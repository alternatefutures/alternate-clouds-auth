-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateTable
CREATE TABLE "auth_users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "auth_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_methods" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "method_type" TEXT NOT NULL,
    "provider" TEXT,
    "identifier" TEXT NOT NULL,
    "oauth_access_token" TEXT,
    "oauth_refresh_token" TEXT,
    "oauth_token_expires_at" TIMESTAMP(3),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "auth_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "device_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_verification_codes" (
    "id" TEXT NOT NULL,
    "code_type" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,

    CONSTRAINT "auth_verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_siwe_challenges" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,

    CONSTRAINT "auth_siwe_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_personal_access_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_personal_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_billing" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_billing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_billing_customers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "stripe_customer_id" TEXT,
    "stax_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_billing_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_payment_methods" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "card_brand" TEXT,
    "card_last4" TEXT,
    "card_exp_month" INTEGER,
    "card_exp_year" INTEGER,
    "stripe_payment_method_id" TEXT,
    "stax_payment_method_id" TEXT,
    "wallet_address" TEXT,
    "blockchain" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_subscription_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_price_per_seat" INTEGER NOT NULL,
    "usage_markup" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "features" TEXT,
    "stripe_price_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_subscriptions" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "org_billing_id" TEXT,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "stripe_subscription_id" TEXT,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancel_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "trial_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_invoices" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "org_billing_id" TEXT,
    "subscription_id" TEXT,
    "invoice_number" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "amount_paid" INTEGER NOT NULL DEFAULT 0,
    "amount_due" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "pdf_url" TEXT,
    "stripe_invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_payments" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "payment_method_id" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "stax_transaction_id" TEXT,
    "tx_hash" TEXT,
    "blockchain" TEXT,
    "from_address" TEXT,
    "to_address" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_usage_records" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "org_billing_id" TEXT,
    "subscription_id" TEXT,
    "metric_type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_usage_aggregates" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "org_billing_id" TEXT,
    "subscription_id" TEXT,
    "metric_type" TEXT NOT NULL,
    "total_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_amount" INTEGER NOT NULL DEFAULT 0,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_usage_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_connected_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "account_type" TEXT NOT NULL DEFAULT 'express',
    "stripe_account_id" TEXT,
    "stax_sub_merchant_id" TEXT,
    "email" TEXT,
    "business_name" TEXT,
    "country" TEXT,
    "charges_enabled" BOOLEAN NOT NULL DEFAULT false,
    "payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
    "details_submitted" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_connected_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_transfers" (
    "id" TEXT NOT NULL,
    "connected_account_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "stripe_transfer_id" TEXT,
    "stax_split_id" TEXT,
    "description" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_platform_fees" (
    "id" TEXT NOT NULL,
    "connected_account_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "stripe_fee_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_platform_fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_email_key" ON "auth_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_phone_key" ON "auth_users"("phone");

-- CreateIndex
CREATE INDEX "auth_methods_user_id_idx" ON "auth_methods"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_methods_identifier_method_type_key" ON "auth_methods"("identifier", "method_type");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_key" ON "auth_sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_verification_codes_identifier_code_type_idx" ON "auth_verification_codes"("identifier", "code_type");

-- CreateIndex
CREATE UNIQUE INDEX "auth_siwe_challenges_nonce_key" ON "auth_siwe_challenges"("nonce");

-- CreateIndex
CREATE INDEX "auth_siwe_challenges_address_idx" ON "auth_siwe_challenges"("address");

-- CreateIndex
CREATE UNIQUE INDEX "auth_personal_access_tokens_token_key" ON "auth_personal_access_tokens"("token");

-- CreateIndex
CREATE INDEX "auth_personal_access_tokens_user_id_idx" ON "auth_personal_access_tokens"("user_id");

-- CreateIndex
CREATE INDEX "auth_personal_access_tokens_token_idx" ON "auth_personal_access_tokens"("token");

-- CreateIndex
CREATE INDEX "auth_personal_access_tokens_organization_id_idx" ON "auth_personal_access_tokens"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_organization_id_idx" ON "organization_members"("organization_id");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_billing_organization_id_key" ON "organization_billing"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_billing_stripe_customer_id_key" ON "organization_billing"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "organization_billing_stripe_customer_id_idx" ON "organization_billing"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_billing_customers_user_id_key" ON "auth_billing_customers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_billing_customers_stripe_customer_id_key" ON "auth_billing_customers"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_billing_customers_stax_customer_id_key" ON "auth_billing_customers"("stax_customer_id");

-- CreateIndex
CREATE INDEX "auth_billing_customers_stripe_customer_id_idx" ON "auth_billing_customers"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "auth_billing_customers_stax_customer_id_idx" ON "auth_billing_customers"("stax_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_payment_methods_stripe_payment_method_id_key" ON "auth_payment_methods"("stripe_payment_method_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_payment_methods_stax_payment_method_id_key" ON "auth_payment_methods"("stax_payment_method_id");

-- CreateIndex
CREATE INDEX "auth_payment_methods_customer_id_idx" ON "auth_payment_methods"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_subscription_plans_name_key" ON "auth_subscription_plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "auth_subscriptions_stripe_subscription_id_key" ON "auth_subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "auth_subscriptions_customer_id_idx" ON "auth_subscriptions"("customer_id");

-- CreateIndex
CREATE INDEX "auth_subscriptions_org_billing_id_idx" ON "auth_subscriptions"("org_billing_id");

-- CreateIndex
CREATE INDEX "auth_subscriptions_status_idx" ON "auth_subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "auth_invoices_invoice_number_key" ON "auth_invoices"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "auth_invoices_stripe_invoice_id_key" ON "auth_invoices"("stripe_invoice_id");

-- CreateIndex
CREATE INDEX "auth_invoices_customer_id_idx" ON "auth_invoices"("customer_id");

-- CreateIndex
CREATE INDEX "auth_invoices_org_billing_id_idx" ON "auth_invoices"("org_billing_id");

-- CreateIndex
CREATE INDEX "auth_invoices_status_idx" ON "auth_invoices"("status");

-- CreateIndex
CREATE INDEX "auth_invoice_line_items_invoice_id_idx" ON "auth_invoice_line_items"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_payments_stripe_payment_intent_id_key" ON "auth_payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_payments_stax_transaction_id_key" ON "auth_payments"("stax_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_payments_tx_hash_key" ON "auth_payments"("tx_hash");

-- CreateIndex
CREATE INDEX "auth_payments_customer_id_idx" ON "auth_payments"("customer_id");

-- CreateIndex
CREATE INDEX "auth_payments_invoice_id_idx" ON "auth_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "auth_usage_records_customer_id_period_start_idx" ON "auth_usage_records"("customer_id", "period_start");

-- CreateIndex
CREATE INDEX "auth_usage_records_org_billing_id_period_start_idx" ON "auth_usage_records"("org_billing_id", "period_start");

-- CreateIndex
CREATE INDEX "auth_usage_records_metric_type_idx" ON "auth_usage_records"("metric_type");

-- CreateIndex
CREATE UNIQUE INDEX "auth_usage_aggregates_customer_id_metric_type_period_start_key" ON "auth_usage_aggregates"("customer_id", "metric_type", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "auth_usage_aggregates_org_billing_id_metric_type_period_sta_key" ON "auth_usage_aggregates"("org_billing_id", "metric_type", "period_start");

-- CreateIndex
CREATE INDEX "auth_webhook_events_processed_idx" ON "auth_webhook_events"("processed");

-- CreateIndex
CREATE UNIQUE INDEX "auth_webhook_events_provider_event_id_key" ON "auth_webhook_events"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_connected_accounts_stripe_account_id_key" ON "auth_connected_accounts"("stripe_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_connected_accounts_stax_sub_merchant_id_key" ON "auth_connected_accounts"("stax_sub_merchant_id");

-- CreateIndex
CREATE INDEX "auth_connected_accounts_user_id_idx" ON "auth_connected_accounts"("user_id");

-- CreateIndex
CREATE INDEX "auth_connected_accounts_provider_idx" ON "auth_connected_accounts"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "auth_transfers_stripe_transfer_id_key" ON "auth_transfers"("stripe_transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_transfers_stax_split_id_key" ON "auth_transfers"("stax_split_id");

-- CreateIndex
CREATE INDEX "auth_transfers_connected_account_id_idx" ON "auth_transfers"("connected_account_id");

-- CreateIndex
CREATE INDEX "auth_transfers_payment_id_idx" ON "auth_transfers"("payment_id");

-- CreateIndex
CREATE INDEX "auth_transfers_status_idx" ON "auth_transfers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "auth_platform_fees_stripe_fee_id_key" ON "auth_platform_fees"("stripe_fee_id");

-- CreateIndex
CREATE INDEX "auth_platform_fees_connected_account_id_idx" ON "auth_platform_fees"("connected_account_id");

-- CreateIndex
CREATE INDEX "auth_platform_fees_payment_id_idx" ON "auth_platform_fees"("payment_id");

-- AddForeignKey
ALTER TABLE "auth_methods" ADD CONSTRAINT "auth_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_personal_access_tokens" ADD CONSTRAINT "auth_personal_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_personal_access_tokens" ADD CONSTRAINT "auth_personal_access_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_billing" ADD CONSTRAINT "organization_billing_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_billing_customers" ADD CONSTRAINT "auth_billing_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_payment_methods" ADD CONSTRAINT "auth_payment_methods_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "auth_billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_subscriptions" ADD CONSTRAINT "auth_subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "auth_billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_subscriptions" ADD CONSTRAINT "auth_subscriptions_org_billing_id_fkey" FOREIGN KEY ("org_billing_id") REFERENCES "organization_billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_subscriptions" ADD CONSTRAINT "auth_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "auth_subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_invoices" ADD CONSTRAINT "auth_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "auth_billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_invoices" ADD CONSTRAINT "auth_invoices_org_billing_id_fkey" FOREIGN KEY ("org_billing_id") REFERENCES "organization_billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_invoices" ADD CONSTRAINT "auth_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "auth_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_invoice_line_items" ADD CONSTRAINT "auth_invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "auth_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_payments" ADD CONSTRAINT "auth_payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "auth_billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_payments" ADD CONSTRAINT "auth_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "auth_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_payments" ADD CONSTRAINT "auth_payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "auth_payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_usage_records" ADD CONSTRAINT "auth_usage_records_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "auth_billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_usage_records" ADD CONSTRAINT "auth_usage_records_org_billing_id_fkey" FOREIGN KEY ("org_billing_id") REFERENCES "organization_billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_usage_records" ADD CONSTRAINT "auth_usage_records_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "auth_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_usage_aggregates" ADD CONSTRAINT "auth_usage_aggregates_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "auth_billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_usage_aggregates" ADD CONSTRAINT "auth_usage_aggregates_org_billing_id_fkey" FOREIGN KEY ("org_billing_id") REFERENCES "organization_billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_usage_aggregates" ADD CONSTRAINT "auth_usage_aggregates_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "auth_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_connected_accounts" ADD CONSTRAINT "auth_connected_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_transfers" ADD CONSTRAINT "auth_transfers_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "auth_connected_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_transfers" ADD CONSTRAINT "auth_transfers_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "auth_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_platform_fees" ADD CONSTRAINT "auth_platform_fees_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "auth_connected_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_platform_fees" ADD CONSTRAINT "auth_platform_fees_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "auth_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
