-- AlterEnum: new FeedbackKind values
ALTER TYPE "FeedbackKind" ADD VALUE IF NOT EXISTS 'SOURCE_QUALITY_UP';
ALTER TYPE "FeedbackKind" ADD VALUE IF NOT EXISTS 'SOURCE_QUALITY_DOWN';
ALTER TYPE "FeedbackKind" ADD VALUE IF NOT EXISTS 'SCORE_UP';
ALTER TYPE "FeedbackKind" ADD VALUE IF NOT EXISTS 'SCORE_DOWN';
ALTER TYPE "FeedbackKind" ADD VALUE IF NOT EXISTS 'MORE_LIKE_THIS';
ALTER TYPE "FeedbackKind" ADD VALUE IF NOT EXISTS 'LESS_LIKE_THIS';

-- AlterEnum: new TaskRunType values
ALTER TYPE "TaskRunType" ADD VALUE IF NOT EXISTS 'REPORT_GENERATION';
ALTER TYPE "TaskRunType" ADD VALUE IF NOT EXISTS 'TELEGRAM_DELIVERY';

-- CreateTable: DeliveryChannel enum
DO $$ BEGIN
    CREATE TYPE "DeliveryChannel" AS ENUM ('TELEGRAM');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: DeliveryStatus enum
DO $$ BEGIN
    CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: ReportStatus enum
DO $$ BEGIN
    CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED', 'INSUFFICIENT_DATA');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add Telegram credential columns to Subscription
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "telegramEncryptedBotToken" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "telegramBotTokenHint" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "telegramEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: DeliveryLog
CREATE TABLE IF NOT EXISTS "DeliveryLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "briefingId" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL DEFAULT 'TELEGRAM',
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "recipientRef" TEXT,
    "idempotencyKey" TEXT,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryLog_briefingId_channel_key"
    ON "DeliveryLog"("briefingId", "channel");
CREATE INDEX IF NOT EXISTS "DeliveryLog_organizationId_status_idx"
    ON "DeliveryLog"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "DeliveryLog_channel_status_idx"
    ON "DeliveryLog"("channel", "status");

ALTER TABLE "DeliveryLog"
    ADD CONSTRAINT "DeliveryLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryLog"
    ADD CONSTRAINT "DeliveryLog_briefingId_fkey"
    FOREIGN KEY ("briefingId") REFERENCES "Briefing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Report
CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "markdown" TEXT,
    "summary" TEXT,
    "rangeStart" TIMESTAMP(3),
    "rangeEnd" TIMESTAMP(3),
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "topicIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coverageNote" TEXT,
    "generatedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Report_organizationId_status_idx"
    ON "Report"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Report_organizationId_createdAt_idx"
    ON "Report"("organizationId", "createdAt");

ALTER TABLE "Report"
    ADD CONSTRAINT "Report_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
