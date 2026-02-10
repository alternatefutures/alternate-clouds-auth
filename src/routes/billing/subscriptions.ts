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

const app = new Hono();

app.use('*', authMiddleware);

const createSubscriptionSchema = z.object({
  planId: z.string().min(1),
  seats: z.number().int().min(1).optional().default(1),
  paymentMethodId: z.string().min(1).optional(),
});

const updateSeatsSchema = z.object({
  seats: z.number().int().min(1),
});

/** Serialize plan fields for API responses */
function serializePlanForResponse(plan: SubscriptionPlan) {
  return {
    id: plan.id,
    name: plan.name,
    basePricePerSeat: plan.base_price_per_seat,
    usageMarkup: plan.usage_markup,
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
          usageMarkup: plan?.usage_markup || 0,
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
        usageMarkup: plan?.usage_markup || 0,
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
 * Create a new subscription
 */
app.post('/', async (c) => {
  try {
    const user = requireAuthUser(c);
    const body = await c.req.json();
    const data = createSubscriptionSchema.parse(body);

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ error: 'Customer not found. Create customer first.' }, 404);
    }

    // Check for existing active subscription
    const existingSubscription = await dbService.getActiveSubscriptionByCustomerId(customer.id);
    if (existingSubscription) {
      return c.json({ error: 'Already have an active subscription. Cancel it first.' }, 400);
    }

    // Get the plan
    const plan = await dbService.getSubscriptionPlanById(data.planId);
    if (!plan) {
      return c.json({ error: 'Plan not found' }, 404);
    }

    // Guard: only allow subscribing to active plans
    if (!plan.is_active) {
      return c.json({ error: 'This plan is no longer available' }, 400);
    }

    // Calculate period end based on billing interval
    let stripeSubscriptionId: string | undefined;
    const now = Date.now();
    const periodEnd = new Date(now);

    if (plan.billing_interval === 'YEARLY') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Create subscription in Stripe (if plan has a Stripe price)
    if (plan.stripe_price_id && customer.stripe_customer_id) {
      const provider = getDefaultProvider();
      if (provider.createSubscription) {
        const externalSub = await provider.createSubscription({
          customerId: customer.stripe_customer_id,
          priceId: plan.stripe_price_id,
          quantity: data.seats,
          metadata: { userId: user.userId },
        });
        stripeSubscriptionId = externalSub.id;
      }
    }

    // Create subscription in database
    const subscription = await dbService.createSubscription({
      id: nanoid(),
      customer_id: customer.id,
      plan_id: plan.id,
      status: 'ACTIVE',
      seats: data.seats,
      stripe_subscription_id: stripeSubscriptionId,
      current_period_start: Math.floor(now / 1000),
      current_period_end: Math.floor(periodEnd.getTime() / 1000),
    });

    return c.json({
      subscription: {
        id: subscription.id,
        plan: plan.name,
        billingInterval: plan.billing_interval,
        status: subscription.status,
        seats: subscription.seats,
        basePricePerSeat: plan.base_price_per_seat,
        usageMarkup: plan.usage_markup,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        createdAt: subscription.created_at,
      },
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

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404);
    }

    const subscription = await dbService.getSubscriptionById(subscriptionId);
    if (!subscription || subscription.customer_id !== customer.id) {
      return c.json({ error: 'Subscription not found' }, 404);
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
      status: immediately ? 'CANCELED' : 'ACTIVE',
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

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404);
    }

    const subscription = await dbService.getSubscriptionById(subscriptionId);
    if (!subscription || subscription.customer_id !== customer.id) {
      return c.json({ error: 'Subscription not found' }, 404);
    }

    // Update in provider
    if (subscription.stripe_subscription_id) {
      const provider = getDefaultProvider();
      if (provider.updateSubscription) {
        await provider.updateSubscription(subscription.stripe_subscription_id, {
          quantity: data.seats,
        });
      }
    }

    // Update in database
    await dbService.updateSubscription(subscriptionId, { seats: data.seats });

    const updatedSubscription = await dbService.getSubscriptionById(subscriptionId);
    const plan = await dbService.getSubscriptionPlanById(subscription.plan_id);

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
        usageMarkup: plan?.usage_markup || 0,
        includedStorageGb: plan?.included_storage_gb || 0,
        includedBandwidthGb: plan?.included_bandwidth_gb || 0,
        includedInvocations: plan?.included_invocations || 0,
        includedComputeSeconds: plan?.included_compute_seconds || 0,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAt: subscription.cancel_at,
        trialEnd: subscription.trial_end,
        createdAt: subscription.created_at,
      },
      trial: {
        startedAt: orgBilling.trial_started_at,
        endsAt: orgBilling.trial_ends_at,
        converted: orgBilling.trial_converted,
        daysRemaining: orgBilling.trial_ends_at
          ? Math.max(0, Math.ceil((orgBilling.trial_ends_at - Date.now()) / (24 * 60 * 60 * 1000)))
          : null,
      },
    });
  } catch (error) {
    console.error('Get org subscription error:', error);
    return c.json({ error: 'Failed to get organization subscription' }, 500);
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
