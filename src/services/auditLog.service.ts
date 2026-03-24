import type { Context } from 'hono';
import { dbService } from './db.service';

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
  | 'RATE_LIMIT_EXCEEDED';

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
   */
  async log(event: AuditLogEvent): Promise<void> {
    try {
      const riskScore = event.riskScore ?? (await this.calculateRiskScore(event));
      await dbService.createAuditLog({
        ...event,
        riskScore: Math.min(100, Math.max(0, riskScore)),
      });
    } catch (err) {
      console.error('[AuditLog] Failed to write audit event:', event.eventType, err);
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
