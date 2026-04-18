/**
 * ElevenLabs Proxy Routes
 * Proxies requests to ElevenLabs API with USD metering
 */

import { Hono } from 'hono';
import { requireAuthUser } from '../../middleware/auth';
import {
  checkBalance,
  FLAT_MIN_BALANCE_CENTS,
  getOrgBillingFromRequest,
  processUsage,
} from './_lib/costMetering';
import { INPUT_COST_PER_TOKEN } from './_lib/costs';

const app = new Hono();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

app.options('/*', (c) => c.text('', 204));

function calculateElevenLabsCost(model: string, textLength: number): number {
  const costPerChar = INPUT_COST_PER_TOKEN[model];
  if (typeof costPerChar === 'number') {
    return textLength * costPerChar;
  }
  // Default: $0.18 per 1000 chars
  return textLength * 0.00018;
}

app.all('/*', async (c) => {
  if (!ELEVENLABS_API_KEY) {
    return c.json({ error: 'ElevenLabs API key not configured' }, 500);
  }

  const user = requireAuthUser(c);
  const billing = await getOrgBillingFromRequest(c);
  if (!billing) {
    return c.json({ error: 'Organization ID required (X-Organization-Id header)' }, 400);
  }

  // Server-side worst-case floor (replaces caller-controlled
  // X-Min-Balance-Cents header). ElevenLabs is per-character pricing —
  // the flat floor gates empty wallets without buffering arbitrary
  // multipart audio payloads.
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

  const path = c.req.path.replace(/^\/ai\/elevenlabs\/?/, '');
  const proxyUrl = `${ELEVENLABS_BASE_URL}/${path}`;
  const endpoint = path.split('?')[0];

  const proxyRequest = c.req.raw.clone();

  const headers: Record<string, string> = {};
  for (const [key, value] of proxyRequest.headers) {
    if (key.toLowerCase() !== 'host' && !key.toLowerCase().startsWith('x-')) {
      headers[key] = value;
    }
  }
  headers['xi-api-key'] = ELEVENLABS_API_KEY;

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

  let model = 'eleven_multilingual_v2';
  let textLength = 0;

  try {
    const requestBody = await c.req.json().catch(() => ({}));
    if (requestBody.model_id) model = requestBody.model_id;
    if (requestBody.text) textLength = requestBody.text.length;
  } catch {
    // Use defaults
  }

  const usdCostRaw = textLength > 0 ? calculateElevenLabsCost(model, textLength) : 0.01;
  const contentType = upstreamResponse.headers.get('content-type') || '';

  try {
    const result = await processUsage({
      orgBillingId: billing.orgBillingId,
      userId: billing.userId,
      serviceType: 'ai_inference',
      provider: 'elevenlabs',
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
