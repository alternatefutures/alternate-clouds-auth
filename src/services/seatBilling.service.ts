/**
 * Per-seat billing — keeps the org subscription's seat count (and Stripe
 * subscription-item quantity) in lockstep with the active member count.
 *
 * Textbook model (Stripe / Slack / Linear):
 *   - seats = number of active OrganizationMember rows (owner counts as seat #1).
 *   - Stripe subscription-item `quantity` is the source of truth for billing;
 *     we reconcile it to our member count, never to a metadata field.
 *   - Minimum quantity is 1 (Stripe rejects 0). Owner is the floor.
 *   - Seat changes use `proration_behavior: 'always_invoice'`: adding a member
 *     charges the saved card IMMEDIATELY for the prorated remainder of the
 *     period; removing a member issues a prorated credit (to the next invoice
 *     or the customer balance). This is decision #7 (2026-06-03) — deferring to
 *     the next invoice made added seats effectively free until renewal on YEARLY.
 *   - `customer.subscription.updated` webhook reconciles Stripe → DB seats.
 */

import { dbService } from './db.service';
import { getDefaultProvider } from './payments';

export interface SyncSeatsResult {
  synced: boolean;
  seats: number;
  reason: string;
  stripeUpdated: boolean;
}

/**
 * Recompute `seats` for an org from its active member count and push the new
 * quantity to Stripe + the local subscription row. Safe to call after every
 * membership mutation. Never throws on the membership path — logs and returns.
 */
export async function syncOrgSeats(
  organizationId: string,
  opts: { reason: string },
): Promise<SyncSeatsResult> {
  const reason = opts.reason;
  try {
    const members = await dbService.getOrganizationMembers(organizationId);
    const targetSeats = Math.max(1, members.length);

    const orgBilling = await dbService.getOrganizationBillingByOrgId(organizationId);
    if (!orgBilling) {
      console.warn(`[seatBilling] no org billing for org ${organizationId} (reason=${reason})`);
      return { synced: false, seats: targetSeats, reason, stripeUpdated: false };
    }

    const subscription = await dbService.getSubscriptionByOrgBillingId(orgBilling.id);
    if (!subscription) {
      // No subscription to bill against (e.g. fully canceled). Nothing to sync.
      return { synced: false, seats: targetSeats, reason, stripeUpdated: false };
    }

    if (subscription.seats === targetSeats) {
      return { synced: true, seats: targetSeats, reason, stripeUpdated: false };
    }

    let stripeUpdated = false;
    if (subscription.stripe_subscription_id) {
      const provider = getDefaultProvider();
      if (provider.updateSubscription) {
        // Immediate proration (decision #7): charge/credit the card NOW for the
        // prorated seat delta rather than deferring to the next invoice.
        await provider.updateSubscription(subscription.stripe_subscription_id, {
          quantity: targetSeats,
          prorationBehavior: 'always_invoice',
        });
        stripeUpdated = true;
      }
    }

    await dbService.updateSubscription(subscription.id, { seats: targetSeats });

    console.log(
      `[seatBilling] org=${organizationId} seats ${subscription.seats}→${targetSeats} ` +
        `(reason=${reason}, stripe=${stripeUpdated})`,
    );

    return { synced: true, seats: targetSeats, reason, stripeUpdated };
  } catch (err) {
    console.error(`[seatBilling] syncOrgSeats failed for org ${organizationId} (reason=${reason}):`, err);
    return { synced: false, seats: 0, reason, stripeUpdated: false };
  }
}

/**
 * True when the org has a subscription in a state that allows inviting members.
 * Per product decision: a team must be on an ACTIVE PAID plan (real Stripe
 * subscription) before it can add members — trial-only orgs cannot invite.
 */
export async function canOrgInviteMembers(
  organizationId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const orgBilling = await dbService.getOrganizationBillingByOrgId(organizationId);
  if (!orgBilling) {
    return { allowed: false, reason: 'NO_BILLING' };
  }

  const subscription = await dbService.getSubscriptionByOrgBillingId(orgBilling.id);
  if (!subscription) {
    return { allowed: false, reason: 'NO_SUBSCRIPTION' };
  }

  if (subscription.status !== 'ACTIVE') {
    return { allowed: false, reason: 'SUBSCRIPTION_NOT_ACTIVE' };
  }

  const plan = await dbService.getSubscriptionPlanById(subscription.plan_id);
  const isPaid = !!plan && plan.base_price_per_seat > 0;
  if (!isPaid || !subscription.stripe_subscription_id) {
    return { allowed: false, reason: 'PAID_PLAN_REQUIRED' };
  }

  return { allowed: true };
}
