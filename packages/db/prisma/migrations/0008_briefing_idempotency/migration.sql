-- Preserve the newest briefing for each topic/period/window before adding the
-- idempotency constraint. Repoint exports and merge event relations first so
-- existing production history remains traceable.
CREATE TEMP TABLE "_BriefingDedup" AS
SELECT "id" AS "duplicateId", "keepId"
FROM (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "topicId", "period", "rangeStart"
      ORDER BY "generatedAt" DESC, "id" DESC
    ) AS "keepId",
    ROW_NUMBER() OVER (
      PARTITION BY "topicId", "period", "rangeStart"
      ORDER BY "generatedAt" DESC, "id" DESC
    ) AS "rowNumber"
  FROM "Briefing"
) AS "ranked"
WHERE "rowNumber" > 1;

UPDATE "ExportEvent" AS "export"
SET "briefingId" = "dedup"."keepId"
FROM "_BriefingDedup" AS "dedup"
WHERE "export"."briefingId" = "dedup"."duplicateId";

INSERT INTO "_BriefingEvents" ("A", "B")
SELECT "dedup"."keepId", "events"."B"
FROM "_BriefingDedup" AS "dedup"
JOIN "_BriefingEvents" AS "events"
  ON "events"."A" = "dedup"."duplicateId"
ON CONFLICT ("A", "B") DO NOTHING;

DELETE FROM "_BriefingEvents"
WHERE "A" IN (SELECT "duplicateId" FROM "_BriefingDedup");

DELETE FROM "Briefing"
WHERE "id" IN (SELECT "duplicateId" FROM "_BriefingDedup");

DROP TABLE "_BriefingDedup";

CREATE UNIQUE INDEX "Briefing_topicId_period_rangeStart_key"
ON "Briefing"("topicId", "period", "rangeStart");
