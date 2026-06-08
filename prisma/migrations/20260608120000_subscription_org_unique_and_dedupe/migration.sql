-- Defense-in-depth against duplicate live subscriptions per organization.
--
-- The application layer already prevents duplicates via convert-not-create
-- (the subscribe flow CONVERTS an org's existing non-terminal row instead of
-- inserting a second). This migration adds the DB-level guarantee so a race,
-- a future code path, or a manual insert can never leave one org with two
-- live subscriptions (which breaks billing invariants and can double-charge).
--
-- Two steps, in order:
--   1. DEDUPE existing data so the unique index can be created. Any org with
--      more than one non-terminal subscription is collapsed to a single
--      "most live" row; the rest are marked CANCELED.
--   2. CREATE the partial unique index. Partial (status <> 'CANCELED') because
--      an org may legitimately accumulate many terminal CANCELED rows over its
--      lifetime (cancel → re-subscribe → cancel …), but only ever ONE live row.

-- 1. Dedupe: keep the most-live row per org, cancel the others.
--    Priority: ACTIVE > PAST_DUE > TRIALING > INCOMPLETE > TRIAL_EXPIRED >
--    SUSPENDED > UNPAID > INACTIVE; tie-break to a row that has a linked
--    Stripe subscription, then to the newest row.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "org_billing_id"
      ORDER BY
        CASE "status"
          WHEN 'ACTIVE'        THEN 0
          WHEN 'PAST_DUE'      THEN 1
          WHEN 'TRIALING'      THEN 2
          WHEN 'INCOMPLETE'    THEN 3
          WHEN 'TRIAL_EXPIRED' THEN 4
          WHEN 'SUSPENDED'     THEN 5
          WHEN 'UNPAID'        THEN 6
          WHEN 'INACTIVE'      THEN 7
          ELSE 8
        END,
        ("stripe_subscription_id" IS NULL),
        "created_at" DESC
    ) AS rn
  FROM "auth_subscriptions"
  WHERE "org_billing_id" IS NOT NULL
    AND "status" <> 'CANCELED'
)
UPDATE "auth_subscriptions" AS s
SET "status" = 'CANCELED',
    "canceled_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
FROM ranked AS r
WHERE s."id" = r."id"
  AND r."rn" > 1;

-- 2. Enforce: at most one non-terminal subscription per org.
CREATE UNIQUE INDEX IF NOT EXISTS "auth_subscriptions_org_billing_id_active_unique"
  ON "auth_subscriptions" ("org_billing_id")
  WHERE "org_billing_id" IS NOT NULL AND "status" <> 'CANCELED';
