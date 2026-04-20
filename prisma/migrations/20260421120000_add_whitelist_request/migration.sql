-- Self-service whitelist requests: a user blocked by the early-access
-- gate can submit (email, name, reason). Admin approves -> a matching
-- auth_whitelist row is created and a "you're in" email is sent.

-- CreateEnum
CREATE TYPE "WhitelistRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "auth_whitelist_requests" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "WhitelistRequestStatus" NOT NULL DEFAULT 'PENDING',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_whitelist_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_whitelist_requests_email_key" ON "auth_whitelist_requests"("email");

-- CreateIndex
CREATE INDEX "auth_whitelist_requests_status_created_at_idx" ON "auth_whitelist_requests"("status", "created_at");
