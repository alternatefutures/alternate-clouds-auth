-- AlterTable: Add token family and version to auth_sessions for refresh token reuse detection
ALTER TABLE "auth_sessions" ADD COLUMN "token_family" TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT;
ALTER TABLE "auth_sessions" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "auth_sessions_token_family_idx" ON "auth_sessions"("token_family");

-- CreateEnum
CREATE TYPE "AuthAuditEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'TOKEN_REFRESH', 'TOKEN_REFRESH_REUSE', 'SESSION_REVOKE', 'PASSWORD_CHANGE', 'MFA_ENABLED', 'MFA_DISABLED', 'PAT_CREATED', 'PAT_DELETED', 'ACCOUNT_LOCKED', 'RATE_LIMIT_EXCEEDED');

-- CreateTable
CREATE TABLE "auth_audit_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "event_type" "AuthAuditEventType" NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_audit_log_user_id_created_at_idx" ON "auth_audit_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "auth_audit_log_event_type_created_at_idx" ON "auth_audit_log"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "auth_audit_log_ip_address_created_at_idx" ON "auth_audit_log"("ip_address", "created_at");
