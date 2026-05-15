/**
 * AI Cost Metering Utilities
 * Handles USD billing, usage logging, and streaming response processing
 * All monetary values in USD (dollars, not cents) unless otherwise specified
 */

import { Context } from 'hono';
import { nanoid } from 'nanoid';
import { dbService, USAGE_MARGIN_RATE } from '../../../services/db.service';
import { audit } from '../../../lib/audit';
import {
  INPUT_COST_PER_TOKEN,
  OUTPUT_COST_PER_TOKEN,
  DEFAULT_INPUT_COST_PER_TOKEN,
  DEFAULT_OUTPUT_COST_PER_TOKEN,
} from './costs';

// ============================================
// TYPES
// ============================================

export interface UsageInfo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
}

export interface UsageProcessingResult {
  usdCostRaw: number; // Raw provider cost
  usdCharged: number; // Amount charged to user (with margin)
  newBalanceCents: number; // Remaining balance in cents
}

export type OutputCostCalculationFn = (
  request: Request,
  response: Response,
  provider: string,
  endpoint: string,
) => Promise<number>;

// ============================================
// MARGIN CALCULATION
// ============================================

/**
 * Calculate USD to charge with markup.
 * Formula: usdCharged = usdCostRaw * (1 + markupRate)
 * Example: $1.00 raw cost with 25% markup → $1.00 * 1.25 = $1.25 charged
 *
 * @param usdCostRaw  Raw provider cost in USD
 * @param markupRate  Per-plan markup (e.g. 0.25 for 25%). Falls back to global USAGE_MARGIN_RATE.
 */
export function calculateUsdWithMargin(
  usdCostRaw: number,
  markupRate?: number,
): {
  usdCharged: number;
  marginRate: number;
} {
  const rate = markupRate ?? USAGE_MARGIN_RATE;
  const usdCharged = usdCostRaw * (1 + rate);

  return {
    usdCharged,
    marginRate: rate,
  };
}

// ============================================
// TOKEN COST CALCULATION
// ============================================

export function calculateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const inputCostPerToken = INPUT_COST_PER_TOKEN[model];
  const outputCostPerToken = OUTPUT_COST_PER_TOKEN[model];

  // Use defaults if model not found
  const inputCost = typeof inputCostPerToken === 'number'
    ? inputCostPerToken
    : DEFAULT_INPUT_COST_PER_TOKEN;
  const outputCost = typeof outputCostPerToken === 'number'
    ? outputCostPerToken
    : DEFAULT_OUTPUT_COST_PER_TOKEN;

  return inputTokens * inputCost + outputTokens * outputCost;
}

// ============================================
// SERVER-SIDE MIN-BALANCE & WORST-CASE ESTIMATION
// ============================================
//
// These helpers replace the legacy `X-Min-Balance-Cents` header. The header
// was user-controlled, so a caller could trivially set `X-Min-Balance-Cents: 1`
// and bypass the pre-flight balance gate even when the request was guaranteed
// to debit far more than the user's remaining balance — leaving the system
// holding the bag for the upstream provider's bill.
//
// We now compute the worst-case cost server-side from the request body and
// the model's published per-token pricing.

/**
 * Approximate token count from a string of text. Use 4 chars / token as a
 * rough universal heuristic — accurate enough for *gating* (we want to err
 * on the high side) without dragging tiktoken into hot path.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Default cap when the request omits `max_tokens`. Most providers will
 * happily generate up to their context-window output limit if unset, so we
 * have to assume a generous cap. 4096 is the common modern default and is
 * comfortably below most context windows. Override per-route if needed.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/** Absolute floor for any min-balance check, in cents. */
const MIN_BALANCE_FLOOR_CENTS = 1;

function pickInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function countCharsInChatMessages(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let chars = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const content = (m as Record<string, unknown>).content;
    if (typeof content === 'string') {
      chars += content.length;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === 'object') {
          const t = (part as Record<string, unknown>).text;
          if (typeof t === 'string') chars += t.length;
        }
      }
    }
  }
  return chars;
}

function countCharsInAnthropicSystem(system: unknown): number {
  if (typeof system === 'string') return system.length;
  if (Array.isArray(system)) {
    let chars = 0;
    for (const part of system) {
      if (part && typeof part === 'object') {
        const t = (part as Record<string, unknown>).text;
        if (typeof t === 'string') chars += t.length;
      }
    }
    return chars;
  }
  return 0;
}

/**
 * Estimate the worst-case input/output token counts for a chat-style
 * request body (OpenAI- or Anthropic-shaped). Used for both:
 *   1. The pre-flight min-balance gate (`estimateChatRequestMaxCostCents`).
 *   2. The streaming-fallback bill when usage events never arrived.
 */
export function estimateChatWorstCaseUsage(
  body: Record<string, unknown>,
  modelId: string,
): UsageInfo {
  const inputChars =
    countCharsInChatMessages(body.messages) +
    countCharsInAnthropicSystem(body.system);

  const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);

  const outputTokens =
    pickInteger(body.max_tokens) ??
    pickInteger(body.max_completion_tokens) ??
    DEFAULT_MAX_OUTPUT_TOKENS;

  return { model: modelId, inputTokens, outputTokens };
}

/**
 * Compute the worst-case cents the request *could* debit, before the
 * upstream call. Used for the pre-flight balance gate.
 *
 * @param body          Parsed request body
 * @param modelId       Resolved model id
 * @param planMarkup    Plan-specific markup (optional — falls back to
 *                      the global USAGE_MARGIN_RATE when omitted).
 */
export function estimateChatRequestMaxCostCents(
  body: Record<string, unknown>,
  modelId: string,
  planMarkup?: number,
): number {
  const usage = estimateChatWorstCaseUsage(body, modelId);
  const usdCostRaw = calculateTokenCost(usage.model, usage.inputTokens, usage.outputTokens);
  const { usdCharged } = calculateUsdWithMargin(usdCostRaw, planMarkup);
  return Math.max(MIN_BALANCE_FLOOR_CENTS, Math.ceil(usdCharged * 100));
}

/**
 * Conservative flat minimum for routes whose body shape is too varied to
 * estimate (image gen, TTS, video). 10 cents is enough for one image at
 * the cheapest tier (DALL-E 2 256×256 = $0.016) but still gates out
 * already-empty wallets.
 */
export const FLAT_MIN_BALANCE_CENTS = 10;

/**
 * Shared probe used by every catch-all proxy (openai, anthropic, groq,
 * deepseek, openrouter, together, xai). Reads the request body once,
 * tries to detect a chat-completion shape, and returns:
 *
 *   - rebuiltBody:    bytes to forward upstream (with `stream_options`
 *                     injected when applicable)
 *   - minBalanceCents: server-side worst-case cost estimate (or the flat
 *                     floor when the body shape is unknown)
 *   - fallbackUsage:  the worst-case `UsageInfo` to bill if the upstream
 *                     stream finishes without an authoritative usage
 *                     event (chat-style endpoints only)
 *
 * Returns `null` for HEAD/GET requests with no body.
 */
export interface ProbedProxyRequest {
  rebuiltBody: Uint8Array | undefined;
  minBalanceCents: number;
  fallbackUsage?: UsageInfo;
  /** True when we recognised a chat-completion-shaped JSON body. */
  isChatStyle: boolean;
  /** Parsed body, exposed so callers can extract `model` etc. without re-parsing. */
  bodyJson: Record<string, unknown> | null;
}

export async function probeProxyRequestBody(
  rawRequest: Request,
  endpoint: string,
  planMarkup?: number,
): Promise<ProbedProxyRequest> {
  if (rawRequest.method === 'GET' || rawRequest.method === 'HEAD') {
    return {
      rebuiltBody: undefined,
      minBalanceCents: FLAT_MIN_BALANCE_CENTS,
      isChatStyle: false,
      bodyJson: null,
    };
  }

  const buffered = new Uint8Array(await rawRequest.arrayBuffer());

  let bodyJson: Record<string, unknown> | null = null;
  try {
    bodyJson = JSON.parse(new TextDecoder().decode(buffered)) as Record<string, unknown>;
  } catch {
    // Non-JSON body (multipart, raw audio, etc.) — fall through with flat min.
  }

  const isChatLikeEndpoint =
    endpoint.includes('chat/completions') ||
    endpoint.includes('messages') ||
    endpoint.includes('/responses');

  const hasChatShape =
    !!bodyJson &&
    typeof bodyJson.model === 'string' &&
    (Array.isArray(bodyJson.messages) || Array.isArray((bodyJson as Record<string, unknown>).input));

  if (bodyJson && isChatLikeEndpoint && hasChatShape) {
    const modelId = bodyJson.model as string;

    // Inject stream_options.include_usage for OpenAI-compatible streams so
    // the upstream actually emits a usage event we can parse.
    if (
      bodyJson.stream === true &&
      (endpoint.includes('chat/completions') || endpoint.includes('/responses'))
    ) {
      bodyJson.stream_options = {
        ...(bodyJson.stream_options as Record<string, unknown> | undefined ?? {}),
        include_usage: true,
      };
    }

    const rebuiltBody = new TextEncoder().encode(JSON.stringify(bodyJson));
    const fallbackUsage = estimateChatWorstCaseUsage(bodyJson, modelId);
    const minBalanceCents = estimateChatRequestMaxCostCents(bodyJson, modelId, planMarkup);

    return {
      rebuiltBody,
      minBalanceCents,
      fallbackUsage,
      isChatStyle: true,
      bodyJson,
    };
  }

  return {
    rebuiltBody: buffered.byteLength > 0 ? buffered : undefined,
    minBalanceCents: FLAT_MIN_BALANCE_CENTS,
    isChatStyle: false,
    bodyJson,
  };
}

// ============================================
// RESPONSE PARSING UTILITIES
// ============================================

/**
 * Parse usage from OpenAI-style JSON response
 */
export function parseOpenAIUsage(data: unknown): UsageInfo | null {
  const obj = data as Record<string, unknown>;
  if (!obj || typeof obj !== 'object') return null;

  const usage = obj.usage as Record<string, number> | undefined;
  const model = obj.model as string | undefined;

  if (!usage || !model) return null;

  return {
    model,
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens,
  };
}

/**
 * Parse usage from Anthropic-style JSON response
 */
export function parseAnthropicUsage(data: unknown): UsageInfo | null {
  const obj = data as Record<string, unknown>;
  if (!obj || typeof obj !== 'object') return null;

  const usage = obj.usage as Record<string, number> | undefined;
  const model = obj.model as string | undefined;

  if (!usage || !model) return null;

  return {
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  };
}

/**
 * Parse SSE streaming response to extract usage
 * Handles both OpenAI and Anthropic formats
 */
export function parseSSEForUsage(text: string): UsageInfo | null {
  const lines = text.split('\n').filter(Boolean);

  // Track model and usage across events
  let model = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let foundUsage = false;

  for (const line of lines) {
    if (!line.startsWith('data:')) continue;

    try {
      const data = line.substring(5).trim();
      if (data === '[DONE]') continue;

      const parsed = JSON.parse(data);

      // OpenAI format: usage in final chunk
      if (parsed.usage) {
        model = parsed.model || model;
        inputTokens = parsed.usage.prompt_tokens ?? parsed.usage.input_tokens ?? inputTokens;
        outputTokens = parsed.usage.completion_tokens ?? parsed.usage.output_tokens ?? outputTokens;
        foundUsage = true;
      }

      // OpenAI Responses API format
      if (parsed.type === 'response.completed' && parsed.response?.usage) {
        model = parsed.response.model || model;
        inputTokens = parsed.response.usage.input_tokens ?? inputTokens;
        outputTokens = parsed.response.usage.output_tokens ?? outputTokens;
        foundUsage = true;
      }

      // Anthropic format: message_start has input tokens
      if (parsed.type === 'message_start' && parsed.message?.usage) {
        model = parsed.message.model || model;
        inputTokens = parsed.message.usage.input_tokens ?? inputTokens;
      }

      // Anthropic format: message_delta has output tokens
      if (parsed.type === 'message_delta' && parsed.usage) {
        outputTokens = parsed.usage.output_tokens ?? outputTokens;
        foundUsage = true;
      }

      // Track model from any event
      if (parsed.model) {
        model = parsed.model;
      }
    } catch {
      continue;
    }
  }

  if (!foundUsage || !model) return null;

  return { model, inputTokens, outputTokens };
}

// ============================================
// USAGE PROCESSING (USD)
// ============================================

/**
 * Process usage for a completed request
 * Deducts from balance and logs usage - all in USD
 */
export async function processUsage(args: {
  orgBillingId: string;
  userId: string;
  serviceType: string; // ai_inference, compute, storage, etc.
  provider: string;
  resource: string; // endpoint or resource name
  model?: string;
  usdCostRaw: number;
  requestId?: string;
  metadata?: Record<string, unknown>;
}): Promise<UsageProcessingResult> {
  const { orgBillingId, userId, serviceType, provider, resource, model, usdCostRaw, requestId, metadata = {} } = args;

  // Look up the org's plan-specific markup rate (falls back to global default)
  const planMarkup = await dbService.getUsageMarkupForOrg(orgBillingId);

  // Calculate USD with plan markup: charged = raw * (1 + rate)
  const { usdCharged, marginRate } = calculateUsdWithMargin(usdCostRaw, planMarkup);

  // Convert to cents for balance deduction
  const amountCents = Math.ceil(usdCharged * 100);

  // Generate idempotency key for debit
  const idempotencyKey = `usage:${orgBillingId}:${requestId || nanoid()}`;

  // Debit + usage-log MUST share a transaction. Previously the two ran
  // sequentially and a usage-log failure (or a process crash between
  // them) left the wallet charged with no audit row — undetectable from
  // the user dashboard.
  const debitResult = await dbService.prismaClient.$transaction(async (tx) => {
    const debit = await dbService.debitOrgBalanceAtomic({
      orgBillingId,
      actorUserId: userId,
      amountCents,
      reason: serviceType,
      idempotencyKey,
      metadata: {
        serviceType,
        provider,
        resource,
        model,
        usdCostRaw,
        usdCharged,
        marginRate,
        ...metadata,
      },
      tx,
    });

    if (!debit.alreadyProcessed) {
      await dbService.logOrgUsage({
        orgBillingId,
        userId,
        serviceType,
        provider,
        resource,
        model,
        usdCostRaw,
        marginRate,
        usdCharged,
        requestId,
        metadata,
        tx,
      });
    }

    return debit;
  });

  // Beta-grade observability for AI proxy traffic. Every settled
  // request (success or worst-case fallback) lands in audit_events so
  // we can answer "how many tokens did user X burn between hh:mm and
  // hh:mm" / "did the streaming fallback fire?" with one SQL query.
  // This complements (not replaces) the per-row usage table — the
  // audit row carries traceId for cross-service correlation.
  audit(dbService.prismaClient, {
    category: 'ai-proxy',
    action: `ai.${provider}.${serviceType}`,
    status: 'ok',
    userId,
    payload: {
      provider,
      model,
      resource,
      usdCostRaw,
      usdCharged,
      marginRate,
      amountCents,
      newBalanceCents: debitResult.balanceCents,
      requestId,
      // Pass through any caller-specified flags (e.g. fallback markers
      // from UsageProcessingTransformStream's parse-failure branch).
      ...metadata,
    },
  });

  return {
    usdCostRaw,
    usdCharged,
    newBalanceCents: debitResult.balanceCents,
  };
}

// ============================================
// STREAMING TRANSFORM
// ============================================

/**
 * Transform stream that captures chunks for usage parsing
 * and processes usage on stream completion
 */
export class UsageProcessingTransformStream extends TransformStream<Uint8Array, Uint8Array> {
  /**
   * Call this from an abort handler to ensure billing fires even if
   * the client disconnects before the stream flushes normally.
   * Safe to call multiple times — billing only fires once.
   */
  finalize: () => Promise<void>;

  constructor(args: {
    orgBillingId: string;
    userId: string;
    serviceType: string;
    provider: string;
    resource: string;
    calculateCost: (usage: UsageInfo) => number;
    onComplete?: (result: UsageProcessingResult) => void;
    /**
     * Worst-case usage to bill if the upstream stream finishes (or the
     * client disconnects) without an authoritative `usage` event.
     *
     * When set, parse failures fall back to billing this estimate rather
     * than letting the request go fully unmetered. Strongly recommended
     * for any chat-completion route — without it, a client that aborts
     * mid-stream pays nothing while we owe the upstream provider for
     * every token that was generated.
     */
    fallbackUsage?: UsageInfo;
    /**
     * Stable identifier used as part of the idempotency key when the
     * fallback bill fires, so retries (e.g. abort + flush in fast
     * succession) don't double-debit.
     */
    fallbackRequestId?: string;
  }) {
    const MAX_TAIL_BYTES = 8192;
    const tailChunks: Uint8Array[] = [];
    let tailBytes = 0;
    const decoder = new TextDecoder();
    let billed = false;

    const doProcessUsage = async () => {
      if (billed) return;
      billed = true;
      try {
        let text = '';
        for (const chunk of tailChunks) {
          text += decoder.decode(chunk, { stream: true });
        }
        text += decoder.decode(new Uint8Array(0));

        let usage = parseSSEForUsage(text);
        let usedFallback = false;

        if (!usage) {
          // Stream ended with no parseable usage event. Bill the
          // worst-case estimate if we have one — otherwise the request
          // would go entirely unmetered (active money leak).
          if (args.fallbackUsage) {
            usage = args.fallbackUsage;
            usedFallback = true;
            console.warn(
              `[ai-proxy] Streaming usage missing — billing worst-case fallback ` +
              `(provider=${args.provider} org=${args.orgBillingId} model=${usage.model} ` +
              `bytes=${tailBytes} input=${usage.inputTokens} output=${usage.outputTokens})`,
            );
          } else {
            if (tailBytes > 0) {
              console.warn(
                `[ai-proxy] Unmetered streaming response (${tailBytes} bytes streamed, ` +
                `usage not parseable, no fallback) — provider=${args.provider} org=${args.orgBillingId}`,
              );
            }
            return;
          }
        }

        const usdCostRaw = args.calculateCost(usage);

        const result = await processUsage({
          orgBillingId: args.orgBillingId,
          userId: args.userId,
          serviceType: args.serviceType,
          provider: args.provider,
          resource: args.resource,
          model: usage.model,
          usdCostRaw,
          requestId: args.fallbackRequestId,
          metadata: usedFallback
            ? { unmeteredFallback: true, fallbackReason: 'sse_parse_failure' }
            : undefined,
        });

        args.onComplete?.(result);
      } catch (error) {
        console.error('[ai-proxy] Error processing usage in stream:', error);
      }
    };

    super({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        tailChunks.push(chunk);
        tailBytes += chunk.byteLength;
        while (tailBytes > MAX_TAIL_BYTES && tailChunks.length > 1) {
          tailBytes -= tailChunks.shift()!.byteLength;
        }
      },
      flush: () => doProcessUsage(),
    });

    this.finalize = doProcessUsage;
  }
}

// Legacy alias for backwards compatibility
export { UsageProcessingTransformStream as CreditProcessingTransformStream };

// ============================================
// PROXY METERING HELPERS
// ============================================

export interface ProxyMeteringOptions {
  provider: string;
  baseUrl: string;
  authHeader: string;
  authValue: string;
  calculateCost: OutputCostCalculationFn;
}

/**
 * Check if user has sufficient balance before making request
 * @param minCents - Minimum balance required in cents (default: 1 cent)
 */
export async function checkBalance(
  orgBillingId: string,
  minCents: number = 1
): Promise<{ hasBalance: boolean; balanceCents: number }> {
  const balance = await dbService.getOrCreateOrgUsageBalance(orgBillingId);

  const required = Math.max(1, minCents);
  const hasBalance = balance.balance_cents >= required;

  return { hasBalance, balanceCents: balance.balance_cents };
}

// Legacy alias
export { checkBalance as checkCredits };

/**
 * Get organization billing info from request headers.
 * If the authenticated token/session carries an organizationId claim,
 * the X-Organization-Id header MUST match it — prevents a multi-org
 * user from billing requests to a different org than their session scope.
 */
export async function getOrgBillingFromRequest(c: Context): Promise<{
  orgBillingId: string;
  userId: string;
} | null> {
  const orgId = c.req.header('X-Organization-Id');
  const user = c.get('user') as { userId?: string; organizationId?: string; patOrganizationId?: string } | undefined;
  const userId = user?.userId;

  if (!orgId || !userId) {
    return null;
  }

  // If the token was scoped to a specific org, the header must match
  if (user?.organizationId && user.organizationId !== orgId) {
    return null;
  }

  // PAT org scoping: if the PAT was minted for a specific org, enforce it
  if (user?.patOrganizationId && user.patOrganizationId !== orgId) {
    return null;
  }

  // Verify membership
  const isMember = await dbService.isUserMemberOfOrganization(userId, orgId);
  if (!isMember) {
    return null;
  }

  // Get org billing
  const orgBilling = await dbService.getOrganizationBillingByOrgId(orgId);
  if (!orgBilling) {
    return null;
  }
  return {
    orgBillingId: orgBilling.id,
    userId,
  };
}

/**
 * Inject stream_options.include_usage for OpenAI-style streaming requests
 */
export async function injectStreamUsageOption(request: Request): Promise<Request> {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return request;
    }

    const body = await request.clone().json();
    if (body.stream === true) {
      body.stream_options = { ...body.stream_options, include_usage: true };

      return new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(body),
      });
    }

    return request;
  } catch {
    return request;
  }
}
