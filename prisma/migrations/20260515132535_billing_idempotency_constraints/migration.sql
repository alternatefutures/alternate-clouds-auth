-- Race-safe idempotency for `logOrgUsageIdempotent`.
--
-- Previously the method did `findFirst({ orgBillingId, requestId })` then
-- `create(...)` with no DB-level UNIQUE, so concurrent retries with the
-- same `requestId` produced duplicate user-visible usage rows. The
-- code-level fix uses an upsert / catch-P2002 pattern, which requires
-- this partial unique index to exist.
--
-- Partial because `request_id` is nullable: legacy rows + non-idempotent
-- callers (admin tooling, manual entries) write NULL and must remain
-- allowed in unbounded counts. Plain UNIQUE would reject the second NULL
-- because PostgreSQL treats NULL values as distinct only with a partial
-- predicate or NULLS NOT DISTINCT (PG15+, which we can't assume yet).
CREATE UNIQUE INDEX IF NOT EXISTS "organization_usage_log_org_request_unique"
  ON "organization_usage_log" ("org_billing_id", "request_id")
  WHERE "request_id" IS NOT NULL;

-- Notify-endpoint idempotency log. Cloud-api retries (or any caller using
-- @upstash/qstash with at-least-once semantics) can fire the notify route
-- multiple times for the same event; without a dedupe primitive each
-- retry sends another email. Caller passes a stable `idempotency_key`;
-- we INSERT-then-catch P2002 to dedupe and skip the actual send.
CREATE TABLE IF NOT EXISTS "organization_notification_log" (
  "id"               TEXT NOT NULL,
  "idempotency_key"  TEXT NOT NULL,
  "org_billing_id"   TEXT,
  "type"             TEXT NOT NULL,
  "recipient_email"  TEXT,
  "metadata"         JSONB NOT NULL DEFAULT '{}',
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_notification_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_notification_log_idempotency_key_key"
  ON "organization_notification_log" ("idempotency_key");

CREATE INDEX IF NOT EXISTS "organization_notification_log_org_created_idx"
  ON "organization_notification_log" ("org_billing_id", "created_at" DESC);
