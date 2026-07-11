-- AlterEnum: Plan
DO $$ BEGIN
    CREATE TYPE "Plan" AS ENUM ('FREE', 'PLUS', 'PRO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterEnum: SubscriptionStatus
DO $$ BEGIN
    CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add subscription plan/status/self-hosted fields
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "plan" "Plan" NOT NULL DEFAULT 'FREE';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "isSelfHosted" BOOLEAN NOT NULL DEFAULT false;

-- Add per-user BYOK fields
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "byokEncryptedKey" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "byokBaseUrl" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "byokProvider" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "byokKeyHint" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "byokModel" TEXT;

-- Add CCPayment fields
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "ccpaymentAppId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "ccpaymentEncryptedSecret" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "ccpaymentSecretHint" TEXT;

-- Add Stripe fields (skeleton)
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;

-- Add subscription period fields
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- CreateTable: Account (Better Auth)
CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Account_userId_providerId_key"
    ON "Account"("userId", "providerId");
CREATE INDEX IF NOT EXISTS "Account_providerId_accountId_idx"
    ON "Account"("providerId", "accountId");

ALTER TABLE "Account"
    ADD CONSTRAINT "Account_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Session (Better Auth)
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Session_token_key"
    ON "Session"("token");
CREATE INDEX IF NOT EXISTS "Session_userId_idx"
    ON "Session"("userId");

ALTER TABLE "Session"
    ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: PaymentInvoice (CCPayment / Stripe)
CREATE TABLE IF NOT EXISTS "PaymentInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'ccpayment',
    "providerOrderId" TEXT,
    "invoiceUrl" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentInvoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentInvoice_organizationId_status_idx"
    ON "PaymentInvoice"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "PaymentInvoice_provider_providerOrderId_idx"
    ON "PaymentInvoice"("provider", "providerOrderId");

ALTER TABLE "PaymentInvoice"
    ADD CONSTRAINT "PaymentInvoice_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
