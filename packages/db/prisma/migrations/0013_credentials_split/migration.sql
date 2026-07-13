CREATE TYPE "CredentialType" AS ENUM ('AI', 'SEARCH', 'BYOK', 'TELEGRAM', 'CCPAYMENT');

CREATE TABLE "OrganizationCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credentialType" "CredentialType" NOT NULL,
    "encryptedKey" TEXT,
    "encryptedSecret" TEXT,
    "keyHint" TEXT,
    "baseUrl" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "appId" TEXT,
    "chatId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "instantPushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "instantPushEnabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationCredential_organizationId_credentialType_key" ON "OrganizationCredential"("organizationId", "credentialType");
CREATE INDEX "OrganizationCredential_organizationId_idx" ON "OrganizationCredential"("organizationId");
CREATE INDEX "OrganizationCredential_credentialType_idx" ON "OrganizationCredential"("credentialType");

ALTER TABLE "OrganizationCredential" ADD CONSTRAINT "OrganizationCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "OrganizationCredential" ("id", "organizationId", "credentialType", "encryptedKey", "keyHint", "baseUrl", "provider", "model", "enabled", "instantPushEnabled", "instantPushEnabledAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "organizationId", 'AI', "aiEncryptedKey", "aiKeyHint", "aiBaseUrl", "aiProvider", "aiModel", false, false, NULL, "createdAt", "updatedAt"
FROM "Subscription" WHERE "aiEncryptedKey" IS NOT NULL;

INSERT INTO "OrganizationCredential" ("id", "organizationId", "credentialType", "encryptedKey", "keyHint", "provider", "enabled", "instantPushEnabled", "instantPushEnabledAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "organizationId", 'SEARCH', "searchEncryptedKey", "searchKeyHint", "searchProvider", false, false, NULL, "createdAt", "updatedAt"
FROM "Subscription" WHERE "searchEncryptedKey" IS NOT NULL;

INSERT INTO "OrganizationCredential" ("id", "organizationId", "credentialType", "encryptedKey", "keyHint", "baseUrl", "provider", "model", "enabled", "instantPushEnabled", "instantPushEnabledAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "organizationId", 'BYOK', "byokEncryptedKey", "byokKeyHint", "byokBaseUrl", "byokProvider", "byokModel", false, false, NULL, "createdAt", "updatedAt"
FROM "Subscription" WHERE "byokEncryptedKey" IS NOT NULL;

INSERT INTO "OrganizationCredential" ("id", "organizationId", "credentialType", "encryptedKey", "keyHint", "chatId", "enabled", "instantPushEnabled", "instantPushEnabledAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "organizationId", 'TELEGRAM', "telegramEncryptedBotToken", "telegramBotTokenHint", "telegramChatId", "telegramEnabled", "instantPushEnabled", "instantPushEnabledAt", "createdAt", "updatedAt"
FROM "Subscription" WHERE "telegramEncryptedBotToken" IS NOT NULL;

INSERT INTO "OrganizationCredential" ("id", "organizationId", "credentialType", "encryptedSecret", "keyHint", "appId", "enabled", "instantPushEnabled", "instantPushEnabledAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "organizationId", 'CCPAYMENT', "ccpaymentEncryptedSecret", "ccpaymentSecretHint", "ccpaymentAppId", false, false, NULL, "createdAt", "updatedAt"
FROM "Subscription" WHERE "ccpaymentEncryptedSecret" IS NOT NULL;

ALTER TABLE "Subscription" DROP COLUMN "aiEncryptedKey";
ALTER TABLE "Subscription" DROP COLUMN "aiKeyHint";
ALTER TABLE "Subscription" DROP COLUMN "aiBaseUrl";
ALTER TABLE "Subscription" DROP COLUMN "aiProvider";
ALTER TABLE "Subscription" DROP COLUMN "aiModel";
ALTER TABLE "Subscription" DROP COLUMN "searchEncryptedKey";
ALTER TABLE "Subscription" DROP COLUMN "searchKeyHint";
ALTER TABLE "Subscription" DROP COLUMN "searchProvider";
ALTER TABLE "Subscription" DROP COLUMN "byokEncryptedKey";
ALTER TABLE "Subscription" DROP COLUMN "byokKeyHint";
ALTER TABLE "Subscription" DROP COLUMN "byokBaseUrl";
ALTER TABLE "Subscription" DROP COLUMN "byokProvider";
ALTER TABLE "Subscription" DROP COLUMN "byokModel";
ALTER TABLE "Subscription" DROP COLUMN "telegramEncryptedBotToken";
ALTER TABLE "Subscription" DROP COLUMN "telegramBotTokenHint";
ALTER TABLE "Subscription" DROP COLUMN "telegramChatId";
ALTER TABLE "Subscription" DROP COLUMN "telegramEnabled";
ALTER TABLE "Subscription" DROP COLUMN "instantPushEnabled";
ALTER TABLE "Subscription" DROP COLUMN "instantPushEnabledAt";
ALTER TABLE "Subscription" DROP COLUMN "ccpaymentEncryptedSecret";
ALTER TABLE "Subscription" DROP COLUMN "ccpaymentSecretHint";
ALTER TABLE "Subscription" DROP COLUMN "ccpaymentAppId";

ALTER TABLE "IntelligenceEvent" DROP COLUMN "secondaryItemIds";
ALTER TABLE "DeliveryLog" DROP COLUMN "idempotencyKey";
ALTER TABLE "UserItemState" DROP COLUMN "dismissedAt";

ALTER TABLE "PaymentInvoice" ALTER COLUMN "amount" TYPE DECIMAL(10, 2);

CREATE UNIQUE INDEX "PaymentInvoice_provider_providerOrderId_key" ON "PaymentInvoice"("provider", "providerOrderId") WHERE "providerOrderId" IS NOT NULL;
DROP INDEX IF EXISTS "PaymentInvoice_provider_providerOrderId_idx";

CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

DROP INDEX IF EXISTS "FeedbackEvent_organizationId_createdAt_idx";
DROP INDEX IF EXISTS "FeedbackEvent_topicId_kind_idx";
CREATE INDEX "FeedbackEvent_organizationId_kind_createdAt_idx" ON "FeedbackEvent"("organizationId", "kind", "createdAt");
CREATE INDEX "FeedbackEvent_topicId_kind_createdAt_idx" ON "FeedbackEvent"("topicId", "kind", "createdAt");

ALTER TYPE "TaskRunType" ADD VALUE IF NOT EXISTS 'SOURCE_DISCOVERY';
ALTER TYPE "UsageEventType" ADD VALUE IF NOT EXISTS 'SOURCE_DISCOVERY';
