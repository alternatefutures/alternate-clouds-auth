-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "user_id" TEXT,
    "org_id" TEXT,
    "project_id" TEXT,
    "service_id" TEXT,
    "deployment_id" TEXT,
    "duration_ms" INTEGER,
    "payload" JSONB NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_user_id_timestamp_idx" ON "audit_events"("user_id", "timestamp");

-- CreateIndex
CREATE INDEX "audit_events_org_id_timestamp_idx" ON "audit_events"("org_id", "timestamp");

-- CreateIndex
CREATE INDEX "audit_events_project_id_timestamp_idx" ON "audit_events"("project_id", "timestamp");

-- CreateIndex
CREATE INDEX "audit_events_service_id_timestamp_idx" ON "audit_events"("service_id", "timestamp");

-- CreateIndex
CREATE INDEX "audit_events_category_timestamp_idx" ON "audit_events"("category", "timestamp");

-- CreateIndex
CREATE INDEX "audit_events_action_timestamp_idx" ON "audit_events"("action", "timestamp");

-- CreateIndex
CREATE INDEX "audit_events_trace_id_idx" ON "audit_events"("trace_id");

-- CreateIndex
CREATE INDEX "audit_events_status_timestamp_idx" ON "audit_events"("status", "timestamp");
