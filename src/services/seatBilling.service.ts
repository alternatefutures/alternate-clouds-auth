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
import { revokePlatformMembership } from './platformSync.service';
import { suspendOrgDeployments } from './trialScheduler';
import { computeProrationCents } from '../utils/billing';

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
        const prevSeats = subscription.seats;
        const seatDelta = targetSeats - prevSeats;

        if (subscription.status === 'TRIALING') {
          // Trial-with-subscription: the owner's trial stays free, but added
          // seats are billed NOW (prorated to trial end). A Stripe `quantity`
          // change during a subscription-wide trial does NOT charge, so we bill
          // the delta out-of-band (one-off invoice / balance credit) and bump
          // the quantity with `proration_behavior: 'none'`. At trial end the
          // recurring invoice then charges all seats.
          const plan = await dbService.getSubscriptionPlanById(subscription.plan_id);
          const basePricePerSeatCents = plan?.base_price_per_seat ?? 0;
          // Stripe customer lives on the BillingCustomer, not OrganizationBilling.
          const billingCustomer = await dbService.getBillingCustomerById(subscription.customer_id);
          const customerId = billingCustomer?.stripe_customer_id ?? orgBilling.stripe_customer_id;

          if (basePricePerSeatCents > 0 && customerId) {
            if (seatDelta > 0 && provider.chargeOneOffInvoice) {
              const amountCents = computeProrationCents(subscription, basePricePerSeatCents, seatDelta);
              if (amountCents > 0) {
                await provider.chargeOneOffInvoice({
                  customerId,
                  amountCents,
                  currency: 'usd',
                  description: `${seatDelta} additional seat${seatDelta > 1 ? 's' : ''} (prorated to trial end)`,
                  metadata: {
                    kind: 'trial_seat_proration',
                    organizationId,
                    subscriptionId: subscription.stripe_subscription_id,
                    fromSeats: String(prevSeats),
                    toSeats: String(targetSeats),
                  },
                  idempotencyKey: `seat-trial-${organizationId}-${subscription.stripe_subscription_id}-${targetSeats}`,
                });
              }
            } else if (seatDelta < 0 && provider.creditCustomerBalance) {
              const amountCents = computeProrationCents(subscription, basePricePerSeatCents, -seatDelta);
              if (amountCents > 0) {
                await provider.creditCustomerBalance({
                  customerId,
                  amountCents,
                  currency: 'usd',
                  description: `${-seatDelta} removed seat${-seatDelta > 1 ? 's' : ''} (prorated credit)`,
                  metadata: {
                    kind: 'trial_seat_credit',
                    organizationId,
                    subscriptionId: subscription.stripe_subscription_id,
                    fromSeats: String(prevSeats),
                    toSeats: String(targetSeats),
                  },
                  idempotencyKey: `seat-trial-credit-${organizationId}-${subscription.stripe_subscription_id}-${targetSeats}`,
                });
              }
            }
          }

          // Quantity reflects the new seat count for the post-trial invoice, but
          // no proration is charged on the subscription itself (trial intact).
          await provider.updateSubscription(subscription.stripe_subscription_id, {
            quantity: targetSeats,
            prorationBehavior: 'none',
          });
          stripeUpdated = true;
        } else {
          // ACTIVE (and other live states): immediate proration (decision #7) —
          // charge/credit the card NOW for the prorated seat delta rather than
          // deferring to the next invoice.
          await provider.updateSubscription(subscription.stripe_subscription_id, {
            quantity: targetSeats,
            prorationBehavior: 'always_invoice',
          });
          stripeUpdated = true;
        }
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
 *
 * A team may add members when it is on a paid plan (real Stripe subscription)
 * AND either:
 *   - the subscription is ACTIVE, or
 *   - the subscription is TRIALING but already subscribed (a Stripe
 *     subscription exists) WITH a default payment method on file — the added
 *     seat is charged immediately (prorated to trial end) while the owner's
 *     trial stays free.
 *
 * Trial-only orgs with no subscription, or no card on file, cannot invite.
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

  const isLiveStatus = subscription.status === 'ACTIVE' || subscription.status === 'TRIALING';
  if (!isLiveStatus) {
    return { allowed: false, reason: 'SUBSCRIPTION_NOT_ACTIVE' };
  }

  const plan = await dbService.getSubscriptionPlanById(subscription.plan_id);
  const isPaid = !!plan && plan.base_price_per_seat > 0;
  if (!isPaid || !subscription.stripe_subscription_id) {
    return { allowed: false, reason: 'PAID_PLAN_REQUIRED' };
  }

  // During a trial the added seat is charged immediately, so a card must be on
  // file. (ACTIVE subscriptions already have a payment method by definition.)
  if (subscription.status === 'TRIALING') {
    // The Stripe customer lives on the BillingCustomer the subscription points
    // at — OrganizationBilling.stripeCustomerId is often null.
    const billingCustomer = await dbService.getBillingCustomerById(subscription.customer_id);
    const stripeCustomerId = billingCustomer?.stripe_customer_id ?? orgBilling.stripe_customer_id;

    // Source of truth the rest of billing uses: the local PaymentMethod table.
    const localMethods = await dbService.getPaymentMethodsByCustomerId(subscription.customer_id);
    let hasCard = localMethods.length > 0;

    if (!hasCard && stripeCustomerId) {
      try {
        const provider = getDefaultProvider();
        const methods = provider.listPaymentMethods
          ? await provider.listPaymentMethods(stripeCustomerId)
          : [];
        hasCard = methods.length > 0;
      } catch (err) {
        console.error(`[seatBilling] payment-method check failed for org ${organizationId}:`, err);
      }
    }

    if (!hasCard) {
      return { allowed: false, reason: 'NO_PAYMENT_METHOD' };
    }
  }

  return { allowed: true };
}

/**
 * Disable an org down to just its owner: remove every non-OWNER member and stop
 * all running deployments. Used when a paid (non-trial) subscription is
 * canceled — the org becomes a locked shell the owner can recover by
 * re-subscribing. The deploy gate (cloud-api) separately blocks new deploys
 * once the subscription status is no longer ACTIVE/TRIALING. Best-effort: logs
 * and continues so a failure in one step never blocks the cancellation.
 */
export async function disableOrg(organizationId: string): Promise<void> {
  try {
    const removedUserIds = await dbService.removeNonOwnerMembers(organizationId);
    if (removedUserIds.length > 0) {
      console.log(`[disableOrg] removed ${removedUserIds.length} non-owner member(s) from org ${organizationId}`);

      // Drop each removed member's CACHED platform membership in cloud-api.
      // Without this, cloud-api's auth fast-path keeps trusting its local
      // OrganizationMember row and the removed user retains access to the org's
      // projects/deployments/shell after cancellation. Best-effort per user.
      await Promise.all(
        removedUserIds.map((userId) =>
          revokePlatformMembership(organizationId, userId).catch((err) =>
            console.error(`[disableOrg] failed to revoke platform membership for user ${userId} org ${organizationId}:`, err),
          ),
        ),
      );

      // One final seat reconcile after the bulk removal so Stripe quantity +
      // the local seat count settle to the owner-only floor (decision: a single
      // sync, not one per removed member).
      await syncOrgSeats(organizationId, { reason: 'org_disabled' }).catch((err) =>
        console.error(`[disableOrg] final seat sync failed for org ${organizationId}:`, err),
      );
    }
  } catch (err) {
    console.error(`[disableOrg] failed to remove members for org ${organizationId}:`, err);
  }

  // Stop running compute (Akash/Phala/Spheron) so a canceled org stops costing.
  await suspendOrgDeployments(organizationId).catch((err) =>
    console.error(`[disableOrg] failed to suspend deployments for org ${organizationId}:`, err),
  );
}

/**
 * Cancel an org's Stripe subscription before the org is deleted. Without this,
 * deleting the org cascades the DB rows but leaves the Stripe subscription live
 * — it keeps billing the customer for an org that no longer exists.
 *
 * Unused paid time is credited to the customer balance (`prorate`/`invoice_now`),
 * which is harmless during a trial and persists on the per-user BillingCustomer
 * (NOT deleted with the org), so the credit carries to the user's next plan.
 *
 * Throws on an unexpected provider error so the caller can abort the delete and
 * avoid orphaning the subscription. A missing/already-canceled sub is success.
 */
/**
 * Void every OPEN (and delete every DRAFT) Stripe invoice for the org's
 * billing customer. Called before org deletion: a dangling open invoice
 * would otherwise finalize later and charge the card for an org that no
 * longer exists. Best-effort per invoice — a single void failure must not
 * block the delete (the error is loud for manual reconciliation).
 */
export async function voidOpenOrgInvoices(organizationId: string): Promise<number> {
  const orgBilling = await dbService.getOrganizationBillingByOrgId(organizationId);
  if (!orgBilling) return 0;

  const subscription = await dbService.getSubscriptionByOrgBillingId(orgBilling.id);
  const billingCustomer = subscription
    ? await dbService.getBillingCustomerById(subscription.customer_id)
    : null;
  const stripeCustomerId = billingCustomer?.stripe_customer_id ?? orgBilling.stripe_customer_id;
  if (!stripeCustomerId) return 0;

  const provider = getDefaultProvider();
  if (!provider.listInvoices || !provider.voidInvoice) return 0;

  let voided = 0;
  try {
    const invoices = await provider.listInvoices(stripeCustomerId, 25);
    for (const inv of invoices) {
      if (inv.status !== 'open' && inv.status !== 'draft') continue;
      try {
        await provider.voidInvoice(inv.id);
        voided += 1;
      } catch (err) {
        console.error(
          `[seatBilling] failed to void invoice ${inv.id} for org ${organizationId} — reconcile manually:`,
          err,
        );
      }
    }
  } catch (err) {
    console.error(`[seatBilling] could not list invoices for org ${organizationId}:`, err);
  }
  if (voided > 0) {
    console.log(`[seatBilling] voided ${voided} open/draft invoice(s) before deleting org ${organizationId}`);
  }
  return voided;
}

export async function cancelOrgSubscription(
  organizationId: string,
  opts?: { prorate?: boolean },
): Promise<{ canceled: boolean; reason: string }> {
  const orgBilling = await dbService.getOrganizationBillingByOrgId(organizationId);
  if (!orgBilling) return { canceled: false, reason: 'NO_BILLING' };

  const subscription = await dbService.getSubscriptionByOrgBillingId(orgBilling.id);
  if (!subscription) return { canceled: false, reason: 'NO_SUBSCRIPTION' };
  if (!subscription.stripe_subscription_id) return { canceled: false, reason: 'NO_STRIPE_SUB' };

  const liveStates = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'INCOMPLETE'];
  if (!liveStates.includes(subscription.status)) {
    return { canceled: false, reason: `STATUS_${subscription.status}` };
  }

  const provider = getDefaultProvider();
  if (!provider.cancelSubscription) return { canceled: false, reason: 'PROVIDER_NO_CANCEL' };

  // Credit unused PAID time; a trial has nothing to prorate.
  const prorate = opts?.prorate ?? (subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE');

  try {
    await provider.cancelSubscription(subscription.stripe_subscription_id, {
      immediately: true,
      prorate,
      invoiceNow: prorate,
    });
    return { canceled: true, reason: 'OK' };
  } catch (err) {
    if ((err as { code?: string }).code === 'resource_missing') {
      return { canceled: true, reason: 'ALREADY_GONE' };
    }
    throw err;
  }
}
