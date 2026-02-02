/*
  Warnings:

  - Made the column `customer_id` on table `auth_invoices` required. This step will fail if there are existing NULL values in that column.
  - Made the column `customer_id` on table `auth_subscriptions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `customer_id` on table `auth_usage_aggregates` required. This step will fail if there are existing NULL values in that column.
  - Made the column `customer_id` on table `auth_usage_records` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "auth_invoices" ALTER COLUMN "customer_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "auth_subscription_plans" ADD COLUMN     "included_bandwidth_gb" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "included_compute_seconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "included_invocations" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "included_storage_gb" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trial_days" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "auth_subscriptions" ALTER COLUMN "customer_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "auth_usage_aggregates" ALTER COLUMN "customer_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "auth_usage_records" ALTER COLUMN "customer_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "organization_billing" ADD COLUMN     "trial_converted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trial_ends_at" TIMESTAMP(3),
ADD COLUMN     "trial_started_at" TIMESTAMP(3);
