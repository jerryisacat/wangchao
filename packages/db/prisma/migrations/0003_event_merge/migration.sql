ALTER TABLE "IntelligenceEvent"
  ADD COLUMN "secondaryItemIds" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "entities" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "followUpSuggestion" TEXT,
  ADD COLUMN "mergeReason" TEXT;

CREATE INDEX "IntelligenceEvent_entities_idx" ON "IntelligenceEvent" USING GIN ("entities");
