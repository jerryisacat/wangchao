CREATE TABLE "EventItem" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SECONDARY',
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mergeReason" TEXT,
    CONSTRAINT "EventItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventItem_eventId_itemId_key" ON "EventItem" ("eventId", "itemId");
CREATE INDEX "EventItem_eventId_idx" ON "EventItem" ("eventId");
CREATE INDEX "EventItem_itemId_idx" ON "EventItem" ("itemId");

ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IntelligenceEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
