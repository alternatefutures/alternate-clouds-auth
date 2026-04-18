import type { Context } from 'hono';
import { dbService } from './db.service';
import { audit, type AuditCategory, type AuditStatus } from '../lib/audit';

export type AuditEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'TOKEN_REFRESH'
  | 'TOKEN_REFRESH_REUSE'
  | 'SESSION_REVOKE'
  | 'PASSWORD_CHANGE'
  | 'MFA_ENABLED'
  | 'MFA_DISABLED'
  | 'PAT_CREATED'
  | 'PAT_DELETED'
  | 'ACCOUNT_LOCKED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'OTP_ISSUED'
  | 'OAUTH_START'
  | 'OAUTH_FAILURE'
  | 'WALLET_NONCE_ISSUED'
  | 'WALLET_LINK_FAILURE'
  | 'CLI_PAIR_START'
  | 'CLI_PAIR_SUCCESS'
  | 'CLI_PAIR_FAILURE'
  | 'PROFILE_UPDATE'
  | 'AUTH_METHOD_LINK'
  | 'AUTH_METHOD_UNLINK'
  | 'WHITELIST_MUTATE';

// Map the legacy event-type alphabet onto the unified (category, action,
// status) tuple the cross-service `audit()` helper consumes. Keeping the
// mapping in one place means new event types are wired in once and
// flow into both the legacy auth_logs table AND the unified audit_events
// table the admin UI reads. Without this bridge the unified table goes
// silent (which is exactly what happened in production until 2026-04-18).
const EVENT_MAPPING: Record<
  AuditEventType,
  { category: AuditCategory; action: string; defaultStatus: AuditStatus }
> = {
  LOGIN_SUCCESS: { category: 'auth', action: 'auth.login.success', defaultStatus: 'ok' },
  LOGIN_FAILURE: { category: 'auth', action: 'auth.login.failure', defaultStatus: 'error' },
  TOKEN_REFRESH: { category: 'auth', action: 'auth.token.refresh', defaultStatus: 'ok' },
  TOKEN_REFRESH_REUSE: { category: 'auth', action: 'auth.token.reuse_detected', defaultStatus: 'error' },
  SESSION_REVOKE: { category: 'auth', action: 'auth.session.revoke', defaultStatus: 'ok' },
  PASSWORD_CHANGE: { category: 'user', action: 'user.password.change', defaultStatus: 'ok' },
  MFA_ENABLED: { category: 'user', action: 'user.mfa.enabled', defaultStatus: 'ok' },
  MFA_DISABLED: { category: 'user', action: 'user.mfa.disabled', defaultStatus: 'ok' },
  PAT_CREATED: { category: 'user', action: 'user.pat.created', defaultStatus: 'ok' },
  PAT_DELETED: { category: 'user', action: 'user.pat.deleted', defaultStatus: 'ok' },
  ACCOUNT_LOCKED: { category: 'auth', action: 'auth.account.locked', defaultStatus: 'error' },
  RATE_LIMIT_EXCEEDED: { category: 'auth', action: 'auth.rate_limit.exceeded', defaultStatus: 'warn' },
  OTP_ISSUED: { category: 'auth', action: 'auth.otp.issued', defaultStatus: 'ok' },
  OAUTH_START: { category: 'auth', action: 'auth.oauth.start', defaultStatus: 'ok' },
  OAUTH_FAILURE: { category: 'auth', action: 'auth.oauth.failure', defaultStatus: 'error' },
  WALLET_NONCE_ISSUED: { category: 'auth', action: 'auth.wallet.nonce_issued', defaultStatus: 'ok' },
  WALLET_LINK_FAILURE: { category: 'auth', action: 'auth.wallet.link_failure', defaultStatus: 'error' },
  CLI_PAIR_START: { category: 'auth', action: 'auth.cli.pair_start', defaultStatus: 'ok' },
  CLI_PAIR_SUCCESS: { category: 'auth', action: 'auth.cli.pair_success', defaultStatus: 'ok' },
  CLI_PAIR_FAILURE: { category: 'auth', action: 'auth.cli.pair_failure', defaultStatus: 'error' },
  PROFILE_UPDATE: { category: 'user', action: 'user.profile.update', defaultStatus: 'ok' },
  AUTH_METHOD_LINK: { category: 'user', action: 'user.auth_method.link', defaultStatus: 'ok' },
  AUTH_METHOD_UNLINK: { category: 'user', action: 'user.auth_method.unlink', defaultStatus: 'ok' },
  WHITELIST_MUTATE: { category: 'system', action: 'admin.whitelist.mutate', defaultStatus: 'ok' },
};

export interface AuditLogEvent {
  userId?: string;
  eventType: AuditEventType;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  riskScore?: number;
}

const SENSITIVE_EVENTS = new Set<AuditEventType>([
  'TOKEN_REFRESH_REUSE',
  'ACCOUNT_LOCKED',
  'PASSWORD_CHANGE',
  'MFA_ENABLED',
  'MFA_DISABLED',
]);

const FAILURE_EVENTS = new Set<AuditEventType>([
  'LOGIN_FAILURE',
  'TOKEN_REFRESH_REUSE',
  'RATE_LIMIT_EXCEEDED',
]);

class AuditLogService {
  /**
   * Log an auth event. Risk score is auto-calculated if not provided.
   * Fire-and-forget: errors are caught and logged, never thrown.
   *
   * Dual-write: every event also lands in the unified `audit_events`
   * table via the cross-service `audit()` helper. This is the table the
   * admin UI's Audit Log page reads. Without the dual-write the unified
   * table stays empty (which is exactly what happened until 2026-04-18
   * when the admin UI first surfaced "auth: 0 events" for a 24h window).
   */
  async log(event: AuditLogEvent): Promise<void> {
    const riskScore = await this.computeRiskScoreSafely(event);

    // Legacy auth_logs write — unchanged behaviour.
    try {
      await dbService.createAuditLog({
        ...event,
        riskScore: Math.min(100, Math.max(0, riskScore)),
      });
    } catch (err) {
      console.error('[AuditLog] Failed to write audit event:', event.eventType, err);
    }

    // Unified audit_events write — fire-and-forget; audit() never throws.
    const mapping = EVENT_MAPPING[event.eventType];
    if (mapping) {
      audit(dbService.prismaClient, {
        category: mapping.category,
        action: mapping.action,
        status: mapping.defaultStatus,
        userId: event.userId,
        // Carry IP / UA / risk score / arbitrary metadata through the
        // payload field so the admin UI can show them per-row.
        payload: {
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          riskScore,
          ...(event.metadata ?? {}),
        },
      });
    }
  }

  private async computeRiskScoreSafely(event: AuditLogEvent): Promise<number> {
    if (event.riskScore != null) return event.riskScore;
    try {
      return await this.calculateRiskScore(event);
    } catch {
      return 0;
    }
  }

  /**
   * Convenience: extract IP + userAgent from a Hono context and log.
   */
  async logFromContext(c: Context, event: Omit<AuditLogEvent, 'ipAddress' | 'userAgent'>): Promise<void> {
    await this.log({
      ...event,
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || undefined,
      userAgent: c.req.header('user-agent') || undefined,
    });
  }

  private async calculateRiskScore(event: AuditLogEvent): Promise<number> {
    let score = 0;

    if (FAILURE_EVENTS.has(event.eventType)) {
      score += 20;
    }

    if (SENSITIVE_EVENTS.has(event.eventType)) {
      score += 25;
    }

    if (event.eventType === 'TOKEN_REFRESH_REUSE') {
      return 90;
    }

    if (!event.userId || !event.ipAddress) {
      return score;
    }

    try {
      const [knownIps, knownAgents, recentFailures] = await Promise.all([
        dbService.getUserKnownIps(event.userId),
        dbService.getUserKnownUserAgents(event.userId),
        dbService.getRecentFailuresByUserId(event.userId, 60 * 60 * 1000),
      ]);

      const isNewIp = knownIps.length > 0 && !knownIps.includes(event.ipAddress);
      const isNewAgent = event.userAgent && knownAgents.length > 0 && !knownAgents.includes(event.userAgent);

      if (isNewIp) score += 20;
      if (isNewAgent) score += 15;
      if (isNewIp && isNewAgent) score += 10; // compound risk
      if (recentFailures >= 3) score += 15;
      if (recentFailures >= 5) score += 10;
    } catch {
      // Risk scoring is best-effort; don't block the event
    }

    return score;
  }
}

export const auditLogService = new AuditLogService();
