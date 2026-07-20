-- Issue #159: Controlled platform operations, temporary plan override, and
-- customer-service notes.
--
-- Adds:
--   * Subscription.tempPlanOverride / tempPlanExpiresAt / tempPlanReason
--     (nullable, for time-limited plan elevation/downgrade that auto-reverts).
--   * PlatformNote table (append-only customer-service notes on any target).
--
-- All columns are nullable and default to null, so this migration is safe on
-- existing rows (no backfill needed). PlatformNote is a new table.

-- ── Subscription: temporary plan override columns ──

ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "tempPlanOverride" "Plan";

ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "tempPlanExpiresAt" TIMESTAMP(3);

ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "tempPlanReason" TEXT;

-- ── PlatformNote table (append-only customer-service notes) ──

CREATE TABLE IF NOT EXISTS "PlatformNote" (
  "id"         TEXT      NOT NULL,
  "targetType" TEXT      NOT NULL,
  "targetId"   TEXT      NOT NULL,
  "authorId"   TEXT      NOT NULL,
  "content"    TEXT      NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlatformNote_pkey" PRIMARY KEY ("id")
);

-- Query indexes: notes by target (the console detail view), by author (audit).
CREATE INDEX IF NOT EXISTS "PlatformNote_targetType_targetId_createdAt_idx"
  ON "PlatformNote" ("targetType", "targetId", "createdAt");
CREATE INDEX IF NOT EXISTS "PlatformNote_authorId_createdAt_idx"
  ON "PlatformNote" ("authorId", "createdAt");
