/**
 * OpenRouter Proxy Routes
 * Proxies requests to OpenRouter API with USD metering
 */

import { Hono } from 'hono';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import {
  calculateTokenCost,
  checkBalance,
  getOrgBillingFromRequest,
  parseOpenAIUsage,
  processUsage,
  UsageProcessingTransformStream,
  injectStreamUsageOption,
} from './_lib/costMetering';

const app = new Hono();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

app.use('*', authMiddleware);

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

  const minBalanceHeader = c.req.header('X-Min-Balance-Cents');
  const minBalanceCents = minBalanceHeader ? parseInt(minBalanceHeader, 10) : 1;

  const balanceCheck = await checkBalance(billing.orgBillingId, minBalanceCents);
  if (!balanceCheck.hasBalance) {
    return c.json({
      error: 'Insufficient balance',
      balance_cents: balanceCheck.balanceCents,
      balance_usd: (balanceCheck.balanceCents / 100).toFixed(2),
    }, 402);
  }

  const path = c.req.path.replace(/^\/ai\/openrouter\/?/, '');
  const proxyUrl = `${OPENROUTER_BASE_URL}/${path}`;
  const endpoint = path.split('?')[0];

  let proxyRequest = c.req.raw.clone();
  if (endpoint.includes('chat/completions')) {
    proxyRequest = await injectStreamUsageOption(proxyRequest);
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of proxyRequest.headers) {
    if (key.toLowerCase() !== 'host' && !key.toLowerCase().startsWith('x-')) {
      headers[key] = value;
    }
  }
  headers['Authorization'] = `Bearer ${OPENROUTER_API_KEY}`;

  const upstreamResponse = await fetch(proxyUrl, {
    method: proxyRequest.method,
    headers,
    body: proxyRequest.method !== 'GET' && proxyRequest.method !== 'HEAD' ? proxyRequest.body : undefined,
    // @ts-ignore
    duplex: proxyRequest.method !== 'GET' && proxyRequest.method !== 'HEAD' ? 'half' : undefined,
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
    const transformStream = new UsageProcessingTransformStream({
      orgBillingId: billing.orgBillingId,
      userId: billing.userId,
      serviceType: 'ai_inference',
      provider: 'openrouter',
      resource: endpoint,
      calculateCost: (usage) => calculateTokenCost(usage.model, usage.inputTokens, usage.outputTokens),
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
      const usdCostRaw = calculateTokenCost(usage.model, usage.inputTokens, usage.outputTokens);

      const result = await processUsage({
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
    console.error('Error processing usage:', error);
  }

  return c.json(responseBody, 200, {
    'x-af-balance-cents': balanceCheck.balanceCents.toString(),
  });
});

export default app;
