/**
 * Stripe Payment Provider
 * Implementation of PaymentProvider interface for Stripe
 */

import Stripe from 'stripe';
import type {
  PaymentProvider,
  StripeConfig,
  ExternalCustomer,
  ExternalPaymentMethod,
  ExternalPaymentIntent,
  ExternalSubscription,
  ExternalInvoice,
  ExternalRefund,
  CreateCustomerInput,
  AttachPaymentMethodInput,
  CreatePaymentIntentInput,
  CreateSubscriptionInput,
  CancelSubscriptionInput,
  CreateRefundInput,
  CreateCheckoutSessionInput,
  CheckoutSession,
  PreviewSubscriptionChangeInput,
  SubscriptionChangePreview,
  WebhookEvent,
  ConnectedAccount,
  CreateConnectedAccountInput,
  ConnectedAccountOnboardingLink,
  Transfer,
  CreateTransferInput,
} from './types';

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: (config.apiVersion as Stripe.LatestApiVersion) || '2024-11-20.acacia',
    });
    this.webhookSecret = config.webhookSecret;
  }

  // Customer management
  async createCustomer(input: CreateCustomerInput): Promise<ExternalCustomer> {
    const customer = await this.stripe.customers.create({
      email: input.email,
      name: input.name,
      metadata: input.metadata,
    });

    return {
      id: customer.id,
      email: customer.email || undefined,
      name: customer.name || undefined,
      metadata: customer.metadata as Record<string, string>,
    };
  }

  async getCustomer(customerId: string): Promise<ExternalCustomer | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if (customer.deleted) return null;

      return {
        id: customer.id,
        email: customer.email || undefined,
        name: customer.name || undefined,
        metadata: customer.metadata as Record<string, string>,
      };
    } catch (error) {
      if ((error as Stripe.errors.StripeError).code === 'resource_missing') {
        return null;
      }
      throw error;
    }
  }

  async updateCustomer(customerId: string, input: Partial<CreateCustomerInput>): Promise<ExternalCustomer> {
    const customer = await this.stripe.customers.update(customerId, {
      email: input.email,
      name: input.name,
      metadata: input.metadata,
    });

    return {
      id: customer.id,
      email: customer.email || undefined,
      name: customer.name || undefined,
      metadata: customer.metadata as Record<string, string>,
    };
  }

  async deleteCustomer(customerId: string): Promise<void> {
    await this.stripe.customers.del(customerId);
  }

  // Payment methods
  async attachPaymentMethod(customerId: string, input: AttachPaymentMethodInput): Promise<ExternalPaymentMethod> {
    if (!input.paymentMethodId) {
      throw new Error('paymentMethodId is required for Stripe');
    }

    const paymentMethod = await this.stripe.paymentMethods.attach(input.paymentMethodId, {
      customer: customerId,
    });

    return this.mapPaymentMethod(paymentMethod);
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  async listPaymentMethods(customerId: string): Promise<ExternalPaymentMethod[]> {
    const methods = await this.stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    return methods.data.map((pm) => this.mapPaymentMethod(pm));
  }

  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    await this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  private mapPaymentMethod(pm: Stripe.PaymentMethod): ExternalPaymentMethod {
    return {
      id: pm.id,
      type: 'card',
      cardBrand: pm.card?.brand,
      cardLast4: pm.card?.last4,
      cardExpMonth: pm.card?.exp_month,
      cardExpYear: pm.card?.exp_year,
    };
  }

  // Payments (with Connect support)
  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<ExternalPaymentIntent> {
    const params: Stripe.PaymentIntentCreateParams = {
      amount: input.amount,
      currency: input.currency,
      customer: input.customerId,
      payment_method: input.paymentMethodId,
      metadata: input.metadata,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
    };

    // Connect: Add application fee for platform
    if (input.applicationFeeAmount) {
      params.application_fee_amount = input.applicationFeeAmount;
    }

    // Connect: Transfer to connected account
    if (input.transferData?.destination) {
      params.transfer_data = {
        destination: input.transferData.destination,
        amount: input.transferData.amount,
      };
    }

    // Connect: Direct charge on behalf of connected account
    if (input.onBehalfOf) {
      params.on_behalf_of = input.onBehalfOf;
    }

    // If charging on a connected account, use stripeAccount header
    const options: Stripe.RequestOptions | undefined = input.connectedAccountId
      ? { stripeAccount: input.connectedAccountId }
      : undefined;

    const intent = options
      ? await this.stripe.paymentIntents.create(params, options)
      : await this.stripe.paymentIntents.create(params);

    return this.mapPaymentIntent(intent);
  }

  async confirmPaymentIntent(paymentIntentId: string): Promise<ExternalPaymentIntent> {
    const intent = await this.stripe.paymentIntents.confirm(paymentIntentId);
    return this.mapPaymentIntent(intent);
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<ExternalPaymentIntent> {
    const intent = await this.stripe.paymentIntents.cancel(paymentIntentId);
    return this.mapPaymentIntent(intent);
  }

  async getPaymentIntent(paymentIntentId: string): Promise<ExternalPaymentIntent | null> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return this.mapPaymentIntent(intent);
    } catch (error) {
      if ((error as Stripe.errors.StripeError).code === 'resource_missing') {
        return null;
      }
      throw error;
    }
  }

  private mapPaymentIntent(intent: Stripe.PaymentIntent): ExternalPaymentIntent {
    const statusMap: Record<Stripe.PaymentIntent.Status, ExternalPaymentIntent['status']> = {
      requires_payment_method: 'requires_payment_method',
      requires_confirmation: 'requires_confirmation',
      requires_action: 'requires_action',
      processing: 'processing',
      requires_capture: 'processing',
      succeeded: 'succeeded',
      canceled: 'canceled',
    };

    return {
      id: intent.id,
      status: statusMap[intent.status] || 'failed',
      amount: intent.amount,
      amountReceived: intent.amount_received,
      currency: intent.currency,
      clientSecret: intent.client_secret || undefined,
      metadata: intent.metadata as Record<string, string>,
    };
  }

  // Refunds
  async createRefund(input: CreateRefundInput): Promise<ExternalRefund> {
    const refund = await this.stripe.refunds.create({
      payment_intent: input.paymentIntentId,
      amount: input.amount,
      reason: input.reason as Stripe.RefundCreateParams.Reason,
    });

    return {
      id: refund.id,
      amount: refund.amount,
      status: refund.status === 'succeeded' ? 'succeeded' : refund.status === 'pending' ? 'pending' : 'failed',
    };
  }

  // Subscriptions
  async createSubscription(input: CreateSubscriptionInput): Promise<ExternalSubscription> {
    const params: Stripe.SubscriptionCreateParams = {
      customer: input.customerId,
      items: [{ price: input.priceId, quantity: input.quantity || 1 }],
      metadata: input.metadata,
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
    };

    if (input.trialEnd) {
      params.trial_end = input.trialEnd;
    } else if (input.trialPeriodDays) {
      params.trial_period_days = input.trialPeriodDays;
    }

    if (input.paymentMethodId) {
      params.default_payment_method = input.paymentMethodId;
    }

    const subscription = await this.stripe.subscriptions.create(params);

    const result = this.mapSubscription(subscription);

    // For trials: clientSecret comes from the pending SetupIntent (save card, charge later)
    const setupIntent = subscription.pending_setup_intent as Stripe.SetupIntent | null;
    if (setupIntent?.client_secret) {
      result.clientSecret = setupIntent.client_secret;
    }

    // For immediate payment: clientSecret comes from the invoice's PaymentIntent
    if (!result.clientSecret) {
      const invoice = subscription.latest_invoice as Stripe.Invoice | null;
      const pi = invoice?.payment_intent as Stripe.PaymentIntent | null;
      if (pi?.client_secret) {
        result.clientSecret = pi.client_secret;
      }
    }

    return result;
  }

  async getSubscription(subscriptionId: string): Promise<ExternalSubscription | null> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      return this.mapSubscription(subscription);
    } catch (error) {
      if ((error as Stripe.errors.StripeError).code === 'resource_missing') {
        return null;
      }
      throw error;
    }
  }

  async updateSubscription(subscriptionId: string, input: Partial<CreateSubscriptionInput>): Promise<ExternalSubscription> {
    const updateParams: Stripe.SubscriptionUpdateParams = {};

    // Seat (quantity) and/or plan (price) changes both edit the single subscription item.
    if (input.quantity !== undefined || input.priceId) {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      const item: Stripe.SubscriptionUpdateParams.Item = {
        id: subscription.items.data[0].id,
      };
      if (input.quantity !== undefined) item.quantity = input.quantity;
      if (input.priceId) item.price = input.priceId;
      updateParams.items = [item];
    }

    if (input.metadata) {
      updateParams.metadata = input.metadata;
    }

    // Default Stripe behavior is `create_prorations` (deferred to next invoice).
    // Per-seat billing passes `always_invoice` so the card is charged NOW for the
    // prorated delta — critical on YEARLY where the next invoice is ~12 months out.
    if (input.prorationBehavior) {
      updateParams.proration_behavior = input.prorationBehavior;
    }

    // Plan switches reset the billing cycle to the switch date so the new
    // interval (month/year) starts today rather than the old anchor.
    if (input.billingCycleAnchorNow) {
      updateParams.billing_cycle_anchor = 'now';
    }

    const subscription = await this.stripe.subscriptions.update(subscriptionId, updateParams);
    return this.mapSubscription(subscription);
  }

  /**
   * Preview the immediate invoice that a seat or plan change would produce,
   * without applying it. Used by the UI to show "you'll be charged $X now" or
   * "you'll receive $Y credit". A negative ending balance is a customer-balance
   * credit (e.g. annual→monthly downgrade) that Stripe auto-applies to future
   * subscription invoices.
   */
  async previewSubscriptionChange(input: PreviewSubscriptionChangeInput): Promise<SubscriptionChangePreview> {
    const subscription = await this.stripe.subscriptions.retrieve(input.subscriptionId);
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

    const item: Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item = {
      id: subscription.items.data[0].id,
    };
    if (input.quantity !== undefined) item.quantity = input.quantity;
    if (input.priceId) item.price = input.priceId;

    const preview = await this.stripe.invoices.createPreview({
      customer: customerId,
      subscription: input.subscriptionId,
      subscription_details: {
        items: [item],
        proration_behavior: input.prorationBehavior ?? 'always_invoice',
        ...(input.resetBillingAnchor ? { billing_cycle_anchor: 'now' } : {}),
      },
    });

    return {
      amountDueCents: preview.amount_due,
      currency: preview.currency,
      startingBalanceCents: preview.starting_balance ?? 0,
      endingBalanceCents: preview.ending_balance ?? 0,
    };
  }

  async cancelSubscription(subscriptionId: string, input?: CancelSubscriptionInput): Promise<ExternalSubscription> {
    let subscription: Stripe.Subscription;

    if (input?.immediately) {
      subscription = await this.stripe.subscriptions.cancel(subscriptionId);
    } else {
      subscription = await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    }

    return this.mapSubscription(subscription);
  }

  // Checkout Sessions
  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const params: Stripe.Checkout.SessionCreateParams = {
      customer: input.customerId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
    };

    if (input.mode === 'subscription') {
      params.mode = 'subscription';
      params.line_items = [{
        price: input.priceId!,
        quantity: input.quantity || 1,
      }];
      if (input.trialEnd) {
        params.subscription_data = {
          trial_end: input.trialEnd,
          metadata: input.metadata,
        };
      }
    } else {
      params.mode = 'payment';
      params.line_items = [{
        price_data: {
          currency: input.currency || 'usd',
          unit_amount: input.amount!,
          product_data: { name: 'Credits Top-up' },
        },
        quantity: 1,
      }];
    }

    const session = await this.stripe.checkout.sessions.create(params);

    if (!session.url) {
      throw new Error('Stripe Checkout session created without a URL');
    }

    return { id: session.id, url: session.url };
  }

  async retrieveCheckoutSession(sessionId: string): Promise<{
    id: string;
    mode: string;
    status: string | null;
    subscription: string | null;
    metadata: Record<string, string>;
  }> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    return {
      id: session.id,
      mode: session.mode ?? 'subscription',
      status: session.status,
      subscription: typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription as Stripe.Subscription)?.id ?? null,
      metadata: (session.metadata ?? {}) as Record<string, string>,
    };
  }

  private mapSubscription(sub: Stripe.Subscription): ExternalSubscription {
    const statusMap: Record<Stripe.Subscription.Status, ExternalSubscription['status']> = {
      active: 'active',
      canceled: 'canceled',
      past_due: 'past_due',
      unpaid: 'unpaid',
      trialing: 'trialing',
      incomplete: 'incomplete',
      incomplete_expired: 'canceled',
      paused: 'active',
    };

    // Note: current_period_start and current_period_end are not in the TS types for Stripe v20+
    // but they exist in the actual API response. Using type assertion to access them.
    const subWithPeriod = sub as Stripe.Subscription & {
      current_period_start: number;
      current_period_end: number;
    };

    return {
      id: sub.id,
      status: statusMap[sub.status] || 'active',
      currentPeriodStart: subWithPeriod.current_period_start,
      currentPeriodEnd: subWithPeriod.current_period_end,
      cancelAt: sub.cancel_at || undefined,
      canceledAt: sub.canceled_at || undefined,
      metadata: sub.metadata as Record<string, string>,
    };
  }

  // Invoices
  async getInvoice(invoiceId: string): Promise<ExternalInvoice | null> {
    try {
      const invoice = await this.stripe.invoices.retrieve(invoiceId);
      return this.mapInvoice(invoice);
    } catch (error) {
      if ((error as Stripe.errors.StripeError).code === 'resource_missing') {
        return null;
      }
      throw error;
    }
  }

  async listInvoices(customerId: string, limit = 10): Promise<ExternalInvoice[]> {
    const invoices = await this.stripe.invoices.list({
      customer: customerId,
      limit,
    });

    return invoices.data.map((inv) => this.mapInvoice(inv));
  }

  private mapInvoice(invoice: Stripe.Invoice): ExternalInvoice {
    const statusMap: Record<Stripe.Invoice.Status, ExternalInvoice['status']> = {
      draft: 'draft',
      open: 'open',
      paid: 'paid',
      void: 'void',
      uncollectible: 'uncollectible',
    };

    return {
      id: invoice.id,
      status: statusMap[invoice.status || 'draft'] || 'draft',
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      hostedInvoiceUrl: invoice.hosted_invoice_url || undefined,
      invoicePdf: invoice.invoice_pdf || undefined,
    };
  }

  // Webhooks
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    try {
      this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  parseWebhookEvent(payload: string | Buffer): WebhookEvent {
    const event = JSON.parse(typeof payload === 'string' ? payload : payload.toString());

    return {
      id: event.id,
      type: event.type,
      provider: 'stripe',
      data: event.data.object,
      createdAt: event.created,
    };
  }

  // ============================================
  // Stripe Connect Methods
  // ============================================

  async createConnectedAccount(input: CreateConnectedAccountInput): Promise<ConnectedAccount> {
    const accountType = input.type || 'express';

    const params: Stripe.AccountCreateParams = {
      type: accountType,
      email: input.email,
      metadata: input.metadata,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    };

    if (input.businessName) {
      params.business_profile = {
        name: input.businessName,
      };
    }

    if (input.country) {
      params.country = input.country;
    }

    const account = await this.stripe.accounts.create(params);

    return this.mapConnectedAccount(account);
  }

  async getConnectedAccount(accountId: string): Promise<ConnectedAccount | null> {
    try {
      const account = await this.stripe.accounts.retrieve(accountId);
      return this.mapConnectedAccount(account);
    } catch (error) {
      if ((error as Stripe.errors.StripeError).code === 'resource_missing') {
        return null;
      }
      throw error;
    }
  }

  async updateConnectedAccount(accountId: string, input: Partial<CreateConnectedAccountInput>): Promise<ConnectedAccount> {
    const params: Stripe.AccountUpdateParams = {
      metadata: input.metadata,
    };

    if (input.email) {
      params.email = input.email;
    }

    if (input.businessName) {
      params.business_profile = {
        name: input.businessName,
      };
    }

    const account = await this.stripe.accounts.update(accountId, params);
    return this.mapConnectedAccount(account);
  }

  async deleteConnectedAccount(accountId: string): Promise<void> {
    await this.stripe.accounts.del(accountId);
  }

  async createAccountOnboardingLink(
    accountId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<ConnectedAccountOnboardingLink> {
    const accountLink = await this.stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return {
      url: accountLink.url,
      expiresAt: accountLink.expires_at,
    };
  }

  async createAccountDashboardLink(accountId: string): Promise<{ url: string }> {
    const loginLink = await this.stripe.accounts.createLoginLink(accountId);
    return { url: loginLink.url };
  }

  private mapConnectedAccount(account: Stripe.Account): ConnectedAccount {
    return {
      id: account.id,
      provider: 'stripe',
      type: (account.type as 'standard' | 'express' | 'custom') || 'express',
      email: account.email || undefined,
      businessName: account.business_profile?.name || undefined,
      country: account.country || undefined,
      chargesEnabled: account.charges_enabled || false,
      payoutsEnabled: account.payouts_enabled || false,
      detailsSubmitted: account.details_submitted || false,
      metadata: account.metadata as Record<string, string>,
      createdAt: account.created || Math.floor(Date.now() / 1000),
    };
  }

  // ============================================
  // Transfers (for Connect payouts)
  // ============================================

  async createTransfer(input: CreateTransferInput): Promise<Transfer> {
    const params: Stripe.TransferCreateParams = {
      amount: input.amount,
      currency: input.currency,
      destination: input.destinationAccountId,
      description: input.description,
      metadata: input.metadata,
    };

    if (input.sourceTransaction) {
      params.source_transaction = input.sourceTransaction;
    }

    const transfer = await this.stripe.transfers.create(params);

    return this.mapTransfer(transfer);
  }

  async getTransfer(transferId: string): Promise<Transfer | null> {
    try {
      const transfer = await this.stripe.transfers.retrieve(transferId);
      return this.mapTransfer(transfer);
    } catch (error) {
      if ((error as Stripe.errors.StripeError).code === 'resource_missing') {
        return null;
      }
      throw error;
    }
  }

  async listTransfers(connectedAccountId?: string, limit = 10): Promise<Transfer[]> {
    const params: Stripe.TransferListParams = { limit };
    if (connectedAccountId) {
      params.destination = connectedAccountId;
    }

    const transfers = await this.stripe.transfers.list(params);
    return transfers.data.map((t) => this.mapTransfer(t));
  }

  async reverseTransfer(transferId: string, amount?: number): Promise<Transfer> {
    const reversal = await this.stripe.transfers.createReversal(transferId, {
      amount,
    });

    // Get the updated transfer
    const transfer = await this.stripe.transfers.retrieve(transferId);
    return this.mapTransfer(transfer);
  }

  private mapTransfer(transfer: Stripe.Transfer): Transfer {
    return {
      id: transfer.id,
      amount: transfer.amount,
      currency: transfer.currency,
      destinationAccountId: typeof transfer.destination === 'string' ? transfer.destination : transfer.destination?.id || '',
      status: transfer.reversed ? 'canceled' : 'paid',
      metadata: transfer.metadata as Record<string, string>,
      createdAt: transfer.created,
    };
  }

  // ============================================
  // Platform Balance
  // ============================================

  async getPlatformBalance(): Promise<{ available: number; pending: number; currency: string }[]> {
    const balance = await this.stripe.balance.retrieve();

    return balance.available.map((b, i) => ({
      available: b.amount,
      pending: balance.pending[i]?.amount || 0,
      currency: b.currency,
    }));
  }
}
