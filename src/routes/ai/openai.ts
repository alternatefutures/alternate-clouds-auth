/**
 * OpenAI Proxy Routes
 * Proxies requests to OpenAI API with USD metering
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
  UsageProcessingTransformStream,
} from './_lib/costMetering';
import { IMAGE_GENERATION_COSTS } from './_lib/costs';

const app = new Hono();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * Calculate cost for OpenAI chat completions
 */
function calculateChatCompletionsCost(model: string, inputTokens: number, outputTokens: number): number {
  return calculateTokenCost(model, inputTokens, outputTokens);
}

/**
 * Calculate cost for OpenAI image generation
 */
function calculateImageCost(model: string, imageCount: number, size: string, quality: string): number {
  const modelPricing = IMAGE_GENERATION_COSTS[model];
  if (!modelPricing) {
    // Default pricing
    return imageCount * 0.04;
  }

  const qualityPricing = modelPricing[quality] || modelPricing.default;
  const price = qualityPricing?.[size] || qualityPricing?.default || 0.04;

  return imageCount * price;
}

/**
 * OPTIONS handler for CORS preflight
 */
app.options('/*', (c) => {
  return c.text('', 204);
});

/**
 * Catch-all proxy handler
 * POST /ai/openai/*
 */
app.all('/*', async (c) => {
  if (!OPENAI_API_KEY) {
    return c.json({ error: 'OpenAI API key not configured' }, 500);
  }

  const user = requireAuthUser(c);

  // Get org billing info
  const billing = await getOrgBillingFromRequest(c);
  if (!billing) {
    return c.json({ error: 'Organization ID required (X-Organization-Id header)' }, 400);
  }

  const path = c.req.path.replace(/^\/ai\/openai\/?/, '');
  const proxyUrl = `${OPENAI_BASE_URL}/${path}`;
  const endpoint = path.split('?')[0];

  // Server-side worst-case cost gate (replaces caller-controlled
  // X-Min-Balance-Cents header). The probe also injects
  // stream_options.include_usage for chat/completions and Responses API
  // streams so usage events are emitted.
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

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  };
  if (probe.rebuiltBody) headers['Content-Length'] = String(probe.rebuiltBody.byteLength);

  const upstreamResponse = await fetch(proxyUrl, {
    method: c.req.method,
    headers,
    body: probe.rebuiltBody,
  });

  // Handle non-OK responses
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
      provider: 'openai',
      resource: endpoint,
      calculateCost: (usage) => calculateChatCompletionsCost(usage.model, usage.inputTokens, usage.outputTokens),
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

  // Handle JSON response
  const responseBody = await upstreamResponse.json();

  // Process usage based on endpoint type
  let usdCostRaw = 0;
  let model = '';

  if (endpoint.includes('chat/completions') || endpoint.includes('responses')) {
    const usage = parseOpenAIUsage(responseBody);
    if (usage) {
      model = usage.model;
      usdCostRaw = calculateChatCompletionsCost(usage.model, usage.inputTokens, usage.outputTokens);
    }
  } else if (endpoint.includes('images/generations')) {
    // probe.bodyJson is the already-parsed request body (we consumed
    // c.req.raw via probeProxyRequestBody), so we can't re-call c.req.json().
    const reqBody = (probe.bodyJson ?? {}) as Record<string, unknown>;
    model = (reqBody.model as string | undefined) || 'dall-e-3';
    const imageCount = (reqBody.n as number | undefined) || 1;
    const size = (reqBody.size as string | undefined) || '1024x1024';
    const quality = (reqBody.quality as string | undefined) || 'standard';
    usdCostRaw = calculateImageCost(model, imageCount, size, quality);
  } else if (endpoint.includes('embeddings')) {
    const usage = responseBody.usage as { total_tokens?: number } | undefined;
    model = responseBody.model || 'text-embedding-3-small';
    const totalTokens = usage?.total_tokens || 0;
    usdCostRaw = calculateTokenCost(model, totalTokens, 0);
  } else if (endpoint.includes('audio/transcriptions') || endpoint.includes('audio/translations')) {
    model = 'whisper-1';
    usdCostRaw = 0.006;
  } else if (endpoint.includes('audio/speech')) {
    const reqBody = (probe.bodyJson ?? {}) as Record<string, unknown>;
    model = (reqBody.model as string | undefined) || 'tts-1';
    const inputLength = ((reqBody.input as string | undefined) || '').length;
    usdCostRaw = inputLength * (model === 'tts-1-hd' ? 0.00003 : 0.000015);
  }

  if (usdCostRaw > 0) {
    // Fail-closed: retry once on transient failure, then return 500
    let result: Awaited<ReturnType<typeof processUsage>> | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await processUsage({
          orgBillingId: billing.orgBillingId,
          userId: billing.userId,
          serviceType: 'ai_inference',
          provider: 'openai',
          resource: endpoint,
          model,
          usdCostRaw,
        });
        break;
      } catch (error) {
        if (attempt === 1) {
          console.error('CRITICAL: AI usage billing failed after retry — blocking response', error);
          return c.json({ error: 'Billing processing failed. Your account was not charged. Please retry.' }, 500);
        }
        console.warn('AI usage billing failed, retrying...', error);
      }
    }

    return c.json(responseBody, 200, {
      'x-af-balance-cents': result!.newBalanceCents.toString(),
    });
  }

  return c.json(responseBody, 200, {
    'x-af-balance-cents': balanceCheck.balanceCents.toString(),
  });
});

export default app;
