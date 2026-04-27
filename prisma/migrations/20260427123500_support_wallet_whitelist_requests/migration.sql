ALTER TABLE "auth_whitelist_requests"
  ADD COLUMN "identifier" TEXT,
  ADD COLUMN "identifier_type" TEXT NOT NULL DEFAULT 'email';

UPDATE "auth_whitelist_requests"
SET "identifier" = lower("email")
WHERE "identifier" IS NULL;

ALTER TABLE "auth_whitelist_requests"
  ALTER COLUMN "identifier" SET NOT NULL;

DROP INDEX IF EXISTS "auth_whitelist_requests_email_key";

CREATE UNIQUE INDEX "auth_whitelist_requests_identifier_key"
  ON "auth_whitelist_requests"("identifier");
