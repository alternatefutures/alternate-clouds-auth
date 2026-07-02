/**
 * Webhooks Routes
 * Handle webhooks from payment providers (Stripe, Stax, Relay)
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { audit } from '../../lib/audit';
import { dbService } from '../../services/db.service';
import { getProvider, isProviderAvailable } from '../../services/payments';
import {
  isAmountCheckedStablecoin,
  isChainVerifyRequired,
  verifyRelayPaymentOnChain,
} from '../../services/payments/relayChainVerifier';
import { disableOrg } from '../../services/seatBilling.service';
import { computePeriodEnd } from '../../utils/billing';
import { processTopupFromWebhook } from './credits';

const app = new Hono();

/**
 * Settle the invoice linked to a succeeded payment: add the payment amount to
 * `amount_paid`, recompute `amount_due`, and mark PAID once fully covered. No-op
 * when the payment isn't tied to an invoice or the invoice is already PAID.
 * Shared by the Stripe, Stax, and Relay settlement paths so the math never
 * drifts between providers.
 */
async function applyPaymentToInvoice(
  payment: { invoice_id?: string | null; amount: number },
): Promise<void> {
  if (!payment.invoice_id) return;
  const invoice = await dbService.getInvoiceById(payment.invoice_id);
  if (!invoice || invoice.status === 'PAID') return;
  const newAmountPaid = invoice.amount_paid + payment.amount;
  const newAmountDue = invoice.total - newAmountPaid;
  await dbService.updateInvoice(invoice.id, {
    amount_paid: newAmountPaid,
    amount_due: newAmountDue,
    status: newAmountDue <= 0 ? 'PAID' : 'OPEN',
    paid_at: newAmountDue <= 0 ? Date.now() : undefined,
  });
}

/**
 * POST /billing/webhooks/stripe
 * Handle Stripe webhooks
 */
app.post('/stripe', async (c) => {
  try {
    if (!isProviderAvailable('stripe')) {
      return c.json({ error: 'Stripe not configured' }, 400);
    }

    const signature = c.req.header('stripe-signature');
    if (!signature) {
      return c.json({ error: 'Missing signature' }, 400);
    }

    const body = await c.req.text();
    const provider = getProvider('stripe');

    // Verify signature
    if (!provider.verifyWebhookSignature(body, signature)) {
      return c.json({ error: 'Invalid signature' }, 400);
    }

    // Parse event
    const event = provider.parseWebhookEvent(body);

    // Dedupe only on SUCCESSFULLY processed events. A row that exists but is
    // unprocessed (a prior attempt threw mid-processing → 500) must be
    // REPROCESSED on the provider's retry, not acknowledged with 200 — otherwise
    // it stays permanently half-processed.
    const existingEvent = await dbService.getWebhookEventByProviderAndEventId('stripe', event.id);
    if (existingEvent?.processed) {
      return c.json({ received: true, duplicate: true });
    }

    // Reuse the existing (unprocessed) row on retry; only create on first sight.
    const dbRecord = existingEvent ?? await dbService.createWebhookEvent({
      id: nanoid(),
      provider: 'stripe',
      event_type: event.type,
      event_id: event.id,
      payload: body,
      processed: 0,
    });

    // Process event — only mark processed on success, return non-2xx on failure
    // so the provider retries transient errors
    try {
      await processStripeEvent(event);
      await dbService.markWebhookEventProcessed(dbRecord.id);
      return c.json({ received: true });
    } catch (processError) {
      console.error('Stripe webhook processing error:', processError);
      return c.json({ error: 'Processing failed, will retry' }, 500);
    }
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

/**
 * POST /billing/webhooks/stax
 * Handle Stax webhooks
 */
app.post('/stax', async (c) => {
  try {
    if (!isProviderAvailable('stax')) {
      return c.json({ error: 'Stax not configured' }, 400);
    }

    const signature = c.req.header('x-stax-signature');
    if (!signature) {
      return c.json({ error: 'Missing signature' }, 400);
    }

    const body = await c.req.text();
    const provider = getProvider('stax');

    // Verify signature
    if (!provider.verifyWebhookSignature(body, signature)) {
      return c.json({ error: 'Invalid signature' }, 400);
    }

    // Parse event
    const event = provider.parseWebhookEvent(body);

    // Dedupe only on SUCCESSFULLY processed events; reprocess unprocessed retries.
    const existingEvent = await dbService.getWebhookEventByProviderAndEventId('stax', event.id);
    if (existingEvent?.processed) {
      return c.json({ received: true, duplicate: true });
    }

    const dbRecord = existingEvent ?? await dbService.createWebhookEvent({
      id: nanoid(),
      provider: 'stax',
      event_type: event.type,
      event_id: event.id,
      payload: body,
      processed: 0,
    });

    // Process event — only mark processed on success
    try {
      await processStaxEvent(event);
      await dbService.markWebhookEventProcessed(dbRecord.id);
      return c.json({ received: true });
    } catch (processError) {
      console.error('Stax webhook processing error:', processError);
      return c.json({ error: 'Processing failed, will retry' }, 500);
    }
  } catch (error) {
    console.error('Stax webhook error:', error);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

/**
 * POST /billing/webhooks/relay
 * Handle Relay.link webhooks (crypto payments)
 */
app.post('/relay', async (c) => {
  try {
    if (!isProviderAvailable('relay')) {
      return c.json({ error: 'Relay not configured' }, 400);
    }

    const signature = c.req.header('x-relay-signature');
    if (!signature) {
      return c.json({ error: 'Missing signature' }, 400);
    }

    const body = await c.req.text();
    const provider = getProvider('relay');

    // Verify signature
    if (!provider.verifyWebhookSignature(body, signature)) {
      return c.json({ error: 'Invalid signature' }, 400);
    }

    // Parse event
    const event = provider.parseWebhookEvent(body);

    // Dedupe only on SUCCESSFULLY processed events; reprocess unprocessed retries.
    const existingEvent = await dbService.getWebhookEventByProviderAndEventId('relay', event.id);
    if (existingEvent?.processed) {
      return c.json({ received: true, duplicate: true });
    }

    const dbRecord = existingEvent ?? await dbService.createWebhookEvent({
      id: nanoid(),
      provider: 'relay',
      event_type: event.type,
      event_id: event.id,
      payload: body,
      processed: 0,
    });

    // Process event — only mark processed on success
    try {
      await processRelayEvent(event);
      await dbService.markWebhookEventProcessed(dbRecord.id);
      return c.json({ received: true });
    } catch (processError) {
      console.error('Relay webhook processing error:', processError);
      return c.json({ error: 'Processing failed, will retry' }, 500);
    }
  } catch (error) {
    console.error('Relay webhook error:', error);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// Event processors

interface WebhookEvent {
  id: string;
  type: string;
  data: unknown;
}

function mapStripeInvoiceStatus(stripeStatus: string): 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE' {
  const map: Record<string, 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE'> = {
    draft: 'DRAFT',
    open: 'OPEN',
    paid: 'PAID',
    void: 'VOID',
    uncollectible: 'UNCOLLECTIBLE',
  };
  return map[stripeStatus] || 'OPEN';
}

async function processStripeEvent(event: WebhookEvent): Promise<void> {
  const data = event.data as Record<string, unknown>;

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntentId = data.id as string;
      const metadata = data.metadata as Record<string, string> | undefined;

      // Check if this is a credits topup
      if (metadata?.type === 'org_credits_topup') {
        const orgBillingId = metadata.orgBillingId;
        const amountCents = (data.amount_received as number) ?? (data.amount as number) ?? 0;
        const userId = metadata.userId;

        if (orgBillingId) {
          const result = await processTopupFromWebhook({
            paymentIntentId,
            orgBillingId,
            amountCents,
            userId,
            organizationId: metadata.orgId,
          });
          console.log(`Topup processed via webhook: $${(result.amountAddedCents / 100).toFixed(2)} added, balance: $${(result.balanceCents / 100).toFixed(2)}, alreadyProcessed: ${result.alreadyProcessed}`);
        }
        break;
      }

      // Standard payment processing
      const payment = await dbService.getPaymentByStripePaymentIntentId(paymentIntentId);
      if (payment) {
        // Idempotency: skip if this payment was already settled synchronously
        if (payment.status === 'SUCCEEDED') {
          break;
        }

        await dbService.updatePayment(payment.id, { status: 'SUCCEEDED' });
        await applyPaymentToInvoice(payment);
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const paymentIntentId = data.id as string;
      const payment = await dbService.getPaymentByStripePaymentIntentId(paymentIntentId);
      if (payment) {
        const errorMessage = (data.last_payment_error as Record<string, string>)?.message;
        await dbService.updatePayment(payment.id, {
          status: 'FAILED',
          failure_reason: errorMessage,
        });
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscriptionId = data.id as string;
      const subscription = await dbService.getSubscriptionByStripeId(subscriptionId);
      if (!subscription) {
        // H6: trial subs are created with a NULL stripe_subscription_id, so a
        // lookup by Stripe id can miss a row that exists locally — leaving our
        // state stale vs Stripe. Surface it instead of silently dropping.
        console.warn(
          `[webhook] ${event.type}: no local subscription matched Stripe sub ${subscriptionId} ` +
            `(event ${event.id}); local state may be stale`,
        );
      }
      if (subscription) {
        const status = data.status as string;
        const statusMap: Record<string, string> = {
          active: 'ACTIVE',
          incomplete: 'INCOMPLETE',
          incomplete_expired: 'CANCELED',
          canceled: 'CANCELED',
          past_due: 'PAST_DUE',
          unpaid: 'UNPAID',
          trialing: 'TRIALING',
          paused: 'SUSPENDED',
        };
        const mappedStatus = statusMap[status];
        if (!mappedStatus) {
          console.error(`Unknown Stripe subscription status: "${status}" for subscription ${subscriptionId}`);
          break;
        }
        const periodStart = data.current_period_start as number | undefined;
        const periodEnd = data.current_period_end as number | undefined;
        const cancelAt = data.cancel_at as number | undefined;
        const canceledAt = data.canceled_at as number | undefined;

        // Reconcile seats from Stripe's authoritative item quantity (Stripe is
        // the source of truth for billed seats). Guards against drift when seat
        // changes originate outside our API (dashboard edits, proration, etc.).
        const item = (data.items as { data?: Array<{ quantity?: number; price?: { id?: string } }> } | undefined)
          ?.data?.[0];
        const itemQuantity = item?.quantity;

        // Reconcile the plan from Stripe's authoritative item price (handles plan
        // switches — monthly↔annual — whether triggered by our change-plan endpoint
        // or directly in the Stripe dashboard). Period start/end above already
        // reflect the new interval.
        let reconciledPlanId: string | undefined;
        const itemPriceId = item?.price?.id;
        if (itemPriceId) {
          const matchedPlan = await dbService.getSubscriptionPlanByStripePriceId(itemPriceId);
          if (matchedPlan && matchedPlan.id !== subscription.plan_id) {
            reconciledPlanId = matchedPlan.id;
          }
        }

        const updates: Record<string, unknown> = {
          status: mappedStatus,
          current_period_start: periodStart ? periodStart * 1000 : undefined,
          current_period_end: periodEnd ? periodEnd * 1000 : undefined,
          cancel_at: cancelAt ? cancelAt * 1000 : undefined,
          canceled_at: canceledAt ? canceledAt * 1000 : undefined,
          ...(typeof itemQuantity === 'number' && itemQuantity > 0 ? { seats: itemQuantity } : {}),
          ...(reconciledPlanId ? { plan_id: reconciledPlanId } : {}),
        };

        // When payment is confirmed (incomplete→active) or trial ends and first charge
        // succeeds (trialing→active), mark trial as converted
        if (mappedStatus === 'ACTIVE'
          && (subscription.status === 'INCOMPLETE' || subscription.status === 'TRIALING')
          && subscription.org_billing_id) {
          await dbService.updateOrganizationBilling(subscription.org_billing_id, {
            trial_converted: true,
          });
        }

        await dbService.updateSubscription(subscription.id, updates);

        // A period-end cancel (cancel_at_period_end) actually terminates HERE,
        // when Stripe deletes the subscription. An incomplete_expired (failed
        // initial payment) also lands here. In both cases tear the org down:
        // revoke non-owner members + suspend all compute. disableOrg is
        // idempotent. The immediate-cancel API path clears the local Stripe id
        // first, so this lookup won't match for that path → no double disable.
        if (
          mappedStatus === 'CANCELED' &&
          subscription.status !== 'CANCELED' &&
          subscription.org_billing_id
        ) {
          const orgBilling = await dbService.getOrganizationBillingById(subscription.org_billing_id);
          if (orgBilling) {
            await disableOrg(orgBilling.organization_id).catch((err) =>
              console.error(`[webhook] disableOrg failed for org ${orgBilling.organization_id}:`, err),
            );
          }
        }

        // H1: mirror the sub's payment method onto the customer's invoice
        // default so renewal + one-off (trial seat) invoices collect. Catch-all
        // for every subscribe path (Checkout, SetupIntent). Idempotent.
        try {
          await getProvider('stripe').syncSubscriptionDefaultPaymentMethodToCustomer?.(subscriptionId);
        } catch (pmErr) {
          console.error('[webhook] failed to sync customer default PM (non-fatal):', pmErr);
        }
      }
      break;
    }

    case 'invoice.created':
    case 'invoice.finalized': {
      const stripeInvoiceId = data.id as string;
      const existing = await dbService.getInvoiceByStripeId(stripeInvoiceId);
      if (existing) {
        await dbService.updateInvoice(existing.id, {
          status: mapStripeInvoiceStatus(data.status as string),
          subtotal: data.subtotal as number,
          tax: (data.tax as number) ?? 0,
          total: data.total as number,
          amount_paid: data.amount_paid as number,
          amount_due: data.amount_due as number,
          pdf_url: (data.invoice_pdf as string) ?? existing.pdf_url,
        });
        break;
      }

      const stripeCustomerId = data.customer as string;
      const customer = stripeCustomerId
        ? await dbService.getBillingCustomerByStripeId(stripeCustomerId)
        : null;
      if (!customer) break;

      const subscriptionStripeId = data.subscription as string | undefined;
      const subscription = subscriptionStripeId
        ? await dbService.getSubscriptionByStripeId(subscriptionStripeId)
        : null;

      // Check if a local invoice already exists for this subscription+period
      // (created at subscribe time before webhooks arrive)
      const invPeriodStart = data.period_start ? (data.period_start as number) * 1000 : undefined;
      const invPeriodEnd = data.period_end ? (data.period_end as number) * 1000 : undefined;
      const invDueDate = data.due_date ? (data.due_date as number) * 1000 : undefined;

      if (subscription) {
        const existingInvoices = await dbService.listInvoicesByCustomerId(customer.id);
        const unlinkedForSub = existingInvoices.filter(
          (inv) => inv.subscription_id === subscription.id && !inv.stripe_invoice_id,
        );

        // Link the Stripe invoice to a locally-estimated row instead of inserting
        // a second one (which would diverge in amount). Matching is loosened to
        // tolerate period drift from subscribe / change-plan / seat-proration:
        //   1. exact period match, else
        //   2. the only unlinked row for this subscription, else
        //   3. the nearest unlinked row within a 2-day window of Stripe's period.
        const DAY = 24 * 60 * 60 * 1000;
        const exact = unlinkedForSub.find(
          (inv) => inv.period_start === invPeriodStart && inv.period_end === invPeriodEnd,
        );
        let match = exact;
        if (!match && unlinkedForSub.length === 1) {
          match = unlinkedForSub[0];
        }
        if (!match && invPeriodStart != null) {
          const nearest = unlinkedForSub
            .map((inv) => ({ inv, delta: Math.abs((inv.period_start ?? 0) - invPeriodStart) }))
            .sort((a, b) => a.delta - b.delta)[0];
          if (nearest && nearest.delta <= 2 * DAY) match = nearest.inv;
        }

        if (match) {
          await dbService.updateInvoice(match.id, {
            stripe_invoice_id: stripeInvoiceId,
            invoice_number: (data.number as string) || match.invoice_number,
            status: mapStripeInvoiceStatus(data.status as string),
            // Stripe is authoritative for amounts + period — overwrite the local
            // estimate so the two never diverge.
            subtotal: (data.subtotal as number) ?? match.subtotal,
            tax: (data.tax as number) ?? match.tax,
            total: (data.total as number) ?? match.total,
            amount_paid: (data.amount_paid as number) ?? match.amount_paid,
            amount_due: (data.amount_due as number) ?? match.amount_due,
            period_start: invPeriodStart ?? match.period_start,
            period_end: invPeriodEnd ?? match.period_end,
            due_date: invDueDate ?? match.due_date,
            pdf_url: (data.invoice_pdf as string) ?? match.pdf_url,
          });
          break;
        }
      }

      await dbService.createInvoice({
        id: nanoid(),
        customer_id: customer.id,
        subscription_id: subscription?.id,
        invoice_number: (data.number as string) || `STRIPE-${stripeInvoiceId.slice(-8)}`,
        status: mapStripeInvoiceStatus(data.status as string),
        subtotal: (data.subtotal as number) ?? 0,
        tax: (data.tax as number) ?? 0,
        total: (data.total as number) ?? 0,
        amount_paid: (data.amount_paid as number) ?? 0,
        amount_due: (data.amount_due as number) ?? 0,
        currency: (data.currency as string) ?? 'usd',
        period_start: invPeriodStart,
        period_end: invPeriodEnd,
        due_date: invDueDate,
        pdf_url: (data.invoice_pdf as string) ?? undefined,
        stripe_invoice_id: stripeInvoiceId,
      });
      break;
    }

    case 'invoice.paid': {
      const stripeInvoiceId = data.id as string;
      const invoice = await dbService.getInvoiceByStripeId(stripeInvoiceId);
      if (invoice) {
        await dbService.updateInvoice(invoice.id, {
          status: 'PAID',
          amount_paid: invoice.total,
          amount_due: 0,
          paid_at: Date.now(),
          pdf_url: (data.invoice_pdf as string) ?? invoice.pdf_url,
        });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const stripeInvoiceId = data.id as string;
      const invoice = await dbService.getInvoiceByStripeId(stripeInvoiceId);
      if (invoice) {
        await dbService.updateInvoice(invoice.id, {
          status: 'OPEN', // Keep open for retry
        });
      }
      break;
    }

    case 'checkout.session.completed': {
      const session = data as Record<string, unknown>;
      const sessionMetadata = session.metadata as Record<string, string> | undefined;
      const mode = session.mode as string;

      if (mode === 'subscription' && sessionMetadata?.type === 'subscription') {
        const stripeSubscriptionId = session.subscription as string;
        const userId = sessionMetadata.userId;
        const orgId = sessionMetadata.orgId;
        const planId = sessionMetadata.planId;
        const seats = parseInt(sessionMetadata.seats || '1', 10);

        if (!stripeSubscriptionId || !userId || !planId) {
          console.error('checkout.session.completed: missing subscription/userId/planId in metadata');
          break;
        }

        const customer = await dbService.getBillingCustomerByUserId(userId);
        if (!customer) {
          console.error(`checkout.session.completed: no billing customer for userId=${userId}`);
          break;
        }

        const plan = await dbService.getSubscriptionPlanById(planId);
        if (!plan) {
          console.error(`checkout.session.completed: plan not found planId=${planId}`);
          break;
        }

        // Find existing trial subscription for this org
        let existingSub: Awaited<ReturnType<typeof dbService.getSubscriptionByOrgBillingId>> | null = null;
        let orgBillingId: string | undefined;

        if (orgId) {
          const billing = await dbService.getOrganizationBillingByOrgId(orgId);
          if (billing) {
            orgBillingId = billing.id;
            existingSub = await dbService.getSubscriptionByOrgBillingId(billing.id);
          }
        }

        const now = Date.now();

        if (existingSub) {
          const isActiveTrial = existingSub.status === 'TRIALING'
            && existingSub.trial_end
            && existingSub.trial_end > now;

          if (isActiveTrial) {
            // Mid-trial checkout: link Stripe sub, update plan, keep TRIALING
            await dbService.updateSubscription(existingSub.id, {
              stripe_subscription_id: stripeSubscriptionId,
              plan_id: planId,
              seats,
              status: 'TRIALING',
            });
          } else {
            // Post-trial: activate immediately
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
          // No existing subscription — create new
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

        // H1: set the customer's invoice default PM from the new subscription.
        try {
          await getProvider('stripe').syncSubscriptionDefaultPaymentMethodToCustomer?.(stripeSubscriptionId);
        } catch (pmErr) {
          console.error('[webhook] failed to sync customer default PM (non-fatal):', pmErr);
        }

        console.log(`Checkout completed: subscription ${stripeSubscriptionId} for user ${userId}, plan ${plan.name}`);
      }
      break;
    }

    case 'account.updated': {
      // Handle connected account updates
      const accountId = data.id as string;
      const connectedAccount = await dbService.getConnectedAccountByStripeId(accountId);
      if (connectedAccount) {
        await dbService.updateConnectedAccount(connectedAccount.id, {
          charges_enabled: (data.charges_enabled as boolean) ? 1 : 0,
          payouts_enabled: (data.payouts_enabled as boolean) ? 1 : 0,
          details_submitted: (data.details_submitted as boolean) ? 1 : 0,
        });
      }
      break;
    }

    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }
}

async function processStaxEvent(event: WebhookEvent): Promise<void> {
  const data = event.data as Record<string, unknown>;

  switch (event.type) {
    case 'transaction.success': {
      const transactionId = data.id as string;
      const payment = await dbService.getPaymentByStaxTransactionId(transactionId);
      if (payment) {
        if (payment.status === 'SUCCEEDED') {
          break;
        }

        await dbService.updatePayment(payment.id, { status: 'SUCCEEDED' });
        await applyPaymentToInvoice(payment);
      }
      break;
    }

    case 'transaction.failed': {
      const transactionId = data.id as string;
      const payment = await dbService.getPaymentByStaxTransactionId(transactionId);
      if (payment) {
        await dbService.updatePayment(payment.id, {
          status: 'FAILED',
          failure_reason: data.message as string,
        });
      }
      break;
    }

    case 'sub_merchant.updated': {
      const subMerchantId = data.id as string;
      const connectedAccount = await dbService.getConnectedAccountByStaxId(subMerchantId);
      if (connectedAccount) {
        await dbService.updateConnectedAccount(connectedAccount.id, {
          charges_enabled: data.processing_enabled ? 1 : 0,
          payouts_enabled: data.payout_enabled ? 1 : 0,
          details_submitted: data.status === 'active' ? 1 : 0,
        });
      }
      break;
    }

    default:
      console.log(`Unhandled Stax event: ${event.type}`);
  }
}

/**
 * Reject a Relay payment.completed event with a structured audit
 * trail. The thrown error bubbles up to the outer handler which
 * returns 500 → Relay retries; if the rejection was correct the
 * retries will keep failing (desired).
 */
function rejectRelayPayment(args: {
  reason: string;
  paymentId?: string;
  txHash?: string;
  details?: Record<string, unknown>;
}): never {
  audit(dbService.prismaClient, {
    category: 'billing',
    action: 'billing.topup.crypto.rejected',
    status: 'error',
    payload: {
      reason: args.reason,
      paymentId: args.paymentId,
      txHash: args.txHash,
      ...(args.details ?? {}),
    },
  });
  console.error('Relay payment.completed REJECTED', args);
  throw new Error(`relay_rejected:${args.reason}`);
}

async function processRelayEvent(event: WebhookEvent): Promise<void> {
  const data = event.data as Record<string, unknown>;

  switch (event.type) {
    case 'payment.completed': {
      const txHash = typeof data.txHash === 'string' ? data.txHash : '';
      const metadata = data.metadata as Record<string, string> | undefined;

      // === Server-of-truth lookup ===========================================
      // We MUST be able to identify the local auth_payments row that
      // this webhook is settling. Two lookup keys:
      //   1. metadata.paymentId — set by us in /topup/crypto/create
      //   2. txHash — set by us when we previously partially-processed
      //      the same event
      // If neither resolves to a row, this webhook is for a payment we
      // didn't initiate; we reject it. The legacy "fall-through to
      // create a brand new auth_payments row from raw webhook data"
      // path was a forgery vector and is gone.
      const paymentById = metadata?.paymentId
        ? await dbService.getPaymentById(metadata.paymentId)
        : null;
      const paymentByTx = txHash ? await dbService.getPaymentByTxHash(txHash) : null;

      // Cross-check: if we resolved a row by both keys they MUST be the
      // same row. A mismatch means the webhook is mapping a known
      // txHash onto someone else's paymentId — drop it.
      if (paymentById && paymentByTx && paymentById.id !== paymentByTx.id) {
        rejectRelayPayment({
          reason: 'payment_id_tx_hash_mismatch',
          paymentId: metadata?.paymentId,
          txHash,
          details: { byId: paymentById.id, byTx: paymentByTx.id },
        });
      }
      const payment = paymentById ?? paymentByTx;
      if (!payment) {
        rejectRelayPayment({
          reason: 'unknown_payment',
          paymentId: metadata?.paymentId,
          txHash,
        });
      }
      if (payment.provider !== 'relay') {
        rejectRelayPayment({
          reason: 'wrong_provider',
          paymentId: payment.id,
          txHash,
          details: { provider: payment.provider },
        });
      }

      // Idempotent short-circuit: if we already settled this row, we
      // are done. The webhook event row was de-duped earlier; this is
      // a defence against a Relay retry that crosses the de-dupe
      // window after we already credited.
      if (payment.status === 'SUCCEEDED') {
        break;
      }

      // === Build verification input from the LOCAL payment row only ========
      // Anything echoed back in `data.*` is treated as advisory at
      // most. The on-chain re-check answers a single question:
      // "did the recipient/contract/amount we recorded actually
      // receive a real transfer with this txHash on the chain we
      // recorded?" The webhook is not allowed to reframe that
      // question.
      const expectedToAddress = payment.to_address ?? '';
      const chainId = payment.blockchain ? Number(payment.blockchain) : NaN;
      const tokenSymbol = payment.token_symbol;
      const tokenAddress = payment.token_address;

      // === Invoice settlements are stablecoin-only (POLICY, not RPC) =======
      // The verifier can only enforce the USD amount for a recognised
      // stablecoin with a persisted canonical contract. A native/unknown
      // token payment row linked to an invoice would settle the full
      // invoice for whatever nonzero value the customer sent — reject it
      // outright, independent of the chain-verify kill switch. (Legacy
      // rows created before token persistence land here by design:
      // fail closed, reconcile manually.)
      if (payment.invoice_id && (!tokenAddress || !isAmountCheckedStablecoin(tokenSymbol))) {
        rejectRelayPayment({
          reason: 'invoice_requires_stablecoin',
          paymentId: payment.id,
          txHash,
          details: {
            invoiceId: payment.invoice_id,
            tokenSymbol: tokenSymbol ?? null,
            hasTokenAddress: Boolean(tokenAddress),
          },
        });
      }

      if (!expectedToAddress || !Number.isFinite(chainId) || chainId <= 0) {
        rejectRelayPayment({
          reason: 'payment_record_incomplete',
          paymentId: payment.id,
          txHash,
          details: {
            hasToAddress: Boolean(expectedToAddress),
            chainId: payment.blockchain,
          },
        });
      }
      if (!txHash) {
        rejectRelayPayment({
          reason: 'missing_tx_hash',
          paymentId: payment.id,
        });
      }

      // === On-chain re-check (HMAC bypass defence) =========================
      const chainVerifyRequired = isChainVerifyRequired();
      const verification = await verifyRelayPaymentOnChain({
        txHash,
        chainId,
        expectedToAddress,
        expectedAmountCents: payment.amount,
        tokenSymbol,
        tokenAddress,
      });
      if (!verification.ok) {
        if (chainVerifyRequired) {
          rejectRelayPayment({
            reason: `chain_verify_failed:${verification.reason}`,
            paymentId: payment.id,
            txHash,
            details: { ...verification.details, chainId },
          });
        }
        console.warn(
          'Relay chain verification failed but RELAY_REQUIRE_CHAIN_VERIFY=false — proceeding (KILL SWITCH ACTIVE)',
          { paymentId: payment.id, txHash, chainId, reason: verification.reason },
        );
      }

      // === Persist the verified facts ======================================
      // Store the fromAddress reported by Relay (cosmetic; we already
      // verified the recipient on-chain) and freeze tx_hash so a
      // future webhook can't quietly substitute a different one.
      await dbService.updatePayment(payment.id, {
        status: 'SUCCEEDED',
        tx_hash: txHash,
        from_address: typeof data.fromAddress === 'string' ? data.fromAddress : undefined,
      });

      // === Credit the right wallet =========================================
      // For org credit top-ups, look up the customer record (server
      // truth) to derive `actorUserId` rather than trusting
      // `metadata.userId` from the webhook.
      if (payment.org_billing_id) {
        const customer = await dbService.getBillingCustomerById(payment.customer_id);
        const result = await processTopupFromWebhook({
          paymentIntentId: `relay:${payment.id}:${txHash}`,
          orgBillingId: payment.org_billing_id,
          amountCents: payment.amount,
          userId: customer?.user_id,
          organizationId: metadata?.orgId,
        });
        audit(dbService.prismaClient, {
          category: 'billing',
          action: 'billing.topup.crypto.settled',
          status: 'ok',
          userId: customer?.user_id ?? null,
          orgId: metadata?.orgId ?? null,
          payload: {
            paymentId: payment.id,
            txHash,
            chainId,
            tokenSymbol,
            amountCents: payment.amount,
            balanceCents: result.balanceCents,
            alreadyProcessed: result.alreadyProcessed,
          },
        });
        console.log(`Crypto topup processed via Relay: $${(result.amountAddedCents / 100).toFixed(2)} added, balance: $${(result.balanceCents / 100).toFixed(2)}, alreadyProcessed: ${result.alreadyProcessed}`);
        break;
      }

      // Invoice settlement path (one-off invoices paid in crypto).
      // Credit by the VERIFIED on-chain amount, bounded by the quoted
      // payment amount — never by the request row alone. With the
      // stablecoin gate above, `verifiedAmountCents` is always present
      // when chain verification ran; the fallback to payment.amount only
      // applies under the explicit RELAY_REQUIRE_CHAIN_VERIFY=false
      // emergency kill switch.
      const verifiedCents =
        verification.ok && verification.verifiedAmountCents != null
          ? verification.verifiedAmountCents
          : payment.amount;
      await applyPaymentToInvoice({
        invoice_id: payment.invoice_id,
        amount: Math.min(payment.amount, verifiedCents),
      });
      audit(dbService.prismaClient, {
        category: 'billing',
        action: 'billing.invoice.crypto.settled',
        status: 'ok',
        payload: {
          paymentId: payment.id,
          invoiceId: payment.invoice_id,
          txHash,
          chainId,
          tokenSymbol,
          quotedAmountCents: payment.amount,
          verifiedAmountCents: verification.ok ? verification.verifiedAmountCents ?? null : null,
          creditedCents: Math.min(payment.amount, verifiedCents),
        },
      });
      break;
    }

    case 'payment.failed':
    case 'payment.expired': {
      const metadata = data.metadata as Record<string, string> | undefined;
      // Only a payment we created can be failed/expired by this hook.
      // We do not accept failure events for arbitrary tx hashes — a
      // forged failure event with no metadata cannot harm us so the
      // strict shape check is purely defence-in-depth.
      if (metadata?.paymentId) {
        const payment = await dbService.getPaymentById(metadata.paymentId);
        if (payment && payment.provider === 'relay' && payment.status === 'PENDING') {
          await dbService.updatePayment(payment.id, {
            status: 'FAILED',
            failure_reason: event.type === 'payment.expired' ? 'Payment expired' : 'Payment failed',
          });
        }
      }
      break;
    }

    default:
      console.log(`Unhandled Relay event: ${event.type}`);
  }
}

export default app;
