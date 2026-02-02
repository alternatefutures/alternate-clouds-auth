-- CreateEnum
CREATE TYPE "UsageLedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateTable: Organization Usage Balance (USD cents)
CREATE TABLE "organization_usage_balance" (
    "id" TEXT NOT NULL,
    "org_billing_id" TEXT NOT NULL,
    "balance_cents" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_usage_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Organization Usage Ledger
CREATE TABLE "organization_usage_ledger" (
    "id" TEXT NOT NULL,
    "org_billing_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "direction" "UsageLedgerDirection" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_usage_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Organization Usage Log (per-request tracking)
CREATE TABLE "organization_usage_log" (
    "id" TEXT NOT NULL,
    "org_billing_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "service_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "model" TEXT,
    "usd_cost_raw" DOUBLE PRECISION NOT NULL,
    "margin_rate" DOUBLE PRECISION NOT NULL,
    "usd_charged" DOUBLE PRECISION NOT NULL,
    "request_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_usage_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Organization Usage Costs Private (internal audit)
CREATE TABLE "organization_usage_costs_private" (
    "id" TEXT NOT NULL,
    "org_billing_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "service_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "model" TEXT,
    "usd_cost_raw" DOUBLE PRECISION NOT NULL,
    "usd_charged" DOUBLE PRECISION NOT NULL,
    "margin_rate" DOUBLE PRECISION NOT NULL,
    "margin_usd" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_usage_costs_private_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_usage_balance_org_billing_id_key" ON "organization_usage_balance"("org_billing_id");
CREATE INDEX "organization_usage_balance_org_billing_id_idx" ON "organization_usage_balance"("org_billing_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_usage_ledger_idempotency_key_key" ON "organization_usage_ledger"("idempotency_key");
CREATE INDEX "organization_usage_ledger_org_billing_id_created_at_idx" ON "organization_usage_ledger"("org_billing_id", "created_at");
CREATE INDEX "organization_usage_ledger_actor_user_id_idx" ON "organization_usage_ledger"("actor_user_id");
CREATE INDEX "organization_usage_ledger_reason_idx" ON "organization_usage_ledger"("reason");

-- CreateIndex
CREATE INDEX "organization_usage_log_org_billing_id_created_at_idx" ON "organization_usage_log"("org_billing_id", "created_at");
CREATE INDEX "organization_usage_log_user_id_created_at_idx" ON "organization_usage_log"("user_id", "created_at");
CREATE INDEX "organization_usage_log_service_type_idx" ON "organization_usage_log"("service_type");
CREATE INDEX "organization_usage_log_provider_idx" ON "organization_usage_log"("provider");

-- CreateIndex
CREATE INDEX "organization_usage_costs_private_org_billing_id_created_at_idx" ON "organization_usage_costs_private"("org_billing_id", "created_at");

-- AddForeignKey
ALTER TABLE "organization_usage_balance" ADD CONSTRAINT "organization_usage_balance_org_billing_id_fkey" FOREIGN KEY ("org_billing_id") REFERENCES "organization_billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_usage_ledger" ADD CONSTRAINT "organization_usage_ledger_org_billing_id_fkey" FOREIGN KEY ("org_billing_id") REFERENCES "organization_billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_usage_ledger" ADD CONSTRAINT "organization_usage_ledger_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_usage_log" ADD CONSTRAINT "organization_usage_log_org_billing_id_fkey" FOREIGN KEY ("org_billing_id") REFERENCES "organization_billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_usage_log" ADD CONSTRAINT "organization_usage_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_usage_costs_private" ADD CONSTRAINT "organization_usage_costs_private_org_billing_id_fkey" FOREIGN KEY ("org_billing_id") REFERENCES "organization_billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_usage_costs_private" ADD CONSTRAINT "organization_usage_costs_private_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
