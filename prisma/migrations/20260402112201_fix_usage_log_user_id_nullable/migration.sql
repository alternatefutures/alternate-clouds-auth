-- DropForeignKey
ALTER TABLE "organization_usage_costs_private" DROP CONSTRAINT "organization_usage_costs_private_user_id_fkey";

-- DropForeignKey
ALTER TABLE "organization_usage_log" DROP CONSTRAINT "organization_usage_log_user_id_fkey";

-- AlterTable
ALTER TABLE "organization_usage_costs_private" ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "organization_usage_log" ALTER COLUMN "user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "organization_usage_log" ADD CONSTRAINT "organization_usage_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_usage_costs_private" ADD CONSTRAINT "organization_usage_costs_private_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
