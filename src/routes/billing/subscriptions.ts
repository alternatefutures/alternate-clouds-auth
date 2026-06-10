/**
 * Subscriptions Routes
 * Manage user subscriptions
 *
 * Plans (2026-02-09):
 *   MONTHLY — $25/seat/month, 25% usage markup
 *   YEARLY  — $20/seat/month ($240/year), 20% usage markup
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { dbService, SubscriptionPlan } from '../../services/db.service';
import { getDefaultProvider } from '../../services/payments';
import { disableOrg } from '../../services/seatBilling.service';
import { computePeriodEnd } from '../../utils/billing';
import type { CreateSubscriptionInput, CreateCheckoutSessionInput } from '../../services/payments/types';

const app = new Hono();

const ALLOWED_REDIRECT_ORIGINS = (process.env.ALLOWED_REDIRECT_ORIGINS || 'https://alternatefutures.ai,https://www.alternatefutures.ai,https://app.alternatefutures.ai')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isAllowedCheckoutRedirect(url: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url);
    return ALLOWED_REDIRECT_ORIGINS.some(origin => {
      try { return parsed.origin === new URL(origin).origin; } catch { return false; }
    });
  } catch {
    return false;
  }
}

app.use('*', authMiddleware);

const createSubscriptionSchema = z.object({
  planId: z.string().min(1),
  seats: z.number().int().min(1).optional().default(1),
  paymentMethodId: z.string().min(1).optional(),
  orgId: z.string().min(1).optional(),
});

const updateSeatsSchema = z.object({
  seats: z.number().int().min(1),
});

const changePlanSchema = z.object({
  targetPlanId: z.string().min(1),
});

type BillingAuthResult = { ok: true } | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * Require the caller be OWNER/ADMIN of an org (by org id). Single source of
 * truth for the org-admin membership guard reused by the subscribe, cancel,
 * reactivate, and seat-change billing endpoints so the rule never drifts.
 */
async function requireOrgBillingAdmin(
  organizationId: string,
  userId: string,
): Promise<BillingAuthResult> {
  const member = await dbService.getOrganizationMember(organizationId, userId);
  if (!member) {
    return { ok: false, status: 403, error: 'Not a member of this organization' };
  }
  if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
    return { ok: false, status: 403, error: 'OWNER or ADMIN role required for billing changes' };
  }
  return { ok: true };
}

/**
 * Authorize a billing-mutating action on a subscription. For org subscriptions
 * the caller must be OWNER/ADMIN; for personal subscriptions they must own the
 * billing customer.
 */
async function authorizeSubscriptionBilling(
  userId: string,
  subscription: { org_billing_id?: string; customer_id: string },
): Promise<BillingAuthResult> {
  if (subscription.org_billing_id) {
    const orgBilling = await dbService.getOrganizationBillingById(subscription.org_billing_id);
    if (orgBilling) {
      return requireOrgBillingAdmin(orgBilling.organization_id, userId);
    }
    // Fail CLOSED: an org subscription whose billing row is missing is a
    // data integrity problem, not a license for any caller to mutate it.
    return { ok: false, status: 404, error: 'Subscription not found' };
  }

  const customer = await dbService.getBillingCustomerByUserId(userId);
  if (!customer || subscription.customer_id !== customer.id) {
    return { ok: false, status: 404, error: 'Subscription not found' };
  }
  return { ok: true };
}

/** Serialize plan fields for API responses (never expose internal markup) */
function serializePlanForResponse(plan: SubscriptionPlan) {
  return {
    id: plan.id,
    name: plan.name,
    basePricePerSeat: plan.base_price_per_seat,
    billingInterval: plan.billing_interval,
    features: plan.features ? JSON.parse(plan.features) : null,
    includedStorageGb: plan.included_storage_gb,
    includedBandwidthGb: plan.included_bandwidth_gb,
    includedInvocations: plan.included_invocations,
    includedComputeSeconds: plan.included_compute_seconds,
    trialDays: plan.trial_days,
  };
}

/**
 * GET /billing/subscriptions
 * List all subscriptions for authenticated user
 */
app.get('/', async (c) => {
  try {
    const user = requireAuthUser(c);

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ subscriptions: [] });
    }

    const subscriptions = await dbService.listSubscriptionsByCustomerId(customer.id);

    // Get plan details for each subscription
    const subscriptionsWithPlans = await Promise.all(
      subscriptions.map(async (sub) => {
        const plan = await dbService.getSubscriptionPlanById(sub.plan_id);
        return {
          id: sub.id,
          plan: plan?.name || 'UNKNOWN',
          billingInterval: plan?.billing_interval || 'MONTHLY',
          status: sub.status,
          seats: sub.seats,
          basePricePerSeat: plan?.base_price_per_seat || 0,
          currentPeriodStart: sub.current_period_start,
          currentPeriodEnd: sub.current_period_end,
          cancelAt: sub.cancel_at,
          trialEnd: sub.trial_end,
          createdAt: sub.created_at,
        };
      })
    );

    return c.json({ subscriptions: subscriptionsWithPlans });
  } catch (error) {
    console.error('List subscriptions error:', error);
    return c.json({ error: 'Failed to list subscriptions' }, 500);
  }
});

/**
 * GET /billing/subscriptions/active
 * Get the active subscription for authenticated user
 */
app.get('/active', async (c) => {
  try {
    const user = requireAuthUser(c);

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ subscription: null });
    }

    const subscription = await dbService.getActiveSubscriptionByCustomerId(customer.id);
    if (!subscription) {
      return c.json({ subscription: null });
    }

    const plan = await dbService.getSubscriptionPlanById(subscription.plan_id);

    return c.json({
      subscription: {
        id: subscription.id,
        plan: plan?.name || 'UNKNOWN',
        billingInterval: plan?.billing_interval || 'MONTHLY',
        status: subscription.status,
        seats: subscription.seats,
        basePricePerSeat: plan?.base_price_per_seat || 0,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAt: subscription.cancel_at,
        trialEnd: subscription.trial_end,
        createdAt: subscription.created_at,
      },
    });
  } catch (error) {
    console.error('Get active subscription error:', error);
    return c.json({ error: 'Failed to get active subscription' }, 500);
  }
});

/**
 * POST /billing/subscriptions
 * Create a new subscription or convert a trial/expired subscription to paid.
 *
 * If the user has an existing TRIAL_EXPIRED or SUSPENDED subscription,
 * the existing row is updated to ACTIVE (trial conversion) instead of
 * creating a new one.
 */
app.post('/', async (c) => {
  try {
    const user = requireAuthUser(c);
    const body = await c.req.json();
    const data = createSubscriptionSchema.parse(body);

    let customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ error: 'Customer not found. Create customer first.' }, 404);
    }

    const plan = await dbService.getSubscriptionPlanById(data.planId);
    if (!plan) {
      return c.json({ error: 'Plan not found' }, 404);
    }

    if (!plan.is_active) {
      return c.json({ error: 'This plan is no longer available' }, 400);
    }

    // Resolve the TARGET org's billing + its single subscription row. Every org
    // is created with a subscription row (personal = TRIALING, added = INACTIVE),
    // so the normal path CONVERTS that one row — it never creates a duplicate.
    // The existing-active guard is scoped to the TARGET org (NOT the customer):
    // a user who already has one active org subscription can still subscribe a
    // second org. (Previously a customer-wide guard wrongly blocked that.)
    const orgs = await dbService.getOrganizationsByUserId(user.userId);
    let existingSub: Awaited<ReturnType<typeof dbService.getSubscriptionByOrgBillingId>> | null = null;
    let orgBillingId: string | null = null;

    if (data.orgId) {
      const authz = await requireOrgBillingAdmin(data.orgId, user.userId);
      if (!authz.ok) {
        return c.json({ error: authz.error }, authz.status);
      }
      const billing = await dbService.getOrganizationBillingByOrgId(data.orgId);
      if (billing) {
        orgBillingId = billing.id;
        existingSub = await dbService.getSubscriptionByOrgBillingId(billing.id);
      }
    }

    // Fallback (no explicit orgId): pick the user's first OWNER/ADMIN org,
    // preferring one whose subscription still needs activating.
    if (!orgBillingId) {
      for (const org of orgs) {
        const authz = await requireOrgBillingAdmin(org.id, user.userId);
        if (!authz.ok) continue;

        const billing = await dbService.getOrganizationBillingByOrgId(org.id);
        if (!billing) continue;

        const sub = await dbService.getSubscriptionByOrgBillingId(billing.id);
        if (!orgBillingId) {
          orgBillingId = billing.id;
          existingSub = sub;
        }
        if (sub && sub.status !== 'ACTIVE') {
          existingSub = sub;
          orgBillingId = billing.id;
          break;
        }
      }
    }

    // Guard: the TARGET org already has a live, paid subscription. Re-subscribing
    // is not allowed here — use change-plan / seat updates instead.
    if (existingSub && existingSub.status === 'ACTIVE' && existingSub.stripe_subscription_id) {
      return c.json({ error: 'This organization already has an active subscription.' }, 400);
    }

    const isPaidPlan = plan.base_price_per_seat > 0;
    const isActiveTrial = existingSub?.status === 'TRIALING'
      && !!existingSub.trial_end
      && existingSub.trial_end > Date.now();
    // Only a PAID subscribe preserves the trial (Stripe SetupIntent, charge at
    // trial end). A free plan during a trial converts straight to ACTIVE.
    const preserveTrial = isPaidPlan && isActiveTrial;

    let stripeSubscriptionId: string | undefined;
    let clientSecret: string | undefined;
    const now = Date.now();
    const periodEndMs = computePeriodEnd(now, plan.billing_interval);

    // Free plan → ACTIVE now. Paid + active trial → keep TRIALING (the owner's
    // trial survives; Stripe charges the saved card at trial end). Paid + no
    // trial → INCOMPLETE until the first payment confirms via webhook.
    const initialStatus = !isPaidPlan ? 'ACTIVE' : (preserveTrial ? 'TRIALING' : 'INCOMPLETE');

    // Claim the org's single live subscription row BEFORE calling Stripe so the
    // Stripe idempotency key can be derived from a stable row id. Two concurrent
    // subscribe clicks converge on ONE row — the partial unique index makes the
    // loser's insert fail with P2002, so it reads the winner — and therefore on
    // ONE Stripe subscription. A genuine re-subscribe AFTER a cancel gets a
    // fresh row id (the old row is terminal/CANCELED), hence a fresh Stripe sub
    // (avoids Stripe replaying the 24h-cached canceled sub for an identical key).
    let workingSub = existingSub;
    if (!workingSub && orgBillingId) {
      try {
        workingSub = await dbService.createSubscription({
          id: nanoid(),
          customer_id: customer.id,
          org_billing_id: orgBillingId,
          plan_id: plan.id,
          status: initialStatus,
          seats: data.seats,
          current_period_start: now,
          current_period_end: periodEndMs,
        });
      } catch (createErr) {
        if ((createErr as { code?: string }).code === 'P2002') {
          workingSub = await dbService.getSubscriptionByOrgBillingId(orgBillingId);
        } else {
          throw createErr;
        }
      }
    }

    if (isPaidPlan) {
      if (!plan.stripe_price_id) {
        console.error(`Plan ${plan.name} (${plan.id}) has no stripe_price_id but base_price_per_seat=${plan.base_price_per_seat}`);
        return c.json({ error: 'Plan is misconfigured — no payment price linked. Contact support.' }, 500);
      }

      // Auto-create Stripe customer if missing (same pattern as topup flow)
      if (!customer.stripe_customer_id) {
        const provider = getDefaultProvider();
        const userData = await dbService.getUserById(user.userId);

        const externalCustomer = await provider.createCustomer({
          email: userData?.email || user.email || '',
          name: userData?.display_name || undefined,
          metadata: { userId: user.userId },
        });

        await dbService.updateBillingCustomer(customer.id, {
          stripe_customer_id: externalCustomer.id,
        });

        customer = (await dbService.getBillingCustomerByUserId(user.userId))!;
      }

      // The row we're about to (re)use may carry a stale Stripe subscription (an
      // abandoned INCOMPLETE attempt, or a trial retry). Cancel it and detach it
      // locally before linking the new one, so we never orphan a live Stripe sub
      // and so convertSubscriptionToActive's "refuse to overwrite a different
      // Stripe id" guard doesn't trip.
      if (workingSub?.stripe_subscription_id) {
        try {
          const provider = getDefaultProvider();
          if (provider.cancelSubscription) {
            await provider.cancelSubscription(workingSub.stripe_subscription_id, { immediately: true });
          }
        } catch (cancelErr) {
          console.error('Failed to cancel stale Stripe subscription before re-subscribe:', cancelErr);
        }
        await dbService.updateSubscription(workingSub.id, { stripe_subscription_id: null });
        workingSub = { ...workingSub, stripe_subscription_id: undefined };
      }

      const provider = getDefaultProvider();
      if (!provider.createSubscription) {
        return c.json({ error: 'Payment provider does not support subscriptions' }, 500);
      }

      const createSubInput: CreateSubscriptionInput = {
        customerId: customer.stripe_customer_id!,
        priceId: plan.stripe_price_id,
        quantity: data.seats,
        paymentMethodId: data.paymentMethodId,
        metadata: { userId: user.userId, orgBillingId: orgBillingId ?? '' },
        // Idempotency keyed on the claimed row id: concurrent clicks share it
        // (→ one Stripe sub); a post-cancel re-subscribe has a new row (→ new sub).
        idempotencyKey: workingSub ? `subscribe:${workingSub.id}` : undefined,
      };

      // Active trial: pass trial_end → Stripe creates SetupIntent (save card, charge later)
      // Post-trial or no trial: Stripe creates PaymentIntent (charge now)
      if (preserveTrial) {
        createSubInput.trialEnd = Math.floor(workingSub!.trial_end! / 1000);
      }

      const externalSub = await provider.createSubscription(createSubInput);
      stripeSubscriptionId = externalSub.id;
      clientSecret = externalSub.clientSecret;

      if (!clientSecret) {
        console.error(`Stripe subscription ${externalSub.id} returned no clientSecret — cannot collect payment/setup`);
        return c.json({ error: 'Payment setup failed. Please try again.' }, 500);
      }
    }

    let subscriptionResult;

    if (workingSub) {
      if (preserveTrial) {
        // Mid-trial subscribe: link the Stripe sub + plan/seats but PRESERVE the
        // trial (status TRIALING, trial_end untouched). Mirrors the Checkout
        // path. Converting-and-clearing here would wipe the trial and make a
        // later cancel mis-classify the trial as a paid period.
        await dbService.updateSubscription(workingSub.id, {
          stripe_subscription_id: stripeSubscriptionId,
          plan_id: plan.id,
          seats: data.seats,
          status: 'TRIALING',
        });
      } else {
        await dbService.convertSubscriptionToActive(workingSub.id, {
          planId: plan.id,
          seats: data.seats,
          stripeSubscriptionId,
          currentPeriodStart: new Date(now),
          currentPeriodEnd: new Date(periodEndMs),
          status: initialStatus,
        });
      }

      if (!isPaidPlan && orgBillingId) {
        await dbService.updateOrganizationBilling(orgBillingId, {
          trial_converted: true,
        });
      }

      subscriptionResult = {
        id: workingSub.id,
        plan: plan.name,
        billingInterval: plan.billing_interval,
        status: initialStatus,
        seats: data.seats,
        basePricePerSeat: plan.base_price_per_seat,
        currentPeriodStart: now,
        currentPeriodEnd: periodEndMs,
        createdAt: workingSub.created_at,
      };
    } else {
      // No org context at all (personal/legacy subscription). Create a
      // standalone row now that the Stripe sub (if any) exists.
      const subscription = await dbService.createSubscription({
        id: nanoid(),
        customer_id: customer.id,
        org_billing_id: undefined,
        plan_id: plan.id,
        status: initialStatus,
        seats: data.seats,
        stripe_subscription_id: stripeSubscriptionId,
        current_period_start: now,
        current_period_end: periodEndMs,
      });

      subscriptionResult = {
        id: subscription.id,
        plan: plan.name,
        billingInterval: plan.billing_interval,
        status: subscription.status,
        seats: subscription.seats,
        basePricePerSeat: plan.base_price_per_seat,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        createdAt: subscription.created_at,
      };
    }

    try {
      const subscriptionAmount = plan.base_price_per_seat * (data.seats || 1);
      const invoiceNumber = `INV-${customer.id.slice(0, 8).toUpperCase()}-${nanoid(6).toUpperCase()}`;

      await dbService.createInvoice({
        id: nanoid(),
        customer_id: customer.id,
        subscription_id: subscriptionResult.id,
        invoice_number: invoiceNumber,
        status: isPaidPlan ? 'OPEN' : 'PAID',
        subtotal: subscriptionAmount,
        tax: 0,
        total: subscriptionAmount,
        amount_paid: isPaidPlan ? 0 : subscriptionAmount,
        amount_due: isPaidPlan ? subscriptionAmount : 0,
        currency: 'usd',
        period_start: subscriptionResult.currentPeriodStart,
        period_end: subscriptionResult.currentPeriodEnd,
        due_date: subscriptionResult.currentPeriodEnd,
        paid_at: isPaidPlan ? undefined : now,
      });
    } catch (invoiceErr) {
      console.error('Failed to create initial invoice (non-fatal):', invoiceErr);
    }

    return c.json({
      subscription: subscriptionResult,
      ...(clientSecret ? { clientSecret } : {}),
    });
  } catch (error) {
    console.error('Create subscription error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to create subscription' }, 500);
  }
});


/**
 * POST /billing/subscriptions/:id/cancel
 * Cancel a subscription
 */
app.post('/:id/cancel', async (c) => {
  try {
    const user = requireAuthUser(c);
    const subscriptionId = c.req.param('id');

    // immediately=false (the web-app default) → cancel at period end: the org
    // keeps access + members until the paid period runs out, then the
    // subscription.deleted webhook tears it down. immediately=true → cancel now,
    // credit the unused time, and disable the org right away.
    let immediately = false;
    try {
      const body = await c.req.json();
      immediately = body?.immediately === true;
    } catch {
      // No JSON body → keep the safe default (end of period).
    }

    const subscription = await dbService.getSubscriptionById(subscriptionId);
    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404);
    }

    const cancelAuthz = await authorizeSubscriptionBilling(user.userId, subscription);
    if (!cancelAuthz.ok) {
      return c.json({ error: cancelAuthz.error }, cancelAuthz.status);
    }

    const provider = getDefaultProvider();

    // A subscription still inside its free-trial window reverts to the trial
    // rather than hard-canceling.
    const hasActiveTrial = subscription.trial_end && subscription.trial_end > Date.now()
      && (subscription.status === 'TRIALING' || subscription.status === 'ACTIVE' || subscription.status === 'INCOMPLETE');

    // Period-end is only meaningful for a live PAID subscription with a Stripe
    // sub. A trial, or a row with no Stripe sub, has no paid period to ride out,
    // so those always take the trial-revert or immediate path.
    const canCancelAtPeriodEnd = !immediately
      && !hasActiveTrial
      && !!subscription.stripe_subscription_id
      && (subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE');

    if (hasActiveTrial && subscription.org_billing_id) {
      // (B) Cancel during trial: detach the Stripe subscription and revert to
      // TRIALING so the trial survives and the scheduler still runs
      // TRIALING → TRIAL_EXPIRED → SUSPENDED on the original schedule. Nothing
      // was charged yet, so there is nothing to credit.
      if (subscription.stripe_subscription_id && provider.cancelSubscription) {
        await provider.cancelSubscription(subscription.stripe_subscription_id, { immediately: true });
      }
      await dbService.updateSubscription(subscriptionId, {
        status: 'TRIALING',
        stripe_subscription_id: null,
        canceled_at: null,
        cancel_at: null,
      });
      await dbService.updateOrganizationBilling(subscription.org_billing_id, {
        trial_converted: false,
      });
    } else if (canCancelAtPeriodEnd) {
      // (C) Cancel at period end: schedule Stripe cancel_at_period_end. The org
      // stays ACTIVE and members keep access until the paid period runs out;
      // they keep the time already paid for (no proration credit). The
      // customer.subscription.deleted webhook marks CANCELED + disables the org
      // when the period actually ends.
      let cancelAtMs: number | null = subscription.current_period_end ?? null;
      if (provider.cancelSubscription) {
        const external = await provider.cancelSubscription(subscription.stripe_subscription_id!, {
          immediately: false,
        });
        // Stripe's cancel_at is authoritative (seconds → ms). Falls back to our
        // local period end if Stripe didn't echo one.
        if (external.cancelAt) cancelAtMs = external.cancelAt * 1000;
      }
      await dbService.updateSubscription(subscriptionId, {
        cancel_at: cancelAtMs,
        canceled_at: null,
      });
      // Status stays ACTIVE; do NOT disableOrg now — members keep access until
      // the period ends and the webhook fires.
    } else {
      // (A) Cancel a paid (non-trial) subscription immediately: cancel now,
      // credit the unused paid time to the Stripe customer balance (prorate +
      // invoice_now), then DISABLE the org — remove non-owner members and stop
      // all deployments. The credit lives on the per-user BillingCustomer and is
      // auto-applied by Stripe to the next invoice when the user re-subscribes.
      if (subscription.stripe_subscription_id && provider.cancelSubscription) {
        await provider.cancelSubscription(subscription.stripe_subscription_id, {
          immediately: true,
          prorate: true,
          invoiceNow: true,
        });
      }

      await dbService.updateSubscription(subscriptionId, {
        status: 'CANCELED',
        canceled_at: Date.now(),
        cancel_at: null,
        stripe_subscription_id: null,
        seats: 1,
      });

      if (subscription.org_billing_id) {
        const orgBilling = await dbService.getOrganizationBillingById(subscription.org_billing_id);
        if (orgBilling) {
          await disableOrg(orgBilling.organization_id).catch((err) =>
            console.error(`[cancel] disableOrg failed for org ${orgBilling.organization_id}:`, err),
          );
        }
      }
    }

    const updatedSubscription = await dbService.getSubscriptionById(subscriptionId);
    const plan = await dbService.getSubscriptionPlanById(subscription.plan_id);

    return c.json({
      subscription: {
        id: updatedSubscription!.id,
        plan: plan?.name || 'UNKNOWN',
        billingInterval: plan?.billing_interval || 'MONTHLY',
        status: updatedSubscription!.status,
        seats: updatedSubscription!.seats,
        cancelAt: updatedSubscription!.cancel_at,
        canceledAt: updatedSubscription!.canceled_at,
      },
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return c.json({ error: 'Failed to cancel subscription' }, 500);
  }
});

/**
 * PUT /billing/subscriptions/:id/seats
 * Update subscription seat count
 */
app.put('/:id/seats', async (c) => {
  try {
    const user = requireAuthUser(c);
    const subscriptionId = c.req.param('id');
    const body = await c.req.json();
    const data = updateSeatsSchema.parse(body);

    const subscription = await dbService.getSubscriptionById(subscriptionId);
    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404);
    }

    const seatsAuthz = await authorizeSubscriptionBilling(user.userId, subscription);
    if (!seatsAuthz.ok) {
      return c.json({ error: seatsAuthz.error }, seatsAuthz.status);
    }

    // Floor at the org's member count — a manual seat update below it would
    // contradict syncOrgSeats and under-bill seats that are occupied (B7).
    if (subscription.org_billing_id) {
      const orgBilling = await dbService.getOrganizationBillingById(subscription.org_billing_id);
      if (orgBilling) {
        const members = await dbService.getOrganizationMembers(orgBilling.organization_id);
        if (data.seats < members.length) {
          return c.json(
            {
              error: `Seat count cannot be below the current member count (${members.length}). Remove members first.`,
            },
            400,
          );
        }
      }
    }

    const plan = await dbService.getSubscriptionPlanById(subscription.plan_id);
    const isPaid = plan && plan.base_price_per_seat > 0;

    if (isPaid && !subscription.stripe_subscription_id) {
      return c.json({ error: 'Cannot update seats — subscription has no active payment link' }, 400);
    }

    if (subscription.stripe_subscription_id) {
      const provider = getDefaultProvider();
      if (provider.updateSubscription) {
        // Immediate proration (decision #7) — charge/credit the card now.
        await provider.updateSubscription(subscription.stripe_subscription_id, {
          quantity: data.seats,
          prorationBehavior: 'always_invoice',
        });
      }
    }

    await dbService.updateSubscription(subscriptionId, { seats: data.seats });

    const updatedSubscription = await dbService.getSubscriptionById(subscriptionId);

    return c.json({
      subscription: {
        id: updatedSubscription!.id,
        plan: plan?.name || 'UNKNOWN',
        billingInterval: plan?.billing_interval || 'MONTHLY',
        status: updatedSubscription!.status,
        seats: updatedSubscription!.seats,
      },
    });
  } catch (error) {
    console.error('Update subscription seats error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to update subscription seats' }, 500);
  }
});

/**
 * GET /billing/subscriptions/:id/change-plan/preview?targetPlanId=
 * Preview the immediate charge / customer-balance credit of switching plans
 * (annual↔monthly) at the current seat count. UI-only — Stripe computes the
 * authoritative amounts when the switch is confirmed.
 */
app.get('/:id/change-plan/preview', async (c) => {
  try {
    const user = requireAuthUser(c);
    const subscriptionId = c.req.param('id');
    const targetPlanId = c.req.query('targetPlanId');

    if (!targetPlanId) {
      return c.json({ error: 'Missing targetPlanId' }, 400);
    }

    const subscription = await dbService.getSubscriptionById(subscriptionId);
    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404);
    }

    const authz = await authorizeSubscriptionBilling(user.userId, subscription);
    if (!authz.ok) {
      return c.json({ error: authz.error }, authz.status);
    }

    if (!subscription.stripe_subscription_id) {
      return c.json({ error: 'Subscription has no active payment link' }, 400);
    }

    const targetPlan = await dbService.getSubscriptionPlanById(targetPlanId);
    if (!targetPlan || !targetPlan.is_active) {
      return c.json({ error: 'Target plan not found or inactive' }, 404);
    }
    if (targetPlan.id === subscription.plan_id) {
      return c.json({ error: 'Already on this plan' }, 400);
    }
    if (!targetPlan.stripe_price_id) {
      return c.json({ error: 'Target plan is misconfigured — no Stripe price linked' }, 500);
    }

    const provider = getDefaultProvider();
    if (!provider.previewSubscriptionChange) {
      return c.json({ error: 'Payment provider does not support plan-change preview' }, 501);
    }

    const preview = await provider.previewSubscriptionChange({
      subscriptionId: subscription.stripe_subscription_id,
      priceId: targetPlan.stripe_price_id,
      quantity: subscription.seats,
      prorationBehavior: 'always_invoice',
      resetBillingAnchor: true,
    });

    // A negative ending balance is a customer-balance credit (e.g. annual→monthly
    // downgrade) that Stripe auto-applies to future subscription invoices.
    const creditToBalanceCents = preview.endingBalanceCents < 0
      ? Math.abs(preview.endingBalanceCents)
      : 0;

    return c.json({
      amountDueNowCents: Math.max(0, preview.amountDueCents),
      creditToBalanceCents,
      currency: preview.currency,
      seats: subscription.seats,
      targetPlan: {
        id: targetPlan.id,
        name: targetPlan.name,
        billingInterval: targetPlan.billing_interval,
        basePricePerSeat: targetPlan.base_price_per_seat,
      },
    });
  } catch (error) {
    console.error('Change-plan preview error:', error);
    return c.json({ error: 'Failed to preview plan change' }, 500);
  }
});

/**
 * POST /billing/subscriptions/:id/change-plan { targetPlanId }
 * Switch a subscription between MONTHLY and YEARLY (OWNER/ADMIN).
 *
 * Stripe computes proration with `always_invoice` and we reset the billing
 * cycle to the switch date:
 *   - monthly→annual upgrade → immediate prorated card charge.
 *   - annual→monthly downgrade → prorated credit; when it exceeds the new
 *     invoice it lands on the Stripe CUSTOMER BALANCE (decision #9) and
 *     auto-applies to future seat/subscription invoices. No card refund, no
 *     wallet involvement, never expires.
 * Seat count is preserved across the switch (decision: seats are interval-independent).
 */
app.post('/:id/change-plan', async (c) => {
  try {
    const user = requireAuthUser(c);
    const subscriptionId = c.req.param('id');
    const body = await c.req.json();
    const { targetPlanId } = changePlanSchema.parse(body);

    const subscription = await dbService.getSubscriptionById(subscriptionId);
    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404);
    }

    const authz = await authorizeSubscriptionBilling(user.userId, subscription);
    if (!authz.ok) {
      return c.json({ error: authz.error }, authz.status);
    }

    if (subscription.status !== 'ACTIVE') {
      return c.json({ error: 'Only an active subscription can change plans' }, 400);
    }
    if (!subscription.stripe_subscription_id) {
      return c.json({ error: 'Subscription has no active payment link' }, 400);
    }

    const targetPlan = await dbService.getSubscriptionPlanById(targetPlanId);
    if (!targetPlan || !targetPlan.is_active) {
      return c.json({ error: 'Target plan not found or inactive' }, 404);
    }
    if (targetPlan.id === subscription.plan_id) {
      return c.json({ error: 'Already on this plan' }, 400);
    }
    if (!targetPlan.stripe_price_id) {
      return c.json({ error: 'Target plan is misconfigured — no Stripe price linked' }, 500);
    }

    const provider = getDefaultProvider();
    if (!provider.updateSubscription) {
      return c.json({ error: 'Payment provider does not support plan changes' }, 500);
    }

    // Switch the subscription item to the new price, keep the seat count, invoice
    // the prorated delta immediately, and reset the cycle to today so the new
    // interval starts now.
    await provider.updateSubscription(subscription.stripe_subscription_id, {
      priceId: targetPlan.stripe_price_id,
      quantity: subscription.seats,
      prorationBehavior: 'always_invoice',
      billingCycleAnchorNow: true,
    });

    // Recompute the period for the new interval from now. The
    // customer.subscription.updated webhook will reconcile these from Stripe's
    // authoritative values; this keeps the UI correct before the webhook lands.
    const now = Date.now();
    const periodEndMs = computePeriodEnd(now, targetPlan.billing_interval);

    await dbService.updateSubscription(subscriptionId, {
      plan_id: targetPlan.id,
      current_period_start: now,
      current_period_end: periodEndMs,
    });

    const updated = await dbService.getSubscriptionById(subscriptionId);

    return c.json({
      subscription: {
        id: updated!.id,
        plan: targetPlan.name,
        billingInterval: targetPlan.billing_interval,
        status: updated!.status,
        seats: updated!.seats,
        basePricePerSeat: targetPlan.base_price_per_seat,
        currentPeriodStart: updated!.current_period_start,
        currentPeriodEnd: updated!.current_period_end,
      },
    });
  } catch (error) {
    console.error('Change plan error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to change plan' }, 500);
  }
});

/**
 * GET /billing/subscriptions/plans
 * List available (active) subscription plans
 */
app.get('/plans', async (c) => {
  try {
    const plans = await dbService.listSubscriptionPlans(); // only returns active plans

    return c.json({
      plans: plans.map(serializePlanForResponse),
    });
  } catch (error) {
    console.error('List plans error:', error);
    return c.json({ error: 'Failed to list plans' }, 500);
  }
});

/**
 * GET /billing/subscriptions/org/:orgId
 * Get subscription for an organization (not user-scoped)
 */
app.get('/org/:orgId', async (c) => {
  try {
    const user = requireAuthUser(c);
    const { orgId } = c.req.param();

    // Verify user is member of org
    const isMember = await dbService.isUserMemberOfOrganization(user.userId, orgId);
    if (!isMember) {
      return c.json({ error: 'Not a member of this organization' }, 403);
    }

    // Get org billing
    const orgBilling = await dbService.getOrganizationBillingByOrgId(orgId);
    if (!orgBilling) {
      return c.json({ error: 'Organization billing not found' }, 404);
    }

    // Get active subscription for this org
    const subscription = await dbService.getSubscriptionByOrgBillingId(orgBilling.id);
    if (!subscription) {
      return c.json({ subscription: null, trial: null });
    }

    // Get plan details
    const plan = await dbService.getSubscriptionPlanById(subscription.plan_id);

    return c.json({
      subscription: {
        id: subscription.id,
        plan: plan?.name || 'UNKNOWN',
        billingInterval: plan?.billing_interval || 'MONTHLY',
        status: subscription.status,
        seats: subscription.seats,
        basePricePerSeat: plan?.base_price_per_seat || 0,
        includedStorageGb: plan?.included_storage_gb || 0,
        includedBandwidthGb: plan?.included_bandwidth_gb || 0,
        includedInvocations: plan?.included_invocations || 0,
        includedComputeSeconds: plan?.included_compute_seconds || 0,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAt: subscription.cancel_at,
        trialEnd: subscription.trial_end,
        createdAt: subscription.created_at,
        hasPaymentLinked: subscription.stripe_subscription_id != null,
      },
      trial: {
        startedAt: orgBilling.trial_started_at,
        endsAt: orgBilling.trial_ends_at,
        converted: orgBilling.trial_converted,
        daysRemaining: orgBilling.trial_ends_at
          ? Math.max(0, Math.ceil((orgBilling.trial_ends_at - Date.now()) / (24 * 60 * 60 * 1000)))
          : null,
        graceRemaining: (subscription.status === 'TRIAL_EXPIRED' && orgBilling.trial_ends_at)
          ? Math.max(0, Math.ceil((orgBilling.trial_ends_at + 3 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000)))
          : null,
      },
    });
  } catch (error) {
    console.error('Get org subscription error:', error);
    return c.json({ error: 'Failed to get organization subscription' }, 500);
  }
});

/**
 * POST /billing/subscriptions/checkout
 * Create a Stripe Checkout session for subscribing to a plan.
 * Redirects user to checkout.stripe.com — no card data touches our servers.
 */
app.post('/checkout', async (c) => {
  try {
    const user = requireAuthUser(c);
    const body = await c.req.json();
    const { planId, seats = 1, orgId, successUrl, cancelUrl } = body;

    if (!planId || !successUrl || !cancelUrl) {
      return c.json({ error: 'Missing planId, successUrl, or cancelUrl' }, 400);
    }

    if (!isAllowedCheckoutRedirect(successUrl) || !isAllowedCheckoutRedirect(cancelUrl)) {
      return c.json({ error: 'Redirect URLs must be on a trusted origin' }, 400);
    }

    if (orgId) {
      const authz = await requireOrgBillingAdmin(orgId, user.userId);
      if (!authz.ok) {
        return c.json({ error: authz.error }, authz.status);
      }
    }

    const plan = await dbService.getSubscriptionPlanById(planId);
    if (!plan || !plan.is_active) {
      return c.json({ error: 'Plan not found or inactive' }, 404);
    }

    if (!plan.stripe_price_id) {
      return c.json({ error: 'Plan is misconfigured — no Stripe price linked' }, 500);
    }

    let customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ error: 'No billing customer found' }, 404);
    }

    // Auto-create Stripe customer if missing
    if (!customer.stripe_customer_id) {
      const provider = getDefaultProvider();
      const userData = await dbService.getUserById(user.userId);
      const externalCustomer = await provider.createCustomer({
        email: userData?.email || user.email || '',
        name: userData?.display_name || undefined,
        metadata: { userId: user.userId },
      });
      await dbService.updateBillingCustomer(customer.id, {
        stripe_customer_id: externalCustomer.id,
      });
      customer = (await dbService.getBillingCustomerByUserId(user.userId))!;
    }

    // Check for active trial
    let trialEnd: number | undefined;
    if (orgId) {
      const billing = await dbService.getOrganizationBillingByOrgId(orgId);
      if (billing) {
        const sub = await dbService.getSubscriptionByOrgBillingId(billing.id);
        if (sub?.status === 'TRIALING' && sub.trial_end && sub.trial_end > Date.now()) {
          trialEnd = Math.floor(sub.trial_end / 1000);
        }
      }
    }

    const provider = getDefaultProvider();
    if (!provider.createCheckoutSession) {
      return c.json({ error: 'Payment provider does not support Checkout' }, 500);
    }

    const session = await provider.createCheckoutSession({
      mode: 'subscription',
      customerId: customer.stripe_customer_id!,
      priceId: plan.stripe_price_id,
      quantity: seats,
      successUrl,
      cancelUrl,
      trialEnd,
      metadata: {
        type: 'subscription',
        userId: user.userId,
        orgId: orgId || '',
        planId,
        seats: String(seats),
      },
    });

    return c.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Create checkout session error:', error);
    return c.json({ error: 'Failed to create checkout session' }, 500);
  }
});

/**
 * POST /billing/subscriptions/checkout/confirm
 * Confirm a Stripe Checkout session on return from Stripe.
 * Fallback for when webhooks haven't arrived yet (always the case in local dev).
 * Retrieves the session from Stripe and applies the same logic as checkout.session.completed.
 */
app.post('/checkout/confirm', async (c) => {
  try {
    const user = requireAuthUser(c);
    const { sessionId } = await c.req.json();

    if (!sessionId) {
      return c.json({ error: 'Missing sessionId' }, 400);
    }

    const provider = getDefaultProvider();
    if (!(provider as any).retrieveCheckoutSession) {
      return c.json({ error: 'Provider does not support session retrieval' }, 500);
    }

    const session = await (provider as any).retrieveCheckoutSession(sessionId);

    if (session.status !== 'complete') {
      return c.json({ error: 'Checkout session not completed', status: session.status }, 400);
    }

    const metadata = session.metadata || {};
    if (metadata.type !== 'subscription' || session.mode !== 'subscription') {
      return c.json({ error: 'Not a subscription checkout session' }, 400);
    }

    const stripeSubscriptionId = session.subscription;
    const planId = metadata.planId;
    const orgId = metadata.orgId;
    const seats = parseInt(metadata.seats || '1', 10);

    if (!stripeSubscriptionId || !planId) {
      return c.json({ error: 'Missing subscription or plan in session' }, 400);
    }

    const plan = await dbService.getSubscriptionPlanById(planId);
    if (!plan) {
      return c.json({ error: 'Plan not found' }, 404);
    }

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ error: 'Billing customer not found' }, 404);
    }

    let existingSub: Awaited<ReturnType<typeof dbService.getSubscriptionByOrgBillingId>> | null = null;
    let orgBillingId: string | undefined;

    if (orgId) {
      const billing = await dbService.getOrganizationBillingByOrgId(orgId);
      if (billing) {
        orgBillingId = billing.id;
        existingSub = await dbService.getSubscriptionByOrgBillingId(billing.id);
      }
    }

    // Already processed (e.g. webhook beat us)
    if (existingSub?.stripe_subscription_id === stripeSubscriptionId) {
      return c.json({ confirmed: true, alreadyProcessed: true });
    }

    const now = Date.now();

    if (existingSub) {
      const isActiveTrial = existingSub.status === 'TRIALING'
        && existingSub.trial_end
        && existingSub.trial_end > now;

      if (isActiveTrial) {
        await dbService.updateSubscription(existingSub.id, {
          stripe_subscription_id: stripeSubscriptionId,
          plan_id: planId,
          seats,
          status: 'TRIALING',
        });
      } else {
        const periodEndMs = computePeriodEnd(now, plan.billing_interval);

        await dbService.convertSubscriptionToActive(existingSub.id, {
          planId,
          seats,
          stripeSubscriptionId,
          currentPeriodStart: new Date(now),
          currentPeriodEnd: new Date(periodEndMs),
          status: 'ACTIVE',
        });

        if (orgBillingId) {
          await dbService.updateOrganizationBilling(orgBillingId, {
            trial_converted: true,
          });
        }
      }
    } else {
      const periodEndMs = computePeriodEnd(now, plan.billing_interval);

      await dbService.createSubscription({
        id: nanoid(),
        customer_id: customer.id,
        org_billing_id: orgBillingId,
        plan_id: planId,
        status: 'ACTIVE',
        seats,
        stripe_subscription_id: stripeSubscriptionId,
        current_period_start: now,
        current_period_end: periodEndMs,
      });
    }

    // H1: mirror the saved card onto the customer's invoice default so renewal
    // and one-off (trial seat) invoices collect. Best-effort, non-fatal.
    try {
      if ((provider as any).syncSubscriptionDefaultPaymentMethodToCustomer) {
        await (provider as any).syncSubscriptionDefaultPaymentMethodToCustomer(stripeSubscriptionId);
      }
    } catch (pmErr) {
      console.error('Failed to set customer default payment method (non-fatal):', pmErr);
    }

    console.log(`Checkout confirmed: subscription ${stripeSubscriptionId} for user ${user.userId}, plan ${plan.name}`);
    return c.json({ confirmed: true });
  } catch (error) {
    console.error('Checkout confirm error:', error);
    return c.json({ error: 'Failed to confirm checkout' }, 500);
  }
});

/**
 * GET /billing/subscriptions/trial-status
 * Get trial status for current user's organizations
 */
app.get('/trial-status', async (c) => {
  try {
    const user = requireAuthUser(c);

    // Get all orgs user belongs to
    const orgs = await dbService.getOrganizationsByUserId(user.userId);

    const trialStatuses = await Promise.all(
      orgs.map(async (org) => {
        const billing = await dbService.getOrganizationBillingByOrgId(org.id);
        if (!billing) return null;

        return {
          organizationId: org.id,
          organizationName: org.name,
          trialStartedAt: billing.trial_started_at,
          trialEndsAt: billing.trial_ends_at,
          trialConverted: billing.trial_converted,
          daysRemaining: billing.trial_ends_at
            ? Math.max(0, Math.ceil((billing.trial_ends_at - Date.now()) / (24 * 60 * 60 * 1000)))
            : null,
        };
      })
    );

    return c.json({
      trials: trialStatuses.filter(Boolean),
    });
  } catch (error) {
    console.error('Get trial status error:', error);
    return c.json({ error: 'Failed to get trial status' }, 500);
  }
});

export default app;
