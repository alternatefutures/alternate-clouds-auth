/**
 * Fal.ai Proxy Routes
 * Proxies requests to Fal.ai API with USD metering
 */

import { Hono } from 'hono';
import { requireAuthUser } from '../../middleware/auth';
import {
  checkBalance,
  FLAT_MIN_BALANCE_CENTS,
  getOrgBillingFromRequest,
  processUsage,
  processUsageFailClosed,
  BillingFailedError,
} from './_lib/costMetering';
import { FAL_AI_COSTS } from './_lib/costs';

const app = new Hono();

const FAL_KEY = process.env.FAL_KEY;
const FAL_BASE_URL = 'https://fal.run';

app.options('/*', (c) => c.text('', 204));

/**
 * Calculate Fal.ai cost based on model and request parameters
 */
function calculateFalCost(modelId: string, requestBody: Record<string, unknown>): number {
  const costConfig = FAL_AI_COSTS[modelId];
  if (!costConfig) {
    return 0.05;
  }

  switch (costConfig.type) {
    case 'per_image': {
      const numImages = (requestBody.num_images as number) || 1;
      return costConfig.rate * numImages;
    }
    case 'per_megapixel': {
      const numImages = (requestBody.num_images as number) || 1;
      const imageSize = requestBody.image_size as { width?: number; height?: number } | string;
      
      let width = 1024;
      let height = 1024;
      
      if (typeof imageSize === 'object' && imageSize) {
        width = imageSize.width || 1024;
        height = imageSize.height || 1024;
      } else if (typeof imageSize === 'string') {
        const presets: Record<string, [number, number]> = {
          'square': [512, 512],
          'square_hd': [1024, 1024],
          'portrait_4_3': [768, 1024],
          'portrait_16_9': [576, 1024],
          'landscape_4_3': [1024, 768],
          'landscape_16_9': [1024, 576],
        };
        const preset = presets[imageSize];
        if (preset) {
          [width, height] = preset;
        }
      }
      
      const megapixels = (width * height) / 1000000;
      return costConfig.rate * megapixels * numImages;
    }
    case 'per_second': {
      const duration = (requestBody.duration as number) || 5;
      return costConfig.rate * duration;
    }
    case 'per_video': {
      return costConfig.rate;
    }
    default:
      return 0.05;
  }
}

async function handleFalRequest(c: any, modelId: string): Promise<Response> {
  if (!FAL_KEY) {
    return c.json({ error: 'Fal.ai API key not configured' }, 500);
  }

  const user = requireAuthUser(c);
  const billing = await getOrgBillingFromRequest(c);
  if (!billing) {
    return c.json({ error: 'Organization ID required (X-Organization-Id header)' }, 400);
  }

  // Server-side worst-case floor (replaces caller-controlled
  // X-Min-Balance-Cents header). Fal.ai is per-image / per-megapixel /
  // per-second pricing — the conservative flat floor is sufficient
  // for gating without buffering arbitrary multipart bodies.
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

  const proxyUrl = `${FAL_BASE_URL}/${modelId}`;
  const proxyRequest = c.req.raw.clone();

  const headers: Record<string, string> = {};
  for (const [key, value] of proxyRequest.headers) {
    if (key.toLowerCase() !== 'host' && !key.toLowerCase().startsWith('x-')) {
      headers[key] = value;
    }
  }
  headers['Authorization'] = `Key ${FAL_KEY}`;

  let requestBody: Record<string, unknown> = {};
  try {
    requestBody = await c.req.json();
  } catch {
    // Empty body
  }

  const upstreamResponse = await fetch(proxyUrl, {
    method: proxyRequest.method,
    headers,
    body: proxyRequest.method !== 'GET' && proxyRequest.method !== 'HEAD' ? JSON.stringify(requestBody) : undefined,
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

  const usdCostRaw = calculateFalCost(modelId, requestBody);

  // Fixed by audit 2026-03: parse JSON once before try/catch to avoid double .json() on consumed body
  const responseBody = await upstreamResponse.json();

  try {
    const result = await processUsageFailClosed({
      orgBillingId: billing.orgBillingId,
      userId: billing.userId,
      serviceType: 'ai_inference',
      provider: 'fal-ai',
      resource: modelId,
      model: modelId,
      usdCostRaw,
    });

    return c.json(responseBody, 200, {
      'x-af-balance-cents': result.newBalanceCents.toString(),
    });
  } catch (error) {
    if (error instanceof BillingFailedError) {
      return c.json({ error: 'Billing processing failed. Your account was not charged. Please retry.' }, 500);
    }
    console.error('Error processing usage:', error);
  }

  return c.json(responseBody, 200, {
    'x-af-balance-cents': balanceCheck.balanceCents.toString(),
  });
}

// Flux models
app.post('/flux/dev', (c) => handleFalRequest(c, 'fal-ai/flux/dev'));
app.post('/flux/schnell', (c) => handleFalRequest(c, 'fal-ai/flux/schnell'));
app.post('/flux-pro/v1.1', (c) => handleFalRequest(c, 'fal-ai/flux-pro/v1.1'));
app.post('/flux-pro/v1.1-ultra', (c) => handleFalRequest(c, 'fal-ai/flux-pro/v1.1-ultra'));

// Other image models
app.post('/recraft-v3', (c) => handleFalRequest(c, 'fal-ai/recraft-v3'));
app.post('/ideogram/v2', (c) => handleFalRequest(c, 'fal-ai/ideogram/v2'));
app.post('/ideogram/v2/turbo', (c) => handleFalRequest(c, 'fal-ai/ideogram/v2/turbo'));

// Video models
app.post('/kling-video/v1/standard/image-to-video', (c) => 
  handleFalRequest(c, 'fal-ai/kling-video/v1/standard/image-to-video'));
app.post('/kling-video/v1/pro/image-to-video', (c) => 
  handleFalRequest(c, 'fal-ai/kling-video/v1/pro/image-to-video'));
app.post('/minimax-video/image-to-video', (c) => 
  handleFalRequest(c, 'fal-ai/minimax-video/image-to-video'));
app.post('/luma-dream-machine/image-to-video', (c) => 
  handleFalRequest(c, 'fal-ai/luma-dream-machine/image-to-video'));

export default app;
