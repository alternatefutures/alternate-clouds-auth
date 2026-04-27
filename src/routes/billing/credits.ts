/**
 * Usage Balance Routes
 * Organization USD wallet, ledger, usage, and topup endpoints
 * All monetary values stored in cents, displayed in USD
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { rateLimit, standardRateLimit } from '../../middleware/ratelimit';
import { auditLogService } from '../../services/auditLog.service';
import { dbService } from '../../services/db.service';
import { getCryptoProvider, getDefaultProvider, isProviderAvailable } from '../../services/payments';
import {
  getCanonicalStablecoinAddress,
  isSupportedChainId,
  isSupportedStablecoin,
  listSupportedStablecoinsForChain,
} from '../../services/payments/stablecoinAllowlist';

/**
 * Best-effort call to service-cloud-api to resume suspended compute after topup.
 */
async function triggerComputeResumeCheck(args: {
  orgBillingId: string;
  organizationId: string;
  newBalanceCents: number;
}): Promise<void> {
  const cloudApiUrl = process.env.CLOUD_API_URL;
  if (!cloudApiUrl) return;

  const secret = process.env.AUTH_INTROSPECTION_SECRET;
  try {
    const res = await fetch(`${cloudApiUrl}/internal/compute/check-resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-af-introspection-secret': secret } : {}),
      },
      body: JSON.stringify(args),
    });

    if (!res.ok) {
      console.error(`[credits] check-resume returned ${res.status}`);
    }
  } catch (err) {
    console.error('[credits] Failed to call check-resume:', err);
  }
}

const app = new Hono();

app.use('*', authMiddleware);
// Apply a generous default rate limit to every credit-balance route.
// Specific high-cost endpoints (topup creation) layer a stricter limit
// on top of this. Without this baseline an authenticated attacker can
// hammer the ledger / balance reads.
app.use('*', standardRateLimit);

/**
 * Strict rate-limit for top-up creation endpoints. These routes mutate
 * payment-provider state (Stripe payment intent, Relay deposit address)
 * and create rows in `auth_payments`, so abuse has both fraud and
 * cost-of-goods consequences. 10/minute/user is comfortably above any
 * legitimate UI usage and well below abuse territory.
 */
const topupCreateRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many top-up requests — slow down and try again in a minute',
  keyGenerator: (c) => {
    const user = c.get('user') as { userId?: string } | undefined;
    const userId = user?.userId ?? c.req.header('x-forwarded-for') ?? 'unknown';
    return `topup-create:${userId}`;
  },
  progressivePenalties: true,
});

// ============================================
// VALIDATION SCHEMAS
// ============================================

const MAX_TOPUP_USD = 10_000;

const topupCreateIntentSchema = z.object({
  usdAmount: z.number()
    .positive('USD amount must be positive')
    .max(MAX_TOPUP_USD, `Topup amount cannot exceed $${MAX_TOPUP_USD.toLocaleString()}`),
});

const topupFinalizeSchema = z.object({
  paymentIntentId: z.string().min(1, 'Payment intent ID is required'),
});

const cryptoTopupCreateSchema = z.object({
  usdAmount: z.number()
    .positive('USD amount must be positive')
    .max(MAX_TOPUP_USD, `Topup amount cannot exceed $${MAX_TOPUP_USD.toLocaleString()}`),
  // Bounded to chains we have an RPC AND a stablecoin allowlist for.
  // The exact combination is rechecked below against the allowlist; the
  // upper bound here is just a defence-in-depth.
  chainId: z.number().int().min(1).max(1_000_000).optional().default(1),
  tokenSymbol: z.string().trim().min(1).max(8).optional().default('USDC'),
});

// ============================================
// HELPER FUNCTIONS
// ============================================

async function verifyOrgMembershipAndGetBilling(userId: string, orgId: string, requiredRoles?: string[]) {
  const member = await dbService.getOrganizationMember(orgId, userId);
  if (!member) {
    return { error: 'Not a member of this organization', status: 403 };
  }

  if (requiredRoles && !requiredRoles.includes(member.role)) {
    return { error: 'Insufficient permissions. OWNER or ADMIN role required.', status: 403 };
  }

  const orgBilling = await dbService.getOrganizationBillingByOrgId(orgId);
  if (!orgBilling) {
    return { error: 'Organization billing not found', status: 404 };
  }

  return { orgBilling };
}

// ============================================
// BALANCE (USD cents)
// ============================================

/**
 * GET /billing/credits/org/:orgId/balance
 * Get organization usage balance (in USD cents)
 */
app.get('/org/:orgId/balance', async (c) => {
  try {
    const user = requireAuthUser(c);
    const { orgId } = c.req.param();

    const result = await verifyOrgMembershipAndGetBilling(user.userId, orgId);
    if ('error' in result) {
      return c.json({ error: result.error }, result.status as 403 | 404);
    }

    const balance = await dbService.getOrCreateOrgUsageBalance(result.orgBilling.id);

    return c.json({
      orgId,
      orgBillingId: result.orgBilling.id,
      balanceCents: balance.balance_cents,
      balanceUsd: (balance.balance_cents / 100).toFixed(2),
      updatedAt: balance.updated_at,
    });
  } catch (error) {
    console.error('Get balance error:', error);
    return c.json({ error: 'Failed to get balance' }, 500);
  }
});

// ============================================
// LEDGER (USD cents)
// ============================================

/**
 * GET /billing/credits/org/:orgId/ledger
 * Get organization usage ledger (append-only audit log)
 */
app.get('/org/:orgId/ledger', async (c) => {
  try {
    const user = requireAuthUser(c);
    const { orgId } = c.req.param();

    const memberResult = await verifyOrgMembershipAndGetBilling(user.userId, orgId);
    if ('error' in memberResult) {
      return c.json({ error: memberResult.error }, memberResult.status as 403 | 404);
    }

    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
    const cursor = c.req.query('cursor');
    const direction = c.req.query('direction') as 'CREDIT' | 'DEBIT' | undefined;
    const reason = c.req.query('reason');

    const result = await dbService.getOrgUsageLedger({
      orgBillingId: memberResult.orgBilling.id,
      limit,
      cursor,
      direction,
      reason,
    });

    return c.json({
      items: result.items.map((item) => ({
        id: item.id,
        direction: item.direction,
        amountCents: item.amount_cents,
        amountUsd: (item.amount_cents / 100).toFixed(2),
        reason: item.reason,
        idempotencyKey: item.idempotency_key,
        metadata: item.metadata,
        actorUserId: item.actor_user_id,
        createdAt: item.created_at,
      })),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    console.error('Get ledger error:', error);
    return c.json({ error: 'Failed to get ledger' }, 500);
  }
});

// ============================================
// USAGE LOG (USD)
// ============================================

/**
 * GET /billing/credits/org/:orgId/usage
 * Get organization usage log (all service usage history)
 */
app.get('/org/:orgId/usage', async (c) => {
  try {
    const user = requireAuthUser(c);
    const { orgId } = c.req.param();

    const memberResult = await verifyOrgMembershipAndGetBilling(user.userId, orgId);
    if ('error' in memberResult) {
      return c.json({ error: memberResult.error }, memberResult.status as 403 | 404);
    }

    const periodStartStr = c.req.query('periodStart');
    const periodEndStr = c.req.query('periodEnd');
    const serviceType = c.req.query('serviceType');
    const periodStart = periodStartStr ? parseInt(periodStartStr, 10) : undefined;
    const periodEnd = periodEndStr ? parseInt(periodEndStr, 10) : undefined;

    const result = await dbService.getOrgUsageLog({
      orgBillingId: memberResult.orgBilling.id,
      serviceType,
      periodStart,
      periodEnd,
    });

    return c.json({
      summary: {
        usdCharged: result.summary.usdCharged,
      },
      items: result.items.map((item) => ({
        id: item.id,
        serviceType: item.service_type,
        provider: item.provider,
        resource: item.resource,
        model: item.model,
        usdCharged: item.usd_charged,
        createdAt: item.created_at,
      })),
    });
  } catch (error) {
    console.error('Get usage error:', error);
    return c.json({ error: 'Failed to get usage' }, 500);
  }
});

// ============================================
// TOPUP FLOW (USD)
// ============================================

/**
 * POST /billing/credits/org/:orgId/topup/create-intent
 * Create a Stripe PaymentIntent for topping up balance
 */
app.post('/org/:orgId/topup/create-intent', topupCreateRateLimit, async (c) => {
  try {
    const user = requireAuthUser(c);
    const { orgId } = c.req.param();

    const memberResult = await verifyOrgMembershipAndGetBilling(user.userId, orgId, ['OWNER', 'ADMIN']);
    if ('error' in memberResult) {
      return c.json({ error: memberResult.error }, memberResult.status as 403 | 404);
    }

    const body = await c.req.json();
    const data = topupCreateIntentSchema.parse(body);

    const amountCents = Math.round(data.usdAmount * 100);

    let stripeCustomerId = memberResult.orgBilling.stripe_customer_id;
    
    if (!stripeCustomerId) {
      const provider = getDefaultProvider();
      if (!provider.createCustomer) {
        return c.json({ error: 'Payment provider does not support customer creation' }, 500);
      }

      const org = await dbService.getOrganizationById(orgId);
      const userDetails = await dbService.getUserById(user.userId);

      const customer = await provider.createCustomer({
        email: userDetails?.email ?? undefined,
        name: org?.name ?? 'Organization',
        metadata: {
          orgId,
          orgBillingId: memberResult.orgBilling.id,
          type: 'org_billing',
        },
      });

      await dbService.updateOrganizationBilling(memberResult.orgBilling.id, {
        stripe_customer_id: customer.id,
      });

      stripeCustomerId = customer.id;
    }

    const provider = getDefaultProvider();
    if (!provider.createPaymentIntent) {
      return c.json({ error: 'Payment provider does not support payment intents' }, 500);
    }

    const paymentIntent = await provider.createPaymentIntent({
      amount: amountCents,
      currency: 'usd',
      customerId: stripeCustomerId,
      metadata: {
        type: 'org_credits_topup',
        orgId,
        orgBillingId: memberResult.orgBilling.id,
        userId: user.userId,
        amountCents: amountCents.toString(),
      },
    });

    return c.json({
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.clientSecret,
    });
  } catch (error) {
    console.error('Create topup intent error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to create topup intent' }, 500);
  }
});

/**
 * POST /billing/credits/org/:orgId/topup/crypto/create
 * Create a Relay crypto payment request for topping up org credits.
 *
 * Settlement happens asynchronously in /billing/webhooks/relay after
 * the transaction is verified on-chain.
 */
app.post('/org/:orgId/topup/crypto/create', topupCreateRateLimit, async (c) => {
  try {
    const user = requireAuthUser(c);
    const { orgId } = c.req.param();

    const memberResult = await verifyOrgMembershipAndGetBilling(user.userId, orgId, ['OWNER', 'ADMIN']);
    if ('error' in memberResult) {
      return c.json({ error: memberResult.error }, memberResult.status as 403 | 404);
    }

    if (!isProviderAvailable('relay')) {
      return c.json({ error: 'Crypto payments are not configured' }, 400);
    }

    const body = await c.req.json();
    const data = cryptoTopupCreateSchema.parse(body);
    const amountCents = Math.round(data.usdAmount * 100);
    const tokenSymbolUpper = data.tokenSymbol.toUpperCase();

    // Enforce server-side allowlist of supported (chainId, stablecoin)
    // pairs. The allowlist is the single source of truth for which
    // ERC-20 contract is "real" USDC/USDT/DAI on each chain. By
    // resolving the canonical contract here and persisting it on the
    // payment row we guarantee the settlement webhook can never be
    // tricked into accepting a fake-ERC-20 transfer.
    if (!isSupportedChainId(data.chainId)) {
      return c.json({ error: 'Unsupported blockchain', code: 'UNSUPPORTED_CHAIN' }, 400);
    }
    if (!isSupportedStablecoin(tokenSymbolUpper)) {
      return c.json({ error: 'Unsupported token. Use USDC, USDT or DAI.', code: 'UNSUPPORTED_TOKEN' }, 400);
    }
    const canonicalTokenAddress = getCanonicalStablecoinAddress(data.chainId, tokenSymbolUpper);
    if (!canonicalTokenAddress) {
      return c.json(
        {
          error: `${tokenSymbolUpper} is not supported on chain ${data.chainId}.`,
          code: 'UNSUPPORTED_PAIR',
          supported: listSupportedStablecoinsForChain(data.chainId),
        },
        400,
      );
    }

    const paymentId = nanoid();
    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404);
    }

    const provider = getCryptoProvider();
    const paymentIntent = await provider.createPaymentIntent({
      amount: amountCents,
      currency: 'usd',
      customerId: customer.id,
      chainId: data.chainId,
      tokenSymbol: tokenSymbolUpper.toLowerCase(),
      metadata: {
        type: 'org_credits_topup',
        paymentId,
        orgId,
        orgBillingId: memberResult.orgBilling.id,
        userId: user.userId,
        amountCents: amountCents.toString(),
      },
    });

    // Persist the *canonical* token contract — never the one Relay
    // echoes back. The provider may include `tokenAddress` for
    // convenience, but we do not trust it.
    const payment = await dbService.createPayment({
      id: paymentId,
      customer_id: customer.id,
      amount: amountCents,
      currency: 'usd',
      status: 'PENDING',
      provider: 'relay',
      blockchain: String(data.chainId),
      to_address: paymentIntent.depositAddress,
      token_symbol: tokenSymbolUpper,
      token_address: canonicalTokenAddress,
      org_billing_id: memberResult.orgBilling.id,
    });

    auditLogService
      .logFromContext(c, {
        eventType: 'BILLING_TOPUP_CRYPTO_CREATED',
        userId: user.userId,
        metadata: {
          paymentId,
          orgId,
          orgBillingId: memberResult.orgBilling.id,
          chainId: data.chainId,
          tokenSymbol: tokenSymbolUpper,
          tokenAddress: canonicalTokenAddress,
          depositAddress: paymentIntent.depositAddress,
          amountCents,
        },
      })
      .catch(() => {/* never block on audit */});

    return c.json({
      payment: {
        id: payment.id,
        status: payment.status,
        amountCents,
        amountUsd: (amountCents / 100).toFixed(2),
        currency: payment.currency,
        depositAddress: paymentIntent.depositAddress,
        chainId: data.chainId,
        tokenAddress: canonicalTokenAddress,
        tokenSymbol: tokenSymbolUpper,
        expiresAt: paymentIntent.expiresAt,
      },
    });
  } catch (error) {
    console.error('Create crypto topup error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to create crypto topup' }, 500);
  }
});

/**
 * POST /billing/credits/org/:orgId/topup/finalize
 * Finalize a topup after payment confirmation
 */
app.post('/org/:orgId/topup/finalize', async (c) => {
  try {
    const user = requireAuthUser(c);
    const { orgId } = c.req.param();

    const memberResult = await verifyOrgMembershipAndGetBilling(user.userId, orgId, ['OWNER', 'ADMIN']);
    if ('error' in memberResult) {
      return c.json({ error: memberResult.error }, memberResult.status as 403 | 404);
    }

    const body = await c.req.json();
    const data = topupFinalizeSchema.parse(body);

    const provider = getDefaultProvider();
    if (!provider.getPaymentIntent) {
      return c.json({ error: 'Payment provider does not support payment intent retrieval' }, 500);
    }

    const paymentIntent = await provider.getPaymentIntent(data.paymentIntentId);

    if (!paymentIntent) {
      return c.json({ error: 'Payment intent not found' }, 404);
    }

    if (paymentIntent.status === 'processing') {
      return c.json({
        error: 'Payment is still processing. Credits will be applied once the payment settles.',
        status: paymentIntent.status,
        pending: true,
      }, 202);
    }

    if (paymentIntent.status !== 'succeeded') {
      return c.json({ 
        error: 'Payment has not been completed', 
        status: paymentIntent.status 
      }, 400);
    }

    const piMetadata = paymentIntent.metadata || {};
    if (piMetadata.orgBillingId !== memberResult.orgBilling.id) {
      return c.json({ error: 'Payment intent does not belong to this organization' }, 403);
    }

    // Amount is already in cents
    const amountCents = paymentIntent.amountReceived ?? paymentIntent.amount ?? 0;

    // Credit balance idempotently (in cents)
    const idempotencyKey = `topup:${memberResult.orgBilling.id}:${data.paymentIntentId}`;
    
    const result = await dbService.creditOrgBalanceIdempotent({
      orgBillingId: memberResult.orgBilling.id,
      actorUserId: user.userId,
      amountCents,
      reason: 'topup',
      idempotencyKey,
      metadata: {
        paymentIntentId: data.paymentIntentId,
        amountCents,
        usdAmount: amountCents / 100,
      },
    });

    if (!result.alreadyProcessed) {
      triggerComputeResumeCheck({
        orgBillingId: memberResult.orgBilling.id,
        organizationId: orgId,
        newBalanceCents: result.balanceCents,
      }).catch((err) => console.error('[credits] resume check failed:', err));
    }

    return c.json({
      success: true,
      amountAddedCents: result.alreadyProcessed ? 0 : amountCents,
      amountAddedUsd: result.alreadyProcessed ? '0.00' : (amountCents / 100).toFixed(2),
      balanceCents: result.balanceCents,
      balanceUsd: (result.balanceCents / 100).toFixed(2),
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    console.error('Finalize topup error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to finalize topup' }, 500);
  }
});

export default app;

/**
 * Internal function to process topup from webhook
 * Called by webhook handler when payment_intent.succeeded is received
 */
export async function processTopupFromWebhook(args: {
  paymentIntentId: string;
  orgBillingId: string;
  amountCents: number;
  userId?: string;
  organizationId?: string;
}): Promise<{ amountAddedCents: number; balanceCents: number; alreadyProcessed: boolean }> {
  const { paymentIntentId, orgBillingId, amountCents, userId, organizationId } = args;

  const idempotencyKey = `topup:${orgBillingId}:${paymentIntentId}`;

  const result = await dbService.creditOrgBalanceIdempotent({
    orgBillingId,
    actorUserId: userId,
    amountCents,
    reason: 'topup',
    idempotencyKey,
    metadata: {
      paymentIntentId,
      amountCents,
      usdAmount: amountCents / 100,
      source: 'webhook',
    },
  });

  if (!result.alreadyProcessed && organizationId) {
    triggerComputeResumeCheck({
      orgBillingId,
      organizationId,
      newBalanceCents: result.balanceCents,
    }).catch((err) => console.error('[credits] webhook resume check failed:', err));
  }

  return {
    amountAddedCents: result.alreadyProcessed ? 0 : amountCents,
    balanceCents: result.balanceCents,
    alreadyProcessed: result.alreadyProcessed,
  };
}
