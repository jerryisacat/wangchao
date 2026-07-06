-- Initial Postgres schema for the Wangchao TypeScript rebuild.

CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "TopicStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "SourceKind" AS ENUM ('RSS', 'WEB');
CREATE TYPE "SourceStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'MUTED', 'REJECTED');
CREATE TYPE "ItemStatus" AS ENUM ('FETCHED', 'FILTERED', 'ANALYZED', 'DUPLICATE', 'ERROR');
CREATE TYPE "EventStatus" AS ENUM ('UNREAD', 'READ', 'SAVED', 'DISMISSED', 'ARCHIVED');
CREATE TYPE "FeedbackKind" AS ENUM ('READ', 'SAVE', 'DISMISS', 'EXPORT', 'SOURCE_APPROVE', 'SOURCE_REJECT', 'CATEGORY_UP', 'CATEGORY_DOWN');
CREATE TYPE "BriefingPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "ExportFormat" AS ENUM ('MARKDOWN', 'PDF', 'JSON');
CREATE TYPE "TaskRunType" AS ENUM ('SOURCE_FETCH', 'AI_RELEVANCE', 'AI_EVENT_EXTRACTION', 'BRIEFING_GENERATION', 'EXPORT_GENERATION');
CREATE TYPE "TaskRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');
CREATE TYPE "UsageEventType" AS ENUM ('AI_CALL', 'FETCH', 'EXPORT', 'BRIEFING', 'SOURCE_GOVERNANCE', 'WEB_ACTION');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "profile" JSONB,
    "status" "TopicStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL DEFAULT 'RSS',
    "status" "SourceStatus" NOT NULL DEFAULT 'CANDIDATE',
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "description" TEXT,
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'FETCHED',
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "summary" TEXT,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT,
    "rawContent" TEXT,
    "rawMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntelligenceEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "primaryItemId" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'UNREAD',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "category" TEXT,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gravityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eventHash" TEXT,
    "explanation" TEXT,
    "occurredAt" TIMESTAMP(3),
    "rawAiResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntelligenceEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserItemState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'UNREAD',
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserItemState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeedbackEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "userId" TEXT,
    "eventId" TEXT,
    "itemId" TEXT,
    "sourceId" TEXT,
    "kind" "FeedbackKind" NOT NULL,
    "value" INTEGER,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedbackEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreferenceMemory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PreferenceMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Briefing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "period" "BriefingPeriod" NOT NULL DEFAULT 'DAILY',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "markdown" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rangeStart" TIMESTAMP(3) NOT NULL,
    "rangeEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Briefing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "_BriefingEvents" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_BriefingEvents_AB_pkey" PRIMARY KEY ("A", "B")
);

CREATE TABLE "ExportEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "userId" TEXT,
    "eventId" TEXT,
    "briefingId" TEXT,
    "format" "ExportFormat" NOT NULL DEFAULT 'MARKDOWN',
    "fileName" TEXT,
    "contentHash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExportEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceObservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "sourceId" TEXT,
    "candidateUrl" TEXT,
    "hitRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "noiseRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duplicateRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT,
    "sourceId" TEXT,
    "itemId" TEXT,
    "eventId" TEXT,
    "type" "TaskRunType" NOT NULL,
    "status" "TaskRunStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "input" JSONB,
    "output" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaskRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "UsageEventType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");
CREATE UNIQUE INDEX "Topic_organizationId_name_key" ON "Topic"("organizationId", "name");
CREATE UNIQUE INDEX "Source_topicId_canonicalUrl_key" ON "Source"("topicId", "canonicalUrl");
CREATE UNIQUE INDEX "Item_topicId_canonicalUrl_key" ON "Item"("topicId", "canonicalUrl");
CREATE UNIQUE INDEX "IntelligenceEvent_topicId_eventHash_key" ON "IntelligenceEvent"("topicId", "eventHash");
CREATE UNIQUE INDEX "UserItemState_userId_eventId_key" ON "UserItemState"("userId", "eventId");
CREATE UNIQUE INDEX "PreferenceMemory_topicId_userId_key_key" ON "PreferenceMemory"("topicId", "userId", "key");

CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");
CREATE INDEX "Topic_organizationId_status_idx" ON "Topic"("organizationId", "status");
CREATE INDEX "Topic_ownerUserId_idx" ON "Topic"("ownerUserId");
CREATE INDEX "Source_organizationId_status_idx" ON "Source"("organizationId", "status");
CREATE INDEX "Source_topicId_status_idx" ON "Source"("topicId", "status");
CREATE INDEX "Item_organizationId_status_idx" ON "Item"("organizationId", "status");
CREATE INDEX "Item_topicId_status_publishedAt_idx" ON "Item"("topicId", "status", "publishedAt");
CREATE INDEX "Item_sourceId_fetchedAt_idx" ON "Item"("sourceId", "fetchedAt");
CREATE INDEX "Item_contentHash_idx" ON "Item"("contentHash");
CREATE INDEX "IntelligenceEvent_organizationId_status_idx" ON "IntelligenceEvent"("organizationId", "status");
CREATE INDEX "IntelligenceEvent_topicId_status_gravityScore_idx" ON "IntelligenceEvent"("topicId", "status", "gravityScore");
CREATE INDEX "IntelligenceEvent_primaryItemId_idx" ON "IntelligenceEvent"("primaryItemId");
CREATE INDEX "UserItemState_eventId_idx" ON "UserItemState"("eventId");
CREATE INDEX "UserItemState_userId_status_idx" ON "UserItemState"("userId", "status");
CREATE INDEX "FeedbackEvent_organizationId_createdAt_idx" ON "FeedbackEvent"("organizationId", "createdAt");
CREATE INDEX "FeedbackEvent_topicId_kind_idx" ON "FeedbackEvent"("topicId", "kind");
CREATE INDEX "FeedbackEvent_userId_idx" ON "FeedbackEvent"("userId");
CREATE INDEX "FeedbackEvent_eventId_idx" ON "FeedbackEvent"("eventId");
CREATE INDEX "FeedbackEvent_sourceId_idx" ON "FeedbackEvent"("sourceId");
CREATE INDEX "PreferenceMemory_organizationId_topicId_idx" ON "PreferenceMemory"("organizationId", "topicId");
CREATE INDEX "Briefing_organizationId_generatedAt_idx" ON "Briefing"("organizationId", "generatedAt");
CREATE INDEX "Briefing_topicId_period_generatedAt_idx" ON "Briefing"("topicId", "period", "generatedAt");
CREATE INDEX "_BriefingEvents_B_index" ON "_BriefingEvents"("B");
CREATE INDEX "ExportEvent_organizationId_createdAt_idx" ON "ExportEvent"("organizationId", "createdAt");
CREATE INDEX "ExportEvent_topicId_format_idx" ON "ExportEvent"("topicId", "format");
CREATE INDEX "ExportEvent_userId_idx" ON "ExportEvent"("userId");
CREATE INDEX "SourceObservation_organizationId_observedAt_idx" ON "SourceObservation"("organizationId", "observedAt");
CREATE INDEX "SourceObservation_topicId_observedAt_idx" ON "SourceObservation"("topicId", "observedAt");
CREATE INDEX "SourceObservation_sourceId_idx" ON "SourceObservation"("sourceId");
CREATE INDEX "TaskRun_organizationId_status_scheduledAt_idx" ON "TaskRun"("organizationId", "status", "scheduledAt");
CREATE INDEX "TaskRun_topicId_type_idx" ON "TaskRun"("topicId", "type");
CREATE INDEX "TaskRun_sourceId_status_idx" ON "TaskRun"("sourceId", "status");
CREATE INDEX "UsageEvent_organizationId_type_createdAt_idx" ON "UsageEvent"("organizationId", "type", "createdAt");
CREATE INDEX "UsageEvent_userId_createdAt_idx" ON "UsageEvent"("userId", "createdAt");

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Source" ADD CONSTRAINT "Source_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Source" ADD CONSTRAINT "Source_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Item" ADD CONSTRAINT "Item_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Item" ADD CONSTRAINT "Item_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Item" ADD CONSTRAINT "Item_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntelligenceEvent" ADD CONSTRAINT "IntelligenceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntelligenceEvent" ADD CONSTRAINT "IntelligenceEvent_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntelligenceEvent" ADD CONSTRAINT "IntelligenceEvent_primaryItemId_fkey" FOREIGN KEY ("primaryItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserItemState" ADD CONSTRAINT "UserItemState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserItemState" ADD CONSTRAINT "UserItemState_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IntelligenceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IntelligenceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PreferenceMemory" ADD CONSTRAINT "PreferenceMemory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreferenceMemory" ADD CONSTRAINT "PreferenceMemory_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreferenceMemory" ADD CONSTRAINT "PreferenceMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Briefing" ADD CONSTRAINT "Briefing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Briefing" ADD CONSTRAINT "Briefing_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_BriefingEvents" ADD CONSTRAINT "_BriefingEvents_A_fkey" FOREIGN KEY ("A") REFERENCES "Briefing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_BriefingEvents" ADD CONSTRAINT "_BriefingEvents_B_fkey" FOREIGN KEY ("B") REFERENCES "IntelligenceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExportEvent" ADD CONSTRAINT "ExportEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExportEvent" ADD CONSTRAINT "ExportEvent_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExportEvent" ADD CONSTRAINT "ExportEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExportEvent" ADD CONSTRAINT "ExportEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IntelligenceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExportEvent" ADD CONSTRAINT "ExportEvent_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "Briefing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IntelligenceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
