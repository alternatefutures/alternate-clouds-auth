/**
 * AI Cost Metering Utilities
 * Handles USD billing, usage logging, and streaming response processing
 * All monetary values in USD (dollars, not cents) unless otherwise specified
 */

import { Context } from 'hono';
import { nanoid } from 'nanoid';
import { dbService, USAGE_MARGIN_RATE } from '../../../services/db.service';
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

  // Debit balance atomically (in cents)
  const debitResult = await dbService.debitOrgBalanceAtomic({
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
  });

  // Log usage (in USD)
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

        const usage = parseSSEForUsage(text);
        if (!usage) {
          if (tailBytes > 0) {
            console.warn(`[ai-proxy] Unmetered streaming response (${tailBytes} bytes streamed, usage not parseable) — provider=${args.provider} org=${args.orgBillingId}`);
          }
          return;
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
