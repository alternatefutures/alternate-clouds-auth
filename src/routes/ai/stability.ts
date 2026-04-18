/**
 * Stability AI Proxy Routes
 * Proxies requests to Stability AI API with USD metering
 */

import { Hono } from 'hono';
import { requireAuthUser } from '../../middleware/auth';
import {
  checkBalance,
  FLAT_MIN_BALANCE_CENTS,
  getOrgBillingFromRequest,
  processUsage,
} from './_lib/costMetering';
import { IMAGE_GENERATION_COSTS } from './_lib/costs';

const app = new Hono();

const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const STABILITY_BASE_URL = 'https://api.stability.ai/v2beta';

app.options('/*', (c) => c.text('', 204));

function calculateStabilityCost(model: string, imageCount: number = 1): number {
  const modelPricing = IMAGE_GENERATION_COSTS[model];
  if (modelPricing) {
    return imageCount * (modelPricing.default?.default || 0.03);
  }
  return imageCount * 0.03;
}

app.all('/*', async (c) => {
  if (!STABILITY_API_KEY) {
    return c.json({ error: 'Stability API key not configured' }, 500);
  }

  const user = requireAuthUser(c);
  const billing = await getOrgBillingFromRequest(c);
  if (!billing) {
    return c.json({ error: 'Organization ID required (X-Organization-Id header)' }, 400);
  }

  // Server-side worst-case floor (replaces caller-controlled
  // X-Min-Balance-Cents header). Stability is per-image pricing so the
  // conservative flat floor is sufficient for gating.
  const balanceCheck = await checkBalance(billing.orgBillingId, FLAT_MIN_BALANCE_CENTS);
  if (!balanceCheck.hasBalance) {
    return c.json({
      error: 'Insufficient balance for worst-case cost of this request',
      balance_cents: balanceCheck.balanceCents,
      balance_usd: (balanceCheck.balanceCents / 100).toFixed(2),
      required_cents: FLAT_MIN_BALANCE_CENTS,
      required_usd: (FLAT_MIN_BALANCE_CENTS / 100).toFixed(2),
    }, 402);
  }

  const path = c.req.path.replace(/^\/ai\/stability\/?/, '');
  const proxyUrl = `${STABILITY_BASE_URL}/${path}`;
  const endpoint = path.split('?')[0];

  const proxyRequest = c.req.raw.clone();

  const headers: Record<string, string> = {};
  for (const [key, value] of proxyRequest.headers) {
    if (key.toLowerCase() !== 'host' && !key.toLowerCase().startsWith('x-')) {
      headers[key] = value;
    }
  }
  headers['Authorization'] = `Bearer ${STABILITY_API_KEY}`;

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

  let model = 'stable-diffusion-3';
  let imageCount = 1;

  try {
    const requestBody = await c.req.json().catch(() => ({}));
    if (requestBody.model) model = requestBody.model;
    if (requestBody.samples) imageCount = requestBody.samples;
  } catch {
    // Use defaults
  }

  const contentType = upstreamResponse.headers.get('content-type') || '';
  
  try {
    const usdCostRaw = calculateStabilityCost(model, imageCount);

    const result = await processUsage({
      orgBillingId: billing.orgBillingId,
      userId: billing.userId,
      serviceType: 'ai_inference',
      provider: 'stability',
      resource: endpoint,
      model,
      usdCostRaw,
    });

    if (contentType.includes('application/json')) {
      const responseBody = await upstreamResponse.json();
      return c.json(responseBody, 200, {
        'x-af-balance-cents': result.newBalanceCents.toString(),
      });
    }

    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of upstreamResponse.headers) {
      responseHeaders[key] = value;
    }
    responseHeaders['x-af-balance-cents'] = result.newBalanceCents.toString();

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Error processing usage:', error);
  }

  if (contentType.includes('application/json')) {
    const responseBody = await upstreamResponse.json();
    return c.json(responseBody, 200, {
      'x-af-balance-cents': balanceCheck.balanceCents.toString(),
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers,
  });
});

export default app;
