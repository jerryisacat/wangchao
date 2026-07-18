/**
 * Worker report orchestration fixtures for Issue #177.
 *
 * Verifies the SPEC §5.8 ReportStatus state machine is correctly persisted when
 * evidence is insufficient: the report MUST land in INSUFFICIENT_DATA (not the
 * bug behaviour of marking it COMPLETED with a coverageNote), and re-running
 * generation on a terminal report MUST be idempotent (no further writes).
 *
 * Tests inject a fake prisma + stubbed db ops through `ReportGenerationDeps`,
 * so no real database or LLM adapter is required. The production code path
 * (no deps) is untouched and exercised by the Railway cron.
 */
import { runReportGeneration, type ReportGenerationDeps } from "./report.js";
import { getPrismaClient, type ReportEvidenceSet } from "@wangchao/db";

type PrismaClientLike = ReturnType<typeof getPrismaClient>;
type ReportStatus = "PENDING" | "GENERATING" | "COMPLETED" | "FAILED" | "INSUFFICIENT_DATA";

interface FakeReportRow {
  id: string;
  organizationId: string;
  question: string;
  status: ReportStatus;
  markdown: string | null;
  summary: string | null;
  eventCount: number;
  itemCount: number;
  topicIds: string[];
  sourceIds: string[];
  coverageNote: string | null;
  generatedAt: Date | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

interface FakeTaskRunRow {
  id: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  output: Record<string, unknown> | null;
  errorMessage: string | null;
}

interface FakeEventRow {
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
  primaryItemUrl: string | null;
  primaryItemRawContent: string | null;
  primaryItemPublishedAt: Date | null;
}

interface FakeItemRow {
  itemId: string;
  eventId: string;
  topicId: string;
  sourceId: string;
  url: string;
  canonicalUrl: string;
  title: string;
  rawContent: string | null;
  publishedAt: Date | null;
  sourceName: string | null;
  sourceTrustScore: number | null;
}

interface FakeBriefingRow {
  briefingId: string;
  topicId: string;
  period: string;
  title: string;
  markdown: string | null;
  generatedAt: Date | null;
}

interface FakeEvidenceSet {
  events: FakeEventRow[];
  items: FakeItemRow[];
  briefings: FakeBriefingRow[];
  eventCount: number;
  itemCount: number;
  briefingCount: number;
  topicIds: string[];
  sourceIds: string[];
  evidenceIds: string[];
}

interface FakePrismaState {
  reports: FakeReportRow[];
  taskRuns: FakeTaskRunRow[];
  reportUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  taskRunCreates: number;
  taskRunUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  usageEvents: number;
  searchEvents: FakeEventRow[];
  evidenceSet: FakeEvidenceSet | null;
  aiPrompt: string | null;
}

function makeFakeReport(over: Partial<FakeReportRow> & { id: string }): FakeReportRow {
  return {
    id: over.id,
    organizationId: over.organizationId ?? "org-1",
    question: over.question ?? "OpenAI 最近有什么进展？",
    status: over.status ?? "PENDING",
    markdown: over.markdown ?? null,
    summary: over.summary ?? null,
    eventCount: over.eventCount ?? 0,
    itemCount: over.itemCount ?? 0,
    topicIds: over.topicIds ?? [],
    sourceIds: over.sourceIds ?? [],
    coverageNote: over.coverageNote ?? null,
    generatedAt: over.generatedAt ?? null,
    errorMessage: over.errorMessage ?? null,
    metadata: over.metadata ?? null,
  };
}

function makeFakeEvent(id: string, topicId = "topic-1"): FakeEventRow {
  return {
    eventId: id,
    title: `Event ${id}`,
    summary: `Summary for ${id}`,
    category: "news",
    score: 70,
    gravityScore: 70,
    entities: [],
    occurredAt: new Date("2026-07-18T10:00:00.000Z"),
    topicId,
    topicName: "Test Topic",
    sourceId: `source-${id}`,
    sourceName: `Source ${id}`,
    sourceUrl: `https://example.com/source-${id}`,
    sourceTrustScore: 0.8,
    sourceQualityScore: 0.7,
    primaryItemUrl: `https://example.com/item-${id}`,
    primaryItemRawContent: `Raw content for ${id}. This is the captured article body.`,
    primaryItemPublishedAt: new Date("2026-07-17T08:00:00.000Z"),
  };
}

function createFakePrisma(state: FakePrismaState): PrismaClientLike {
  const prisma = {
    report: {
      findFirst: async ({ where }: { where: { id?: string; organizationId?: string } }) =>
        state.reports.find(
          (r) => r.id === where.id && r.organizationId === where.organizationId,
        ) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const target = state.reports.find((r) => r.id === where.id);
        if (target) {
          Object.assign(target, data);
          state.reportUpdates.push({ id: where.id, data });
        }
        return target;
      },
    },
    taskRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.taskRunCreates += 1;
        const row: FakeTaskRunRow = {
          id: `taskrun-${state.taskRunCreates}`,
          status: "RUNNING",
          output: null,
          errorMessage: null,
        };
        state.taskRuns.push(row);
        void data;
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const target = state.taskRuns.find((t) => t.id === where.id);
        if (target) {
          Object.assign(target, data);
          state.taskRunUpdates.push({ id: where.id, data });
        }
        return target;
      },
    },
  } as unknown as PrismaClientLike;
  return prisma;
}

function createDeps(state: FakePrismaState, prisma: PrismaClientLike): ReportGenerationDeps {
  return {
    prisma,
    updateReportStatus: async (_p, reportId, status) => {
      const target = state.reports.find((r) => r.id === reportId);
      if (target) {
        target.status = status;
        state.reportUpdates.push({ id: reportId, data: { status } });
      }
    },
    completeReport: async (_p, reportId, input) => {
      const target = state.reports.find((r) => r.id === reportId);
      if (target) {
        target.status = "COMPLETED";
        target.markdown = input.markdown;
        target.summary = input.summary;
        target.eventCount = input.eventCount;
        target.itemCount = input.itemCount;
        target.topicIds = input.topicIds;
        target.sourceIds = input.sourceIds;
        target.coverageNote = input.coverageNote;
        target.metadata = (input.metadata as Record<string, unknown>) ?? null;
        target.generatedAt = new Date();
        state.reportUpdates.push({ id: reportId, data: { status: "COMPLETED" } });
      }
    },
    completeInsufficientReport: async (_p, reportId, input) => {
      const target = state.reports.find((r) => r.id === reportId);
      if (target) {
        target.status = "INSUFFICIENT_DATA";
        target.markdown = input.markdown;
        target.summary = input.summary;
        target.eventCount = input.eventCount;
        target.itemCount = input.itemCount;
        target.topicIds = input.topicIds;
        target.sourceIds = input.sourceIds;
        target.coverageNote = input.coverageNote;
        target.metadata = (input.metadata as Record<string, unknown>) ?? null;
        target.generatedAt = new Date();
        state.reportUpdates.push({ id: reportId, data: { status: "INSUFFICIENT_DATA" } });
      }
    },
    failReport: async (_p, reportId, errorMessage) => {
      const target = state.reports.find((r) => r.id === reportId);
      if (target) {
        target.status = "FAILED";
        target.errorMessage = errorMessage;
        state.reportUpdates.push({ id: reportId, data: { status: "FAILED" } });
      }
    },
    createTaskRun: async (_p, _input) => {
      state.taskRunCreates += 1;
      const row: FakeTaskRunRow = {
        id: `taskrun-${state.taskRunCreates}`,
        status: "RUNNING",
        output: null,
        errorMessage: null,
      };
      state.taskRuns.push(row);
      return { id: row.id };
    },
    completeTaskRun: async (_p, taskRunId, output) => {
      const target = state.taskRuns.find((t) => t.id === taskRunId);
      if (target) {
        target.status = "SUCCEEDED";
        target.output = output;
        state.taskRunUpdates.push({ id: taskRunId, data: { status: "SUCCEEDED" } });
      }
    },
    failTaskRun: async (_p, taskRunId) => {
      const target = state.taskRuns.find((t) => t.id === taskRunId);
      if (target) {
        target.status = "FAILED";
        state.taskRunUpdates.push({ id: taskRunId, data: { status: "FAILED" } });
      }
    },
    collectReportEvidence: async () =>
      (state.evidenceSet ?? {
        events: state.searchEvents,
        items: [],
        briefings: [],
        eventCount: state.searchEvents.length,
        itemCount: 0,
        briefingCount: 0,
        topicIds: Array.from(new Set(state.searchEvents.map((e) => e.topicId))),
        sourceIds: Array.from(
          new Set(state.searchEvents.map((e) => e.sourceId).filter(Boolean)),
        ) as string[],
        evidenceIds: state.searchEvents.map((e) => e.eventId),
      }) as unknown as ReportEvidenceSet,
    recordUsageEvent: async () => {
      state.usageEvents += 1;
    },
    resolveAiRuntime: async () => null,
  };
}

export async function runReportGenerationFixtures(): Promise<void> {
  await testInsufficientEvidenceLandsInsufficientDataStatus();
  await testInsufficientReportIsIdempotentOnRerun();
  await testSufficientEvidenceLandsCompletedStatus();
  await testZeroEventsLandsInsufficientData();
  await testEvidenceSetPersistsRealCountsAndProvenance();
  await testAiPromptCarriesEvidenceProvenance();
  await testInsufficientDataPersistsEvidenceIdsAndRealCount();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function testInsufficientEvidenceLandsInsufficientDataStatus(): Promise<void> {
  // 2 events < threshold 3. MUST persist INSUFFICIENT_DATA, never COMPLETED.
  const state: FakePrismaState = {
    reports: [makeFakeReport({ id: "r1", status: "PENDING" })],
    taskRuns: [],
    reportUpdates: [],
    taskRunCreates: 0,
    taskRunUpdates: [],
    usageEvents: 0,
    searchEvents: [makeFakeEvent("e1"), makeFakeEvent("e2")],
    evidenceSet: null,
    aiPrompt: null,
  };
  const prisma = createFakePrisma(state);
  await runReportGeneration(
    { reportId: "r1", organizationId: "org-1", userId: "test" },
    createDeps(state, prisma),
  );

  const report = state.reports[0]!;
  assert(
    report.status === "INSUFFICIENT_DATA",
    `Insufficient evidence MUST land INSUFFICIENT_DATA, got ${report.status}.`,
  );
  assert(
    report.coverageNote !== null && report.coverageNote.includes("2 条相关事件"),
    `coverageNote must explain the shortfall, got: ${report.coverageNote}`,
  );
  assert(
    !state.reportUpdates.some((u) => u.data.status === "COMPLETED"),
    "Insufficient-evidence path must NEVER write COMPLETED status (the #177 bug).",
  );
  // Idempotency: no AI usage event when insufficient.
  assert(state.usageEvents === 0, "Insufficient path must not record an AI usage event.");
}

async function testInsufficientReportIsIdempotentOnRerun(): Promise<void> {
  // Report already terminal (INSUFFICIENT_DATA). Re-running generation must
  // NOT issue any further report updates — the PENDING guard returns early.
  const state: FakePrismaState = {
    reports: [
      makeFakeReport({
        id: "r2",
        status: "INSUFFICIENT_DATA",
        coverageNote: "情报库中仅找到 1 条相关事件（建议阈值 ≥ 3）。",
        generatedAt: new Date("2026-07-18T10:00:00.000Z"),
      }),
    ],
    taskRuns: [],
    reportUpdates: [],
    taskRunCreates: 0,
    taskRunUpdates: [],
    usageEvents: 0,
    searchEvents: [makeFakeEvent("e1")],
    evidenceSet: null,
    aiPrompt: null,
  };
  const prisma = createFakePrisma(state);
  const updatesBefore = state.reportUpdates.length;
  await runReportGeneration(
    { reportId: "r2", organizationId: "org-1", userId: "test" },
    createDeps(state, prisma),
  );

  assert(
    state.reportUpdates.length === updatesBefore,
    `Re-running a terminal report must not write any updates, got ${state.reportUpdates.length - updatesBefore} new writes.`,
  );
  assert(state.taskRunCreates === 0, "Re-running a terminal report must not create a TaskRun.");
  assert(state.usageEvents === 0, "Re-running a terminal report must not record usage.");

  // Also assert COMPLETED and FAILED terminals are equally idempotent.
  for (const terminal of ["COMPLETED", "FAILED"] as const) {
    const s: FakePrismaState = {
      reports: [makeFakeReport({ id: `r-${terminal}`, status: terminal })],
      taskRuns: [],
      reportUpdates: [],
      taskRunCreates: 0,
      taskRunUpdates: [],
      usageEvents: 0,
      searchEvents: [],
      evidenceSet: null,
      aiPrompt: null,
    };
    const p = createFakePrisma(s);
    await runReportGeneration(
      { reportId: `r-${terminal}`, organizationId: "org-1", userId: "test" },
      createDeps(s, p),
    );
    assert(s.taskRunCreates === 0, `Terminal ${terminal} must not create a TaskRun on rerun.`);
    assert(s.reportUpdates.length === 0, `Terminal ${terminal} must not update the report on rerun.`);
  }
}

async function testSufficientEvidenceLandsCompletedStatus(): Promise<void> {
  // 5 events ≥ threshold. MUST persist COMPLETED (regression guard: the fix
  // must not accidentally route sufficient evidence into INSUFFICIENT_DATA).
  const state: FakePrismaState = {
    reports: [makeFakeReport({ id: "r3", status: "PENDING" })],
    taskRuns: [],
    reportUpdates: [],
    taskRunCreates: 0,
    taskRunUpdates: [],
    usageEvents: 0,
    searchEvents: Array.from({ length: 5 }, (_, i) => makeFakeEvent(`e${i + 1}`)),
    evidenceSet: null,
    aiPrompt: null,
  };
  const prisma = createFakePrisma(state);
  await runReportGeneration(
    { reportId: "r3", organizationId: "org-1", userId: "test" },
    createDeps(state, prisma),
  );

  const report = state.reports[0]!;
  assert(
    report.status === "COMPLETED",
    `Sufficient evidence MUST land COMPLETED, got ${report.status}.`,
  );
  assert(state.usageEvents === 1, "Sufficient path must record exactly one AI usage event.");
  assert(
    report.markdown !== null && report.markdown.length > 0,
    "Completed report must have non-empty markdown body.",
  );
}

async function testZeroEventsLandsInsufficientData(): Promise<void> {
  const state: FakePrismaState = {
    reports: [makeFakeReport({ id: "r4", status: "PENDING" })],
    taskRuns: [],
    reportUpdates: [],
    taskRunCreates: 0,
    taskRunUpdates: [],
    usageEvents: 0,
    searchEvents: [],
    evidenceSet: null,
    aiPrompt: null,
  };
  const prisma = createFakePrisma(state);
  await runReportGeneration(
    { reportId: "r4", organizationId: "org-1", userId: "test" },
    createDeps(state, prisma),
  );

  const report = state.reports[0]!;
  assert(
    report.status === "INSUFFICIENT_DATA",
    `Zero-evidence case MUST land INSUFFICIENT_DATA, got ${report.status}.`,
  );
}

// ─── Issue #178: evidence set provenance ───

/**
 * #178: When items with rawContent and briefings are recalled, the persisted
 * report MUST carry a real itemCount (distinct from eventCount), a
 * briefingCount in metadata, and evidenceIds that reference every contributing
 * event / item / briefing. This catches the #178 bug where itemCount was
 * hard-wired to events.length and items/briefings were silently dropped.
 */
async function testEvidenceSetPersistsRealCountsAndProvenance(): Promise<void> {
  const events = [makeFakeEvent("e1"), makeFakeEvent("e2"), makeFakeEvent("e3")];
  const items: FakeItemRow[] = [
    {
      itemId: "item-1",
      eventId: "e1",
      topicId: "topic-1",
      sourceId: "source-e1",
      url: "https://example.com/item-1",
      canonicalUrl: "https://example.com/item-1",
      title: "Item 1",
      rawContent: "正文内容 item-1",
      publishedAt: new Date("2026-07-17T08:00:00.000Z"),
      sourceName: "Source e1",
      sourceTrustScore: 0.8,
    },
    {
      // Dedup test: same canonicalUrl as item-1, must collapse to one entry.
      itemId: "item-1-dup",
      eventId: "e2",
      topicId: "topic-1",
      sourceId: "source-e2",
      url: "https://example.com/item-1",
      canonicalUrl: "https://example.com/item-1",
      title: "Item 1 dup",
      rawContent: "正文内容 item-1 dup",
      publishedAt: new Date("2026-07-17T09:00:00.000Z"),
      sourceName: "Source e2",
      sourceTrustScore: 0.6,
    },
    {
      itemId: "item-2",
      eventId: "e3",
      topicId: "topic-1",
      sourceId: "source-e3",
      url: "https://example.com/item-2",
      canonicalUrl: "https://example.com/item-2",
      title: "Item 2",
      rawContent: "正文内容 item-2",
      publishedAt: null,
      sourceName: "Source e3",
      sourceTrustScore: 0.9,
    },
  ];
  const briefings: FakeBriefingRow[] = [
    {
      briefingId: "b1",
      topicId: "topic-1",
      period: "DAILY",
      title: "Daily Briefing 2026-07-18",
      markdown: "# 简报\n\n今日要点。",
      generatedAt: new Date("2026-07-18T02:00:00.000Z"),
    },
  ];
  const state: FakePrismaState = {
    reports: [makeFakeReport({ id: "r5", status: "PENDING" })],
    taskRuns: [],
    reportUpdates: [],
    taskRunCreates: 0,
    taskRunUpdates: [],
    usageEvents: 0,
    searchEvents: events,
    evidenceSet: {
      events,
      // After dedup by canonicalUrl, item-1-dup collapses into item-1.
      items: [items[0]!, items[2]!],
      briefings,
      eventCount: events.length,
      itemCount: 2,
      briefingCount: 1,
      topicIds: ["topic-1"],
      sourceIds: ["source-e1", "source-e2", "source-e3"],
      evidenceIds: ["e1", "e2", "e3", "item-1", "item-2", "b1"],
    },
    aiPrompt: null,
  };
  const prisma = createFakePrisma(state);
  await runReportGeneration(
    { reportId: "r5", organizationId: "org-1", userId: "test" },
    createDeps(state, prisma),
  );

  const report = state.reports[0]!;
  assert(
    report.status === "COMPLETED",
    `Sufficient evidence with items/briefings MUST land COMPLETED, got ${report.status}.`,
  );
  assert(
    report.itemCount === 2,
    `itemCount MUST reflect real deduplicated Item count (expected 2, got ${report.itemCount}). The #178 bug hard-wired itemCount = events.length (${events.length}).`,
  );
  assert(
    report.eventCount === events.length,
    `eventCount MUST equal recalled events (${events.length}), got ${report.eventCount}.`,
  );
  const meta = report.metadata as { briefingCount?: number; evidenceIds?: string[] } | null;
  assert(
    meta !== null && meta.briefingCount === 1,
    `metadata.briefingCount MUST record real briefing count (expected 1, got ${meta?.briefingCount}).`,
  );
  assert(
    meta !== null && Array.isArray(meta.evidenceIds) && meta.evidenceIds!.length === 6,
    `metadata.evidenceIds MUST list all contributing event/item/briefing IDs (expected 6, got ${meta?.evidenceIds?.length}).`,
  );
}

/**
 * #178: When AI runtime is available, the prompt fed to the LLM MUST carry
 * evidence provenance (IDs, URLs, timestamps, trust) so the model can cite
 * concrete sources instead of hallucinating. We inject a fake AI adapter that
 * captures the prompt and asserts provenance fields are present.
 */
async function testAiPromptCarriesEvidenceProvenance(): Promise<void> {
  const events = [makeFakeEvent("e1"), makeFakeEvent("e2"), makeFakeEvent("e3")];
  const state: FakePrismaState = {
    reports: [makeFakeReport({ id: "r6", status: "PENDING" })],
    taskRuns: [],
    reportUpdates: [],
    taskRunCreates: 0,
    taskRunUpdates: [],
    usageEvents: 0,
    searchEvents: events,
    evidenceSet: {
      events,
      items: [],
      briefings: [],
      eventCount: events.length,
      itemCount: 0,
      briefingCount: 0,
      topicIds: ["topic-1"],
      sourceIds: ["source-e1", "source-e2", "source-e3"],
      evidenceIds: ["e1", "e2", "e3"],
    },
    aiPrompt: null,
  };
  const prisma = createFakePrisma(state);
  const deps = createDeps(state, prisma);
  // Inject a fake AI runtime that captures the user prompt.
  deps.resolveAiRuntime = async () => ({
    adapter: {
      chat: async (args: { messages: Array<{ role: string; content: string }> }) => {
        const userMsg = args.messages.find((m) => m.role === "user");
        if (userMsg) state.aiPrompt = userMsg.content;
        return { content: "## 1. 摘要判断\n\n基于 [E1] 的报告。" };
      },
    } as never,
    model: "test-model",
  });
  await runReportGeneration(
    { reportId: "r6", organizationId: "org-1", userId: "test" },
    deps,
  );

  assert(state.aiPrompt !== null, "AI path must have been exercised (prompt captured).");
  const prompt = state.aiPrompt!;
  // Evidence IDs referenced.
  assert(prompt.includes("E1") || prompt.includes("e1"), "Prompt must reference evidence IDs (e.g. E1).");
  // Source URLs referenced.
  assert(
    prompt.includes("https://example.com/source-e1"),
    "Prompt must carry source URLs for traceability.",
  );
  // Timestamps referenced.
  assert(prompt.includes("2026-07-18"), "Prompt must carry event occurredAt timestamps.");
  // Trust score referenced.
  assert(
    prompt.includes("0.8") || prompt.toLowerCase().includes("trust"),
    "Prompt must carry source trust metadata.",
  );
  // Explicit no-internet instruction.
  assert(
    /不联网|不.{0,4}网络|禁止.{0,4}补全|only.*provided/i.test(prompt),
    "Prompt must explicitly forbid internet-based completion.",
  );
}

/**
 * #178: Insufficient-data path must persist evidenceIds of what WAS recalled,
 * so the user can see exactly which events fell short. Also the coverageNote
 * must reference the real recalled count (not a fabricated number).
 */
async function testInsufficientDataPersistsEvidenceIdsAndRealCount(): Promise<void> {
  const events = [makeFakeEvent("e1"), makeFakeEvent("e2")];
  const state: FakePrismaState = {
    reports: [makeFakeReport({ id: "r7", status: "PENDING" })],
    taskRuns: [],
    reportUpdates: [],
    taskRunCreates: 0,
    taskRunUpdates: [],
    usageEvents: 0,
    searchEvents: events,
    evidenceSet: {
      events,
      items: [],
      briefings: [],
      eventCount: events.length,
      itemCount: 0,
      briefingCount: 0,
      topicIds: ["topic-1"],
      sourceIds: ["source-e1", "source-e2"],
      evidenceIds: ["e1", "e2"],
    },
    aiPrompt: null,
  };
  const prisma = createFakePrisma(state);
  await runReportGeneration(
    { reportId: "r7", organizationId: "org-1", userId: "test" },
    createDeps(state, prisma),
  );

  const report = state.reports[0]!;
  assert(
    report.status === "INSUFFICIENT_DATA",
    `2 events < 3 threshold MUST land INSUFFICIENT_DATA, got ${report.status}.`,
  );
  const meta = report.metadata as { evidenceIds?: string[]; threshold?: number } | null;
  assert(
    meta !== null && Array.isArray(meta.evidenceIds) && meta.evidenceIds!.length === 2,
    `INSUFFICIENT_DATA metadata must persist recalled evidenceIds (expected [e1,e2], got ${JSON.stringify(meta?.evidenceIds)}).`,
  );
  assert(
    report.coverageNote !== null && report.coverageNote.includes("2 条"),
    `coverageNote must reference real recalled count, got: ${report.coverageNote}`,
  );
}