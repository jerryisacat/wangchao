-- CreateTable: Verification (Better Auth core)
CREATE TABLE IF NOT EXISTS "Verification" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Verification_identifier_idx"
    ON "Verification"("identifier");
CREATE INDEX IF NOT EXISTS "Verification_expiresAt_idx"
    ON "Verification"("expiresAt");

-- Add Better Auth core User fields: emailVerified, image
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "image" TEXT;

-- Better Auth 1.6.23 core schema: user.name is ZodString (required, NOT nullable).
-- Backfill any existing NULL names before setting NOT NULL.
UPDATE "User" SET "name" = "email" WHERE "name" IS NULL;
ALTER TABLE "User" ALTER COLUMN "name" SET NOT NULL;

-- Add Better Auth core Account OAuth fields: refreshTokenExpiresAt, idToken, scope
-- (expiresAt already exists from migration 0010, mapped to Better Auth accessTokenExpiresAt via auth.ts config)
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "refreshTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "idToken" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "scope" TEXT;

-- Create user lifecycle enum (Issue #153)
DO $$ BEGIN
    CREATE TYPE "UserAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETION_PENDING', 'DELETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add user lifecycle fields (Issue #153)
-- accountStatus: separated from emailVerified; existing users default to ACTIVE
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspendedReason" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspendEndsAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3);

-- Create index on accountStatus for operational queries
CREATE INDEX IF NOT EXISTS "User_accountStatus_idx"
    ON "User"("accountStatus");
