-- Extend AuthAuditEventType with the values the auditLogService bridge
-- now emits. Without these the legacy auth_logs write fails with
-- "Invalid value for argument `eventType`" and the dual-write never
-- reaches the unified audit_events table either.
--
-- ALTER TYPE ... ADD VALUE is additive and non-blocking; existing rows
-- are untouched. IF NOT EXISTS makes the migration idempotent so it's
-- safe to re-run against a partially-migrated environment.

ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'OTP_ISSUED';
ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'OAUTH_START';
ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'OAUTH_FAILURE';
ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'WALLET_NONCE_ISSUED';
ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'WALLET_LINK_FAILURE';
ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'CLI_PAIR_START';
ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'CLI_PAIR_SUCCESS';
ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'CLI_PAIR_FAILURE';
ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'PROFILE_UPDATE';
ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'AUTH_METHOD_LINK';
ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'AUTH_METHOD_UNLINK';
ALTER TYPE "AuthAuditEventType" ADD VALUE IF NOT EXISTS 'WHITELIST_MUTATE';
