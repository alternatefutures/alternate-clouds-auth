/**
 * Database service for interacting with PostgreSQL via Prisma
 * Migrated from SQLite (better-sqlite3) to PostgreSQL for shared database with service-cloud-api
 */

import { PrismaClient } from '@prisma/client';

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
  code_type: 'email' | 'sms' | 'mfa';
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
}

export interface OrganizationBilling {
  id: string;
  organization_id: string;
  stripe_customer_id?: string;
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

export type SubscriptionPlanName = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';

export interface SubscriptionPlan {
  id: string;
  name: SubscriptionPlanName;
  base_price_per_seat: number;
  usage_markup: number;
  features?: string;
  stripe_price_id?: string;
  created_at: number;
  updated_at: number;
}

export type SubscriptionStatus = 'ACTIVE' | 'CANCELED' | 'PAST_DUE' | 'UNPAID' | 'TRIALING';

export interface Subscription {
  id: string;
  customer_id: string;
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
   * Initialize connection and seed default data
   */
  async initialize(): Promise<void> {
    await this.prisma.$connect();
    await this.seedDefaultPlans();
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /**
   * Seed default subscription plans if they don't exist
   */
  private async seedDefaultPlans(): Promise<void> {
    const plans = [
      {
        id: 'plan_free',
        name: 'FREE',
        basePricePerSeat: 0,
        usageMarkup: 0.2,
        features: JSON.stringify(['1 project', '1GB storage', '10GB bandwidth/month']),
      },
      {
        id: 'plan_starter',
        name: 'STARTER',
        basePricePerSeat: 1900,
        usageMarkup: 0.1,
        features: JSON.stringify(['5 projects', '10GB storage', '100GB bandwidth/month']),
      },
      {
        id: 'plan_pro',
        name: 'PRO',
        basePricePerSeat: 4900,
        usageMarkup: 0,
        features: JSON.stringify(['Unlimited projects', '100GB storage', '1TB bandwidth/month']),
      },
      {
        id: 'plan_enterprise',
        name: 'ENTERPRISE',
        basePricePerSeat: 0,
        usageMarkup: 0,
        features: JSON.stringify(['Custom limits', 'SLA', 'Dedicated support']),
      },
    ];

    for (const plan of plans) {
      await this.prisma.subscriptionPlan.upsert({
        where: { id: plan.id },
        update: {},
        create: plan,
      });
    }
  }

  // ============================================
  // USER METHODS
  // ============================================

  async createUser(user: Omit<User, 'created_at' | 'updated_at'>): Promise<User> {
    const result = await this.prisma.authUser.create({
      data: {
        id: user.id,
        email: user.email,
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
    const result = await this.prisma.authUser.findUnique({ where: { email } });
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
      code_type: result.codeType as 'email' | 'sms' | 'mfa',
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
      code_type: result.codeType as 'email' | 'sms' | 'mfa',
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

  // ============================================
  // SESSION METHODS
  // ============================================

  async createSession(session: Omit<Session, 'created_at' | 'last_activity_at'>): Promise<Session> {
    const result = await this.prisma.authSession.create({
      data: {
        id: session.id,
        userId: session.user_id,
        refreshToken: session.refresh_token,
        userAgent: session.user_agent,
        ipAddress: session.ip_address,
        deviceId: session.device_id,
        expiresAt: new Date(session.expires_at),
        revoked: intToBool(session.revoked),
        revokedAt: timestampToDate(session.revoked_at),
      },
    });

    return {
      id: result.id,
      user_id: result.userId,
      refresh_token: result.refreshToken,
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

  async getSessionByRefreshToken(refreshToken: string): Promise<Session | null> {
    const result = await this.prisma.authSession.findFirst({
      where: {
        refreshToken,
        revoked: false,
      },
    });

    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      refresh_token: result.refreshToken,
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

  async getSessionById(id: string): Promise<Session | null> {
    const result = await this.prisma.authSession.findUnique({ where: { id } });
    if (!result) return null;

    return {
      id: result.id,
      user_id: result.userId,
      refresh_token: result.refreshToken,
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

  async revokeSession(id: string): Promise<void> {
    await this.prisma.authSession.update({
      where: { id },
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    });
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

    return results.map((result) => ({
      id: result.id,
      user_id: result.userId,
      refresh_token: result.refreshToken,
      user_agent: result.userAgent ?? undefined,
      ip_address: result.ipAddress ?? undefined,
      device_id: result.deviceId ?? undefined,
      expires_at: result.expiresAt.getTime(),
      revoked: boolToInt(result.revoked),
      revoked_at: dateToTimestamp(result.revokedAt),
      created_at: result.createdAt.getTime(),
      last_activity_at: result.lastActivityAt.getTime(),
    }));
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

  async getOrganizationsByUserId(userId: string): Promise<Array<Organization & { role: OrgRole }>> {
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

  async createOrganizationMember(member: Omit<OrganizationMember, 'created_at'>): Promise<OrganizationMember> {
    const result = await this.prisma.organizationMember.create({
      data: {
        id: member.id,
        organizationId: member.organization_id,
        userId: member.user_id,
        role: member.role,
      },
    });

    return {
      id: result.id,
      organization_id: result.organizationId,
      user_id: result.userId,
      role: result.role as OrgRole,
      created_at: result.createdAt.getTime(),
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
    }));
  }

  async updateOrganizationMemberRole(organizationId: string, userId: string, role: OrgRole): Promise<void> {
    await this.prisma.organizationMember.update({
      where: {
        organizationId_userId: { organizationId, userId },
      },
      data: { role },
    });
  }

  async deleteOrganizationMember(organizationId: string, userId: string): Promise<void> {
    await this.prisma.organizationMember.delete({
      where: {
        organizationId_userId: { organizationId, userId },
      },
    });
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
      },
    });

    return {
      id: result.id,
      organization_id: result.organizationId,
      stripe_customer_id: result.stripeCustomerId ?? undefined,
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
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async updateOrganizationBilling(id: string, updates: Partial<Omit<OrganizationBilling, 'id' | 'organization_id' | 'created_at' | 'updated_at'>>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.stripe_customer_id !== undefined) data.stripeCustomerId = updates.stripe_customer_id;

    await this.prisma.organizationBilling.update({
      where: { id },
      data,
    });
  }

  /**
   * Create a default organization for a new user (with membership and billing)
   * This is called when a user signs up via email, wallet, or OAuth
   */
  async createDefaultOrganizationForUser(params: {
    orgId: string;
    memberId: string;
    billingId: string;
    userId: string;
    orgSlug: string;
    orgName: string;
  }): Promise<Organization> {
    const { orgId, memberId, billingId, userId, orgSlug, orgName } = params;

    // Use transaction to ensure all three are created atomically
    const [org] = await this.prisma.$transaction([
      this.prisma.organization.create({
        data: {
          id: orgId,
          slug: orgSlug,
          name: orgName,
        },
      }),
      this.prisma.organizationMember.create({
        data: {
          id: memberId,
          organizationId: orgId,
          userId: userId,
          role: 'OWNER',
        },
      }),
      this.prisma.organizationBilling.create({
        data: {
          id: billingId,
          organizationId: orgId,
        },
      }),
    ]);

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

  async getSubscriptionPlanByName(name: string): Promise<SubscriptionPlan | null> {
    const result = await this.prisma.subscriptionPlan.findUnique({ where: { name } });
    if (!result) return null;

    return {
      id: result.id,
      name: result.name as SubscriptionPlanName,
      base_price_per_seat: result.basePricePerSeat,
      usage_markup: result.usageMarkup,
      features: result.features ?? undefined,
      stripe_price_id: result.stripePriceId ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  async getAllSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    const results = await this.prisma.subscriptionPlan.findMany();

    return results.map((result) => ({
      id: result.id,
      name: result.name as SubscriptionPlanName,
      base_price_per_seat: result.basePricePerSeat,
      usage_markup: result.usageMarkup,
      features: result.features ?? undefined,
      stripe_price_id: result.stripePriceId ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    }));
  }

  async listSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    return this.getAllSubscriptionPlans();
  }

  async getSubscriptionPlanById(id: string): Promise<SubscriptionPlan | null> {
    const result = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!result) return null;

    return {
      id: result.id,
      name: result.name as SubscriptionPlanName,
      base_price_per_seat: result.basePricePerSeat,
      usage_markup: result.usageMarkup,
      features: result.features ?? undefined,
      stripe_price_id: result.stripePriceId ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    };
  }

  // ============================================
  // SUBSCRIPTION METHODS
  // ============================================

  async createSubscription(sub: Omit<Subscription, 'created_at' | 'updated_at'>): Promise<Subscription> {
    const result = await this.prisma.subscription.create({
      data: {
        id: sub.id,
        customerId: sub.customer_id,
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

  async updateSubscription(id: string, updates: Partial<Subscription>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.status !== undefined) data.status = updates.status;
    if (updates.seats !== undefined) data.seats = updates.seats;
    if (updates.plan_id !== undefined) data.planId = updates.plan_id;
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
        status: 'ACTIVE',
      },
    });

    if (!result) return null;

    return {
      id: result.id,
      customer_id: result.customerId,
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
    if (updates.amount_paid !== undefined) data.amountPaid = updates.amount_paid;
    if (updates.amount_due !== undefined) data.amountDue = updates.amount_due;
    if (updates.paid_at !== undefined) data.paidAt = timestampToDate(updates.paid_at);
    if (updates.pdf_url !== undefined) data.pdfUrl = updates.pdf_url;

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
      failure_reason: result.failureReason ?? undefined,
      created_at: result.createdAt.getTime(),
      updated_at: result.updatedAt.getTime(),
    }));
  }

  async updatePayment(id: string, updates: Partial<Payment>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.status !== undefined) data.status = updates.status;
    if (updates.failure_reason !== undefined) data.failureReason = updates.failure_reason;

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
}

// ============================================
// SINGLETON INSTANCE
// ============================================

// Create a singleton instance for the application
const dbService = new DatabaseService(process.env.DATABASE_URL);

export { dbService };
