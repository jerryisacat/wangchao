ALTER TABLE "IntelligenceEvent"
  ADD COLUMN "titleHash" TEXT;

CREATE INDEX "IntelligenceEvent_title_hash_occurred_idx" ON "IntelligenceEvent" ("topicId", "titleHash", "occurredAt");
