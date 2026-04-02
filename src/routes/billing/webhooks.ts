/**
 * Webhooks Routes
 * Handle webhooks from payment providers (Stripe, Stax, Relay)
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { dbService } from '../../services/db.service';
import { getProvider, isProviderAvailable } from '../../services/payments';
import { processTopupFromWebhook } from './credits';

const app = new Hono();

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

    // Check for duplicate
    const existingEvent = await dbService.getWebhookEventByProviderAndEventId('stripe', event.id);
    if (existingEvent) {
      return c.json({ received: true, duplicate: true });
    }

    // Store event
    const dbRecord = await dbService.createWebhookEvent({
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

    // Check for duplicate
    const existingEvent = await dbService.getWebhookEventByProviderAndEventId('stax', event.id);
    if (existingEvent) {
      return c.json({ received: true, duplicate: true });
    }

    // Store event
    const dbRecord = await dbService.createWebhookEvent({
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

    // Check for duplicate
    const existingEvent = await dbService.getWebhookEventByProviderAndEventId('relay', event.id);
    if (existingEvent) {
      return c.json({ received: true, duplicate: true });
    }

    // Store event
    const dbRecord = await dbService.createWebhookEvent({
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
          try {
            const result = await processTopupFromWebhook({
              paymentIntentId,
              orgBillingId,
              amountCents,
              userId,
            });
            console.log(`Topup processed via webhook: $${(result.amountAddedCents / 100).toFixed(2)} added, balance: $${(result.balanceCents / 100).toFixed(2)}, alreadyProcessed: ${result.alreadyProcessed}`);
          } catch (topupError) {
            console.error('Credits topup webhook processing error:', topupError);
          }
        }
        break;
      }

      // Standard payment processing
      const payment = await dbService.getPaymentByStripePaymentIntentId(paymentIntentId);
      if (payment) {
        await dbService.updatePayment(payment.id, { status: 'SUCCEEDED' });

        // Update invoice
        if (payment.invoice_id) {
          const invoice = await dbService.getInvoiceById(payment.invoice_id);
          if (invoice) {
            const newAmountPaid = invoice.amount_paid + payment.amount;
            const newAmountDue = invoice.total - newAmountPaid;
            await dbService.updateInvoice(invoice.id, {
              amount_paid: newAmountPaid,
              amount_due: newAmountDue,
              status: newAmountDue <= 0 ? 'PAID' : 'OPEN',
              paid_at: newAmountDue <= 0 ? Date.now() : undefined,
            });
          }
        }
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

        const updates: Record<string, unknown> = {
          status: mappedStatus,
          current_period_start: periodStart ? periodStart * 1000 : undefined,
          current_period_end: periodEnd ? periodEnd * 1000 : undefined,
          cancel_at: cancelAt ? cancelAt * 1000 : undefined,
          canceled_at: canceledAt ? canceledAt * 1000 : undefined,
        };

        // When Stripe confirms payment (incomplete → active), mark trial as converted
        if (mappedStatus === 'ACTIVE' && subscription.status === 'INCOMPLETE' && subscription.org_billing_id) {
          await dbService.updateOrganizationBilling(subscription.org_billing_id, {
            trial_converted: true,
          });
        }

        await dbService.updateSubscription(subscription.id, updates);
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
        const matchByPeriod = existingInvoices.find(
          (inv) =>
            inv.subscription_id === subscription.id &&
            inv.period_start === invPeriodStart &&
            inv.period_end === invPeriodEnd &&
            !inv.stripe_invoice_id
        );
        if (matchByPeriod) {
          await dbService.updateInvoice(matchByPeriod.id, {
            stripe_invoice_id: stripeInvoiceId,
            invoice_number: (data.number as string) || matchByPeriod.invoice_number,
            status: mapStripeInvoiceStatus(data.status as string),
            subtotal: (data.subtotal as number) ?? matchByPeriod.subtotal,
            tax: (data.tax as number) ?? matchByPeriod.tax,
            total: (data.total as number) ?? matchByPeriod.total,
            amount_paid: (data.amount_paid as number) ?? matchByPeriod.amount_paid,
            amount_due: (data.amount_due as number) ?? matchByPeriod.amount_due,
            pdf_url: (data.invoice_pdf as string) ?? matchByPeriod.pdf_url,
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
        await dbService.updatePayment(payment.id, { status: 'SUCCEEDED' });

        if (payment.invoice_id) {
          const invoice = await dbService.getInvoiceById(payment.invoice_id);
          if (invoice) {
            const newAmountPaid = invoice.amount_paid + payment.amount;
            const newAmountDue = invoice.total - newAmountPaid;
            await dbService.updateInvoice(invoice.id, {
              amount_paid: newAmountPaid,
              amount_due: newAmountDue,
              status: newAmountDue <= 0 ? 'PAID' : 'OPEN',
              paid_at: newAmountDue <= 0 ? Date.now() : undefined,
            });
          }
        }
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

async function processRelayEvent(event: WebhookEvent): Promise<void> {
  const data = event.data as Record<string, unknown>;

  switch (event.type) {
    case 'payment.completed': {
      const txHash = data.txHash as string;
      const payment = await dbService.getPaymentByTxHash(txHash);
      if (payment) {
        await dbService.updatePayment(payment.id, { status: 'SUCCEEDED' });

        if (payment.invoice_id) {
          const invoice = await dbService.getInvoiceById(payment.invoice_id);
          if (invoice) {
            const newAmountPaid = invoice.amount_paid + payment.amount;
            const newAmountDue = invoice.total - newAmountPaid;
            await dbService.updateInvoice(invoice.id, {
              amount_paid: newAmountPaid,
              amount_due: newAmountDue,
              status: newAmountDue <= 0 ? 'PAID' : 'OPEN',
              paid_at: newAmountDue <= 0 ? Date.now() : undefined,
            });
          }
        }
      } else {
        // Payment not found - it might be a new payment we haven't recorded
        // This could happen if user sends crypto directly without going through our flow
        const metadata = data.metadata as Record<string, string>;
        if (metadata?.invoiceId) {
          const invoice = await dbService.getInvoiceById(metadata.invoiceId);
          if (invoice) {
            // Record the payment
            const amount = Math.round(parseFloat(data.amount as string) * 100);
            await dbService.createPayment({
              id: nanoid(),
              customer_id: invoice.customer_id,
              invoice_id: invoice.id,
              amount,
              currency: invoice.currency,
              status: 'SUCCEEDED',
              provider: 'relay',
              tx_hash: txHash,
              blockchain: data.chainId?.toString() || 'unknown',
              from_address: data.fromAddress as string,
              to_address: data.toAddress as string,
            });

            // Update invoice
            const newAmountPaid = invoice.amount_paid + amount;
            const newAmountDue = invoice.total - newAmountPaid;
            await dbService.updateInvoice(invoice.id, {
              amount_paid: newAmountPaid,
              amount_due: newAmountDue,
              status: newAmountDue <= 0 ? 'PAID' : 'OPEN',
              paid_at: newAmountDue <= 0 ? Date.now() : undefined,
            });
          }
        }
      }
      break;
    }

    case 'payment.failed':
    case 'payment.expired': {
      const paymentId = data.paymentId as string;
      // Try to find by our payment ID in metadata
      const metadata = data.metadata as Record<string, string>;
      if (metadata?.paymentId) {
        const payment = await dbService.getPaymentById(metadata.paymentId);
        if (payment) {
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
