import { Hono } from 'hono';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { subscriptionGuard } from '../../services/subscription.guard';
import { aiProxyRateLimit } from '../../middleware/ratelimit';
import {
  calculateTokenCost,
  checkBalance,
  getOrgBillingFromRequest,
  parseOpenAIUsage,
  parseAnthropicUsage,
  processUsage,
  UsageProcessingTransformStream,
} from './_lib/costMetering';
import {
  resolveProvider,
  listModels,
  PROVIDER_CONFIG,
  type Provider,
} from './_lib/modelRegistry';
import {
  openaiToAnthropic,
  anthropicResponseToOpenai,
  AnthropicToOpenAIStream,
} from './_lib/formatTranslation';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', subscriptionGuard);
app.use('*', aiProxyRateLimit);
app.options('/*', (c) => new Response(null, { status: 204 }));

// ---------------------------------------------------------------------------
// GET /v1/models
// ---------------------------------------------------------------------------
app.get('/models', (c) => {
  const models = listModels();
  return c.json({
    object: 'list',
    data: models.map((m) => ({
      id: m.id,
      object: 'model',
      created: 0,
      owned_by: m.provider,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /v1/chat/completions
// ---------------------------------------------------------------------------
app.post('/chat/completions', async (c) => {
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

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const modelId = body.model as string | undefined;
  if (!modelId) {
    return c.json({ error: 'model field is required' }, 400);
  }

  const entry = resolveProvider(modelId);
  if (!entry) {
    return c.json({ error: `Unknown model: ${modelId}. Use GET /v1/models to list available models.` }, 400);
  }

  const config = PROVIDER_CONFIG[entry.provider];
  const apiKey = process.env[config.envKey];
  if (!apiKey) {
    return c.json({ error: `${entry.provider} API key not configured` }, 500);
  }

  const isStreaming = body.stream === true;

  // Build upstream request
  let upstreamBody: string;
  let upstreamUrl: string;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [config.authHeader]: `${config.authPrefix}${apiKey}`,
    ...config.extraHeaders,
  };

  if (entry.format === 'anthropic') {
    const anthropicBody = openaiToAnthropic(body);
    upstreamBody = JSON.stringify(anthropicBody);
    upstreamUrl = `${config.baseUrl}/messages`;
  } else {
    // OpenAI-compatible: inject stream_options for usage tracking
    if (isStreaming) {
      body.stream_options = { ...(body.stream_options as Record<string, unknown> ?? {}), include_usage: true };
    }
    upstreamBody = JSON.stringify(body);
    upstreamUrl = `${config.baseUrl}/chat/completions`;
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'POST',
    headers,
    body: upstreamBody,
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
  const isSSE = contentType.includes('text/event-stream');

  // ── Streaming ──────────────────────────────────────────────────────────
  if (isSSE && upstreamResponse.body) {
    let responseStream: ReadableStream<Uint8Array> = upstreamResponse.body;

    // Anthropic SSE → OpenAI SSE translation
    if (entry.format === 'anthropic') {
      responseStream = responseStream.pipeThrough(new AnthropicToOpenAIStream(modelId));
    }

    const usageStream = new UsageProcessingTransformStream({
      orgBillingId: billing.orgBillingId,
      userId: billing.userId,
      serviceType: 'ai_inference',
      provider: entry.provider,
      resource: 'chat/completions',
      calculateCost: (usage) => calculateTokenCost(usage.model, usage.inputTokens, usage.outputTokens),
    });

    c.req.raw.signal.addEventListener('abort', () => {
      usageStream.finalize().catch(err =>
        console.error('[ai-proxy] Error billing on stream abort:', err)
      );
    });

    const responseHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'x-af-balance-cents': balanceCheck.balanceCents.toString(),
      'x-af-provider': entry.provider,
    };

    return new Response(responseStream.pipeThrough(usageStream), {
      status: 200,
      headers: responseHeaders,
    });
  }

  // ── JSON response ──────────────────────────────────────────────────────
  const responseBody = (await upstreamResponse.json()) as Record<string, unknown>;

  let openaiResponse: Record<string, unknown>;
  if (entry.format === 'anthropic') {
    openaiResponse = anthropicResponseToOpenai(responseBody, modelId);
  } else {
    openaiResponse = responseBody;
  }

  const parseUsage = entry.format === 'anthropic' ? parseAnthropicUsage : parseOpenAIUsage;
  const usage = parseUsage(entry.format === 'anthropic' ? responseBody : openaiResponse);

  if (usage) {
    const usdCostRaw = calculateTokenCost(usage.model, usage.inputTokens, usage.outputTokens);

    // Fail-closed: retry once on transient failure, then return 500
    let result: Awaited<ReturnType<typeof processUsage>> | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await processUsage({
          orgBillingId: billing.orgBillingId,
          userId: billing.userId,
          serviceType: 'ai_inference',
          provider: entry.provider,
          resource: 'chat/completions',
          model: usage.model,
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

    return c.json(openaiResponse, 200, {
      'x-af-balance-cents': result!.newBalanceCents.toString(),
      'x-af-provider': entry.provider,
    });
  }

  return c.json(openaiResponse, 200, {
    'x-af-balance-cents': balanceCheck.balanceCents.toString(),
    'x-af-provider': entry.provider,
  });
});

export default app;
