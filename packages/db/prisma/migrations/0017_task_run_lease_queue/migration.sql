-- Issue #162 Lane 1A: TaskRun lease/idempotency data model.
-- Expand-only: adds 5 nullable columns + 2 indexes. No data backfill, no
-- constraint on existing RUNNING rows, no enum change.

-- New nullable columns. All default NULL so existing PENDING/RUNNING/terminal
-- rows remain valid; the worker populates them as it claims tasks.
ALTER TABLE "TaskRun" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "TaskRun" ADD COLUMN IF NOT EXISTS "leaseOwner"    TEXT;
ALTER TABLE "TaskRun" ADD COLUMN IF NOT EXISTS "leaseToken"    TEXT;
ALTER TABLE "TaskRun" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "TaskRun" ADD COLUMN IF NOT EXISTS "heartbeatAt"    TIMESTAMP(3);

-- Due scan index for the worker claim loop: pick the oldest PENDING task of
-- a given type whose scheduledAt has passed. status leads for status-filtered
-- lookups; (status, type, scheduledAt) is the claim-scan access pattern.
CREATE INDEX IF NOT EXISTS "TaskRun_status_type_scheduledAt_idx"
    ON "TaskRun" ("status", "type", "scheduledAt");

-- Partial UNIQUE active-idempotency index (migration-owned; Prisma schema
-- cannot express WHERE-filtered @@unique).
-- Same (organizationId, type, idempotencyKey) may have at most one row while
-- the task is in an active state (PENDING or RUNNING). Once a row reaches a
-- terminal state (SUCCEEDED / FAILED / CANCELED) the predicate no longer
-- matches it, so a future task is free to reuse the same business key.
-- This is intentionally an index, not a table constraint, so it does not block
-- normal INSERT of terminal-state rows and does not require backfill.
CREATE UNIQUE INDEX IF NOT EXISTS "TaskRun_active_idempotency_key"
    ON "TaskRun" ("organizationId", "type", "idempotencyKey")
    WHERE "idempotencyKey" IS NOT NULL
      AND "status" IN ('PENDING', 'RUNNING');