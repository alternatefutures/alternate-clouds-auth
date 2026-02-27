-- Add billing_interval and is_active columns to subscription plans
ALTER TABLE "auth_subscription_plans" ADD COLUMN "billing_interval" TEXT NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "auth_subscription_plans" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
