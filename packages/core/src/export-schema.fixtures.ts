// Issue #186 — JSON export schema fixtures (RED → GREEN)
// 测试稳定版本化 JSON schema 的构建、序列化、解析往返。
import {
  buildEventExportJson,
  buildBriefingExportJson,
  buildTopicExportJson,
  serializeExportJson,
  parseExportJson,
  EXPORT_JSON_SCHEMA_VERSION,
  type ExportJsonEnvelope,
} from "./index.js";

export function runExportSchemaFixtures(): void {
  testEventJsonEnvelopeHasSchemaVersion();
  testBriefingJsonEnvelopeHasCorrectTarget();
  testTopicJsonIncludesAllEvents();
  testSerializeAndParseRoundTrip();
  testParseRejectsWrongSchemaVersion();
  testEventJsonPreservesNullFields();
}

function testEventJsonEnvelopeHasSchemaVersion(): void {
  const json = buildEventExportJson({
    exportedAt: new Date("2026-07-20T00:00:00.000Z"),
    topic: { id: "topic-1", name: "中国商业航空进展" },
    event: {
      eventId: "evt-1",
      title: "C919 商业运营进展",
      summary: "C919 完成首次商业飞行。",
      category: "商业运营",
      score: 88,
      explanation: "中国商飞交付里程碑。",
      followUpSuggestion: "跟踪后续航线开通。",
      occurredAt: new Date("2026-07-19T00:00:00.000Z"),
      entities: ["中国商飞", "东航"],
      sourceName: "中国商飞",
      sourceUrl: "https://comac.com",
      url: "https://example.com/c919",
    },
  });

  assert(
    json.schemaVersion === EXPORT_JSON_SCHEMA_VERSION,
    `schemaVersion must be ${EXPORT_JSON_SCHEMA_VERSION}, got ${json.schemaVersion}`,
  );
  assert(json.target === "event", "Event export target must be 'event'");
  assert(json.format === "JSON", "Format must be 'JSON'");
  assert(json.topic.name === "中国商业航空进展", "Topic name must be preserved");
  assert(
    (json.data as { eventId: string }).eventId === "evt-1",
    "Event ID must be in data",
  );
}

function testBriefingJsonEnvelopeHasCorrectTarget(): void {
  const json = buildBriefingExportJson({
    exportedAt: new Date("2026-07-20T00:00:00.000Z"),
    topic: { id: "topic-1", name: "AI 基础设施" },
    briefing: {
      briefingId: "brf-1",
      title: "AI 基础设施｜每日简报",
      period: "DAILY",
      rangeStart: new Date("2026-07-19T00:00:00.000Z"),
      rangeEnd: new Date("2026-07-20T00:00:00.000Z"),
      generatedAt: new Date("2026-07-20T00:00:00.000Z"),
      markdown: "# AI 基础设施简报\n\n...",
      events: [
        { eventId: "evt-1", title: "OpenAI 发布新产品", occurredAt: new Date("2026-07-19T00:00:00.000Z") },
      ],
    },
  });

  assert(json.target === "briefing", "Target must be 'briefing'");
  const data = json.data as { period: string; events: unknown[] };
  assert(data.period === "DAILY", "Period must be DAILY");
  assert(data.events.length === 1, "Events array must have 1 entry");
}

function testTopicJsonIncludesAllEvents(): void {
  const json = buildTopicExportJson({
    exportedAt: new Date("2026-07-20T00:00:00.000Z"),
    topic: { id: "topic-1", name: "中国商业航空" },
    events: [
      {
        eventId: "evt-1",
        title: "C919 首飞",
        summary: "C919 完成首飞。",
        category: "商业运营",
        score: 90,
        explanation: "里程碑",
        followUpSuggestion: null,
        occurredAt: null,
        entities: [],
        sourceName: null,
        sourceUrl: null,
        url: null,
      },
      {
        eventId: "evt-2",
        title: "ARJ21 交付",
        summary: "ARJ21 交付给成都航空。",
        category: "交付",
        score: 75,
        explanation: null,
        followUpSuggestion: null,
        occurredAt: new Date("2026-07-18T00:00:00.000Z"),
        entities: ["成都航空"],
        sourceName: "民航局",
        sourceUrl: "https://caac.gov.cn",
        url: "https://example.com/arj21",
      },
    ],
  });

  assert(json.target === "topic", "Target must be 'topic'");
  const data = json.data as { eventCount: number; events: { eventId: string }[] };
  assert(data.eventCount === 2, "Event count must be 2");
  assert(data.events.length === 2, "Events array must have 2 entries");
  assert(data.events[1]!.eventId === "evt-2", "Second event ID must be evt-2");
}

function testSerializeAndParseRoundTrip(): void {
  const original = buildEventExportJson({
    exportedAt: new Date("2026-07-20T00:00:00.000Z"),
    topic: { id: "topic-1", name: "测试主题" },
    event: {
      eventId: "evt-rt",
      title: "往返测试",
      summary: "序列化与解析往返。",
      category: null,
      score: 50,
      explanation: null,
      followUpSuggestion: null,
      occurredAt: null,
      entities: [],
      sourceName: null,
      sourceUrl: null,
      url: null,
    },
  });

  const text = serializeExportJson(original);
  const parsed = parseExportJson(text) as ExportJsonEnvelope;

  assert(parsed.schemaVersion === original.schemaVersion, "Round-trip schemaVersion must match");
  assert(parsed.target === original.target, "Round-trip target must match");
  const origData = original.data as { eventId: string };
  const parsedData = parsed.data as { eventId: string };
  assert(parsedData.eventId === origData.eventId, "Round-trip eventId must match");
}

function testParseRejectsWrongSchemaVersion(): void {
  const bad = JSON.stringify({
    schemaVersion: 999,
    exportedAt: "2026-07-20T00:00:00.000Z",
    target: "event",
    format: "JSON",
    topic: { id: "t", name: "t" },
    data: {},
  });

  let threw = false;
  try {
    parseExportJson(bad);
  } catch {
    threw = true;
  }
  assert(threw, "parseExportJson must reject wrong schemaVersion");
}

function testEventJsonPreservesNullFields(): void {
  const json = buildEventExportJson({
    exportedAt: new Date("2026-07-20T00:00:00.000Z"),
    topic: { id: "topic-1", name: "空值测试" },
    event: {
      eventId: "evt-null",
      title: "空值字段测试",
      summary: "测试 null 字段保留。",
      category: null,
      score: 0,
      explanation: null,
      followUpSuggestion: null,
      occurredAt: null,
      entities: [],
      sourceName: null,
      sourceUrl: null,
      url: null,
    },
  });

  const data = json.data as {
    category: string | null;
    explanation: string | null;
    occurredAt: string | null;
    url: string | null;
    source: { name: string | null; url: string | null };
  };

  assert(data.category === null, "category null must be preserved");
  assert(data.explanation === null, "explanation null must be preserved");
  assert(data.occurredAt === null, "occurredAt null must be preserved");
  assert(data.url === null, "url null must be preserved");
  assert(data.source.name === null, "source.name null must be preserved");
  assert(data.source.url === null, "source.url null must be preserved");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Export schema fixture failed: ${message}`);
}