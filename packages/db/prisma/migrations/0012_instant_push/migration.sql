CREATE TYPE "InstantPushStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

ALTER TYPE "TaskRunType" ADD VALUE IF NOT EXISTS 'TELEGRAM_INSTANT_PUSH';
ALTER TYPE "UsageEventType" ADD VALUE IF NOT EXISTS 'INSTANT_PUSH';

ALTER TABLE "Subscription"
  ADD COLUMN "instantPushEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "instantPushEnabledAt" TIMESTAMP(3);

CREATE TABLE "InstantPushLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "channel" "DeliveryChannel" NOT NULL DEFAULT 'TELEGRAM',
  "status" "InstantPushStatus" NOT NULL DEFAULT 'PENDING',
  "score" DOUBLE PRECISION NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "recipientRef" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "errorCode" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstantPushLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstantPushLog_eventId_channel_key" ON "InstantPushLog"("eventId", "channel");
CREATE INDEX "InstantPushLog_organizationId_status_nextAttemptAt_idx" ON "InstantPushLog"("organizationId", "status", "nextAttemptAt");

ALTER TABLE "InstantPushLog" ADD CONSTRAINT "InstantPushLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstantPushLog" ADD CONSTRAINT "InstantPushLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IntelligenceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
