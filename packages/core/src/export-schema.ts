// SPEC §5.7 知识库导出 — 稳定版本化 JSON schema。
// 导出对象：单条情报 (event)、主题简报 (briefing)、主题批量 (topic)。
// JSON schema 有版本号 (schemaVersion)，向前兼容承诺：只增字段，不删不改语义。

export const EXPORT_JSON_SCHEMA_VERSION = 1 as const;

export type ExportTarget = "event" | "briefing" | "topic" | "timeline" | "saved";
export type ExportFormat = "MARKDOWN" | "JSON" | "PDF";

export interface ExportJsonEnvelope {
  schemaVersion: typeof EXPORT_JSON_SCHEMA_VERSION;
  exportedAt: string; // ISO 8601
  target: ExportTarget;
  format: "JSON";
  topic: {
    id: string;
    name: string;
  };
  data: ExportEventData | ExportBriefingData | ExportTopicData | ExportTimelineData | ExportSavedData;
}

export interface ExportEventData {
  eventId: string;
  title: string;
  summary: string;
  category: string | null;
  score: number;
  explanation: string | null;
  followUpSuggestion: string | null;
  occurredAt: string | null; // ISO 8601
  entities: string[];
  source: {
    name: string | null;
    url: string | null;
  };
  url: string | null;
}

export interface ExportBriefingData {
  briefingId: string;
  title: string;
  period: "DAILY" | "WEEKLY" | "MONTHLY";
  rangeStart: string; // ISO 8601
  rangeEnd: string; // ISO 8601
  generatedAt: string; // ISO 8601
  markdown: string | null;
  events: Array<{
    eventId: string;
    title: string;
    occurredAt: string | null;
  }>;
}

export interface ExportTopicData {
  topicId: string;
  topicName: string;
  eventCount: number;
  events: ExportEventData[];
}

// Issue #187 — Timeline 全量导出。
// Timeline 是主题级时间线（组织级视图，不按个人阅读状态过滤），
// 与 topic 批量导出的区别：timeline 不限制 100 条上限，全量导出。
export interface ExportTimelineData {
  topicId: string;
  topicName: string;
  eventCount: number;
  events: ExportEventData[];
}

// Issue #187 — Saved collection 导出。
// 当前用户 saved 集合（user-scoped），跨主题，严格按 UserItemState.saved=true 过滤。
export interface ExportSavedData {
  userId: string;
  eventCount: number;
  events: ExportEventData[];
}

export function buildEventExportJson(input: {
  exportedAt: Date;
  topic: { id: string; name: string };
  event: {
    eventId: string;
    title: string;
    summary: string;
    category: string | null;
    score: number;
    explanation: string | null;
    followUpSuggestion: string | null;
    occurredAt: Date | null;
    entities: string[];
    sourceName: string | null;
    sourceUrl: string | null;
    url: string | null;
  };
}): ExportJsonEnvelope {
  return {
    schemaVersion: EXPORT_JSON_SCHEMA_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    target: "event",
    format: "JSON",
    topic: input.topic,
    data: {
      eventId: input.event.eventId,
      title: input.event.title,
      summary: input.event.summary,
      category: input.event.category,
      score: input.event.score,
      explanation: input.event.explanation,
      followUpSuggestion: input.event.followUpSuggestion,
      occurredAt: input.event.occurredAt?.toISOString() ?? null,
      entities: input.event.entities,
      source: {
        name: input.event.sourceName,
        url: input.event.sourceUrl,
      },
      url: input.event.url,
    },
  };
}

export function buildBriefingExportJson(input: {
  exportedAt: Date;
  topic: { id: string; name: string };
  briefing: {
    briefingId: string;
    title: string;
    period: "DAILY" | "WEEKLY" | "MONTHLY";
    rangeStart: Date;
    rangeEnd: Date;
    generatedAt: Date;
    markdown: string | null;
    events: Array<{
      eventId: string;
      title: string;
      occurredAt: Date | null;
    }>;
  };
}): ExportJsonEnvelope {
  return {
    schemaVersion: EXPORT_JSON_SCHEMA_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    target: "briefing",
    format: "JSON",
    topic: input.topic,
    data: {
      briefingId: input.briefing.briefingId,
      title: input.briefing.title,
      period: input.briefing.period,
      rangeStart: input.briefing.rangeStart.toISOString(),
      rangeEnd: input.briefing.rangeEnd.toISOString(),
      generatedAt: input.briefing.generatedAt.toISOString(),
      markdown: input.briefing.markdown,
      events: input.briefing.events.map((e) => ({
        eventId: e.eventId,
        title: e.title,
        occurredAt: e.occurredAt?.toISOString() ?? null,
      })),
    },
  };
}

export function buildTopicExportJson(input: {
  exportedAt: Date;
  topic: { id: string; name: string };
  events: Array<{
    eventId: string;
    title: string;
    summary: string;
    category: string | null;
    score: number;
    explanation: string | null;
    followUpSuggestion: string | null;
    occurredAt: Date | null;
    entities: string[];
    sourceName: string | null;
    sourceUrl: string | null;
    url: string | null;
  }>;
}): ExportJsonEnvelope {
  return {
    schemaVersion: EXPORT_JSON_SCHEMA_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    target: "topic",
    format: "JSON",
    topic: input.topic,
    data: {
      topicId: input.topic.id,
      topicName: input.topic.name,
      eventCount: input.events.length,
      events: input.events.map((event) => ({
        eventId: event.eventId,
        title: event.title,
        summary: event.summary,
        category: event.category,
        score: event.score,
        explanation: event.explanation,
        followUpSuggestion: event.followUpSuggestion,
        occurredAt: event.occurredAt?.toISOString() ?? null,
        entities: event.entities,
        source: {
          name: event.sourceName,
          url: event.sourceUrl,
        },
        url: event.url,
      })),
    },
  };
}

// Issue #187 - Timeline/Saved export JSON builders.
// 复用 ExportEventData 结构，仅 envelope target 不同。
export function buildTimelineExportJson(input: {
  exportedAt: Date;
  topic: { id: string; name: string };
  events: Array<{
    eventId: string;
    title: string;
    summary: string;
    category: string | null;
    score: number;
    explanation: string | null;
    followUpSuggestion: string | null;
    occurredAt: Date | null;
    entities: string[];
    sourceName: string | null;
    sourceUrl: string | null;
    url: string | null;
  }>;
}): ExportJsonEnvelope {
  return {
    schemaVersion: EXPORT_JSON_SCHEMA_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    target: "timeline",
    format: "JSON",
    topic: input.topic,
    data: {
      topicId: input.topic.id,
      topicName: input.topic.name,
      eventCount: input.events.length,
      events: mapEventsToExportData(input.events),
    },
  };
}

export function buildSavedExportJson(input: {
  exportedAt: Date;
  topic: { id: string; name: string };
  userId: string;
  events: Array<{
    eventId: string;
    title: string;
    summary: string;
    category: string | null;
    score: number;
    explanation: string | null;
    followUpSuggestion: string | null;
    occurredAt: Date | null;
    entities: string[];
    sourceName: string | null;
    sourceUrl: string | null;
    url: string | null;
  }>;
}): ExportJsonEnvelope {
  return {
    schemaVersion: EXPORT_JSON_SCHEMA_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    target: "saved",
    format: "JSON",
    topic: input.topic,
    data: {
      userId: input.userId,
      eventCount: input.events.length,
      events: mapEventsToExportData(input.events),
    },
  };
}

function mapEventsToExportData(
  events: Array<{
    eventId: string;
    title: string;
    summary: string;
    category: string | null;
    score: number;
    explanation: string | null;
    followUpSuggestion: string | null;
    occurredAt: Date | null;
    entities: string[];
    sourceName: string | null;
    sourceUrl: string | null;
    url: string | null;
  }>,
): ExportEventData[] {
  return events.map((event) => ({
    eventId: event.eventId,
    title: event.title,
    summary: event.summary,
    category: event.category,
    score: event.score,
    explanation: event.explanation,
    followUpSuggestion: event.followUpSuggestion,
    occurredAt: event.occurredAt?.toISOString() ?? null,
    entities: event.entities,
    source: {
      name: event.sourceName,
      url: event.sourceUrl,
    },
    url: event.url,
  }));
}

export function serializeExportJson(envelope: ExportJsonEnvelope): string {
  return JSON.stringify(envelope, null, 2) + "\n";
}

export function parseExportJson(text: string): ExportJsonEnvelope {
  const parsed = JSON.parse(text) as ExportJsonEnvelope;
  if (parsed.schemaVersion !== EXPORT_JSON_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported export JSON schemaVersion: ${parsed.schemaVersion}, expected ${EXPORT_JSON_SCHEMA_VERSION}`,
    );
  }
  return parsed;
}