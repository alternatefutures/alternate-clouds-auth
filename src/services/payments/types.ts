/**
 * Payment Provider Types
 * Unified interface for Stripe Connect, Stax Connect, and Relay.link
 * Supports multi-tenant marketplace/platform model
 */

export type ProviderName = 'stripe' | 'stax' | 'relay';

// Connected Account types (for Stripe Connect / Stax Connect)
export interface ConnectedAccount {
  id: string;
  provider: ProviderName;
  type: 'standard' | 'express' | 'custom'; // Stripe types
  email?: string;
  businessName?: string;
  country?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingUrl?: string;
  dashboardUrl?: string;
  metadata?: Record<string, string>;
  createdAt: number;
}

export interface CreateConnectedAccountInput {
  email: string;
  businessName?: string;
  country?: string;
  type?: 'standard' | 'express' | 'custom';
  metadata?: Record<string, string>;
  // For custom onboarding flow
  returnUrl?: string;
  refreshUrl?: string;
}

export interface ConnectedAccountOnboardingLink {
  url: string;
  expiresAt: number;
}

// External provider responses
export interface ExternalCustomer {
  id: string;
  email?: string;
  name?: string;
  metadata?: Record<string, string>;
  // For platform customers linked to connected accounts
  connectedAccountId?: string;
}

export interface ExternalPaymentMethod {
  id: string;
  type: 'card' | 'crypto';
  // Card fields
  cardBrand?: string;
  cardLast4?: string;
  cardExpMonth?: number;
  cardExpYear?: number;
  // Crypto fields
  walletAddress?: string;
  blockchain?: string;
}

export interface ExternalPaymentIntent {
  id: string;
  status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'succeeded' | 'canceled' | 'failed';
  amount: number;
  amountReceived?: number;
  currency: string;
  clientSecret?: string;
  metadata?: Record<string, string>;
  // For crypto payments
  depositAddress?: string;
  chainId?: number;
  tokenAddress?: string;
  expiresAt?: number;
}

export interface ExternalSubscription {
  id: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing' | 'incomplete';
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAt?: number;
  canceledAt?: number;
  clientSecret?: string;
  metadata?: Record<string, string>;
}

export interface ExternalInvoice {
  id: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  amountDue: number;
  amountPaid: number;
  currency: string;
  hostedInvoiceUrl?: string;
  invoicePdf?: string;
}

export interface ExternalRefund {
  id: string;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed' | 'canceled';
}

// Input types for provider methods
export interface CreateCustomerInput {
  email: string;
  name?: string;
  metadata?: Record<string, string>;
}

export interface AttachPaymentMethodInput {
  // Card payment method (Stripe/Stax)
  paymentMethodId?: string;
  // Crypto wallet (Relay)
  walletAddress?: string;
  blockchain?: string;
}

export interface CreatePaymentIntentInput {
  amount: number; // in cents
  currency: string;
  customerId: string;
  paymentMethodId?: string;
  metadata?: Record<string, string>;
  // Crypto specific
  tokenSymbol?: string;
  chainId?: number;
  // Connect specific - for platform/marketplace payments
  connectedAccountId?: string;
  applicationFeeAmount?: number; // Platform fee in cents
  transferData?: {
    destination: string; // Connected account ID
    amount?: number; // Amount to transfer (if different from payment)
  };
  onBehalfOf?: string; // Connected account ID for direct charges
}

export interface CreateSubscriptionInput {
  customerId: string;
  priceId: string;
  quantity?: number;
  trialPeriodDays?: number;
  trialEnd?: number; // Unix timestamp (seconds) — overrides trialPeriodDays
  paymentMethodId?: string;
  metadata?: Record<string, string>;
  // Connect specific
  connectedAccountId?: string;
  applicationFeePercent?: number; // Platform takes this % of each invoice
}

// Transfer types for Connect payouts
export interface Transfer {
  id: string;
  amount: number;
  currency: string;
  destinationAccountId: string;
  status: 'pending' | 'paid' | 'failed' | 'canceled';
  metadata?: Record<string, string>;
  createdAt: number;
}

export interface CreateTransferInput {
  amount: number;
  currency: string;
  destinationAccountId: string;
  description?: string;
  metadata?: Record<string, string>;
  // For transfers tied to a specific payment
  sourceTransaction?: string;
}

export interface CancelSubscriptionInput {
  immediately?: boolean;
}

export interface CreateRefundInput {
  paymentIntentId: string;
  amount?: number; // partial refund
  reason?: string;
}

// Webhook event types
export interface WebhookEvent {
  id: string;
  type: string;
  provider: ProviderName;
  data: unknown;
  createdAt: number;
}

// Provider interface
export interface PaymentProvider {
  readonly name: ProviderName;

  // Customer management
  createCustomer(input: CreateCustomerInput): Promise<ExternalCustomer>;
  getCustomer(customerId: string): Promise<ExternalCustomer | null>;
  updateCustomer(customerId: string, input: Partial<CreateCustomerInput>): Promise<ExternalCustomer>;
  deleteCustomer(customerId: string): Promise<void>;

  // Payment methods
  attachPaymentMethod(customerId: string, input: AttachPaymentMethodInput): Promise<ExternalPaymentMethod>;
  detachPaymentMethod(paymentMethodId: string): Promise<void>;
  listPaymentMethods(customerId: string): Promise<ExternalPaymentMethod[]>;
  setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void>;

  // Payments
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<ExternalPaymentIntent>;
  confirmPaymentIntent(paymentIntentId: string): Promise<ExternalPaymentIntent>;
  cancelPaymentIntent(paymentIntentId: string): Promise<ExternalPaymentIntent>;
  getPaymentIntent(paymentIntentId: string): Promise<ExternalPaymentIntent | null>;

  // Refunds
  createRefund(input: CreateRefundInput): Promise<ExternalRefund>;

  // Subscriptions (optional - not all providers support)
  createSubscription?(input: CreateSubscriptionInput): Promise<ExternalSubscription>;
  getSubscription?(subscriptionId: string): Promise<ExternalSubscription | null>;
  updateSubscription?(subscriptionId: string, input: Partial<CreateSubscriptionInput>): Promise<ExternalSubscription>;
  cancelSubscription?(subscriptionId: string, input?: CancelSubscriptionInput): Promise<ExternalSubscription>;

  // Invoices (optional)
  getInvoice?(invoiceId: string): Promise<ExternalInvoice | null>;
  listInvoices?(customerId: string, limit?: number): Promise<ExternalInvoice[]>;

  // Webhooks
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean;
  parseWebhookEvent(payload: string | Buffer): WebhookEvent;

  // Connect / Marketplace methods (optional - Stripe Connect, Stax Connect)
  createConnectedAccount?(input: CreateConnectedAccountInput): Promise<ConnectedAccount>;
  getConnectedAccount?(accountId: string): Promise<ConnectedAccount | null>;
  updateConnectedAccount?(accountId: string, input: Partial<CreateConnectedAccountInput>): Promise<ConnectedAccount>;
  deleteConnectedAccount?(accountId: string): Promise<void>;
  createAccountOnboardingLink?(accountId: string, returnUrl: string, refreshUrl: string): Promise<ConnectedAccountOnboardingLink>;
  createAccountDashboardLink?(accountId: string): Promise<{ url: string }>;

  // Transfers / Payouts (for Connect)
  createTransfer?(input: CreateTransferInput): Promise<Transfer>;
  getTransfer?(transferId: string): Promise<Transfer | null>;
  listTransfers?(connectedAccountId?: string, limit?: number): Promise<Transfer[]>;
  reverseTransfer?(transferId: string, amount?: number): Promise<Transfer>;

  // Platform balance (for Connect)
  getPlatformBalance?(): Promise<{ available: number; pending: number; currency: string }[]>;
}

// Provider configuration
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  apiVersion?: string;
}

export interface StaxConfig {
  apiKey: string;
  merchantId: string;
  webhookSecret: string;
  sandbox?: boolean;
}

export interface RelayConfig {
  apiKey: string;
  webhookSecret: string;
  supportedChains?: number[];
  supportedTokens?: string[];
}

export interface PaymentProviderConfig {
  stripe?: StripeConfig;
  stax?: StaxConfig;
  relay?: RelayConfig;
}
