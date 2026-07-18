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
  primaryItemUrl: string | null;
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
          source: { select: { id: true, name: true, url: true } },
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
    primaryItemUrl: event.primaryItem?.url ?? null,
  }));
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
