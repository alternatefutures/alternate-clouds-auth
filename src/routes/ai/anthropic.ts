/**
 * Anthropic Proxy Routes
 * Proxies requests to Anthropic API with USD metering
 */

import { Hono } from 'hono';
import { requireAuthUser } from '../../middleware/auth';
import { nanoid } from 'nanoid';
import {
  calculateTokenCost,
  checkBalance,
  getOrgBillingFromRequest,
  parseAnthropicUsage,
  probeProxyRequestBody,
  processUsage,
  UsageProcessingTransformStream,
} from './_lib/costMetering';

const app = new Hono();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

app.options('/*', (c) => c.text('', 204));

app.all('/*', async (c) => {
  if (!ANTHROPIC_API_KEY) {
    return c.json({ error: 'Anthropic API key not configured' }, 500);
  }

  const user = requireAuthUser(c);

  const billing = await getOrgBillingFromRequest(c);
  if (!billing) {
    return c.json({ error: 'Organization ID required (X-Organization-Id header)' }, 400);
  }

  const path = c.req.path.replace(/^\/ai\/anthropic\/?/, '');
  const proxyUrl = `${ANTHROPIC_BASE_URL}/${path}`;
  const endpoint = path.split('?')[0];

  // Buffer + probe the body so we can compute a server-side worst-case
  // cost before we hit the upstream. The legacy `X-Min-Balance-Cents`
  // header was caller-controlled and trivially bypassable.
  const probe = await probeProxyRequestBody(c.req.raw.clone(), endpoint);

  const balanceCheck = await checkBalance(billing.orgBillingId, probe.minBalanceCents);
  if (!balanceCheck.hasBalance) {
    return c.json({
      error: 'Insufficient balance for worst-case cost of this request',
      balance_cents: balanceCheck.balanceCents,
      balance_usd: (balanceCheck.balanceCents / 100).toFixed(2),
      required_cents: probe.minBalanceCents,
      required_usd: (probe.minBalanceCents / 100).toFixed(2),
    }, 402);
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of c.req.raw.headers) {
    if (key.toLowerCase() !== 'host' && !key.toLowerCase().startsWith('x-')) {
      headers[key] = value;
    }
  }
  headers['x-api-key'] = ANTHROPIC_API_KEY;
  headers['anthropic-version'] = '2023-06-01';
  if (probe.rebuiltBody) headers['Content-Length'] = String(probe.rebuiltBody.byteLength);

  const upstreamResponse = await fetch(proxyUrl, {
    method: c.req.method,
    headers,
    body: probe.rebuiltBody,
  });

  if (!upstreamResponse.ok) {
    const errorBody = await upstreamResponse.text();
    return new Response(errorBody, {
      status: upstreamResponse.status,
      headers: {
        'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json',
        'x-af-balance-cents': balanceCheck.balanceCents.toString(),
      },
    });
  }

  const contentType = upstreamResponse.headers.get('content-type') || '';
  const isStreaming = contentType.includes('text/event-stream');

  if (isStreaming && upstreamResponse.body) {
    const fallbackRequestId = `stream:${nanoid()}`;
    const transformStream = new UsageProcessingTransformStream({
      orgBillingId: billing.orgBillingId,
      userId: billing.userId,
      serviceType: 'ai_inference',
      provider: 'anthropic',
      resource: endpoint,
      calculateCost: (usage) => calculateTokenCost(usage.model, usage.inputTokens, usage.outputTokens),
      fallbackUsage: probe.fallbackUsage,
      fallbackRequestId,
    });

    c.req.raw.signal.addEventListener('abort', () => {
      transformStream.finalize().catch(err =>
        console.error('[ai-proxy] Error billing on stream abort:', err)
      );
    });

    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of upstreamResponse.headers) {
      if (key.toLowerCase() !== 'content-encoding') {
        responseHeaders[key] = value;
      }
    }
    responseHeaders['x-af-balance-cents'] = balanceCheck.balanceCents.toString();

    return new Response(upstreamResponse.body.pipeThrough(transformStream), {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }

  const responseBody = await upstreamResponse.json();

  try {
    const usage = parseAnthropicUsage(responseBody);
    if (usage) {
      const usdCostRaw = calculateTokenCost(usage.model, usage.inputTokens, usage.outputTokens);

      const result = await processUsage({
        orgBillingId: billing.orgBillingId,
        userId: billing.userId,
        serviceType: 'ai_inference',
        provider: 'anthropic',
        resource: endpoint,
        model: usage.model,
        usdCostRaw,
      });

      return c.json(responseBody, 200, {
        'x-af-balance-cents': result.newBalanceCents.toString(),
      });
    }
  } catch (error) {
    console.error('Error processing usage:', error);
  }

  return c.json(responseBody, 200, {
    'x-af-balance-cents': balanceCheck.balanceCents.toString(),
  });
});

export default app;
