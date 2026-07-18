import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantScope } from "./types.js";

export interface ReportRecord {
  id: string;
  question: string;
  status: "PENDING" | "GENERATING" | "COMPLETED" | "FAILED" | "INSUFFICIENT_DATA";
  markdown: string | null;
  summary: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  eventCount: number;
  itemCount: number;
  topicIds: string[];
  sourceIds: string[];
  coverageNote: string | null;
  generatedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export async function createReport(
  prisma: PrismaClient,
  scope: TenantScope,
  input: { question: string },
): Promise<ReportRecord> {
  const report = await prisma.report.create({
    data: {
      organizationId: scope.organizationId,
      question: input.question,
      status: "PENDING",
    },
  });

  return toReportRecord(report);
}

export async function getReport(
  prisma: PrismaClient,
  scope: TenantScope,
  reportId: string,
): Promise<ReportRecord | null> {
  const report = await prisma.report.findFirst({
    where: {
      id: reportId,
      organizationId: scope.organizationId,
    },
  });

  return report ? toReportRecord(report) : null;
}

export async function listReports(
  prisma: PrismaClient,
  scope: TenantScope,
  page: number,
  pageSize: number,
): Promise<{ reports: ReportRecord[]; total: number; page: number; pageCount: number }> {
  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where: { organizationId: scope.organizationId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.report.count({
      where: { organizationId: scope.organizationId },
    }),
  ]);

  return {
    reports: reports.map(toReportRecord),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function updateReportStatus(
  prisma: PrismaClient,
  reportId: string,
  status: "GENERATING" | "COMPLETED" | "FAILED" | "INSUFFICIENT_DATA",
): Promise<void> {
  await prisma.report.update({
    where: { id: reportId },
    data: { status },
  });
}

export async function completeReport(
  prisma: PrismaClient,
  reportId: string,
  input: {
    markdown: string;
    summary: string;
    rangeStart?: Date | null;
    rangeEnd?: Date | null;
    eventCount: number;
    itemCount: number;
    topicIds: string[];
    sourceIds: string[];
    coverageNote: string;
    metadata?: unknown;
  },
): Promise<void> {
  await prisma.report.update({
    where: { id: reportId },
    data: {
      status: "COMPLETED",
      markdown: input.markdown,
      summary: input.summary,
      rangeStart: input.rangeStart ?? null,
      rangeEnd: input.rangeEnd ?? null,
      eventCount: input.eventCount,
      itemCount: input.itemCount,
      topicIds: input.topicIds,
      sourceIds: input.sourceIds,
      coverageNote: input.coverageNote,
      generatedAt: new Date(),
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

/**
 * Mark a report as INSUFFICIENT_DATA when the evidence base does not meet the
 * generation threshold (see SPEC §5.8 / Issue #177). Writes the same payload
 * shape as `completeReport` but records the terminal `INSUFFICIENT_DATA`
 * status so UI can surface coverageNote + next-step guidance instead of
 * presenting a half-empty "completed" report.
 */
export async function completeInsufficientReport(
  prisma: PrismaClient,
  reportId: string,
  input: {
    markdown: string;
    summary: string;
    rangeStart?: Date | null;
    rangeEnd?: Date | null;
    eventCount: number;
    itemCount: number;
    topicIds: string[];
    sourceIds: string[];
    coverageNote: string;
    metadata?: unknown;
  },
): Promise<void> {
  await prisma.report.update({
    where: { id: reportId },
    data: {
      status: "INSUFFICIENT_DATA",
      markdown: input.markdown,
      summary: input.summary,
      rangeStart: input.rangeStart ?? null,
      rangeEnd: input.rangeEnd ?? null,
      eventCount: input.eventCount,
      itemCount: input.itemCount,
      topicIds: input.topicIds,
      sourceIds: input.sourceIds,
      coverageNote: input.coverageNote,
      generatedAt: new Date(),
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function failReport(
  prisma: PrismaClient,
  reportId: string,
  errorMessage: string,
): Promise<void> {
  await prisma.report.update({
    where: { id: reportId },
    data: { status: "FAILED", errorMessage },
  });
}

export async function listPendingReports(
  prisma: PrismaClient,
  limit = 10,
): Promise<Array<{ id: string; organizationId: string; question: string }>> {
  const reports = await prisma.report.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true, question: true },
  });
  return reports;
}

export interface ReportEvidenceEvent {
  eventId: string;
  title: string;
  summary: string;
  category: string | null;
  score: number;
  gravityScore: number;
  entities: string[];
  occurredAt: Date | null;
  topicId: string;
  topicName: string;
  sourceId: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceTrustScore: number | null;
  sourceQualityScore: number | null;
  primaryItemId: string | null;
  primaryItemUrl: string | null;
  primaryItemRawContent: string | null;
  primaryItemPublishedAt: Date | null;
}

export interface ReportEvidenceItem {
  itemId: string;
  eventId: string;
  topicId: string;
  sourceId: string;
  sourceName: string | null;
  sourceTrustScore: number | null;
  url: string;
  canonicalUrl: string;
  title: string;
  rawContent: string | null;
  publishedAt: Date | null;
}

export interface ReportEvidenceBriefing {
  briefingId: string;
  topicId: string;
  period: string;
  title: string;
  markdown: string | null;
  generatedAt: Date | null;
}

export interface ReportEvidenceSet {
  events: ReportEvidenceEvent[];
  items: ReportEvidenceItem[];
  briefings: ReportEvidenceBriefing[];
  eventCount: number;
  itemCount: number;
  briefingCount: number;
  topicIds: string[];
  sourceIds: string[];
  evidenceIds: string[];
}

export async function searchReportEvidenceEvents(
  prisma: PrismaClient,
  scope: TenantScope,
  query: {
    keywords: string[];
    rangeStart?: Date | null;
    rangeEnd?: Date | null;
    limit?: number;
  },
): Promise<ReportEvidenceEvent[]> {
  const events = await prisma.intelligenceEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      summaryStatus: "READY",
      status: { in: ["UNREAD", "READ", "SAVED"] },
      ...(query.rangeStart || query.rangeEnd
        ? {
            occurredAt: {
              ...(query.rangeStart ? { gte: query.rangeStart } : {}),
              ...(query.rangeEnd ? { lte: query.rangeEnd } : {}),
            },
          }
        : {}),
      ...(query.keywords.length > 0
        ? {
            OR: query.keywords.flatMap((kw) => [
              { title: { contains: kw, mode: "insensitive" as const } },
              { summary: { contains: kw, mode: "insensitive" as const } },
            ]),
          }
        : {}),
    },
    include: {
      topic: { select: { name: true } },
      primaryItem: {
        select: {
          id: true,
          url: true,
          rawContent: true,
          publishedAt: true,
          contentStatus: true,
          source: {
            select: {
              id: true,
              name: true,
              url: true,
              trustScore: true,
              qualityScore: true,
            },
          },
        },
      },
    },
    orderBy: [{ gravityScore: "desc" }, { occurredAt: "desc" }],
    take: query.limit ?? 30,
  });

  return events.map((event) => ({
    eventId: event.id,
    title: event.title,
    summary: event.summary,
    category: event.category,
    score: event.score,
    gravityScore: event.gravityScore,
    entities: event.entities,
    occurredAt: event.occurredAt,
    topicId: event.topicId,
    topicName: event.topic.name,
    sourceId: event.primaryItem?.source.id ?? null,
    sourceName: event.primaryItem?.source.name ?? null,
    sourceUrl: event.primaryItem?.source.url ?? null,
    sourceTrustScore: event.primaryItem?.source.trustScore ?? null,
    sourceQualityScore: event.primaryItem?.source.qualityScore ?? null,
    primaryItemId: event.primaryItem?.id ?? null,
    primaryItemUrl: event.primaryItem?.url ?? null,
    primaryItemRawContent: event.primaryItem?.rawContent ?? null,
    primaryItemPublishedAt: event.primaryItem?.publishedAt ?? null,
  }));
}

/**
 * Issue #178 — recall Item bodies (rawContent) that are associated with the
 * given event IDs through the EventItem join table. Returns primary items
 * first, then secondary merged items, so dedup keeps the most authoritative
 * copy when multiple events reference the same canonical URL.
 */
export async function searchReportEvidenceItems(
  prisma: PrismaClient,
  scope: TenantScope,
  query: { eventIds: string[]; limit?: number },
): Promise<ReportEvidenceItem[]> {
  if (query.eventIds.length === 0) return [];
  const rows = await prisma.eventItem.findMany({
    where: {
      event: {
        organizationId: scope.organizationId,
        id: { in: query.eventIds },
      },
    },
    select: {
      role: true,
      mergedAt: true,
      event: { select: { id: true, topicId: true } },
      item: {
        select: {
          id: true,
          url: true,
          canonicalUrl: true,
          title: true,
          rawContent: true,
          publishedAt: true,
          sourceId: true,
          source: {
            select: { name: true, trustScore: true },
          },
        },
      },
    },
    orderBy: { mergedAt: "asc" },
    take: query.limit ?? 60,
  });

  return rows.map((row) => ({
    itemId: row.item.id,
    eventId: row.event.id,
    topicId: row.event.topicId,
    sourceId: row.item.sourceId,
    sourceName: row.item.source.name,
    sourceTrustScore: row.item.source.trustScore,
    url: row.item.url,
    canonicalUrl: row.item.canonicalUrl,
    title: row.item.title,
    rawContent: row.item.rawContent,
    publishedAt: row.item.publishedAt,
  }));
}

/**
 * Issue #178 — recall Briefings whose event set overlaps the recalled events,
 * so the report can cite prior daily/weekly summaries as structured evidence.
 */
export async function searchReportEvidenceBriefings(
  prisma: PrismaClient,
  scope: TenantScope,
  query: { eventIds: string[]; limit?: number },
): Promise<ReportEvidenceBriefing[]> {
  if (query.eventIds.length === 0) return [];
  const rows = await prisma.briefing.findMany({
    where: {
      organizationId: scope.organizationId,
      events: { some: { id: { in: query.eventIds } } },
    },
    select: {
      id: true,
      topicId: true,
      period: true,
      title: true,
      markdown: true,
      generatedAt: true,
    },
    orderBy: { generatedAt: "desc" },
    take: query.limit ?? 10,
  });

  return rows.map((row) => ({
    briefingId: row.id,
    topicId: row.topicId,
    period: row.period,
    title: row.title,
    markdown: row.markdown,
    generatedAt: row.generatedAt,
  }));
}

/**
 * Issue #178 — assemble the full traceable evidence set for a topic report:
 * events (with source trust + primary item body), secondary Item bodies via
 * EventItem, and Briefings that referenced those events. Deduplicates Items
 * by canonicalUrl (keeps the first / highest-trust copy) and preserves every
 * evidence ID so the report can cite concrete provenance.
 *
 * No network calls — this only reads what the worker has already ingested.
 */
export async function collectReportEvidence(
  prisma: PrismaClient,
  scope: TenantScope,
  query: {
    keywords: string[];
    rangeStart?: Date | null;
    rangeEnd?: Date | null;
    eventLimit?: number;
    itemLimit?: number;
    briefingLimit?: number;
  },
): Promise<ReportEvidenceSet> {
  const events = await searchReportEvidenceEvents(prisma, scope, {
    keywords: query.keywords,
    rangeStart: query.rangeStart ?? null,
    rangeEnd: query.rangeEnd ?? null,
    limit: query.eventLimit ?? 30,
  });

  const eventIds = events.map((e) => e.eventId);
  const [rawItems, briefings] = await Promise.all([
    searchReportEvidenceItems(prisma, scope, {
      eventIds,
      limit: query.itemLimit ?? 60,
    }),
    searchReportEvidenceBriefings(prisma, scope, {
      eventIds,
      limit: query.briefingLimit ?? 10,
    }),
  ]);

  // Dedup items by canonicalUrl — keep the first occurrence (events are
  // ordered by gravityScore desc, so primary/higher-gravity events win).
  const seenCanonical = new Set<string>();
  const dedupedItems: ReportEvidenceItem[] = [];
  for (const item of rawItems) {
    if (item.canonicalUrl && seenCanonical.has(item.canonicalUrl)) continue;
    if (item.canonicalUrl) seenCanonical.add(item.canonicalUrl);
    dedupedItems.push(item);
  }

  const topicIds = Array.from(
    new Set([
      ...events.map((e) => e.topicId),
      ...dedupedItems.map((i) => i.topicId),
      ...briefings.map((b) => b.topicId),
    ]),
  );
  const sourceIds = Array.from(
    new Set(
      [
        ...events.map((e) => e.sourceId),
        ...dedupedItems.map((i) => i.sourceId),
      ].filter((id): id is string => Boolean(id)),
    ),
  );
  const evidenceIds = Array.from(
    new Set([
      ...events.map((e) => e.eventId),
      ...dedupedItems.map((i) => i.itemId),
      ...briefings.map((b) => b.briefingId),
    ]),
  );

  return {
    events,
    items: dedupedItems,
    briefings,
    eventCount: events.length,
    itemCount: dedupedItems.length,
    briefingCount: briefings.length,
    topicIds,
    sourceIds,
    evidenceIds,
  };
}

function toReportRecord(row: {
  id: string;
  question: string;
  status: "PENDING" | "GENERATING" | "COMPLETED" | "FAILED" | "INSUFFICIENT_DATA";
  markdown: string | null;
  summary: string | null;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  eventCount: number;
  itemCount: number;
  topicIds: string[];
  sourceIds: string[];
  coverageNote: string | null;
  generatedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}): ReportRecord {
  return {
    id: row.id,
    question: row.question,
    status: row.status,
    markdown: row.markdown,
    summary: row.summary,
    rangeStart: row.rangeStart?.toISOString() ?? null,
    rangeEnd: row.rangeEnd?.toISOString() ?? null,
    eventCount: row.eventCount,
    itemCount: row.itemCount,
    topicIds: row.topicIds,
    sourceIds: row.sourceIds,
    coverageNote: row.coverageNote,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}
