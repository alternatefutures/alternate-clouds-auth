/**
 * Usage Balance Routes
 * Organization USD wallet, ledger, usage, and topup endpoints
 * All monetary values stored in cents, displayed in USD
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { dbService } from '../../services/db.service';
import { getDefaultProvider } from '../../services/payments';

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
app.post('/org/:orgId/topup/create-intent', async (c) => {
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
