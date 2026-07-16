CREATE TYPE "ItemContentStatus" AS ENUM ('PENDING', 'READY', 'INSUFFICIENT', 'FETCH_FAILED', 'UNSUPPORTED');
CREATE TYPE "ItemContentSource" AS ENUM ('RSS_EMBEDDED', 'ARTICLE_HTML', 'LEGACY_TEXT');
CREATE TYPE "EventSummaryStatus" AS ENUM ('PENDING', 'READY', 'CONTENT_FETCH_FAILED', 'CONTENT_INSUFFICIENT', 'CONTENT_UNSUPPORTED', 'AI_FAILED');

ALTER TYPE "TaskRunType" ADD VALUE 'CONTENT_FETCH';

ALTER TABLE "Item"
  ADD COLUMN "contentStatus" "ItemContentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "contentSource" "ItemContentSource",
  ADD COLUMN "contentFetchedAt" TIMESTAMP(3),
  ADD COLUMN "contentErrorCode" TEXT;

UPDATE "Item"
SET
  "contentStatus" = 'READY',
  "contentSource" = 'LEGACY_TEXT',
  "contentFetchedAt" = COALESCE("fetchedAt", "updatedAt")
WHERE "rawContent" IS NOT NULL AND length(trim("rawContent")) > 0;

ALTER TABLE "IntelligenceEvent"
  ADD COLUMN "summaryStatus" "EventSummaryStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN "summaryRequestedAt" TIMESTAMP(3);

CREATE INDEX "Item_organizationId_contentStatus_idx" ON "Item"("organizationId", "contentStatus");
