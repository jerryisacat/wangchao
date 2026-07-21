-- Issue #154: Independent platform admin RBAC and immutable audit log.
-- Adds PlatformAdmin (global identity separate from MembershipRole) and
-- AuditLog (append-only) tables. No data backfill — both are new tables.
--
-- Design constraints enforced at the schema level:
--   * PlatformAdmin.userId is UNIQUE: a user may hold at most one platform
--     role. The role is independent of MembershipRole (workspace-scoped).
--   * AuditLog has no UPDATE path in the application layer. Immutability is
--     enforced by repository code (create-only, no update/delete methods).
--     A DB-level trigger is intentionally omitted in the migration to keep
--     it portable; a future migration can add one if hard enforcement is
--     required.

-- PlatformAdminRole enum
DO $$ BEGIN
  CREATE TYPE "PlatformAdminRole" AS ENUM ('PLATFORM_OWNER', 'PLATFORM_ADMIN', 'PLATFORM_AUDITOR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AuditActorType enum
DO $$ BEGIN
  CREATE TYPE "AuditActorType" AS ENUM ('PLATFORM_ADMIN', 'SYSTEM', 'USER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- PlatformAdmin table
CREATE TABLE IF NOT EXISTS "PlatformAdmin" (
  "id"           TEXT             NOT NULL,
  "userId"       TEXT             NOT NULL,
  "role"         "PlatformAdminRole" NOT NULL DEFAULT 'PLATFORM_AUDITOR',
  "mfaEnabled"   BOOLEAN,
  "lastReauthAt" TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one platform role per user
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformAdmin_userId_key"
  ON "PlatformAdmin" ("userId");

-- Index for role-based queries (e.g. list all PLATFORM_OWNER)
CREATE INDEX IF NOT EXISTS "PlatformAdmin_role_idx"
  ON "PlatformAdmin" ("role");

-- Foreign key to User
ALTER TABLE "PlatformAdmin"
  ADD CONSTRAINT "PlatformAdmin_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AuditLog table (append-only)
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id"         TEXT            NOT NULL,
  "actorType"  "AuditActorType" NOT NULL,
  "actorId"    TEXT            NOT NULL,
  "action"     TEXT            NOT NULL,
  "targetType" TEXT            NOT NULL,
  "targetId"   TEXT            NOT NULL,
  "reason"     TEXT,
  "before"     JSONB,
  "after"      JSONB,
  "requestId"  TEXT,
  "createdAt"  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Query indexes: audit trails by actor, by target, by action
CREATE INDEX IF NOT EXISTS "AuditLog_actorType_actorId_createdAt_idx"
  ON "AuditLog" ("actorType", "actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_targetType_targetId_createdAt_idx"
  ON "AuditLog" ("targetType", "targetId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx"
  ON "AuditLog" ("action", "createdAt");