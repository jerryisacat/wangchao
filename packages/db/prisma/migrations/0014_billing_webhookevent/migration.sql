-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY';

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_recordId_key" ON "WebhookEvent"("provider", "recordId");

-- CreateIndex
CREATE INDEX "WebhookEvent_organizationId_idx" ON "WebhookEvent"("organizationId");

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
