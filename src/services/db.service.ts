/**
 * Database service for interacting with PostgreSQL via Prisma
 * Migrated from SQLite (better-sqlite3) to PostgreSQL for shared database with service-cloud-api
 * 
 * SECURITY: Sensitive tokens (refresh tokens, etc.) are hashed before storage
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';

/**
 * Postgres unique-constraint violation. Centralizing the check keeps the
 * Prisma error-code knowledge inside this module so callers don't have to
 * pattern-match raw error codes from the client.
 */
function isUniqueConstraintError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002'
  );
}

/**
 * Default amount of compute credit (in USD cents) seeded into a new
 * org's wallet on signup. Overridable via the `SIGNUP_CREDIT_CENTS`
 * env var so we can change the value with a K8s secret bump rather
 * than a code release. Surfaced through `/admin/users.config` so the
 * admin dashboard never drifts from this value.
 *
 * Single source of truth — anything else that needs to know "what's
 * the signup credit?" must call `getSignupCreditCents()`.
 */
const DEFAULT_SIGNUP_CREDIT_CENTS = 500;

export function getSignupCreditCents(): number {
  const raw = process.env.SIGNUP_CREDIT_CENTS;
  if (!raw) return DEFAULT_SIGNUP_CREDIT_CENTS;
  const parsed = Number.parseInt(raw, 10);
  // Reject NaN, negatives, and absurdly large values (>$10k) to avoid
  // a typo in the env var silently issuing $5,000 credits to every new
  // signup. Falls back to the default and logs once.
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
    console.warn(
      `[db.service] Invalid SIGNUP_CREDIT_CENTS="${raw}" — falling back to ${DEFAULT_SIGNUP_CREDIT_CENTS}`,
    );
    return DEFAULT_SIGNUP_CREDIT_CENTS;
  }
  return parsed;
}

/**
 * Hash a token/secret using SHA-256 for storage at rest
 */
function hashTokenForStorage(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Verify a token against its hash using timing-safe comparison
 */
function verifyTokenHashInternal(token: string, hash: string): boolean {
  const tokenHash = hashTokenForStorage(token);
  if (tokenHash.length !== hash.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(tokenHash, 'utf8'), Buffer.from(hash, 'utf8'));
  } catch {
    return false;
  }
}

// ============================================
// LEGACY INTERFACES (kept for API compatibility)
// ============================================

export interface User {
  id: string;
  email?: string;
  email_verified: number;
  phone?: string;
  phone_verified: number;
  display_name?: string;
  avatar_url?: string;
  created_at: number;
  updated_at: number;
  last_login_at?: number;
}

export interface AuthMethod {
  id: string;
  user_id: string;
  method_type: 'email' | 'sms' | 'wallet' | 'oauth';
  provider?: string;
  identifier: string;
  oauth_access_token?: string;
  oauth_refresh_token?: string;
  oauth_token_expires_at?: number;
  verified: number;
  is_primary: number;
  created_at: number;
  last_used_at?: number;
}

export interface Session {
  id: string;
  user_id: string;
  refresh_token: string;
  token_family: string;
  token_version: number;
  user_agent?: string;
  ip_address?: string;
  device_id?: string;
  expires_at: number;
  revoked: number;
  revoked_at?: number;
  created_at: number;
  last_activity_at: number;
}

export interface VerificationCode {
  id: string;
  // NOTE: Prisma stores this as a string; we keep a union for known types,
  // but may also use additional internal types (e.g. oauth exchange / cli sessions).
  code_type: 'email' | 'sms' | 'mfa' | 'oauth_exchange' | 'oauth_state' | 'cli_session';
  identifier: string;
  code: string;
  expires_at: number;
  attempts: number;
  max_attempts: number;
  verified: number;
  verified_at?: number;
  created_at: number;
  ip_address?: string;
}

export interface SIWEChallenge {
  id: string;
  address: string;
  message: string;
  nonce: string;
  expires_at: number;
  verified: number;
  verified_at?: number;
  created_at: number;
  ip_address?: string;
}

export interface PersonalAccessToken {
  id: string;
  user_id: string;
  organization_id?: string;
  name: string;
  token: string;
  expires_at?: number;
  last_used_at?: number;
  created_at: number;
  updated_at: number;
}

// ============================================
// ORGANIZATION INTERFACES
// ============================================

export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface Organization {
  id: string;
  slug: string;
  name: string;
  avatar_url?: string;
  created_at: number;
  updated_at: number;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  created_at: number;
  /** Project-scoped access. true => access to every project in the org. */
  access_all_projects: boolean;
  /** Platform project IDs a scoped member may access (when access_all_projects is false). */
  project_ids: string[];
}

export interface OrganizationBilling {
  id: string;
  organization_id: string;
  stripe_customer_id?: string;
  trial_started_at?: number;
  trial_ends_at?: number;
  trial_converted: boolean;
  created_at: number;
  updated_at: number;
}

// ============================================
// BILLING INTERFACES
// ============================================

export interface BillingCustomer {
  id: string;
  user_id: string;
  email?: string;
  name?: string;
  stripe_customer_id?: string;
  stax_customer_id?: string;
  created_at: number;
  updated_at: number;
}

export type PaymentMethodType = 'CARD' | 'CRYPTO';
export type PaymentProvider = 'stripe' | 'stax' | 'relay';

export interface PaymentMethod {
  id: string;
  customer_id: string;
  type: PaymentMethodType;
  provider: PaymentProvider;
  card_brand?: string;
  card_last4?: string;
  card_exp_month?: number;
  card_exp_year?: number;
  stripe_payment_method_id?: string;
  stax_payment_method_id?: string;
  wallet_address?: string;
  blockchain?: string;
  is_default: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export type SubscriptionPlanName = 'MONTHLY' | 'YEARLY' | string; // legacy: FREE, STARTER, PRO, ENTERPRISE
export type BillingInterval = 'MONTHLY' | 'YEARLY';

export interface SubscriptionPlan {
  id: string;
  name: SubscriptionPlanName;
  base_price_per_seat: number;
  usage_markup: number;
  billing_interval: BillingInterval;
  is_active: boolean;
  features?: string;
  stripe_price_id?: string;
  included_storage_gb: number;
  included_bandwidth_gb: number;
  included_invocations: number;
  included_compute_seconds: number;
  trial_days: number;
  created_at: number;
  updated_at: number;
}

// `INACTIVE` = org exists but has never subscribed and has no trial (additional
// orgs created via the UI). It is a non-entitled state: the deploy gate blocks
// it, and subscribing converts it to ACTIVE.
export type SubscriptionStatus = 'ACTIVE' | 'INCOMPLETE' | 'CANCELED' | 'PAST_DUE' | 'UNPAID' | 'TRIALING' | 'TRIAL_EXPIRED' | 'SUSPENDED' | 'INACTIVE';

export interface Subscription {
  id: string;
  customer_id: string;
  org_billing_id?: string;
  plan_id: string;
  status: SubscriptionStatus;
  seats: number;
  stripe_subscription_id?: string;
  current_period_start: number;
  current_period_end: number;
  cancel_at?: number;
  canceled_at?: number;
  trial_end?: number;
  created_at: number;
  updated_at: number;
}

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';

export interface Invoice {
  id: string;
  customer_id: string;
  subscription_id?: string;
  invoice_number: string;
  status: InvoiceStatus;
  subtotal: number;
  tax: number;
  total: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  period_start?: number;
  period_end?: number;
  due_date?: number;
  paid_at?: number;
  pdf_url?: string;
  stripe_invoice_id?: string;
  created_at: number;
  updated_at: number;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  created_at: number;
}

export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';

export interface Payment {
  id: string;
  customer_id: string;
  invoice_id?: string;
  payment_method_id?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: PaymentProvider;
  stripe_payment_intent_id?: string;
  stax_transaction_id?: string;
  tx_hash?: string;
  blockchain?: string;
  from_address?: string;
  to_address?: string;
  /** Stablecoin symbol (e.g. USDC) chosen at intent creation time. */
  token_symbol?: string;
  /** Canonical ERC-20 contract for the (chainId, token_symbol) pair. */
  token_address?: string;
  /** Org wallet credited on settlement; never read from webhook. */
  org_billing_id?: string;
  failure_reason?: string;
  created_at: number;
  updated_at: number;
}

export type UsageMetricType = 'storage' | 'bandwidth' | 'compute' | 'requests';

export interface UsageRecord {
  id: string;
  customer_id: string;
  subscription_id?: string;
  metric_type: UsageMetricType;
  quantity: number;
  unit_price: number;
  amount: number;
  period_start: number;
  period_end: number;
  recorded_at: number;
  created_at: number;
}

export interface UsageAggregate {
  id: string;
  customer_id: string;
  subscription_id?: string;
  metric_type: UsageMetricType;
  total_quantity: number;
  total_amount: number;
  period_start: number;
  period_end: number;
  updated_at: number;
}

export interface WebhookEvent {
  id: string;
  provider: PaymentProvider;
  event_type: string;
  event_id: string;
  payload: string;
  processed: number;
  processed_at?: number;
  error?: string;
  created_at: number;
}

// ============================================
// CONNECT / MARKETPLACE INTERFACES
// ============================================

export type ConnectedAccountType = 'standard' | 'express' | 'custom';

export interface ConnectedAccount {
  id: string;
  user_id: string;
  provider: 'stripe' | 'stax';
  account_type: ConnectedAccountType;
  stripe_account_id?: string;
  stax_sub_merchant_id?: string;
  email?: string;
  business_name?: string;
  country?: string;
  charges_enabled: number;
  payouts_enabled: number;
  details_submitted: number;
  metadata?: string;
  created_at: number;
  updated_at: number;
}

export type TransferStatus = 'pending' | 'paid' | 'failed' | 'canceled';

export interface Transfer {
  id: string;
  connected_account_id: string;
  payment_id?: string;
  amount: number;
  currency: string;
  status: TransferStatus;
  provider: 'stripe' | 'stax';
  stripe_transfer_id?: string;
  stax_split_id?: string;
  description?: string;
  metadata?: string;
  created_at: number;
  updated_at: number;
}

export interface PlatformFee {
  id: string;
  connected_account_id: string;
  payment_id: string;
  amount: number;
  currency: string;
  stripe_fee_id?: string;
  created_at: number;
}

// ============================================
// USAGE WALLET INTERFACES (USD cents)
// ============================================

export type UsageLedgerDirection = 'CREDIT' | 'DEBIT';

export interface OrganizationUsageBalance {
  id: string;
  org_billing_id: string;
  balance_cents: number; // USD cents (e.g., 2500 = $25.00)
  updated_at: number;
  created_at: number;
}

export interface OrganizationUsageLedger {
  id: string;
  org_billing_id: string;
  actor_user_id?: string;
  direction: UsageLedgerDirection;
  amount_cents: number; // USD cents
  reason: string;
  idempotency_key: string;
  metadata: Record<string, unknown>;
  created_at: number;
}

export interface OrganizationUsageLog {
  id: string;
  org_billing_id: string;
  user_id: string;
  service_type: string; // ai_inference, compute, storage, bandwidth, etc.
  provider: string;
  resource: string;
  model?: string;
  usd_cost_raw: number;
  margin_rate: number;
  usd_charged: number;
  request_id?: string;
  metadata: Record<string, unknown>;
  created_at: number;
}

export interface OrganizationUsageCostsPrivate {
  id: string;
  org_billing_id: string;
  user_id: string;
  service_type: string;
  provider: string;
  resource: string;
  model?: string;
  usd_cost_raw: number;
  usd_charged: number;
  margin_rate: number;
  margin_usd: number;
  metadata: Record<string, unknown>;
  created_at: number;
}

// Default usage markup rate — used as fallback when org has no active subscription.
// We apply a markup (charged = raw × (1 + rate)), not a true margin. Per-plan
// markup (from SubscriptionPlan.usageMarkup) is preferred; see costMetering.ts.
// Env var name kept as USAGE_MARGIN_RATE for deployment/config compatibility.
export const USAGE_MARGIN_RATE = parseFloat(process.env.USAGE_MARGIN_RATE || '0.25'); // 25% default

// ============================================
// HELPER FUNCTIONS
// ============================================

function dateToTimestamp(date: Date | null | undefined): number | undefined {
  return date ? date.getTime() : undefined;
}

function timestampToDate(timestamp: number | null | undefined): Date | null {
  return timestamp ? new Date(timestamp) : null;
}

function boolToInt(val: boolean): number {
  return val ? 1 : 0;
}

function intToBool(val: number): boolean {
  return val === 1;
}

// ============================================
// DATABASE SERVICE
// ============================================

export class DatabaseService {
  private prisma: PrismaClient;

  constructor(_databasePath?: string) {
    // databasePath is ignored for PostgreSQL (uses DATABASE_URL env var)
    this.prisma = new PrismaClient();
  }

  /**
   * Exposes the underlying Prisma client for modules that need to query
   * tables outside the DatabaseService wrapper (e.g. `audit()` writes in
   * `src/lib/audit.ts`, ad-hoc scripts, debug tooling). Keep callers to a
   * minimum — prefer adding explicit methods to this class when the access
   * pattern is reused.
   */
  get prismaClient(): PrismaClient {
    return this.prisma;
  }

  /**
   * Initialize connection and seed default data
   */
  async initialize(): Promise<void> {
    await this.prisma.$connect();
    await this.seedDefaultPlans();
  }

  /**
   * Health check: verify DB connectivity, count tables and subscription plans.
   * Used by /health/db endpoint.
   */
  async healthCheck(): Promise<{
    status: 'ok' | 'degraded' | 'error';
    db: boolean;
    plans: number;
    tables: number;
    latencyMs: number;
    error?: string;
  }> {
    const start = Date.now();
    try {
      // Verify connectivity with a simple query
      await this.prisma.$queryRawUnsafe('SELECT 1');
      const dbOk = true;

      // Count subscription plans
      const plans = await this.prisma.subscriptionPlan.count();

      // Count tables in the database (PostgreSQL-specific)
      const tableResult = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
      );
      const tables = Number(tableResult[0]?.count ?? 0);

      const latencyMs = Date.now() - start;
      const status = plans > 0 && tables > 3 ? 'ok' : 'degraded';

      return { status, db: dbOk, plans, tables, latencyMs };
    } catch (e: any) {
      return {
        status: 'error',
        db: false,
        plans: 0,
        tables: 0,
        latencyMs: Date.now() - start,
        error: e.message || String(e),
      };
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /**
   * Verify subscription plans exist on startup.
   * Plans are seeded externally via `npm run db:seed` (scripts/seed-plans.ts).
   * This method only logs a warning if no active plans are found.
   */
  private async seedDefaultPlans(): Promise<void> {
    const count = await this.prisma.subscriptionPlan.count({
      where: { isActive: true },
    });
    if (count === 0) {
      console.warn(
        '⚠️  No active subscription plans found. Run: npm run db:seed'
      );
    }
  }

  // ============================================
  // USER METHODS
  // ============================================

  async createUser(user: Omit<User, 'created_at' | 'updated_at'>): Promise<User> {
    const result = await this.prisma.authUser.create({
      data: {
        id: user.id,
        email: user.email?.toLowerCase(),
        emailVerified: intToBool(user.email_verified),
        phone: user.phone,
        phoneVerified: intToBool(user.phone_verified),
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        lastLoginAt: timestampToDate(user.last_login_at),
      },
    });

    return {
      id: result.id,
      email: result.email ?? undefined,
      email_verified: boolToInt(result.emailVerified),
      phone: result.phone ?? undefined,
      phone_verified: boolToInt(result.phoneVerified),
      display_name: result.displayName ?? undefined,
      avatar_url: result.avatarUrl ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
      last_login_at: dateToTimestamp(result.lastLoginAt),
    };
  }

  async getUserById(id: string): Promise<User | null> {
    const result = await this.prisma.authUser.findUnique({ where: { id } });
    if (!result) return null;

    return {
      id: result.id,
      email: result.email ?? undefined,
      email_verified: boolToInt(result.emailVerified),
      phone: result.phone ?? undefined,
      phone_verified: boolToInt(result.phoneVerified),
      display_name: result.displayName ?? undefined,
      avatar_url: result.avatarUrl ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
      last_login_at: dateToTimestamp(result.lastLoginAt),
    };
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const result = await this.prisma.authUser.findUnique({ where: { email: email.toLowerCase() } });
    if (!result) return null;

    return {
      id: result.id,
      email: result.email ?? undefined,
      email_verified: boolToInt(result.emailVerified),
      phone: result.phone ?? undefined,
      phone_verified: boolToInt(result.phoneVerified),
      display_name: result.displayName ?? undefined,
      avatar_url: result.avatarUrl ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
      last_login_at: dateToTimestamp(result.lastLoginAt),
    };
  }

  async getUserByPhone(phone: string): Promise<User | null> {
    const result = await this.prisma.authUser.findUnique({ where: { phone } });
    if (!result) return null;

    return {
      id: result.id,
      email: result.email ?? undefined,
      email_verified: boolToInt(result.emailVerified),
      phone: result.phone ?? undefined,
      phone_verified: boolToInt(result.phoneVerified),
      display_name: result.displayName ?? undefined,
      avatar_url: result.avatarUrl ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
      last_login_at: dateToTimestamp(result.lastLoginAt),
    };
  }

  async updateUser(id: string, updates: Partial<User>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.email !== undefined) data.email = updates.email;
    if (updates.email_verified !== undefined) data.emailVerified = intToBool(updates.email_verified);
    if (updates.phone !== undefined) data.phone = updates.phone;
    if (updates.phone_verified !== undefined) data.phoneVerified = intToBool(updates.phone_verified);
    if (updates.display_name !== undefined) data.displayName = updates.display_name;
    if (updates.avatar_url !== undefined) data.avatarUrl = updates.avatar_url;
    if (updates.last_login_at !== undefined) data.lastLoginAt = timestampToDate(updates.last_login_at);

    await this.prisma.authUser.update({
      where: { id },
      data,
    });
  }

  async deleteUser(id: string): Promise<void> {
    await this.prisma.authUser.delete({ where: { id } });
  }

  // ============================================
  // VERIFICATION CODE METHODS
  // ============================================

  async createVerificationCode(code: Omit<VerificationCode, 'created_at'>): Promise<VerificationCode> {
    const result = await this.prisma.verificationCode.create({
      data: {
        id: code.id,
        codeType: code.code_type,
        identifier: code.identifier,
        code: code.code,
        expiresAt: new Date(code.expires_at),
        attempts: code.attempts,
        maxAttempts: code.max_attempts,
        verified: intToBool(code.verified),
        verifiedAt: timestampToDate(code.verified_at),
        ipAddress: code.ip_address,
      },
    });

    return {
      id: result.id,
      code_type: result.codeType as VerificationCode['code_type'],
      identifier: result.identifier,
      code: result.code,
      expires_at: result.expiresAt.getTime(),
      attempts: result.attempts,
      max_attempts: result.maxAttempts,
      verified: boolToInt(result.verified),
      verified_at: dateToTimestamp(result.verifiedAt),
      created_at: result.createdAt.getTime(),
      ip_address: result.ipAddress ?? undefined,
    };
  }

  async getVerificationCode(identifier: string, codeType: string): Promise<VerificationCode | null> {
    const result = await this.prisma.verificationCode.findFirst({
      where: {
        identifier,
        codeType,
        verified: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!result) return null;

    return {
      id: result.id,
      code_type: result.codeType as VerificationCode['code_type'],
      identifier: result.identifier,
      code: result.code,
      expires_at: result.expiresAt.getTime(),
      attempts: result.attempts,
      max_attempts: result.maxAttempts,
      verified: boolToInt(result.verified),
      verified_at: dateToTimestamp(result.verifiedAt),
      created_at: result.createdAt.getTime(),
      ip_address: result.ipAddress ?? undefined,
    };
  }

  async markVerificationCodeAsUsed(id: string): Promise<void> {
    await this.prisma.verificationCode.update({
      where: { id },
      data: {
        verified: true,
        verifiedAt: new Date(),
      },
    });
  }

  async incrementVerificationAttempts(id: string): Promise<void> {
    await this.prisma.verificationCode.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
      },
    });
  }

  async updateVerificationCodeValue(id: string, code: string): Promise<void> {
    await this.prisma.verificationCode.update({
      where: { id },
      data: {
        code,
      },
    });
  }

  // ============================================
  // SESSION METHODS
  // ============================================

  async createSession(session: Omit<Session, 'created_at' | 'last_activity_at'>): Promise<Session> {
    // SECURITY: Hash refresh token before storage
    const refreshTokenHash = hashTokenForStorage(session.refresh_token);
    
    const result = await this.prisma.authSession.create({
      data: {
        id: session.id,
        userId: session.user_id,
        refreshToken: refreshTokenHash,
        tokenFamily: session.token_family,
        tokenVersion: session.token_version,
        userAgent: session.user_agent,
        ipAddress: session.ip_address,
        deviceId: session.device_id,
        expiresAt: new Date(session.expires_at),
        revoked: intToBool(session.revoked),
        revokedAt: timestampToDate(session.revoked_at),
      },
    });

    return this.mapSessionResult(result);
  }

  async getSessionByRefreshToken(refreshToken: string): Promise<Session | null> {
    // SECURITY: Hash the token to look up by stored hash
    const refreshTokenHash = hashTokenForStorage(refreshToken);
    
    const result = await this.prisma.authSession.findFirst({
      where: {
        refreshToken: refreshTokenHash,
        revoked: false,
      },
    });

    if (!result) return null;
    return this.mapSessionResult(result);
  }

  async getSessionById(id: string): Promise<Session | null> {
    const result = await this.prisma.authSession.findUnique({ where: { id } });
    if (!result) return null;
    return this.mapSessionResult(result);
  }

  async revokeSession(id: string): Promise<void> {
    await this.prisma.authSession.update({
      where: { id },
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    });
  }

  async revokeTokenFamily(tokenFamily: string): Promise<number> {
    const result = await this.prisma.authSession.updateMany({
      where: {
        tokenFamily,
        revoked: false,
      },
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    });
    return result.count;
  }

  verifyRefreshTokenHash(presentedToken: string, storedHash: string): boolean {
    return verifyTokenHashInternal(presentedToken, storedHash);
  }

  async rotateSessionRefreshToken(sessionId: string, newRefreshToken: string, newExpiresAt: number): Promise<void> {
    // SECURITY: Hash the new refresh token before storage
    const refreshTokenHash = hashTokenForStorage(newRefreshToken);
    
    await this.prisma.authSession.update({
      where: { id: sessionId },
      data: {
        refreshToken: refreshTokenHash,
        tokenVersion: { increment: 1 },
        expiresAt: new Date(newExpiresAt),
        lastActivityAt: new Date(),
      },
    });
  }

  private mapSessionResult(result: any): Session {
    return {
      id: result.id,
      user_id: result.userId,
      refresh_token: result.refreshToken,
      token_family: result.tokenFamily,
      token_version: result.tokenVersion,
      user_agent: result.userAgent ?? undefined,
      ip_address: result.ipAddress ?? undefined,
      device_id: result.deviceId ?? undefined,
      expires_at: result.expiresAt.getTime(),
      revoked: boolToInt(result.revoked),
      revoked_at: dateToTimestamp(result.revokedAt),
      created_at: result.createdAt.getTime(),
      last_activity_at: result.lastActivityAt.getTime(),
    };
  }

  async updateSessionActivity(id: string): Promise<void> {
    await this.prisma.authSession.update({
      where: { id },
      data: { lastActivityAt: new Date() },
    });
  }

  async getUserSessions(userId: string): Promise<Session[]> {
    const results = await this.prisma.authSession.findMany({
      where: { userId, revoked: false },
      orderBy: { createdAt: 'desc' },
    });

    return results.map((result) => this.mapSessionResult(result));
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, revoked: false },
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    });
  }

  // ============================================
  // AUTH METHOD METHODS
  // ============================================

  async createAuthMethod(method: Omit<AuthMethod, 'created_at'>): Promise<AuthMethod> {
    const result = await this.prisma.authMethod.create({
      data: {
        id: method.id,
        userId: method.user_id,
        methodType: method.method_type,
        provider: method.provider,
        identifier: method.identifier,
        oauthAccessToken: method.oauth_access_token,
        oauthRefreshToken: method.oauth_refresh_token,
        oauthTokenExpiresAt: timestampToDate(method.oauth_token_expires_at),
        verified: intToBool(method.verified),
        isPrimary: intToBool(method.is_primary),
        lastUsedAt: timestampToDate(method.last_used_at),
      },
    });

    return {
      id: result.id,
      user_id: result.userId,
      method_type: result.methodType as 'email' | 'sms' | 'wallet' | 'oauth',
      provider: result.provider ?? undefined,
      identifier: result.identifier,
      oauth_access_token: result.oauthAccessToken ?? undefined,
      oauth_refresh_token: result.oauthRefreshToken ?? undefined,
      oauth_token_expires_at: dateToTimestamp(result.oauthTokenExpiresAt),
      verified: boolToInt(result.verified),
      is_primary: boolToInt(result.isPrimary),
      created_at: result.createdAt.getTime(),
      last_used_at: dateToTimestamp(result.lastUsedAt),
    };
  }

  async getAuthMethodByIdentifier(identifier: string, methodType: string): Promise<AuthMethod | null> {
    const result = await this.prisma.authMethod.findFirst({
      where: { identifier, methodType },
    });

    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      method_type: result.methodType as 'email' | 'sms' | 'wallet' | 'oauth',
      provider: result.provider ?? undefined,
      identifier: result.identifier,
      oauth_access_token: result.oauthAccessToken ?? undefined,
      oauth_refresh_token: result.oauthRefreshToken ?? undefined,
      oauth_token_expires_at: dateToTimestamp(result.oauthTokenExpiresAt),
      verified: boolToInt(result.verified),
      is_primary: boolToInt(result.isPrimary),
      created_at: result.createdAt.getTime(),
      last_used_at: dateToTimestamp(result.lastUsedAt),
    };
  }

  async getUserAuthMethods(userId: string): Promise<AuthMethod[]> {
    const results = await this.prisma.authMethod.findMany({
      where: { userId },
    });

    return results.map((result) => ({
      id: result.id,
      user_id: result.userId,
      method_type: result.methodType as 'email' | 'sms' | 'wallet' | 'oauth',
      provider: result.provider ?? undefined,
      identifier: result.identifier,
      oauth_access_token: result.oauthAccessToken ?? undefined,
      oauth_refresh_token: result.oauthRefreshToken ?? undefined,
      oauth_token_expires_at: dateToTimestamp(result.oauthTokenExpiresAt),
      verified: boolToInt(result.verified),
      is_primary: boolToInt(result.isPrimary),
      created_at: result.createdAt.getTime(),
      last_used_at: dateToTimestamp(result.lastUsedAt),
    }));
  }

  async updateAuthMethod(id: string, updates: Partial<AuthMethod>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.verified !== undefined) data.verified = intToBool(updates.verified);
    if (updates.is_primary !== undefined) data.isPrimary = intToBool(updates.is_primary);
    if (updates.oauth_access_token !== undefined) data.oauthAccessToken = updates.oauth_access_token;
    if (updates.oauth_refresh_token !== undefined) data.oauthRefreshToken = updates.oauth_refresh_token;
    if (updates.oauth_token_expires_at !== undefined) data.oauthTokenExpiresAt = timestampToDate(updates.oauth_token_expires_at);
    if (updates.last_used_at !== undefined) data.lastUsedAt = timestampToDate(updates.last_used_at);

    await this.prisma.authMethod.update({
      where: { id },
      data,
    });
  }

  async updateAuthMethodLastUsed(id: string): Promise<void> {
    await this.prisma.authMethod.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async deleteAuthMethod(id: string): Promise<void> {
    await this.prisma.authMethod.delete({ where: { id } });
  }

  async getAuthMethodById(id: string): Promise<AuthMethod | null> {
    const result = await this.prisma.authMethod.findUnique({ where: { id } });

    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      method_type: result.methodType as 'email' | 'sms' | 'wallet' | 'oauth',
      provider: result.provider ?? undefined,
      identifier: result.identifier,
      oauth_access_token: result.oauthAccessToken ?? undefined,
      oauth_refresh_token: result.oauthRefreshToken ?? undefined,
      oauth_token_expires_at: dateToTimestamp(result.oauthTokenExpiresAt),
      verified: boolToInt(result.verified),
      is_primary: boolToInt(result.isPrimary),
      created_at: result.createdAt.getTime(),
      last_used_at: dateToTimestamp(result.lastUsedAt),
    };
  }

  async unsetAllPrimaryAuthMethods(userId: string): Promise<void> {
    await this.prisma.authMethod.updateMany({
      where: { userId },
      data: { isPrimary: false },
    });
  }

  // ============================================
  // SIWE CHALLENGE METHODS
  // ============================================

  async createSIWEChallenge(challenge: Omit<SIWEChallenge, 'created_at'>): Promise<SIWEChallenge> {
    const result = await this.prisma.sIWEChallenge.create({
      data: {
        id: challenge.id,
        address: challenge.address,
        message: challenge.message,
        nonce: challenge.nonce,
        expiresAt: new Date(challenge.expires_at),
        verified: intToBool(challenge.verified),
        verifiedAt: timestampToDate(challenge.verified_at),
        ipAddress: challenge.ip_address,
      },
    });

    return {
      id: result.id,
      address: result.address,
      message: result.message,
      nonce: result.nonce,
      expires_at: result.expiresAt.getTime(),
      verified: boolToInt(result.verified),
      verified_at: dateToTimestamp(result.verifiedAt),
      created_at: result.createdAt.getTime(),
      ip_address: result.ipAddress ?? undefined,
    };
  }

  async getSIWEChallengeByNonce(nonce: string): Promise<SIWEChallenge | null> {
    const result = await this.prisma.sIWEChallenge.findUnique({ where: { nonce } });
    if (!result) return null;

    return {
      id: result.id,
      address: result.address,
      message: result.message,
      nonce: result.nonce,
      expires_at: result.expiresAt.getTime(),
      verified: boolToInt(result.verified),
      verified_at: dateToTimestamp(result.verifiedAt),
      created_at: result.createdAt.getTime(),
      ip_address: result.ipAddress ?? undefined,
    };
  }

  async markSIWEChallengeAsVerified(id: string): Promise<void> {
    await this.prisma.sIWEChallenge.update({
      where: { id },
      data: {
        verified: true,
        verifiedAt: new Date(),
      },
    });
  }

  /**
   * Atomically claim a SIWE challenge: marks it verified only if it was
   * still unverified. Returns true if THIS caller is the one who claimed
   * the challenge (and therefore is allowed to proceed with login). Two
   * concurrent /verify calls for the same challenge will only see one
   * `true`; the other gets `false` and must be rejected by the caller.
   */
  async claimSIWEChallenge(id: string): Promise<boolean> {
    const result = await this.prisma.sIWEChallenge.updateMany({
      where: { id, verified: false },
      data: { verified: true, verifiedAt: new Date() },
    });
    return result.count === 1;
  }

  async getSIWEChallengeByAddressAndNonce(address: string, nonce: string): Promise<SIWEChallenge | null> {
    const result = await this.prisma.sIWEChallenge.findFirst({
      where: {
        address,
        nonce,
        verified: false,
      },
    });

    if (!result) return null;

    return {
      id: result.id,
      address: result.address,
      message: result.message,
      nonce: result.nonce,
      expires_at: result.expiresAt.getTime(),
      verified: boolToInt(result.verified),
      verified_at: dateToTimestamp(result.verifiedAt),
      created_at: result.createdAt.getTime(),
      ip_address: result.ipAddress ?? undefined,
    };
  }

  async verifySIWEChallenge(id: string): Promise<void> {
    await this.markSIWEChallengeAsVerified(id);
  }

  // ============================================
  // PERSONAL ACCESS TOKEN METHODS
  // ============================================

  async createPersonalAccessToken(pat: Omit<PersonalAccessToken, 'created_at' | 'updated_at'>): Promise<PersonalAccessToken> {
    const result = await this.prisma.personalAccessToken.create({
      data: {
        id: pat.id,
        userId: pat.user_id,
        organizationId: pat.organization_id,
        name: pat.name,
        token: pat.token,
        expiresAt: timestampToDate(pat.expires_at),
        lastUsedAt: timestampToDate(pat.last_used_at),
      },
    });

    return {
      id: result.id,
      user_id: result.userId,
      organization_id: result.organizationId ?? undefined,
      name: result.name,
      token: result.token,
      expires_at: dateToTimestamp(result.expiresAt),
      last_used_at: dateToTimestamp(result.lastUsedAt),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getPersonalAccessTokenByToken(token: string): Promise<PersonalAccessToken | null> {
    const result = await this.prisma.personalAccessToken.findUnique({ where: { token } });
    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      organization_id: result.organizationId ?? undefined,
      name: result.name,
      token: result.token,
      expires_at: dateToTimestamp(result.expiresAt),
      last_used_at: dateToTimestamp(result.lastUsedAt),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getUserPersonalAccessTokens(userId: string): Promise<PersonalAccessToken[]> {
    const results = await this.prisma.personalAccessToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return results.map((result) => ({
      id: result.id,
      user_id: result.userId,
      organization_id: result.organizationId ?? undefined,
      name: result.name,
      token: result.token,
      expires_at: dateToTimestamp(result.expiresAt),
      last_used_at: dateToTimestamp(result.lastUsedAt),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    }));
  }

  async updatePersonalAccessTokenLastUsed(id: string): Promise<void> {
    await this.prisma.personalAccessToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async deletePersonalAccessToken(id: string): Promise<void> {
    await this.prisma.personalAccessToken.delete({ where: { id } });
  }

  async countPersonalAccessTokensByUserId(userId: string): Promise<number> {
    return await this.prisma.personalAccessToken.count({
      where: { userId },
    });
  }

  async getPersonalAccessTokenById(id: string): Promise<PersonalAccessToken | null> {
    const result = await this.prisma.personalAccessToken.findUnique({ where: { id } });
    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      organization_id: result.organizationId ?? undefined,
      name: result.name,
      token: result.token,
      expires_at: dateToTimestamp(result.expiresAt),
      last_used_at: dateToTimestamp(result.lastUsedAt),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async listPersonalAccessTokensByUserId(userId: string): Promise<PersonalAccessToken[]> {
    return this.getUserPersonalAccessTokens(userId);
  }

  async deleteExpiredPersonalAccessTokens(): Promise<number> {
    const result = await this.prisma.personalAccessToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  }

  // ============================================
  // ORGANIZATION METHODS
  // ============================================

  async createOrganization(org: Omit<Organization, 'created_at' | 'updated_at'>): Promise<Organization> {
    const result = await this.prisma.organization.create({
      data: {
        id: org.id,
        slug: org.slug,
        name: org.name,
        avatarUrl: org.avatar_url,
      },
    });

    return {
      id: result.id,
      slug: result.slug,
      name: result.name,
      avatar_url: result.avatarUrl ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getOrganizationById(id: string): Promise<Organization | null> {
    const result = await this.prisma.organization.findUnique({ where: { id } });
    if (!result) return null;

    return {
      id: result.id,
      slug: result.slug,
      name: result.name,
      avatar_url: result.avatarUrl ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | null> {
    const result = await this.prisma.organization.findUnique({ where: { slug } });
    if (!result) return null;

    return {
      id: result.id,
      slug: result.slug,
      name: result.name,
      avatar_url: result.avatarUrl ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getOrganizationsByUserId(
    userId: string,
  ): Promise<Array<Organization & { role: OrgRole; access_all_projects: boolean; project_ids: string[] }>> {
    const results = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'desc' },
    });

    return results.map((result) => ({
      id: result.organization.id,
      slug: result.organization.slug,
      name: result.organization.name,
      avatar_url: result.organization.avatarUrl ?? undefined,
      created_at: result.organization.createdAt.getTime(),
      updated_at: result.organization.updatedAt.getTime(),
      role: result.role as OrgRole,
      access_all_projects: result.accessAllProjects,
      project_ids: result.projectIds,
    }));
  }

  async updateOrganization(id: string, updates: Partial<Omit<Organization, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.slug !== undefined) data.slug = updates.slug;
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.avatar_url !== undefined) data.avatarUrl = updates.avatar_url;

    await this.prisma.organization.update({
      where: { id },
      data,
    });
  }

  async deleteOrganization(id: string): Promise<void> {
    await this.prisma.organization.delete({ where: { id } });
  }

  // ============================================
  // ORGANIZATION MEMBER METHODS
  // ============================================

  async createOrganizationMember(
    member: Omit<OrganizationMember, 'created_at' | 'access_all_projects' | 'project_ids'> &
      Partial<Pick<OrganizationMember, 'access_all_projects' | 'project_ids'>>,
  ): Promise<OrganizationMember> {
    // Role-elevated members (OWNER/ADMIN) always have full project access.
    const fullByRole = member.role === 'OWNER' || member.role === 'ADMIN';
    const accessAllProjects = fullByRole ? true : member.access_all_projects ?? true;
    const projectIds = accessAllProjects ? [] : member.project_ids ?? [];

    const result = await this.prisma.organizationMember.create({
      data: {
        id: member.id,
        organizationId: member.organization_id,
        userId: member.user_id,
        role: member.role,
        accessAllProjects,
        projectIds,
      },
    });

    return {
      id: result.id,
      organization_id: result.organizationId,
      user_id: result.userId,
      role: result.role as OrgRole,
      created_at: result.createdAt.getTime(),
      access_all_projects: result.accessAllProjects,
      project_ids: result.projectIds,
    };
  }

  async getOrganizationMember(organizationId: string, userId: string): Promise<OrganizationMember | null> {
    const result = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId },
      },
    });

    if (!result) return null;

    return {
      id: result.id,
      organization_id: result.organizationId,
      user_id: result.userId,
      role: result.role as OrgRole,
      created_at: result.createdAt.getTime(),
      access_all_projects: result.accessAllProjects,
      project_ids: result.projectIds,
    };
  }

  async getOrganizationMembers(organizationId: string): Promise<OrganizationMember[]> {
    const results = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    return results.map((result) => ({
      id: result.id,
      organization_id: result.organizationId,
      user_id: result.userId,
      role: result.role as OrgRole,
      created_at: result.createdAt.getTime(),
      access_all_projects: result.accessAllProjects,
      project_ids: result.projectIds,
    }));
  }

  async updateOrganizationMemberRole(organizationId: string, userId: string, role: OrgRole): Promise<void> {
    // Elevating to OWNER/ADMIN grants full project access; demoting to MEMBER
    // preserves whatever scope was previously set.
    const data: Record<string, unknown> = { role };
    if (role === 'OWNER' || role === 'ADMIN') {
      data.accessAllProjects = true;
      data.projectIds = [];
    }
    await this.prisma.organizationMember.update({
      where: {
        organizationId_userId: { organizationId, userId },
      },
      data,
    });
  }

  /**
   * Update a member's project-scoped access. OWNER/ADMIN members always keep
   * full access (scope is a MEMBER-only concept) — callers should guard, but we
   * also normalize here for safety.
   */
  async updateOrganizationMemberAccess(
    organizationId: string,
    userId: string,
    access: { accessAllProjects: boolean; projectIds: string[] },
  ): Promise<void> {
    const accessAllProjects = access.accessAllProjects;
    const projectIds = accessAllProjects ? [] : access.projectIds;
    await this.prisma.organizationMember.update({
      where: {
        organizationId_userId: { organizationId, userId },
      },
      data: { accessAllProjects, projectIds },
    });
  }

  async deleteOrganizationMember(organizationId: string, userId: string): Promise<void> {
    await this.prisma.organizationMember.delete({
      where: {
        organizationId_userId: { organizationId, userId },
      },
    });
  }

  /**
   * Remove every non-OWNER member of an org. Used when a paid subscription is
   * canceled — the org is disabled down to just its owner (who can re-subscribe
   * to recover it). Returns the userIds removed so the caller can revoke each
   * one's cached platform (cloud-api) membership.
   */
  async removeNonOwnerMembers(organizationId: string): Promise<string[]> {
    // Read the userIds BEFORE deleting so the caller can fan out platform
    // revokes (cloud-api caches OrganizationMember rows and won't re-check).
    const toRemove = await this.prisma.organizationMember.findMany({
      where: { organizationId, role: { not: 'OWNER' } },
      select: { userId: true },
    });
    if (toRemove.length === 0) return [];

    await this.prisma.organizationMember.deleteMany({
      where: { organizationId, role: { not: 'OWNER' } },
    });
    return toRemove.map((m) => m.userId);
  }

  async isUserMemberOfOrganization(userId: string, organizationId: string): Promise<boolean> {
    const member = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId },
      },
    });
    return member !== null;
  }


  // ============================================
  // ORGANIZATION BILLING METHODS
  // ============================================

  async createOrganizationBilling(billing: Omit<OrganizationBilling, 'created_at' | 'updated_at'>): Promise<OrganizationBilling> {
    const result = await this.prisma.organizationBilling.create({
      data: {
        id: billing.id,
        organizationId: billing.organization_id,
        stripeCustomerId: billing.stripe_customer_id,
        trialStartedAt: billing.trial_started_at ? new Date(billing.trial_started_at) : null,
        trialEndsAt: billing.trial_ends_at ? new Date(billing.trial_ends_at) : null,
        trialConverted: billing.trial_converted ?? false,
      },
    });

    return {
      id: result.id,
      organization_id: result.organizationId,
      stripe_customer_id: result.stripeCustomerId ?? undefined,
      trial_started_at: dateToTimestamp(result.trialStartedAt),
      trial_ends_at: dateToTimestamp(result.trialEndsAt),
      trial_converted: result.trialConverted,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getOrganizationBillingByOrgId(organizationId: string): Promise<OrganizationBilling | null> {
    const result = await this.prisma.organizationBilling.findUnique({
      where: { organizationId },
    });

    if (!result) return null;

    return {
      id: result.id,
      organization_id: result.organizationId,
      stripe_customer_id: result.stripeCustomerId ?? undefined,
      trial_started_at: dateToTimestamp(result.trialStartedAt),
      trial_ends_at: dateToTimestamp(result.trialEndsAt),
      trial_converted: result.trialConverted,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getOrganizationBillingById(id: string): Promise<OrganizationBilling | null> {
    const result = await this.prisma.organizationBilling.findUnique({
      where: { id },
    });

    if (!result) return null;

    return {
      id: result.id,
      organization_id: result.organizationId,
      stripe_customer_id: result.stripeCustomerId ?? undefined,
      trial_started_at: dateToTimestamp(result.trialStartedAt),
      trial_ends_at: dateToTimestamp(result.trialEndsAt),
      trial_converted: result.trialConverted,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async updateOrganizationBilling(id: string, updates: Partial<Omit<OrganizationBilling, 'id' | 'organization_id' | 'created_at' | 'updated_at'>>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.stripe_customer_id !== undefined) data.stripeCustomerId = updates.stripe_customer_id;
    if (updates.trial_converted !== undefined) data.trialConverted = updates.trial_converted;

    await this.prisma.organizationBilling.update({
      where: { id },
      data,
    });
  }

  /**
   * Create a default organization for a new user (with membership, billing, and trial subscription)
   * This is called when a user signs up via email, wallet, or OAuth
   */
  async createDefaultOrganizationForUser(params: {
    orgId: string;
    memberId: string;
    billingId: string;
    billingCustomerId: string;
    subscriptionId: string;
    userId: string;
    orgSlug: string;
    orgName: string;
  }): Promise<Organization> {
    const { orgId, memberId, billingId, billingCustomerId, subscriptionId, userId, orgSlug, orgName } = params;

    const now = new Date();

    // Look up the default trial plan (MONTHLY, or first active plan)
    const defaultPlan = await this.prisma.subscriptionPlan.findFirst({
      where: { isActive: true },
      orderBy: { basePricePerSeat: 'asc' },
    });
    if (!defaultPlan) {
      throw new Error('No active subscription plan found. Run: npm run db:seed');
    }

    const trialDays = defaultPlan.trialDays || 7;
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    // Get-or-create the user's BillingCustomer race-safely BEFORE the org
    // transaction. `upsert` on the unique `userId` closes the TOCTOU window
    // where two concurrent signups both miss a `findUnique` and the second
    // `create` throws an unhandled P2002, orphaning the user (no org/billing).
    const billingCustomer = await this.prisma.billingCustomer.upsert({
      where: { userId },
      create: { id: billingCustomerId, userId },
      update: {},
    });
    const actualBillingCustomerId = billingCustomer.id;

    // Build the transaction operations
    const operations: Prisma.PrismaPromise<any>[] = [
      // 1. Create organization
      this.prisma.organization.create({
        data: {
          id: orgId,
          slug: orgSlug,
          name: orgName,
        },
      }),

      // 2. Create membership (OWNER)
      this.prisma.organizationMember.create({
        data: {
          id: memberId,
          organizationId: orgId,
          userId: userId,
          role: 'OWNER',
        },
      }),
    ];

    // 4. Create OrganizationBilling with trial tracking
    operations.push(
      this.prisma.organizationBilling.create({
        data: {
          id: billingId,
          organizationId: orgId,
          trialStartedAt: now,
          trialEndsAt: trialEndsAt,
          trialConverted: false,
        },
      })
    );

    // 5. Create trial subscription (links to BOTH billing entities)
    operations.push(
      this.prisma.subscription.create({
        data: {
          id: subscriptionId,
          customerId: actualBillingCustomerId, // Use existing or new BillingCustomer
          orgBillingId: billingId, // Optional FK to OrganizationBilling
          planId: defaultPlan.id, // Use cheapest active plan for trial
          status: 'TRIALING',
          seats: 1,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          trialEnd: trialEndsAt,
        },
      })
    );

    // Execute transaction. The array form does not accept a `timeout` option
    // (that is interactive-transaction only), so it is intentionally omitted.
    const [org] = await this.prisma.$transaction(operations);

    // 6. Seed signup compute credit into the org's usage wallet.
    // Amount is centralized in `getSignupCreditCents()` so the admin
    // dashboard, the .env.example, and this seed call never drift.
    const signupCreditCents = getSignupCreditCents();
    if (signupCreditCents > 0) {
      try {
        await this.creditOrgBalanceIdempotent({
          orgBillingId: billingId,
          actorUserId: userId,
          amountCents: signupCreditCents,
          reason: 'signup_credit',
          idempotencyKey: `signup_credit:${billingId}`,
          metadata: {
            description: 'Signup compute credit',
            orgId,
            // Stamp the granted amount in the metadata so we have an
            // immutable per-org record of what each user actually got
            // — survives future SIGNUP_CREDIT_CENTS changes.
            grantedCents: signupCreditCents,
          },
        });
      } catch (error) {
        // Non-fatal: org creation succeeds even if credit seeding fails
        console.warn(`[createDefaultOrganizationForUser] Failed to seed signup credit for org ${orgId}:`, error);
      }
    }

    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      avatar_url: org.avatarUrl ?? undefined,
      created_at: org.createdAt.getTime(),
      updated_at: org.updatedAt.getTime(),
    };
  }

  /**
   * Idempotent lazy recovery: guarantee a user owns at least one organization.
   *
   * A signup whose org `$transaction` failed AFTER the user + authMethod rows
   * committed leaves an orphaned account — the identifier is taken (so re-signup
   * is blocked) but the user has ZERO orgs, making the app unusable. Calling
   * this on session resolution self-heals that account by creating the default
   * org. No-op when the user already has ≥1 org. Returns true iff it created one.
   *
   * Safe under concurrency: if a parallel request wins the create, the P2002 is
   * swallowed and we report success as long as an org now exists.
   */
  async ensureUserHasDefaultOrganization(userId: string, fallbackName?: string): Promise<boolean> {
    const existing = await this.getOrganizationsByUserId(userId);
    if (existing.length > 0) return false;

    const base = (fallbackName || 'My').split('@')[0] || 'My';
    const orgSlug = `user-${userId.slice(0, 8)}`;
    try {
      console.log(`[org-heal] user ${userId} has 0 orgs — creating default org (self-heal)`);
      await this.createDefaultOrganizationForUser({
        orgId: nanoid(),
        memberId: nanoid(),
        billingId: nanoid(),
        billingCustomerId: nanoid(),
        subscriptionId: nanoid(),
        userId,
        orgSlug,
        orgName: `${base}'s Org`,
      });
      console.log(`[org-heal] ✓ default org created for user ${userId}`);
      return true;
    } catch (err) {
      // A concurrent heal may have created it first — treat as success if an org
      // now exists, otherwise surface the failure (caller leaves orgs empty).
      const after = await this.getOrganizationsByUserId(userId);
      if (after.length > 0) {
        console.warn(`[org-heal] create raced for user ${userId}; org already exists`);
        return false;
      }
      console.error(`[org-heal] ✖ failed to self-heal org for user ${userId}:`, err);
      return false;
    }
  }

  /**
   * Generate a URL-safe, unique organization slug from a display name.
   * Never produces a `user-` prefixed slug (reserved for personal orgs).
   */
  private async generateUniqueOrgSlug(orgName: string): Promise<string> {
    const base = orgName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^user-+/, 'org-') // never collide with personal-org convention
      .slice(0, 40);

    let candidate = base.length >= 3 ? base : `org-${nanoid(6).toLowerCase()}`;

    // Ensure uniqueness; append a short random suffix on collision.
    // Bounded loop avoids any chance of spinning forever.
    for (let i = 0; i < 6; i++) {
      const existing = await this.prisma.organization.findUnique({ where: { slug: candidate } });
      if (!existing) return candidate;
      const suffix = nanoid(5).toLowerCase();
      candidate = `${base.slice(0, 34)}-${suffix}`;
    }
    // Final fallback: guaranteed-unique random slug.
    return `org-${nanoid(12).toLowerCase()}`;
  }

  /**
   * Create a brand-new organization owned by `userId`.
   *
   * Mirrors {@link createDefaultOrganizationForUser} (org + OWNER member +
   * OrganizationBilling trial + trial Subscription, reusing the user's existing
   * BillingCustomer) but is used for ADDITIONAL orgs created from the UI, so it
   * does NOT seed a signup credit (that would let users farm free credits by
   * spinning up orgs).
   */
  async createOrganizationForUser(params: { userId: string; orgName: string }): Promise<Organization> {
    const { userId, orgName } = params;

    const orgId = nanoid();
    const memberId = nanoid();
    const billingId = nanoid();
    const subscriptionId = nanoid();
    const orgSlug = await this.generateUniqueOrgSlug(orgName);
    const now = new Date();

    // ADDITIONAL orgs get NO free trial — the owner must subscribe before the
    // org can deploy or do anything. We still create an OrganizationBilling +
    // a placeholder Subscription in status INACTIVE (no trial fields) so the
    // subscribe flow has a row to CONVERT (never creating a duplicate) and the
    // deploy gate has a definitive non-entitled status to block on.
    const defaultPlan = await this.prisma.subscriptionPlan.findFirst({
      where: { isActive: true },
      orderBy: { basePricePerSeat: 'asc' },
    });
    if (!defaultPlan) {
      throw new Error('No active subscription plan found. Run: npm run db:seed');
    }

    // Get-or-create the user's BillingCustomer race-safely (upsert avoids the
    // TOCTOU P2002 crash on concurrent org creation).
    const billingCustomer = await this.prisma.billingCustomer.upsert({
      where: { userId },
      create: { id: nanoid(), userId },
      update: {},
    });
    const billingCustomerId = billingCustomer.id;

    const operations: Prisma.PrismaPromise<any>[] = [
      this.prisma.organization.create({
        data: { id: orgId, slug: orgSlug, name: orgName },
      }),
      this.prisma.organizationMember.create({
        data: { id: memberId, organizationId: orgId, userId, role: 'OWNER' },
      }),
      this.prisma.organizationBilling.create({
        data: {
          id: billingId,
          organizationId: orgId,
          // No trial — added orgs must subscribe.
          trialConverted: false,
        },
      }),
      this.prisma.subscription.create({
        data: {
          id: subscriptionId,
          customerId: billingCustomerId,
          orgBillingId: billingId,
          planId: defaultPlan.id,
          status: 'INACTIVE',
          seats: 1,
          currentPeriodStart: now,
          currentPeriodEnd: now,
        },
      }),
    ];

    // Note: the array form of $transaction does not accept a `timeout` option
    // (that is interactive-transaction only), so it is intentionally omitted.
    const results = await this.prisma.$transaction(operations);
    const org = results[0] as Awaited<ReturnType<typeof this.prisma.organization.create>>;

    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      avatar_url: org.avatarUrl ?? undefined,
      created_at: org.createdAt.getTime(),
      updated_at: org.updatedAt.getTime(),
    };
  }

  // ============================================
  // BILLING CUSTOMER METHODS
  // ============================================

  async createBillingCustomer(customer: Omit<BillingCustomer, 'created_at' | 'updated_at'>): Promise<BillingCustomer> {
    const result = await this.prisma.billingCustomer.create({
      data: {
        id: customer.id,
        userId: customer.user_id,
        email: customer.email,
        name: customer.name,
        stripeCustomerId: customer.stripe_customer_id,
        staxCustomerId: customer.stax_customer_id,
      },
    });

    return {
      id: result.id,
      user_id: result.userId,
      email: result.email ?? undefined,
      name: result.name ?? undefined,
      stripe_customer_id: result.stripeCustomerId ?? undefined,
      stax_customer_id: result.staxCustomerId ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getBillingCustomerByUserId(userId: string): Promise<BillingCustomer | null> {
    const result = await this.prisma.billingCustomer.findUnique({ where: { userId } });
    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      email: result.email ?? undefined,
      name: result.name ?? undefined,
      stripe_customer_id: result.stripeCustomerId ?? undefined,
      stax_customer_id: result.staxCustomerId ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getBillingCustomerByStripeId(stripeCustomerId: string): Promise<BillingCustomer | null> {
    const result = await this.prisma.billingCustomer.findUnique({ where: { stripeCustomerId } });
    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      email: result.email ?? undefined,
      name: result.name ?? undefined,
      stripe_customer_id: result.stripeCustomerId ?? undefined,
      stax_customer_id: result.staxCustomerId ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async updateBillingCustomer(id: string, updates: Partial<BillingCustomer>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.email !== undefined) data.email = updates.email;
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.stripe_customer_id !== undefined) data.stripeCustomerId = updates.stripe_customer_id;
    if (updates.stax_customer_id !== undefined) data.staxCustomerId = updates.stax_customer_id;

    await this.prisma.billingCustomer.update({
      where: { id },
      data,
    });
  }

  async getBillingCustomerById(id: string): Promise<BillingCustomer | null> {
    const result = await this.prisma.billingCustomer.findUnique({ where: { id } });
    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      email: result.email ?? undefined,
      name: result.name ?? undefined,
      stripe_customer_id: result.stripeCustomerId ?? undefined,
      stax_customer_id: result.staxCustomerId ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  // ============================================
  // PAYMENT METHOD METHODS
  // ============================================

  async createPaymentMethod(method: Omit<PaymentMethod, 'created_at' | 'updated_at'>): Promise<PaymentMethod> {
    const result = await this.prisma.paymentMethod.create({
      data: {
        id: method.id,
        customerId: method.customer_id,
        type: method.type,
        provider: method.provider,
        cardBrand: method.card_brand,
        cardLast4: method.card_last4,
        cardExpMonth: method.card_exp_month,
        cardExpYear: method.card_exp_year,
        stripePaymentMethodId: method.stripe_payment_method_id,
        staxPaymentMethodId: method.stax_payment_method_id,
        walletAddress: method.wallet_address,
        blockchain: method.blockchain,
        isDefault: intToBool(method.is_default),
        isActive: intToBool(method.is_active),
      },
    });

    return {
      id: result.id,
      customer_id: result.customerId,
      type: result.type as PaymentMethodType,
      provider: result.provider as PaymentProvider,
      card_brand: result.cardBrand ?? undefined,
      card_last4: result.cardLast4 ?? undefined,
      card_exp_month: result.cardExpMonth ?? undefined,
      card_exp_year: result.cardExpYear ?? undefined,
      stripe_payment_method_id: result.stripePaymentMethodId ?? undefined,
      stax_payment_method_id: result.staxPaymentMethodId ?? undefined,
      wallet_address: result.walletAddress ?? undefined,
      blockchain: result.blockchain ?? undefined,
      is_default: boolToInt(result.isDefault),
      is_active: boolToInt(result.isActive),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getPaymentMethodsByCustomerId(customerId: string): Promise<PaymentMethod[]> {
    const results = await this.prisma.paymentMethod.findMany({
      where: { customerId, isActive: true },
    });

    return results.map((result) => ({
      id: result.id,
      customer_id: result.customerId,
      type: result.type as PaymentMethodType,
      provider: result.provider as PaymentProvider,
      card_brand: result.cardBrand ?? undefined,
      card_last4: result.cardLast4 ?? undefined,
      card_exp_month: result.cardExpMonth ?? undefined,
      card_exp_year: result.cardExpYear ?? undefined,
      stripe_payment_method_id: result.stripePaymentMethodId ?? undefined,
      stax_payment_method_id: result.staxPaymentMethodId ?? undefined,
      wallet_address: result.walletAddress ?? undefined,
      blockchain: result.blockchain ?? undefined,
      is_default: boolToInt(result.isDefault),
      is_active: boolToInt(result.isActive),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    }));
  }

  async getDefaultPaymentMethod(customerId: string): Promise<PaymentMethod | null> {
    const result = await this.prisma.paymentMethod.findFirst({
      where: { customerId, isDefault: true, isActive: true },
    });

    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      type: result.type as PaymentMethodType,
      provider: result.provider as PaymentProvider,
      card_brand: result.cardBrand ?? undefined,
      card_last4: result.cardLast4 ?? undefined,
      card_exp_month: result.cardExpMonth ?? undefined,
      card_exp_year: result.cardExpYear ?? undefined,
      stripe_payment_method_id: result.stripePaymentMethodId ?? undefined,
      stax_payment_method_id: result.staxPaymentMethodId ?? undefined,
      wallet_address: result.walletAddress ?? undefined,
      blockchain: result.blockchain ?? undefined,
      is_default: boolToInt(result.isDefault),
      is_active: boolToInt(result.isActive),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.paymentMethod.updateMany({
        where: { customerId },
        data: { isDefault: false },
      }),
      this.prisma.paymentMethod.update({
        where: { id: paymentMethodId },
        data: { isDefault: true },
      }),
    ]);
  }

  async deactivatePaymentMethod(id: string): Promise<void> {
    await this.prisma.paymentMethod.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getPaymentMethodById(id: string): Promise<PaymentMethod | null> {
    const result = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      type: result.type as PaymentMethodType,
      provider: result.provider as PaymentProvider,
      card_brand: result.cardBrand ?? undefined,
      card_last4: result.cardLast4 ?? undefined,
      card_exp_month: result.cardExpMonth ?? undefined,
      card_exp_year: result.cardExpYear ?? undefined,
      stripe_payment_method_id: result.stripePaymentMethodId ?? undefined,
      stax_payment_method_id: result.staxPaymentMethodId ?? undefined,
      wallet_address: result.walletAddress ?? undefined,
      blockchain: result.blockchain ?? undefined,
      is_default: boolToInt(result.isDefault),
      is_active: boolToInt(result.isActive),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async updatePaymentMethod(id: string, updates: Partial<PaymentMethod>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.is_default !== undefined) data.isDefault = intToBool(updates.is_default);
    if (updates.is_active !== undefined) data.isActive = intToBool(updates.is_active);
    if (updates.card_exp_month !== undefined) data.cardExpMonth = updates.card_exp_month;
    if (updates.card_exp_year !== undefined) data.cardExpYear = updates.card_exp_year;

    await this.prisma.paymentMethod.update({
      where: { id },
      data,
    });
  }

  async deletePaymentMethod(id: string): Promise<void> {
    await this.prisma.paymentMethod.delete({ where: { id } });
  }

  async listPaymentMethodsByCustomerId(customerId: string): Promise<PaymentMethod[]> {
    return this.getPaymentMethodsByCustomerId(customerId);
  }

  // ============================================
  // SUBSCRIPTION PLAN METHODS
  // ============================================

  private serializePlan(result: {
    id: string; name: string; basePricePerSeat: number; usageMarkup: number;
    billingInterval: string; isActive: boolean; features: string | null;
    stripePriceId: string | null; includedStorageGb: number; includedBandwidthGb: number;
    includedInvocations: number; includedComputeSeconds: number; trialDays: number;
    createdAt: Date; updatedAt: Date;
  }): SubscriptionPlan {
    return {
      id: result.id,
      name: result.name as SubscriptionPlanName,
      base_price_per_seat: result.basePricePerSeat,
      usage_markup: result.usageMarkup,
      billing_interval: result.billingInterval as BillingInterval,
      is_active: result.isActive,
      features: result.features ?? undefined,
      stripe_price_id: result.stripePriceId ?? undefined,
      included_storage_gb: result.includedStorageGb,
      included_bandwidth_gb: result.includedBandwidthGb,
      included_invocations: result.includedInvocations,
      included_compute_seconds: result.includedComputeSeconds,
      trial_days: result.trialDays,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getSubscriptionPlanByName(name: string): Promise<SubscriptionPlan | null> {
    const result = await this.prisma.subscriptionPlan.findUnique({ where: { name } });
    if (!result) return null;
    return this.serializePlan(result);
  }

  async getAllSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    const results = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { basePricePerSeat: 'asc' },
    });
    return results.map((r) => this.serializePlan(r));
  }

  async listSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    return this.getAllSubscriptionPlans();
  }

  async getSubscriptionPlanById(id: string): Promise<SubscriptionPlan | null> {
    const result = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!result) return null;
    return this.serializePlan(result);
  }

  /**
   * Resolve a plan from its Stripe price id. Used by the subscription webhook to
   * reconcile a plan switch made on the Stripe side back to our `plan_id`.
   */
  async getSubscriptionPlanByStripePriceId(stripePriceId: string): Promise<SubscriptionPlan | null> {
    const result = await this.prisma.subscriptionPlan.findFirst({ where: { stripePriceId } });
    if (!result) return null;
    return this.serializePlan(result);
  }

  /**
   * Get the usage markup rate for an org based on their active subscription plan.
   * Returns the plan's usageMarkup, or the global USAGE_MARGIN_RATE fallback.
   */
  async getUsageMarkupForOrg(orgBillingId: string): Promise<number> {
    const sub = await this.getSubscriptionByOrgBillingId(orgBillingId);
    if (!sub) return USAGE_MARGIN_RATE;

    const plan = await this.getSubscriptionPlanById(sub.plan_id);
    if (!plan) return USAGE_MARGIN_RATE;

    return plan.usage_markup;
  }

  // ============================================
  // SUBSCRIPTION METHODS
  // ============================================

  async createSubscription(sub: Omit<Subscription, 'created_at' | 'updated_at'>): Promise<Subscription> {
    const result = await this.prisma.subscription.create({
      data: {
        id: sub.id,
        customerId: sub.customer_id,
        orgBillingId: sub.org_billing_id,
        planId: sub.plan_id,
        status: sub.status,
        seats: sub.seats,
        stripeSubscriptionId: sub.stripe_subscription_id,
        currentPeriodStart: new Date(sub.current_period_start),
        currentPeriodEnd: new Date(sub.current_period_end),
        cancelAt: timestampToDate(sub.cancel_at),
        canceledAt: timestampToDate(sub.canceled_at),
        trialEnd: timestampToDate(sub.trial_end),
      },
    });

    return {
      id: result.id,
      customer_id: result.customerId,
      org_billing_id: result.orgBillingId ?? undefined,
      plan_id: result.planId,
      status: result.status as SubscriptionStatus,
      seats: result.seats,
      stripe_subscription_id: result.stripeSubscriptionId ?? undefined,
      current_period_start: result.currentPeriodStart.getTime(),
      current_period_end: result.currentPeriodEnd.getTime(),
      cancel_at: dateToTimestamp(result.cancelAt),
      canceled_at: dateToTimestamp(result.canceledAt),
      trial_end: dateToTimestamp(result.trialEnd),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getSubscriptionByCustomerId(customerId: string): Promise<Subscription | null> {
    const result = await this.prisma.subscription.findFirst({
      where: { customerId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    });

    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      org_billing_id: result.orgBillingId ?? undefined,
      plan_id: result.planId,
      status: result.status as SubscriptionStatus,
      seats: result.seats,
      stripe_subscription_id: result.stripeSubscriptionId ?? undefined,
      current_period_start: result.currentPeriodStart.getTime(),
      current_period_end: result.currentPeriodEnd.getTime(),
      cancel_at: dateToTimestamp(result.cancelAt),
      canceled_at: dateToTimestamp(result.canceledAt),
      trial_end: dateToTimestamp(result.trialEnd),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | null> {
    const result = await this.prisma.subscription.findUnique({ where: { stripeSubscriptionId } });
    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      org_billing_id: result.orgBillingId ?? undefined,
      plan_id: result.planId,
      status: result.status as SubscriptionStatus,
      seats: result.seats,
      stripe_subscription_id: result.stripeSubscriptionId ?? undefined,
      current_period_start: result.currentPeriodStart.getTime(),
      current_period_end: result.currentPeriodEnd.getTime(),
      cancel_at: dateToTimestamp(result.cancelAt),
      canceled_at: dateToTimestamp(result.canceledAt),
      trial_end: dateToTimestamp(result.trialEnd),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async updateSubscription(
    id: string,
    // The detach/clear fields accept `null` to explicitly null the column
    // (e.g. cancellation clears stripe_subscription_id / cancel_at).
    updates: Partial<Omit<Subscription, 'stripe_subscription_id' | 'cancel_at' | 'canceled_at' | 'trial_end'>> & {
      stripe_subscription_id?: string | null;
      cancel_at?: number | null;
      canceled_at?: number | null;
      trial_end?: number | null;
    },
  ): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.status !== undefined) data.status = updates.status;
    if (updates.seats !== undefined) data.seats = updates.seats;
    if (updates.plan_id !== undefined) data.planId = updates.plan_id;
    if (updates.stripe_subscription_id !== undefined) data.stripeSubscriptionId = updates.stripe_subscription_id || null;
    if (updates.current_period_start !== undefined) data.currentPeriodStart = new Date(updates.current_period_start);
    if (updates.current_period_end !== undefined) data.currentPeriodEnd = new Date(updates.current_period_end);
    if (updates.cancel_at !== undefined) data.cancelAt = timestampToDate(updates.cancel_at);
    if (updates.canceled_at !== undefined) data.canceledAt = timestampToDate(updates.canceled_at);
    if (updates.trial_end !== undefined) data.trialEnd = timestampToDate(updates.trial_end);

    await this.prisma.subscription.update({
      where: { id },
      data,
    });
  }

  async getActiveSubscriptionByCustomerId(customerId: string): Promise<Subscription | null> {
    const result = await this.prisma.subscription.findFirst({
      where: {
        customerId,
        status: { in: ['ACTIVE', 'INCOMPLETE'] },
      },
    });

    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      org_billing_id: result.orgBillingId ?? undefined,
      plan_id: result.planId,
      status: result.status as SubscriptionStatus,
      seats: result.seats,
      stripe_subscription_id: result.stripeSubscriptionId ?? undefined,
      current_period_start: result.currentPeriodStart.getTime(),
      current_period_end: result.currentPeriodEnd.getTime(),
      cancel_at: dateToTimestamp(result.cancelAt),
      canceled_at: dateToTimestamp(result.canceledAt),
      trial_end: dateToTimestamp(result.trialEnd),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getSubscriptionById(id: string): Promise<Subscription | null> {
    const result = await this.prisma.subscription.findUnique({ where: { id } });
    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      org_billing_id: result.orgBillingId ?? undefined,
      plan_id: result.planId,
      status: result.status as SubscriptionStatus,
      seats: result.seats,
      stripe_subscription_id: result.stripeSubscriptionId ?? undefined,
      current_period_start: result.currentPeriodStart.getTime(),
      current_period_end: result.currentPeriodEnd.getTime(),
      cancel_at: dateToTimestamp(result.cancelAt),
      canceled_at: dateToTimestamp(result.canceledAt),
      trial_end: dateToTimestamp(result.trialEnd),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async listSubscriptionsByCustomerId(customerId: string): Promise<Subscription[]> {
    const results = await this.prisma.subscription.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });

    return results.map((result) => ({
      id: result.id,
      customer_id: result.customerId,
      org_billing_id: result.orgBillingId ?? undefined,
      plan_id: result.planId,
      status: result.status as SubscriptionStatus,
      seats: result.seats,
      stripe_subscription_id: result.stripeSubscriptionId ?? undefined,
      current_period_start: result.currentPeriodStart.getTime(),
      current_period_end: result.currentPeriodEnd.getTime(),
      cancel_at: dateToTimestamp(result.cancelAt),
      canceled_at: dateToTimestamp(result.canceledAt),
      trial_end: dateToTimestamp(result.trialEnd),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    }));
  }

  async getSubscriptionByOrgBillingId(orgBillingId: string): Promise<Subscription | null> {
    const result = await this.prisma.subscription.findFirst({
      where: {
        orgBillingId,
        // Excludes only CANCELED (terminal). INACTIVE/INCOMPLETE included so the
        // subscribe flow finds and CONVERTS the org's existing row instead of
        // creating a duplicate live subscription.
        status: { in: ['ACTIVE', 'TRIALING', 'TRIAL_EXPIRED', 'SUSPENDED', 'PAST_DUE', 'INACTIVE', 'INCOMPLETE', 'UNPAID'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      org_billing_id: result.orgBillingId ?? undefined,
      plan_id: result.planId,
      status: result.status as SubscriptionStatus,
      seats: result.seats,
      stripe_subscription_id: result.stripeSubscriptionId ?? undefined,
      current_period_start: result.currentPeriodStart.getTime(),
      current_period_end: result.currentPeriodEnd.getTime(),
      cancel_at: dateToTimestamp(result.cancelAt),
      canceled_at: dateToTimestamp(result.canceledAt),
      trial_end: dateToTimestamp(result.trialEnd),
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  // ============================================
  // TRIAL EXPIRATION HELPERS
  // ============================================

  /**
   * Find all subscriptions whose trial has ended but status is still TRIALING.
   */
  async getExpiredTrials(): Promise<Array<{ subscriptionId: string; orgBillingId: string; trialEnd: Date }>> {
    const results = await this.prisma.subscription.findMany({
      where: {
        status: 'TRIALING',
        trialEnd: { lt: new Date() },
      },
      select: { id: true, orgBillingId: true, trialEnd: true },
    });
    return results
      .filter((r): r is typeof r & { orgBillingId: string; trialEnd: Date } => !!r.orgBillingId && !!r.trialEnd)
      .map(r => ({ subscriptionId: r.id, orgBillingId: r.orgBillingId!, trialEnd: r.trialEnd! }));
  }

  /**
   * Find all TRIAL_EXPIRED subscriptions whose 3-day grace period has passed.
   */
  async getExpiredGracePeriods(): Promise<Array<{ subscriptionId: string; orgBillingId: string }>> {
    const graceCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const results = await this.prisma.subscription.findMany({
      where: {
        status: 'TRIAL_EXPIRED',
        trialEnd: { lt: graceCutoff },
      },
      select: { id: true, orgBillingId: true },
    });
    return results
      .filter((r): r is typeof r & { orgBillingId: string } => !!r.orgBillingId)
      .map(r => ({ subscriptionId: r.id, orgBillingId: r.orgBillingId! }));
  }

  /**
   * Update a subscription's status.
   */
  async updateSubscriptionStatus(subscriptionId: string, status: SubscriptionStatus): Promise<void> {
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status },
    });
  }

  /**
   * Atomically claim a TRIALING→TRIAL_EXPIRED transition. Returns true only for
   * the caller that actually flipped the row (count === 1). The conditional
   * `updateMany` (status still TRIALING AND trial still expired) is the claim:
   * in a multi-replica deployment only ONE worker wins, so the side effects
   * (email, logging) run exactly once instead of once per replica.
   */
  async claimTrialExpiry(subscriptionId: string): Promise<boolean> {
    const res = await this.prisma.subscription.updateMany({
      where: { id: subscriptionId, status: 'TRIALING', trialEnd: { lt: new Date() } },
      data: { status: 'TRIAL_EXPIRED' },
    });
    return res.count === 1;
  }

  /**
   * Atomically claim a TRIAL_EXPIRED→SUSPENDED transition once the 3-day grace
   * window has passed. Returns true only for the worker that flipped the row, so
   * the suspension email + deployment suspend run exactly once across replicas.
   */
  async claimGraceSuspension(subscriptionId: string): Promise<boolean> {
    const graceCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const res = await this.prisma.subscription.updateMany({
      where: { id: subscriptionId, status: 'TRIAL_EXPIRED', trialEnd: { lt: graceCutoff } },
      data: { status: 'SUSPENDED' },
    });
    return res.count === 1;
  }

  /**
   * Convert a trial/expired subscription to a new status with new plan and period.
   * Use INCOMPLETE when payment is pending, ACTIVE when confirmed.
   * Pass trialEnd to preserve the trial end date (mid-trial subscription setup).
   * Omit trialEnd to clear it (post-trial conversion).
   */
  async convertSubscriptionToActive(subscriptionId: string, updates: {
    planId: string;
    seats: number;
    stripeSubscriptionId?: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    status?: SubscriptionStatus;
    trialEnd?: Date | null;
  }): Promise<void> {
    // H8 guard: never silently overwrite a DIFFERENT Stripe subscription id.
    // Two distinct checkout.session.completed events (or a retry that linked a
    // new sub) would otherwise orphan the first Stripe subscription, which keeps
    // charging the card untracked.
    if (updates.stripeSubscriptionId) {
      const existing = await this.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        select: { stripeSubscriptionId: true },
      });
      if (
        existing?.stripeSubscriptionId &&
        existing.stripeSubscriptionId !== updates.stripeSubscriptionId
      ) {
        throw new Error(
          `Subscription ${subscriptionId} already linked to Stripe sub ${existing.stripeSubscriptionId}; ` +
            `refusing to overwrite with ${updates.stripeSubscriptionId}`,
        );
      }
    }

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        planId: updates.planId,
        seats: updates.seats,
        status: updates.status ?? 'ACTIVE',
        stripeSubscriptionId: updates.stripeSubscriptionId || null,
        currentPeriodStart: updates.currentPeriodStart,
        currentPeriodEnd: updates.currentPeriodEnd,
        trialEnd: updates.trialEnd ?? null,
      },
    });
  }

  /**
   * Look up the org owner's email for a given orgBillingId.
   */
  async getOrgOwnerEmail(orgBillingId: string): Promise<{ email: string; orgName: string; orgId: string } | null> {
    const orgBilling = await this.prisma.organizationBilling.findUnique({
      where: { id: orgBillingId },
      include: {
        organization: {
          include: {
            members: {
              where: { role: 'OWNER' },
              take: 1,
              include: { user: true },
            },
          },
        },
      },
    });
    if (!orgBilling?.organization?.members?.[0]?.user?.email) return null;
    return {
      email: orgBilling.organization.members[0].user.email,
      orgName: orgBilling.organization.name,
      orgId: orgBilling.organizationId,
    };
  }

  /**
   * Get subscription status for an org (used by subscription guard).
   * Sum all DEBIT ledger entries for an org in the current calendar month.
   * Excludes topup credits — only counts usage spend.
   */
  async getOrgMonthlySpendCents(orgId: string): Promise<number> {
    const orgBilling = await this.prisma.organizationBilling.findUnique({
      where: { organizationId: orgId },
      select: { id: true },
    });
    if (!orgBilling) return 0;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const result = await this.prisma.organizationUsageLedger.aggregate({
      where: {
        orgBillingId: orgBilling.id,
        direction: 'DEBIT',
        createdAt: { gte: monthStart },
      },
      _sum: { amountCents: true },
    });

    return result._sum.amountCents ?? 0;
  }

  /**
   * Returns the most relevant subscription (ACTIVE > TRIALING > TRIAL_EXPIRED > SUSPENDED).
   */
  async getOrgSubscriptionStatus(orgId: string): Promise<{
    status: string;
    trialEnd: number | null;
    daysRemaining: number | null;
    graceRemaining: number | null;
    planName: string | null;
  } | null> {
    const orgBilling = await this.prisma.organizationBilling.findUnique({
      where: { organizationId: orgId },
    });
    if (!orgBilling) return null;

    const sub = await this.prisma.subscription.findFirst({
      where: {
        orgBillingId: orgBilling.id,
        status: { in: ['ACTIVE', 'TRIALING', 'TRIAL_EXPIRED', 'SUSPENDED', 'PAST_DUE', 'CANCELED', 'INACTIVE', 'INCOMPLETE', 'UNPAID'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) return null;

    const plan = sub.planId ? await this.prisma.subscriptionPlan.findUnique({ where: { id: sub.planId } }) : null;
    const trialEndMs = sub.trialEnd?.getTime() ?? null;
    const now = Date.now();

    let daysRemaining: number | null = null;
    let graceRemaining: number | null = null;

    if (trialEndMs) {
      if (sub.status === 'TRIALING') {
        daysRemaining = Math.max(0, Math.ceil((trialEndMs - now) / (24 * 60 * 60 * 1000)));
      } else if (sub.status === 'TRIAL_EXPIRED') {
        const graceEndMs = trialEndMs + 3 * 24 * 60 * 60 * 1000;
        graceRemaining = Math.max(0, Math.ceil((graceEndMs - now) / (24 * 60 * 60 * 1000)));
      }
    }

    return {
      status: sub.status,
      trialEnd: trialEndMs,
      daysRemaining,
      graceRemaining,
      planName: plan?.name ?? null,
    };
  }

  // ============================================
  // INVOICE METHODS
  // ============================================

  async createInvoice(invoice: Omit<Invoice, 'created_at' | 'updated_at'>): Promise<Invoice> {
    const result = await this.prisma.invoice.create({
      data: {
        id: invoice.id,
        customerId: invoice.customer_id,
        subscriptionId: invoice.subscription_id,
        invoiceNumber: invoice.invoice_number,
        status: invoice.status,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total: invoice.total,
        amountPaid: invoice.amount_paid,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        periodStart: timestampToDate(invoice.period_start),
        periodEnd: timestampToDate(invoice.period_end),
        dueDate: timestampToDate(invoice.due_date),
        paidAt: timestampToDate(invoice.paid_at),
        pdfUrl: invoice.pdf_url,
        stripeInvoiceId: invoice.stripe_invoice_id,
      },
    });

    return {
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      invoice_number: result.invoiceNumber,
      status: result.status as InvoiceStatus,
      subtotal: result.subtotal,
      tax: result.tax,
      total: result.total,
      amount_paid: result.amountPaid,
      amount_due: result.amountDue,
      currency: result.currency,
      period_start: dateToTimestamp(result.periodStart),
      period_end: dateToTimestamp(result.periodEnd),
      due_date: dateToTimestamp(result.dueDate),
      paid_at: dateToTimestamp(result.paidAt),
      pdf_url: result.pdfUrl ?? undefined,
      stripe_invoice_id: result.stripeInvoiceId ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getInvoicesByCustomerId(customerId: string): Promise<Invoice[]> {
    const results = await this.prisma.invoice.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });

    return results.map((result) => ({
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      invoice_number: result.invoiceNumber,
      status: result.status as InvoiceStatus,
      subtotal: result.subtotal,
      tax: result.tax,
      total: result.total,
      amount_paid: result.amountPaid,
      amount_due: result.amountDue,
      currency: result.currency,
      period_start: dateToTimestamp(result.periodStart),
      period_end: dateToTimestamp(result.periodEnd),
      due_date: dateToTimestamp(result.dueDate),
      paid_at: dateToTimestamp(result.paidAt),
      pdf_url: result.pdfUrl ?? undefined,
      stripe_invoice_id: result.stripeInvoiceId ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    }));
  }

  async updateInvoice(id: string, updates: Partial<Invoice>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.status !== undefined) data.status = updates.status;
    if (updates.subtotal !== undefined) data.subtotal = updates.subtotal;
    if (updates.tax !== undefined) data.tax = updates.tax;
    if (updates.total !== undefined) data.total = updates.total;
    if (updates.amount_paid !== undefined) data.amountPaid = updates.amount_paid;
    if (updates.amount_due !== undefined) data.amountDue = updates.amount_due;
    if (updates.paid_at !== undefined) data.paidAt = timestampToDate(updates.paid_at);
    if (updates.pdf_url !== undefined) data.pdfUrl = updates.pdf_url;
    if (updates.invoice_number !== undefined) data.invoiceNumber = updates.invoice_number;
    if (updates.stripe_invoice_id !== undefined) data.stripeInvoiceId = updates.stripe_invoice_id;
    // Period/due-date: let reconciliation overwrite a locally-estimated period
    // with Stripe's authoritative one when linking an unlinked invoice row.
    if (updates.period_start !== undefined) data.periodStart = timestampToDate(updates.period_start);
    if (updates.period_end !== undefined) data.periodEnd = timestampToDate(updates.period_end);
    if (updates.due_date !== undefined) data.dueDate = timestampToDate(updates.due_date);

    await this.prisma.invoice.update({
      where: { id },
      data,
    });
  }

  async getInvoiceById(id: string): Promise<Invoice | null> {
    const result = await this.prisma.invoice.findUnique({ where: { id } });
    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      invoice_number: result.invoiceNumber,
      status: result.status as InvoiceStatus,
      subtotal: result.subtotal,
      tax: result.tax,
      total: result.total,
      amount_paid: result.amountPaid,
      amount_due: result.amountDue,
      currency: result.currency,
      period_start: dateToTimestamp(result.periodStart),
      period_end: dateToTimestamp(result.periodEnd),
      due_date: dateToTimestamp(result.dueDate),
      paid_at: dateToTimestamp(result.paidAt),
      pdf_url: result.pdfUrl ?? undefined,
      stripe_invoice_id: result.stripeInvoiceId ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getInvoiceByStripeId(stripeId: string): Promise<Invoice | null> {
    const result = await this.prisma.invoice.findUnique({
      where: { stripeInvoiceId: stripeId }
    });
    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      invoice_number: result.invoiceNumber,
      status: result.status as InvoiceStatus,
      subtotal: result.subtotal,
      tax: result.tax,
      total: result.total,
      amount_paid: result.amountPaid,
      amount_due: result.amountDue,
      currency: result.currency,
      period_start: dateToTimestamp(result.periodStart),
      period_end: dateToTimestamp(result.periodEnd),
      due_date: dateToTimestamp(result.dueDate),
      paid_at: dateToTimestamp(result.paidAt),
      pdf_url: result.pdfUrl ?? undefined,
      stripe_invoice_id: result.stripeInvoiceId ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  // ============================================
  // INVOICE LINE ITEM METHODS
  // ============================================

  async createInvoiceLineItem(item: Omit<InvoiceLineItem, 'created_at'>): Promise<InvoiceLineItem> {
    const result = await this.prisma.invoiceLineItem.create({
      data: {
        id: item.id,
        invoiceId: item.invoice_id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        amount: item.amount,
      },
    });

    return {
      id: result.id,
      invoice_id: result.invoiceId,
      description: result.description,
      quantity: result.quantity,
      unit_price: result.unitPrice,
      amount: result.amount,
      created_at: result.createdAt.getTime(),
    };
  }

  async getInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]> {
    const results = await this.prisma.invoiceLineItem.findMany({
      where: { invoiceId },
    });

    return results.map((result) => ({
      id: result.id,
      invoice_id: result.invoiceId,
      description: result.description,
      quantity: result.quantity,
      unit_price: result.unitPrice,
      amount: result.amount,
      created_at: result.createdAt.getTime(),
    }));
  }

  async listInvoiceLineItemsByInvoiceId(invoiceId: string): Promise<InvoiceLineItem[]> {
    return this.getInvoiceLineItems(invoiceId);
  }

  async listInvoicesByCustomerId(customerId: string): Promise<Invoice[]> {
    return this.getInvoicesByCustomerId(customerId);
  }

  // ============================================
  // PAYMENT METHODS
  // ============================================

  async createPayment(payment: Omit<Payment, 'created_at' | 'updated_at'>): Promise<Payment> {
    const result = await this.prisma.payment.create({
      data: {
        id: payment.id,
        customerId: payment.customer_id,
        invoiceId: payment.invoice_id,
        paymentMethodId: payment.payment_method_id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        stripePaymentIntentId: payment.stripe_payment_intent_id,
        staxTransactionId: payment.stax_transaction_id,
        txHash: payment.tx_hash,
        blockchain: payment.blockchain,
        fromAddress: payment.from_address,
        toAddress: payment.to_address,
        tokenSymbol: payment.token_symbol,
        tokenAddress: payment.token_address,
        orgBillingId: payment.org_billing_id,
        failureReason: payment.failure_reason,
      },
    });

    return {
      id: result.id,
      customer_id: result.customerId,
      invoice_id: result.invoiceId ?? undefined,
      payment_method_id: result.paymentMethodId ?? undefined,
      amount: result.amount,
      currency: result.currency,
      status: result.status as PaymentStatus,
      provider: result.provider as PaymentProvider,
      stripe_payment_intent_id: result.stripePaymentIntentId ?? undefined,
      stax_transaction_id: result.staxTransactionId ?? undefined,
      tx_hash: result.txHash ?? undefined,
      blockchain: result.blockchain ?? undefined,
      from_address: result.fromAddress ?? undefined,
      to_address: result.toAddress ?? undefined,
      token_symbol: result.tokenSymbol ?? undefined,
      token_address: result.tokenAddress ?? undefined,
      org_billing_id: result.orgBillingId ?? undefined,
      failure_reason: result.failureReason ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getPaymentsByCustomerId(customerId: string): Promise<Payment[]> {
    const results = await this.prisma.payment.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });

    return results.map((result) => ({
      id: result.id,
      customer_id: result.customerId,
      invoice_id: result.invoiceId ?? undefined,
      payment_method_id: result.paymentMethodId ?? undefined,
      amount: result.amount,
      currency: result.currency,
      status: result.status as PaymentStatus,
      provider: result.provider as PaymentProvider,
      stripe_payment_intent_id: result.stripePaymentIntentId ?? undefined,
      stax_transaction_id: result.staxTransactionId ?? undefined,
      tx_hash: result.txHash ?? undefined,
      blockchain: result.blockchain ?? undefined,
      from_address: result.fromAddress ?? undefined,
      to_address: result.toAddress ?? undefined,
      token_symbol: result.tokenSymbol ?? undefined,
      token_address: result.tokenAddress ?? undefined,
      org_billing_id: result.orgBillingId ?? undefined,
      failure_reason: result.failureReason ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    }));
  }

  async updatePayment(id: string, updates: Partial<Payment>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.status !== undefined) data.status = updates.status;
    if (updates.failure_reason !== undefined) data.failureReason = updates.failure_reason;
    if (updates.tx_hash !== undefined) data.txHash = updates.tx_hash;
    if (updates.blockchain !== undefined) data.blockchain = updates.blockchain;
    if (updates.from_address !== undefined) data.fromAddress = updates.from_address;
    if (updates.to_address !== undefined) data.toAddress = updates.to_address;
    if (updates.token_symbol !== undefined) data.tokenSymbol = updates.token_symbol;
    if (updates.token_address !== undefined) data.tokenAddress = updates.token_address;
    if (updates.org_billing_id !== undefined) data.orgBillingId = updates.org_billing_id;

    await this.prisma.payment.update({
      where: { id },
      data,
    });
  }

  async getPaymentByStripePaymentIntentId(paymentIntentId: string): Promise<Payment | null> {
    const result = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId }
    });
    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      invoice_id: result.invoiceId ?? undefined,
      payment_method_id: result.paymentMethodId ?? undefined,
      amount: result.amount,
      currency: result.currency,
      status: result.status as PaymentStatus,
      provider: result.provider as PaymentProvider,
      stripe_payment_intent_id: result.stripePaymentIntentId ?? undefined,
      stax_transaction_id: result.staxTransactionId ?? undefined,
      tx_hash: result.txHash ?? undefined,
      blockchain: result.blockchain ?? undefined,
      from_address: result.fromAddress ?? undefined,
      to_address: result.toAddress ?? undefined,
      token_symbol: result.tokenSymbol ?? undefined,
      token_address: result.tokenAddress ?? undefined,
      org_billing_id: result.orgBillingId ?? undefined,
      failure_reason: result.failureReason ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getPaymentByStaxTransactionId(transactionId: string): Promise<Payment | null> {
    const result = await this.prisma.payment.findUnique({
      where: { staxTransactionId: transactionId }
    });
    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      invoice_id: result.invoiceId ?? undefined,
      payment_method_id: result.paymentMethodId ?? undefined,
      amount: result.amount,
      currency: result.currency,
      status: result.status as PaymentStatus,
      provider: result.provider as PaymentProvider,
      stripe_payment_intent_id: result.stripePaymentIntentId ?? undefined,
      stax_transaction_id: result.staxTransactionId ?? undefined,
      tx_hash: result.txHash ?? undefined,
      blockchain: result.blockchain ?? undefined,
      from_address: result.fromAddress ?? undefined,
      to_address: result.toAddress ?? undefined,
      token_symbol: result.tokenSymbol ?? undefined,
      token_address: result.tokenAddress ?? undefined,
      org_billing_id: result.orgBillingId ?? undefined,
      failure_reason: result.failureReason ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getPaymentByTxHash(txHash: string): Promise<Payment | null> {
    const result = await this.prisma.payment.findFirst({
      where: { txHash }
    });
    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      invoice_id: result.invoiceId ?? undefined,
      payment_method_id: result.paymentMethodId ?? undefined,
      amount: result.amount,
      currency: result.currency,
      status: result.status as PaymentStatus,
      provider: result.provider as PaymentProvider,
      stripe_payment_intent_id: result.stripePaymentIntentId ?? undefined,
      stax_transaction_id: result.staxTransactionId ?? undefined,
      tx_hash: result.txHash ?? undefined,
      blockchain: result.blockchain ?? undefined,
      from_address: result.fromAddress ?? undefined,
      to_address: result.toAddress ?? undefined,
      token_symbol: result.tokenSymbol ?? undefined,
      token_address: result.tokenAddress ?? undefined,
      org_billing_id: result.orgBillingId ?? undefined,
      failure_reason: result.failureReason ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    const result = await this.prisma.payment.findUnique({ where: { id } });
    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      invoice_id: result.invoiceId ?? undefined,
      payment_method_id: result.paymentMethodId ?? undefined,
      amount: result.amount,
      currency: result.currency,
      status: result.status as PaymentStatus,
      provider: result.provider as PaymentProvider,
      stripe_payment_intent_id: result.stripePaymentIntentId ?? undefined,
      stax_transaction_id: result.staxTransactionId ?? undefined,
      tx_hash: result.txHash ?? undefined,
      blockchain: result.blockchain ?? undefined,
      from_address: result.fromAddress ?? undefined,
      to_address: result.toAddress ?? undefined,
      token_symbol: result.tokenSymbol ?? undefined,
      token_address: result.tokenAddress ?? undefined,
      org_billing_id: result.orgBillingId ?? undefined,
      failure_reason: result.failureReason ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async listPaymentsByCustomerId(customerId: string): Promise<Payment[]> {
    return this.getPaymentsByCustomerId(customerId);
  }

  // ============================================
  // USAGE RECORD METHODS
  // ============================================

  async createUsageRecord(record: Omit<UsageRecord, 'created_at'>): Promise<UsageRecord> {
    const result = await this.prisma.usageRecord.create({
      data: {
        id: record.id,
        customerId: record.customer_id,
        subscriptionId: record.subscription_id,
        metricType: record.metric_type,
        quantity: record.quantity,
        unitPrice: record.unit_price,
        amount: record.amount,
        periodStart: new Date(record.period_start),
        periodEnd: new Date(record.period_end),
        recordedAt: new Date(record.recorded_at),
      },
    });

    return {
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      metric_type: result.metricType as UsageMetricType,
      quantity: result.quantity,
      unit_price: result.unitPrice,
      amount: result.amount,
      period_start: result.periodStart.getTime(),
      period_end: result.periodEnd.getTime(),
      recorded_at: result.recordedAt.getTime(),
      created_at: result.createdAt.getTime(),
    };
  }

  async getUsageRecordsByCustomerId(customerId: string, periodStart: number, periodEnd: number): Promise<UsageRecord[]> {
    const results = await this.prisma.usageRecord.findMany({
      where: {
        customerId,
        periodStart: { gte: new Date(periodStart) },
        periodEnd: { lte: new Date(periodEnd) },
      },
    });

    return results.map((result) => ({
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      metric_type: result.metricType as UsageMetricType,
      quantity: result.quantity,
      unit_price: result.unitPrice,
      amount: result.amount,
      period_start: result.periodStart.getTime(),
      period_end: result.periodEnd.getTime(),
      recorded_at: result.recordedAt.getTime(),
      created_at: result.createdAt.getTime(),
    }));
  }

  // ============================================
  // USAGE AGGREGATE METHODS
  // ============================================

  async upsertUsageAggregate(aggregate: Omit<UsageAggregate, 'updated_at'>): Promise<UsageAggregate> {
    const result = await this.prisma.usageAggregate.upsert({
      where: {
        customerId_metricType_periodStart: {
          customerId: aggregate.customer_id,
          metricType: aggregate.metric_type,
          periodStart: new Date(aggregate.period_start),
        },
      },
      update: {
        totalQuantity: aggregate.total_quantity,
        totalAmount: aggregate.total_amount,
      },
      create: {
        id: aggregate.id,
        customerId: aggregate.customer_id,
        subscriptionId: aggregate.subscription_id,
        metricType: aggregate.metric_type,
        totalQuantity: aggregate.total_quantity,
        totalAmount: aggregate.total_amount,
        periodStart: new Date(aggregate.period_start),
        periodEnd: new Date(aggregate.period_end),
      },
    });

    return {
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      metric_type: result.metricType as UsageMetricType,
      total_quantity: result.totalQuantity,
      total_amount: result.totalAmount,
      period_start: result.periodStart.getTime(),
      period_end: result.periodEnd.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getUsageAggregatesByCustomerId(customerId: string, periodStart: number): Promise<UsageAggregate[]> {
    const results = await this.prisma.usageAggregate.findMany({
      where: {
        customerId,
        periodStart: new Date(periodStart),
      },
    });

    return results.map((result) => ({
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      metric_type: result.metricType as UsageMetricType,
      total_quantity: result.totalQuantity,
      total_amount: result.totalAmount,
      period_start: result.periodStart.getTime(),
      period_end: result.periodEnd.getTime(),
      updated_at: result.updatedAt.getTime(),
    }));
  }

  async getUsageAggregatesByCustomerAndPeriod(customerId: string, periodStart: number, periodEnd: number): Promise<UsageAggregate[]> {
    const results = await this.prisma.usageAggregate.findMany({
      where: {
        customerId,
        periodStart: { gte: new Date(periodStart) },
        periodEnd: { lte: new Date(periodEnd) },
      },
    });

    return results.map((result) => ({
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      metric_type: result.metricType as UsageMetricType,
      total_quantity: result.totalQuantity,
      total_amount: result.totalAmount,
      period_start: result.periodStart.getTime(),
      period_end: result.periodEnd.getTime(),
      updated_at: result.updatedAt.getTime(),
    }));
  }

  async getUsageAggregateByCustomerMetricPeriod(customerId: string, metricType: UsageMetricType, periodStart: number): Promise<UsageAggregate | null> {
    const result = await this.prisma.usageAggregate.findUnique({
      where: {
        customerId_metricType_periodStart: {
          customerId,
          metricType,
          periodStart: new Date(periodStart),
        },
      },
    });

    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      metric_type: result.metricType as UsageMetricType,
      total_quantity: result.totalQuantity,
      total_amount: result.totalAmount,
      period_start: result.periodStart.getTime(),
      period_end: result.periodEnd.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async updateUsageAggregate(id: string, data: Partial<Pick<UsageAggregate, 'total_quantity' | 'total_amount'>>): Promise<void> {
    const updateData: Record<string, unknown> = {};

    if (data.total_quantity !== undefined) updateData.totalQuantity = data.total_quantity;
    if (data.total_amount !== undefined) updateData.totalAmount = data.total_amount;

    await this.prisma.usageAggregate.update({
      where: { id },
      data: updateData,
    });
  }

  async createUsageAggregate(aggregate: Omit<UsageAggregate, 'updated_at'>): Promise<UsageAggregate> {
    const result = await this.prisma.usageAggregate.create({
      data: {
        id: aggregate.id,
        customerId: aggregate.customer_id,
        subscriptionId: aggregate.subscription_id,
        metricType: aggregate.metric_type,
        totalQuantity: aggregate.total_quantity,
        totalAmount: aggregate.total_amount,
        periodStart: new Date(aggregate.period_start),
        periodEnd: new Date(aggregate.period_end),
      },
    });

    return {
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      metric_type: result.metricType as UsageMetricType,
      total_quantity: result.totalQuantity,
      total_amount: result.totalAmount,
      period_start: result.periodStart.getTime(),
      period_end: result.periodEnd.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async listUsageRecordsByCustomerId(customerId: string): Promise<UsageRecord[]> {
    const results = await this.prisma.usageRecord.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });

    return results.map((result) => ({
      id: result.id,
      customer_id: result.customerId,
      subscription_id: result.subscriptionId ?? undefined,
      metric_type: result.metricType as UsageMetricType,
      quantity: result.quantity,
      unit_price: result.unitPrice,
      amount: result.amount,
      period_start: result.periodStart.getTime(),
      period_end: result.periodEnd.getTime(),
      recorded_at: result.recordedAt.getTime(),
      created_at: result.createdAt.getTime(),
    }));
  }

  // ============================================
  // WEBHOOK EVENT METHODS
  // ============================================

  async createWebhookEvent(event: Omit<WebhookEvent, 'created_at'>): Promise<WebhookEvent> {
    const result = await this.prisma.webhookEvent.create({
      data: {
        id: event.id,
        provider: event.provider,
        eventType: event.event_type,
        eventId: event.event_id,
        payload: event.payload,
        processed: intToBool(event.processed),
        processedAt: timestampToDate(event.processed_at),
        error: event.error,
      },
    });

    return {
      id: result.id,
      provider: result.provider as PaymentProvider,
      event_type: result.eventType,
      event_id: result.eventId,
      payload: result.payload,
      processed: boolToInt(result.processed),
      processed_at: dateToTimestamp(result.processedAt),
      error: result.error ?? undefined,
      created_at: result.createdAt.getTime(),
    };
  }

  async getWebhookEventByEventId(provider: string, eventId: string): Promise<WebhookEvent | null> {
    const result = await this.prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId } },
    });

    if (!result) return null;

    return {
      id: result.id,
      provider: result.provider as PaymentProvider,
      event_type: result.eventType,
      event_id: result.eventId,
      payload: result.payload,
      processed: boolToInt(result.processed),
      processed_at: dateToTimestamp(result.processedAt),
      error: result.error ?? undefined,
      created_at: result.createdAt.getTime(),
    };
  }

  async markWebhookEventProcessed(id: string, error?: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        processed: true,
        processedAt: new Date(),
        error,
      },
    });
  }

  async getWebhookEventByProviderAndEventId(provider: string, eventId: string): Promise<WebhookEvent | null> {
    return this.getWebhookEventByEventId(provider, eventId);
  }

  // ============================================
  // CONNECTED ACCOUNT METHODS
  // ============================================

  async createConnectedAccount(account: Omit<ConnectedAccount, 'created_at' | 'updated_at'>): Promise<ConnectedAccount> {
    const result = await this.prisma.connectedAccount.create({
      data: {
        id: account.id,
        userId: account.user_id,
        provider: account.provider,
        accountType: account.account_type,
        stripeAccountId: account.stripe_account_id,
        staxSubMerchantId: account.stax_sub_merchant_id,
        email: account.email,
        businessName: account.business_name,
        country: account.country,
        chargesEnabled: intToBool(account.charges_enabled),
        payoutsEnabled: intToBool(account.payouts_enabled),
        detailsSubmitted: intToBool(account.details_submitted),
        metadata: account.metadata,
      },
    });

    return {
      id: result.id,
      user_id: result.userId,
      provider: result.provider as 'stripe' | 'stax',
      account_type: result.accountType as ConnectedAccountType,
      stripe_account_id: result.stripeAccountId ?? undefined,
      stax_sub_merchant_id: result.staxSubMerchantId ?? undefined,
      email: result.email ?? undefined,
      business_name: result.businessName ?? undefined,
      country: result.country ?? undefined,
      charges_enabled: boolToInt(result.chargesEnabled),
      payouts_enabled: boolToInt(result.payoutsEnabled),
      details_submitted: boolToInt(result.detailsSubmitted),
      metadata: result.metadata ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getConnectedAccountByUserId(userId: string): Promise<ConnectedAccount | null> {
    const result = await this.prisma.connectedAccount.findFirst({ where: { userId } });
    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      provider: result.provider as 'stripe' | 'stax',
      account_type: result.accountType as ConnectedAccountType,
      stripe_account_id: result.stripeAccountId ?? undefined,
      stax_sub_merchant_id: result.staxSubMerchantId ?? undefined,
      email: result.email ?? undefined,
      business_name: result.businessName ?? undefined,
      country: result.country ?? undefined,
      charges_enabled: boolToInt(result.chargesEnabled),
      payouts_enabled: boolToInt(result.payoutsEnabled),
      details_submitted: boolToInt(result.detailsSubmitted),
      metadata: result.metadata ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getConnectedAccountByStripeId(stripeAccountId: string): Promise<ConnectedAccount | null> {
    const result = await this.prisma.connectedAccount.findUnique({ where: { stripeAccountId } });
    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      provider: result.provider as 'stripe' | 'stax',
      account_type: result.accountType as ConnectedAccountType,
      stripe_account_id: result.stripeAccountId ?? undefined,
      stax_sub_merchant_id: result.staxSubMerchantId ?? undefined,
      email: result.email ?? undefined,
      business_name: result.businessName ?? undefined,
      country: result.country ?? undefined,
      charges_enabled: boolToInt(result.chargesEnabled),
      payouts_enabled: boolToInt(result.payoutsEnabled),
      details_submitted: boolToInt(result.detailsSubmitted),
      metadata: result.metadata ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async updateConnectedAccount(id: string, updates: Partial<ConnectedAccount>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.charges_enabled !== undefined) data.chargesEnabled = intToBool(updates.charges_enabled);
    if (updates.payouts_enabled !== undefined) data.payoutsEnabled = intToBool(updates.payouts_enabled);
    if (updates.details_submitted !== undefined) data.detailsSubmitted = intToBool(updates.details_submitted);
    if (updates.email !== undefined) data.email = updates.email;
    if (updates.business_name !== undefined) data.businessName = updates.business_name;
    if (updates.country !== undefined) data.country = updates.country;
    if (updates.metadata !== undefined) data.metadata = updates.metadata;

    await this.prisma.connectedAccount.update({
      where: { id },
      data,
    });
  }

  async listConnectedAccountsByUserId(userId: string): Promise<ConnectedAccount[]> {
    const results = await this.prisma.connectedAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return results.map((result) => ({
      id: result.id,
      user_id: result.userId,
      provider: result.provider as 'stripe' | 'stax',
      account_type: result.accountType as ConnectedAccountType,
      stripe_account_id: result.stripeAccountId ?? undefined,
      stax_sub_merchant_id: result.staxSubMerchantId ?? undefined,
      email: result.email ?? undefined,
      business_name: result.businessName ?? undefined,
      country: result.country ?? undefined,
      charges_enabled: boolToInt(result.chargesEnabled),
      payouts_enabled: boolToInt(result.payoutsEnabled),
      details_submitted: boolToInt(result.detailsSubmitted),
      metadata: result.metadata ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    }));
  }

  async getConnectedAccountById(id: string): Promise<ConnectedAccount | null> {
    const result = await this.prisma.connectedAccount.findUnique({ where: { id } });
    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      provider: result.provider as 'stripe' | 'stax',
      account_type: result.accountType as ConnectedAccountType,
      stripe_account_id: result.stripeAccountId ?? undefined,
      stax_sub_merchant_id: result.staxSubMerchantId ?? undefined,
      email: result.email ?? undefined,
      business_name: result.businessName ?? undefined,
      country: result.country ?? undefined,
      charges_enabled: boolToInt(result.chargesEnabled),
      payouts_enabled: boolToInt(result.payoutsEnabled),
      details_submitted: boolToInt(result.detailsSubmitted),
      metadata: result.metadata ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async deleteConnectedAccount(id: string): Promise<void> {
    await this.prisma.connectedAccount.delete({ where: { id } });
  }

  async getConnectedAccountByStaxId(staxId: string): Promise<ConnectedAccount | null> {
    const result = await this.prisma.connectedAccount.findUnique({
      where: { staxSubMerchantId: staxId }
    });
    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      provider: result.provider as 'stripe' | 'stax',
      account_type: result.accountType as ConnectedAccountType,
      stripe_account_id: result.stripeAccountId ?? undefined,
      stax_sub_merchant_id: result.staxSubMerchantId ?? undefined,
      email: result.email ?? undefined,
      business_name: result.businessName ?? undefined,
      country: result.country ?? undefined,
      charges_enabled: boolToInt(result.chargesEnabled),
      payouts_enabled: boolToInt(result.payoutsEnabled),
      details_submitted: boolToInt(result.detailsSubmitted),
      metadata: result.metadata ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  // ============================================
  // TRANSFER METHODS
  // ============================================

  async createTransfer(transfer: Omit<Transfer, 'created_at' | 'updated_at'>): Promise<Transfer> {
    const result = await this.prisma.transfer.create({
      data: {
        id: transfer.id,
        connectedAccountId: transfer.connected_account_id,
        paymentId: transfer.payment_id,
        amount: transfer.amount,
        currency: transfer.currency,
        status: transfer.status,
        provider: transfer.provider,
        stripeTransferId: transfer.stripe_transfer_id,
        staxSplitId: transfer.stax_split_id,
        description: transfer.description,
        metadata: transfer.metadata,
      },
    });

    return {
      id: result.id,
      connected_account_id: result.connectedAccountId,
      payment_id: result.paymentId ?? undefined,
      amount: result.amount,
      currency: result.currency,
      status: result.status as TransferStatus,
      provider: result.provider as 'stripe' | 'stax',
      stripe_transfer_id: result.stripeTransferId ?? undefined,
      stax_split_id: result.staxSplitId ?? undefined,
      description: result.description ?? undefined,
      metadata: result.metadata ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getTransfersByConnectedAccountId(connectedAccountId: string): Promise<Transfer[]> {
    const results = await this.prisma.transfer.findMany({
      where: { connectedAccountId },
      orderBy: { createdAt: 'desc' },
    });

    return results.map((result) => ({
      id: result.id,
      connected_account_id: result.connectedAccountId,
      payment_id: result.paymentId ?? undefined,
      amount: result.amount,
      currency: result.currency,
      status: result.status as TransferStatus,
      provider: result.provider as 'stripe' | 'stax',
      stripe_transfer_id: result.stripeTransferId ?? undefined,
      stax_split_id: result.staxSplitId ?? undefined,
      description: result.description ?? undefined,
      metadata: result.metadata ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    }));
  }

  async listTransfersByConnectedAccountId(accountId: string): Promise<Transfer[]> {
    return this.getTransfersByConnectedAccountId(accountId);
  }

  async updateTransfer(id: string, updates: Partial<Transfer>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.status !== undefined) data.status = updates.status;

    await this.prisma.transfer.update({
      where: { id },
      data,
    });
  }

  // ============================================
  // PLATFORM FEE METHODS
  // ============================================

  async createPlatformFee(fee: Omit<PlatformFee, 'created_at'>): Promise<PlatformFee> {
    const result = await this.prisma.platformFee.create({
      data: {
        id: fee.id,
        connectedAccountId: fee.connected_account_id,
        paymentId: fee.payment_id,
        amount: fee.amount,
        currency: fee.currency,
        stripeFeeId: fee.stripe_fee_id,
      },
    });

    return {
      id: result.id,
      connected_account_id: result.connectedAccountId,
      payment_id: result.paymentId,
      amount: result.amount,
      currency: result.currency,
      stripe_fee_id: result.stripeFeeId ?? undefined,
      created_at: result.createdAt.getTime(),
    };
  }

  async getPlatformFeesByConnectedAccountId(connectedAccountId: string): Promise<PlatformFee[]> {
    const results = await this.prisma.platformFee.findMany({
      where: { connectedAccountId },
      orderBy: { createdAt: 'desc' },
    });

    return results.map((result) => ({
      id: result.id,
      connected_account_id: result.connectedAccountId,
      payment_id: result.paymentId,
      amount: result.amount,
      currency: result.currency,
      stripe_fee_id: result.stripeFeeId ?? undefined,
      created_at: result.createdAt.getTime(),
    }));
  }

  // ============================================
  // USAGE WALLET METHODS (USD cents)
  // ============================================

  /**
   * Get or create organization usage balance
   * Creates a balance row with $0.00 if it doesn't exist
   */
  async getOrCreateOrgUsageBalance(orgBillingId: string): Promise<OrganizationUsageBalance> {
    const existing = await this.prisma.organizationUsageBalance.findUnique({
      where: { orgBillingId },
    });

    if (existing) {
      return {
        id: existing.id,
        org_billing_id: existing.orgBillingId,
        balance_cents: existing.balanceCents,
        updated_at: existing.updatedAt.getTime(),
        created_at: existing.createdAt.getTime(),
      };
    }

    // Create new balance with $0.00
    const result = await this.prisma.organizationUsageBalance.create({
      data: {
        orgBillingId,
        balanceCents: 0,
      },
    });

    return {
      id: result.id,
      org_billing_id: result.orgBillingId,
      balance_cents: result.balanceCents,
      updated_at: result.updatedAt.getTime(),
      created_at: result.createdAt.getTime(),
    };
  }

  /**
   * Get organization usage balance
   */
  async getOrgUsageBalance(orgBillingId: string): Promise<OrganizationUsageBalance | null> {
    const result = await this.prisma.organizationUsageBalance.findUnique({
      where: { orgBillingId },
    });

    if (!result) return null;

    return {
      id: result.id,
      org_billing_id: result.orgBillingId,
      balance_cents: result.balanceCents,
      updated_at: result.updatedAt.getTime(),
      created_at: result.createdAt.getTime(),
    };
  }

  /**
   * Credit org balance idempotently (add funds)
   * If idempotency key already exists, returns current balance (no-op)
   * @param amountCents - Amount to add in USD cents (e.g., 2500 = $25.00)
   */
  async creditOrgBalanceIdempotent(args: {
    orgBillingId: string;
    actorUserId?: string;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ balanceCents: number; alreadyProcessed: boolean }> {
    const { orgBillingId, actorUserId, amountCents, reason, idempotencyKey, metadata = {} } = args;

    // Race-safe idempotency: rely on the `idempotency_key` UNIQUE
    // constraint inside the transaction instead of a pre-check `findUnique`
    // outside it. The pre-check pattern leaves a window where two concurrent
    // callers both miss, both enter the tx, and the second one throws P2002
    // → 500. Catching P2002 here returns "already processed" cleanly.
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.organizationUsageLedger.create({
          data: {
            orgBillingId,
            actorUserId: actorUserId ?? null,
            direction: 'CREDIT',
            amountCents,
            reason,
            idempotencyKey,
            metadata: metadata as object,
          },
        });

        const updatedBalance = await tx.organizationUsageBalance.upsert({
          where: { orgBillingId },
          create: {
            orgBillingId,
            balanceCents: amountCents,
          },
          update: {
            balanceCents: { increment: amountCents },
          },
        });

        return updatedBalance.balanceCents;
      });

      return { balanceCents: result, alreadyProcessed: false };
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        const balance = await this.getOrCreateOrgUsageBalance(orgBillingId);
        return { balanceCents: balance.balance_cents, alreadyProcessed: true };
      }
      throw err;
    }
  }

  /**
   * Debit org balance atomically (charge for usage)
   * Fails if insufficient balance
   * @param amountCents - Amount to deduct in USD cents (e.g., 150 = $1.50)
   */
  async debitOrgBalanceAtomic(args: {
    orgBillingId: string;
    actorUserId?: string;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    /**
     * Optional transaction client. When provided, the debit + ledger insert
     * run inside the caller's transaction (used by `compute-debit` to keep
     * debit + usage-log atomic). When omitted, opens its own transaction.
     */
    tx?: Prisma.TransactionClient;
  }): Promise<{ balanceCents: number; alreadyProcessed: boolean }> {
    const { orgBillingId, actorUserId, amountCents, reason, idempotencyKey, metadata = {}, tx: outerTx } = args;

    // Race-safe idempotency: P2002 on `idempotency_key` is the dedupe
    // primitive. The previous `findUnique` pre-check left a TOCTOU race
    // where two concurrent callers each saw "not found" and the second
    // one's tx threw an unhandled P2002 → 500.
    const runDebit = async (tx: Prisma.TransactionClient): Promise<number> => {
      await tx.organizationUsageLedger.create({
        data: {
          orgBillingId,
          actorUserId: actorUserId ?? null,
          direction: 'DEBIT',
          amountCents,
          reason,
          idempotencyKey,
          metadata: metadata as object,
        },
      });

      // Conditional decrement: rejects if balance < amount. Guards against
      // the read-then-write race a `findUnique` + `update` pair would have.
      const updateResult = await tx.organizationUsageBalance.updateMany({
        where: {
          orgBillingId,
          balanceCents: { gte: amountCents },
        },
        data: {
          balanceCents: { decrement: amountCents },
        },
      });

      if (updateResult.count === 0) {
        throw new Error('INSUFFICIENT_BALANCE');
      }

      const updatedBalance = await tx.organizationUsageBalance.findUnique({
        where: { orgBillingId },
      });

      return updatedBalance!.balanceCents;
    };

    try {
      const balanceCents = outerTx
        ? await runDebit(outerTx)
        : await this.prisma.$transaction(runDebit);
      return { balanceCents, alreadyProcessed: false };
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        const balance = await this.getOrCreateOrgUsageBalance(orgBillingId);
        return { balanceCents: balance.balance_cents, alreadyProcessed: true };
      }
      throw err;
    }
  }

  /**
   * Log organization usage (user-visible + internal audit)
   * All amounts in USD
   */
  async logOrgUsage(args: {
    orgBillingId: string;
    userId?: string | null; // null for system-initiated debits (billing scheduler)
    serviceType: string; // ai_inference, compute, storage, bandwidth, etc.
    provider: string;
    resource: string;
    model?: string;
    usdCostRaw: number; // raw provider cost
    marginRate: number; // markup rate as a decimal, e.g. 0.25 = 25% (param name kept for DB/contract compat)
    usdCharged: number; // final amount charged = usdCostRaw × (1 + markupRate)
    requestId?: string;
    metadata?: Record<string, unknown>;
    /**
     * Optional transaction client. Lets `compute-debit` and other callers
     * compose `debitOrgBalanceAtomic` + `logOrgUsage` inside one outer
     * transaction so a failed log won't leave the wallet charged with no
     * audit row (and vice versa).
     */
    tx?: Prisma.TransactionClient;
  }): Promise<{ usageId: string; costsPrivateId: string }> {
    const {
      orgBillingId,
      userId,
      serviceType,
      provider,
      resource,
      model,
      usdCostRaw,
      marginRate,
      usdCharged,
      requestId,
      metadata = {},
      tx: outerTx,
    } = args;

    const marginUsd = usdCharged - usdCostRaw;

    const writeBoth = async (tx: Prisma.TransactionClient) => {
      const resolvedUserId = (userId && userId !== 'system') ? userId : null;

      const usage = await tx.organizationUsageLog.create({
        data: {
          orgBillingId,
          userId: resolvedUserId,
          serviceType,
          provider,
          resource,
          model: model ?? null,
          usdCostRaw,
          marginRate,
          usdCharged,
          requestId: requestId ?? null,
          metadata: metadata as object,
        },
      });

      const costsPrivate = await tx.organizationUsageCostsPrivate.create({
        data: {
          orgBillingId,
          userId: resolvedUserId,
          serviceType,
          provider,
          resource,
          model: model ?? null,
          usdCostRaw,
          usdCharged,
          marginRate,
          marginUsd,
          metadata: metadata as object,
        },
      });

      return { usageId: usage.id, costsPrivateId: costsPrivate.id };
    };

    return outerTx
      ? writeBoth(outerTx)
      : this.prisma.$transaction(writeBoth);
  }

  /**
   * Idempotent wrapper for usage logging.
   * Uses requestId as the stable dedupe key when callers may retry.
   */
  async logOrgUsageIdempotent(args: {
    orgBillingId: string;
    userId?: string | null;
    serviceType: string;
    provider: string;
    resource: string;
    model?: string;
    usdCostRaw: number;
    marginRate: number;
    usdCharged: number;
    requestId: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ usageId: string; alreadyProcessed: boolean }> {
    // Race-safe via the partial UNIQUE on (org_billing_id, request_id)
    // created in `20260515132535_billing_idempotency_constraints`. The
    // previous TOCTOU `findFirst` → `create` pattern produced duplicate
    // rows under concurrent retries with the same `requestId`.
    try {
      const result = await this.logOrgUsage(args);
      return { usageId: result.usageId, alreadyProcessed: false };
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        const existing = await this.prisma.organizationUsageLog.findFirst({
          where: {
            orgBillingId: args.orgBillingId,
            requestId: args.requestId,
          },
          select: { id: true },
        });
        if (existing) {
          return { usageId: existing.id, alreadyProcessed: true };
        }
      }
      throw err;
    }
  }

  /**
   * Get usage ledger entries for an org with pagination
   */
  async getOrgUsageLedger(args: {
    orgBillingId: string;
    limit?: number;
    cursor?: string;
    direction?: UsageLedgerDirection;
    reason?: string;
  }): Promise<{ items: OrganizationUsageLedger[]; nextCursor?: string }> {
    const { orgBillingId, limit = 50, cursor, direction, reason } = args;
    const take = Math.min(limit, 200);

    const where: Record<string, unknown> = { orgBillingId };
    if (direction) where.direction = direction;
    if (reason) where.reason = reason;

    // Parse cursor if provided (format: "createdAt:id")
    let cursorFilter: { createdAt?: { lt: Date }; id?: { lt: string } } | undefined;
    if (cursor) {
      const [createdAtStr, id] = cursor.split(':');
      const createdAt = new Date(parseInt(createdAtStr, 10));
      cursorFilter = { createdAt: { lt: createdAt }, id: { lt: id } };
    }

    const results = await this.prisma.organizationUsageLedger.findMany({
      where: cursorFilter ? { ...where, OR: [
        { createdAt: { lt: cursorFilter.createdAt?.lt } },
        { createdAt: cursorFilter.createdAt?.lt, id: { lt: cursorFilter.id?.lt } },
      ]} : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1, // Fetch one extra to determine if there's a next page
    });

    const hasNext = results.length > take;
    const items = hasNext ? results.slice(0, take) : results;

    const mapped = items.map((r) => ({
      id: r.id,
      org_billing_id: r.orgBillingId,
      actor_user_id: r.actorUserId ?? undefined,
      direction: r.direction as UsageLedgerDirection,
      amount_cents: r.amountCents,
      reason: r.reason,
      idempotency_key: r.idempotencyKey,
      metadata: r.metadata as Record<string, unknown>,
      created_at: r.createdAt.getTime(),
    }));

    const nextCursor = hasNext && items.length > 0
      ? `${items[items.length - 1].createdAt.getTime()}:${items[items.length - 1].id}`
      : undefined;

    return { items: mapped, nextCursor };
  }

  /**
   * Get usage log entries for an org with pagination and date filtering
   */
  async getOrgUsageLog(args: {
    orgBillingId: string;
    serviceType?: string;
    periodStart?: number;
    periodEnd?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ items: OrganizationUsageLog[]; summary: { usdCharged: number; usdCostRaw: number } }> {
    const { orgBillingId, serviceType, periodStart, periodEnd, limit = 50, offset = 0 } = args;

    // Default to last 30 days if not specified
    const now = Date.now();
    const start = periodStart ?? now - 30 * 24 * 60 * 60 * 1000;
    const end = periodEnd ?? now;

    const where: Record<string, unknown> = {
      orgBillingId,
      createdAt: {
        gte: new Date(start),
        lte: new Date(end),
      },
    };
    if (serviceType) where.serviceType = serviceType;

    const [results, aggregation] = await Promise.all([
      this.prisma.organizationUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 200),
        skip: offset,
      }),
      this.prisma.organizationUsageLog.aggregate({
        where,
        _sum: {
          usdCharged: true,
          usdCostRaw: true,
        },
      }),
    ]);

    const items = results.map((r) => ({
      id: r.id,
      org_billing_id: r.orgBillingId,
      user_id: r.userId,
      service_type: r.serviceType,
      provider: r.provider,
      resource: r.resource,
      model: r.model ?? undefined,
      usd_cost_raw: r.usdCostRaw,
      margin_rate: r.marginRate,
      usd_charged: r.usdCharged,
      request_id: r.requestId ?? undefined,
      metadata: r.metadata as Record<string, unknown>,
      created_at: r.createdAt.getTime(),
    }));

    return {
      items,
      summary: {
        usdCharged: aggregation._sum.usdCharged ?? 0,
        usdCostRaw: aggregation._sum.usdCostRaw ?? 0,
      },
    };
  }

  // ============================================
  // AUDIT LOG METHODS
  // ============================================

  async createAuditLog(data: {
    userId?: string;
    eventType: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
    riskScore?: number;
  }): Promise<void> {
    await this.prisma.authAuditLog.create({
      data: {
        userId: data.userId,
        eventType: data.eventType as any,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        metadata: data.metadata ?? {},
        riskScore: data.riskScore ?? 0,
      },
    });
  }

  async getRecentLoginsByIp(ipAddress: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    return this.prisma.authAuditLog.count({
      where: {
        ipAddress,
        eventType: { in: ['LOGIN_SUCCESS', 'LOGIN_FAILURE'] },
        createdAt: { gte: since },
      },
    });
  }

  async getRecentFailuresByUserId(userId: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs);
    return this.prisma.authAuditLog.count({
      where: {
        userId,
        eventType: 'LOGIN_FAILURE',
        createdAt: { gte: since },
      },
    });
  }

  async getUserKnownIps(userId: string): Promise<string[]> {
    const logs = await this.prisma.authAuditLog.findMany({
      where: {
        userId,
        eventType: 'LOGIN_SUCCESS',
        ipAddress: { not: null },
      },
      select: { ipAddress: true },
      distinct: ['ipAddress'],
    });
    return logs.map((l) => l.ipAddress).filter(Boolean) as string[];
  }

  async getUserKnownUserAgents(userId: string): Promise<string[]> {
    const logs = await this.prisma.authAuditLog.findMany({
      where: {
        userId,
        eventType: 'LOGIN_SUCCESS',
        userAgent: { not: null },
      },
      select: { userAgent: true },
      distinct: ['userAgent'],
    });
    return logs.map((l) => l.userAgent).filter(Boolean) as string[];
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

// Create a singleton instance for the application
const dbService = new DatabaseService(process.env.DATABASE_URL);

export { dbService };
