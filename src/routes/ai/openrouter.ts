/**
 * OpenRouter Proxy Routes
 * Proxies requests to OpenRouter API with USD metering
 */

import { Hono } from 'hono';
import { requireAuthUser } from '../../middleware/auth';
import { nanoid } from 'nanoid';
import {
  calculateTokenCost,
  checkBalance,
  getOrgBillingFromRequest,
  parseOpenAIUsage,
  probeProxyRequestBody,
  processUsage,
  processUsageFailClosed,
  BillingFailedError,
  UsageProcessingTransformStream,
} from './_lib/costMetering';

const app = new Hono();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

app.options('/*', (c) => c.text('', 204));

app.all('/*', async (c) => {
  if (!OPENROUTER_API_KEY) {
    return c.json({ error: 'OpenRouter API key not configured' }, 500);
  }

  const user = requireAuthUser(c);
  const billing = await getOrgBillingFromRequest(c);
  if (!billing) {
    return c.json({ error: 'Organization ID required (X-Organization-Id header)' }, 400);
  }

  const path = c.req.path.replace(/^\/ai\/openrouter\/?/, '');
  const proxyUrl = `${OPENROUTER_BASE_URL}/${path}`;
  const endpoint = path.split('?')[0];

  // Server-side worst-case cost gate (replaces caller-controlled
  // X-Min-Balance-Cents header). Also injects stream_options.include_usage
  // for chat/completions streams so usage events are emitted.
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
  headers['Authorization'] = `Bearer ${OPENROUTER_API_KEY}`;
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
      provider: 'openrouter',
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
    const usage = parseOpenAIUsage(responseBody);
    if (usage) {
      // OpenRouter returns the authoritative cost (USD) in `usage.cost` for
      // most models — bill that exactly when present; otherwise fall back to
      // our per-token estimate (now frontier-tier for unlisted models).
      // (Audit C2, 2026-06-29.)
      const upstreamCost = (responseBody as { usage?: { cost?: unknown } })?.usage?.cost;
      const usdCostRaw =
        typeof upstreamCost === 'number' && upstreamCost > 0
          ? upstreamCost
          : calculateTokenCost(usage.model, usage.inputTokens, usage.outputTokens);

      const result = await processUsageFailClosed({
        orgBillingId: billing.orgBillingId,
        userId: billing.userId,
        serviceType: 'ai_inference',
        provider: 'openrouter',
        resource: endpoint,
        model: usage.model,
        usdCostRaw,
      });

      return c.json(responseBody, 200, {
        'x-af-balance-cents': result.newBalanceCents.toString(),
      });
    }
  } catch (error) {
    if (error instanceof BillingFailedError) {
      return c.json({ error: 'Billing processing failed. Your account was not charged. Please retry.' }, 500);
    }
    console.error('Error processing usage:', error);
  }

  return c.json(responseBody, 200, {
    'x-af-balance-cents': balanceCheck.balanceCents.toString(),
  });
});

export default app;
