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

    // Check for existing ACTIVE or INCOMPLETE subscription
    const existingActive = await dbService.getActiveSubscriptionByCustomerId(customer.id);
    if (existingActive) {
      if (existingActive.status === 'INCOMPLETE') {
        // Stale payment attempt — cancel the old Stripe sub and let them retry
        if (existingActive.stripe_subscription_id) {
          try {
            const provider = getDefaultProvider();
            if (provider.cancelSubscription) {
              await provider.cancelSubscription(existingActive.stripe_subscription_id, { immediately: true });
            }
          } catch (cancelErr) {
            console.error('Failed to cancel stale Stripe subscription:', cancelErr);
          }
        }
        await dbService.updateSubscription(existingActive.id, { status: 'CANCELED', canceled_at: Date.now() });
      } else if (!existingActive.org_billing_id) {
        await dbService.updateSubscription(existingActive.id, { status: 'CANCELED', canceled_at: Date.now() });
      } else {
        return c.json({ error: 'Already have an active subscription. Cancel it first.' }, 400);
      }
    }

    const plan = await dbService.getSubscriptionPlanById(data.planId);
    if (!plan) {
      return c.json({ error: 'Plan not found' }, 404);
    }

    if (!plan.is_active) {
      return c.json({ error: 'This plan is no longer available' }, 400);
    }

    // Resolve org billing and look for a trial/expired/suspended subscription to convert
    const orgs = await dbService.getOrganizationsByUserId(user.userId);
    let existingTrialSub: Awaited<ReturnType<typeof dbService.getSubscriptionByOrgBillingId>> | null = null;
    let orgBillingId: string | null = null;

    // If frontend specified an orgId, resolve that org's billing first
    if (data.orgId) {
      const member = await dbService.getOrganizationMember(data.orgId, user.userId);
      if (!member) {
        return c.json({ error: 'Not a member of this organization' }, 403);
      }
      if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
        return c.json({ error: 'OWNER or ADMIN role required for billing changes' }, 403);
      }
      const billing = await dbService.getOrganizationBillingByOrgId(data.orgId);
      if (billing) {
        orgBillingId = billing.id;
        const sub = await dbService.getSubscriptionByOrgBillingId(billing.id);
        if (sub && ['TRIALING', 'TRIAL_EXPIRED', 'SUSPENDED'].includes(sub.status)) {
          existingTrialSub = sub;
        }
      }
    }

    // Fallback: scan user orgs (only those where user is OWNER or ADMIN)
    if (!orgBillingId) {
      for (const org of orgs) {
        const member = await dbService.getOrganizationMember(org.id, user.userId);
        if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) continue;

        const billing = await dbService.getOrganizationBillingByOrgId(org.id);
        if (!billing) continue;

        if (!orgBillingId) orgBillingId = billing.id;

        const sub = await dbService.getSubscriptionByOrgBillingId(billing.id);
        if (sub && ['TRIALING', 'TRIAL_EXPIRED', 'SUSPENDED'].includes(sub.status)) {
          existingTrialSub = sub;
          orgBillingId = billing.id;
          break;
        }
      }
    }

    const isPaidPlan = plan.base_price_per_seat > 0;
    const isActiveTrial = existingTrialSub?.status === 'TRIALING'
      && existingTrialSub.trial_end
      && existingTrialSub.trial_end > Date.now();

    let stripeSubscriptionId: string | undefined;
    let clientSecret: string | undefined;
    const now = Date.now();
    const periodEnd = new Date(now);

    if (plan.billing_interval === 'YEARLY') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
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

      // If retrying during trial and a stale Stripe sub exists, cancel it first
      if (isActiveTrial && existingTrialSub!.stripe_subscription_id) {
        try {
          const provider = getDefaultProvider();
          if (provider.cancelSubscription) {
            await provider.cancelSubscription(existingTrialSub!.stripe_subscription_id, { immediately: true });
          }
        } catch (cancelErr) {
          console.error('Failed to cancel stale Stripe subscription on trial retry:', cancelErr);
        }
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
        metadata: { userId: user.userId },
      };

      // Active trial: pass trial_end → Stripe creates SetupIntent (save card, charge later)
      // Post-trial or no trial: Stripe creates PaymentIntent (charge now)
      if (isActiveTrial) {
        createSubInput.trialEnd = Math.floor(existingTrialSub!.trial_end! / 1000);
      }

      const externalSub = await provider.createSubscription(createSubInput);
      stripeSubscriptionId = externalSub.id;
      clientSecret = externalSub.clientSecret;

      if (!clientSecret) {
        console.error(`Stripe subscription ${externalSub.id} returned no clientSecret — cannot collect payment/setup`);
        return c.json({ error: 'Payment setup failed. Please try again.' }, 500);
      }
    }

    // Post-trial + paid: INCOMPLETE until payment confirmed via webhook
    // Free plan: ACTIVE immediately
    const initialStatus = isPaidPlan ? 'INCOMPLETE' : 'ACTIVE';
    let subscriptionResult;

    if (existingTrialSub && orgBillingId) {
      await dbService.convertSubscriptionToActive(existingTrialSub.id, {
        planId: plan.id,
        seats: data.seats,
        stripeSubscriptionId,
        currentPeriodStart: new Date(now),
        currentPeriodEnd: periodEnd,
        status: initialStatus,
      });

      if (!isPaidPlan) {
        await dbService.updateOrganizationBilling(orgBillingId, {
          trial_converted: true,
        });
      }

      subscriptionResult = {
        id: existingTrialSub.id,
        plan: plan.name,
        billingInterval: plan.billing_interval,
        status: initialStatus,
        seats: data.seats,
        basePricePerSeat: plan.base_price_per_seat,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd.getTime(),
        createdAt: existingTrialSub.created_at,
      };
    } else {
      const subscription = await dbService.createSubscription({
        id: nanoid(),
        customer_id: customer.id,
        org_billing_id: orgBillingId ?? undefined,
        plan_id: plan.id,
        status: initialStatus,
        seats: data.seats,
        stripe_subscription_id: stripeSubscriptionId,
        current_period_start: now,
        current_period_end: periodEnd.getTime(),
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
    const body = await c.req.json().catch(() => ({}));
    const immediately = body.immediately === true;

    const subscription = await dbService.getSubscriptionById(subscriptionId);
    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404);
    }

    if (subscription.org_billing_id) {
      const orgBilling = await dbService.getOrganizationBillingById(subscription.org_billing_id);
      if (orgBilling) {
        const member = await dbService.getOrganizationMember(orgBilling.organization_id, user.userId);
        if (!member) {
          return c.json({ error: 'Not a member of this organization' }, 403);
        }
        if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
          return c.json({ error: 'OWNER or ADMIN role required for billing changes' }, 403);
        }
      }
    } else {
      const customer = await dbService.getBillingCustomerByUserId(user.userId);
      if (!customer || subscription.customer_id !== customer.id) {
        return c.json({ error: 'Subscription not found' }, 404);
      }
    }

    // Cancel in provider
    if (subscription.stripe_subscription_id) {
      const provider = getDefaultProvider();
      if (provider.cancelSubscription) {
        await provider.cancelSubscription(subscription.stripe_subscription_id, { immediately });
      }
    }

    // Update in database
    const updates: Record<string, unknown> = {
      status: immediately ? 'CANCELED' : subscription.status,
      canceled_at: Date.now(),
    };

    if (!immediately) {
      updates.cancel_at = subscription.current_period_end;
    }

    await dbService.updateSubscription(subscriptionId, updates);

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

    if (subscription.org_billing_id) {
      const orgBilling = await dbService.getOrganizationBillingById(subscription.org_billing_id);
      if (orgBilling) {
        const member = await dbService.getOrganizationMember(orgBilling.organization_id, user.userId);
        if (!member) {
          return c.json({ error: 'Not a member of this organization' }, 403);
        }
        if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
          return c.json({ error: 'OWNER or ADMIN role required for billing changes' }, 403);
        }
      }
    } else {
      const customer = await dbService.getBillingCustomerByUserId(user.userId);
      if (!customer || subscription.customer_id !== customer.id) {
        return c.json({ error: 'Subscription not found' }, 404);
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
        await provider.updateSubscription(subscription.stripe_subscription_id, {
          quantity: data.seats,
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
      const member = await dbService.getOrganizationMember(orgId, user.userId);
      if (!member) {
        return c.json({ error: 'Not a member of this organization' }, 403);
      }
      if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
        return c.json({ error: 'OWNER or ADMIN role required for billing changes' }, 403);
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
        const periodEnd = new Date(now);
        if (plan.billing_interval === 'YEARLY') {
          periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        } else {
          periodEnd.setMonth(periodEnd.getMonth() + 1);
        }

        await dbService.convertSubscriptionToActive(existingSub.id, {
          planId,
          seats,
          stripeSubscriptionId,
          currentPeriodStart: new Date(now),
          currentPeriodEnd: periodEnd,
          status: 'ACTIVE',
        });

        if (orgBillingId) {
          await dbService.updateOrganizationBilling(orgBillingId, {
            trial_converted: true,
          });
        }
      }
    } else {
      const periodEnd = new Date(now);
      if (plan.billing_interval === 'YEARLY') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      await dbService.createSubscription({
        id: nanoid(),
        customer_id: customer.id,
        org_billing_id: orgBillingId,
        plan_id: planId,
        status: 'ACTIVE',
        seats,
        stripe_subscription_id: stripeSubscriptionId,
        current_period_start: now,
        current_period_end: periodEnd.getTime(),
      });
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
