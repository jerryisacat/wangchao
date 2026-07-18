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
import { getPrismaClient } from "@wangchao/db";

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
  occurredAt: Date | null;
  topicId: string;
  sourceId: string | null;
  sourceName: string | null;
  topicName: string;
}

interface FakePrismaState {
  reports: FakeReportRow[];
  taskRuns: FakeTaskRunRow[];
  reportUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  taskRunCreates: number;
  taskRunUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  usageEvents: number;
  searchEvents: FakeEventRow[];
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
  };
}

function makeFakeEvent(id: string, topicId = "topic-1"): FakeEventRow {
  return {
    eventId: id,
    title: `Event ${id}`,
    summary: `Summary for ${id}`,
    category: "news",
    score: 70,
    occurredAt: new Date("2026-07-18T10:00:00.000Z"),
    topicId,
    sourceId: `source-${id}`,
    sourceName: `Source ${id}`,
    topicName: "Test Topic",
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
    searchReportEvidenceEvents: async () => state.searchEvents,
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