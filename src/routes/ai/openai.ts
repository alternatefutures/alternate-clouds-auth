/**
 * OpenAI Proxy Routes
 * Proxies requests to OpenAI API with USD metering
 */

import { Hono } from 'hono';
import { requireAuthUser } from '../../middleware/auth';
import {
  calculateTokenCost,
  checkBalance,
  getOrgBillingFromRequest,
  parseOpenAIUsage,
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

  // Check for minimum balance requirement (in cents)
  const minBalanceHeader = c.req.header('X-Min-Balance-Cents');
  const minBalanceCents = minBalanceHeader ? parseInt(minBalanceHeader, 10) : 1;

  // Check balance before proxying
  const balanceCheck = await checkBalance(billing.orgBillingId, minBalanceCents);
  if (!balanceCheck.hasBalance) {
    return c.json({
      error: 'Insufficient balance',
      balance_cents: balanceCheck.balanceCents,
      balance_usd: (balanceCheck.balanceCents / 100).toFixed(2),
    }, 402);
  }

  // Get the path after /ai/openai/
  const path = c.req.path.replace(/^\/ai\/openai\/?/, '');
  const proxyUrl = `${OPENAI_BASE_URL}/${path}`;
  const endpoint = path.split('?')[0];

  // Build headers - filter out host and x-* headers
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  };
  
  // Get request body
  let requestBody: string | undefined;
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    try {
      const body = await c.req.json();
      // Inject stream_options.include_usage for streaming requests
      if ((endpoint.includes('chat/completions') || endpoint.includes('responses')) && body.stream === true) {
        body.stream_options = { ...body.stream_options, include_usage: true };
      }
      requestBody = JSON.stringify(body);
    } catch {
      // If body parsing fails, try to get raw text
      requestBody = await c.req.text();
    }
  }

  // Make upstream request
  const upstreamResponse = await fetch(proxyUrl, {
    method: c.req.method,
    headers,
    body: requestBody,
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
    // Handle streaming response
    const transformStream = new UsageProcessingTransformStream({
      orgBillingId: billing.orgBillingId,
      userId: billing.userId,
      serviceType: 'ai_inference',
      provider: 'openai',
      resource: endpoint,
      calculateCost: (usage) => calculateChatCompletionsCost(usage.model, usage.inputTokens, usage.outputTokens),
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
    const reqBody = await c.req.json().catch(() => ({}));
    model = reqBody.model || 'dall-e-3';
    const imageCount = reqBody.n || 1;
    const size = reqBody.size || '1024x1024';
    const quality = reqBody.quality || 'standard';
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
    const reqBody = await c.req.json().catch(() => ({}));
    model = reqBody.model || 'tts-1';
    const inputLength = (reqBody.input || '').length;
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
