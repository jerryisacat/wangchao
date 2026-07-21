/**
 * Worker dedup orchestration fixtures for Issue #171.
 *
 * Tests the编排层 (apps/worker/src/modules/dedup.ts) with a fake prisma and
 * injectable AI runtime. Verifies:
 *   1. Recall query no longer filters status=UNREAD (脱离阅读状态).
 *   2. No-AI path uses deterministic fallback and does NOT call LLM adapter.
 *   3. Same canonical title (different URL) merges via deterministic path.
 *   4. Different Topic events never merge.
 *   5. Late-arriving report merges within bounded lookback.
 *   6. Source preservation: mergeSemanticEvents is called (EventItem + Item Duplicated).
 */
import { runSemanticDedupCycle } from "./dedup.js";
import { getPrismaClient } from "@wangchao/db";

type PrismaClientLike = ReturnType<typeof getPrismaClient>;

// ─── Fake Prisma ───
// We only implement the subset of methods that runSemanticDedupCycle + mergeSemanticEvents touch.
// Shape matches Prisma payload enough for type-narrowed access inside dedup.ts.

interface FakeEventRow {
  id: string;
  organizationId: string;
  topicId: string;
  primaryItemId: string | null;
  status: "UNREAD" | "READ" | "SAVED" | "DISMISSED" | "ARCHIVED";
  title: string;
  summary: string;
  summaryStatus: "PENDING" | "READY" | "CONTENT_FETCH_FAILED" | "CONTENT_INSUFFICIENT" | "CONTENT_UNSUPPORTED" | "AI_FAILED";
  entities: string[];
  occurredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  eventHash: string | null;
  titleHash: string | null;
  mergeReason: string | null;
  primaryItem: { sourceId: string; source: { name: string } } | null;
  topic: { name: string; description: string | null };
  eventItems: Array<{ itemId: string; role: string; mergeReason: string | null; item: { sourceId: string; source: { name: string } } }>;
}

function makeFakeEvent(over: Partial<FakeEventRow> & { id: string; topicId: string; sourceId?: string }): FakeEventRow {
  const sourceId = over.primaryItem?.sourceId ?? over.sourceId ?? `src-${over.id}`;
  // Use a time within the 48h lookback window (1 hour ago by default).
  const recentTime = new Date();
  recentTime.setHours(recentTime.getHours() - 1);
  return {
    id: over.id,
    organizationId: "org-1",
    topicId: over.topicId,
    primaryItemId: over.primaryItemId ?? `item-${over.id}`,
    status: over.status ?? "UNREAD",
    title: over.title ?? "Untitled",
    summary: over.summary ?? "",
    summaryStatus: over.summaryStatus ?? "READY",
    entities: over.entities ?? [],
    occurredAt: over.occurredAt ?? recentTime,
    createdAt: over.createdAt ?? recentTime,
    updatedAt: over.createdAt ?? recentTime,
    eventHash: over.eventHash ?? `event:${over.id}`,
    titleHash: over.titleHash ?? `title:${over.id}`,
    mergeReason: over.mergeReason ?? null,
    primaryItem: over.primaryItem ?? { sourceId, source: { name: `Source ${over.id}` } },
    topic: over.topic ?? { name: "Test Topic", description: null },
    eventItems: over.eventItems ?? [],
  };
}

interface FakePrismaState {
  events: FakeEventRow[];
  findManyCalls: Array<{ where: unknown }>;
  mergeCalls: Array<{ keepEventId: string; mergeEventIds: string[]; reason: string }>;
  itemStatusUpdates: Array<{ ids: string[]; status: string }>;
  eventItemCreates: Array<{ eventId: string; itemId: string; role: string }>;
}

function createFakePrisma(state: FakePrismaState): PrismaClientLike {
  const tx = {
    intelligenceEvent: {
      findFirst: async ({ where }: { where: { id?: string; organizationId?: string } }) =>
        state.events.find((e) => e.id === where.id && e.organizationId === where.organizationId) ?? null,
      findMany: async ({ where }: { where: { id?: { in: string[] }; organizationId?: string } }) =>
        state.events.filter(
          (e) =>
            (!where.id || (where.id.in && where.id.in.includes(e.id))) &&
            (!where.organizationId || e.organizationId === where.organizationId),
        ),
      updateMany: async ({ where, data }: { where: { id?: { in: string[] }; organizationId?: string }; data: { status?: string; eventHash?: string | null; titleHash?: string | null; mergeReason?: string } }) => {
        const targets = state.events.filter(
          (e) =>
            where.id?.in?.includes(e.id) &&
            (!where.organizationId || e.organizationId === where.organizationId),
        );
        for (const t of targets) {
          if (data.status !== undefined) (t as { status: string }).status = data.status;
          if ("eventHash" in data) t.eventHash = data.eventHash as string | null;
          if ("titleHash" in data) (t as { titleHash: string | null }).titleHash = data.titleHash as string | null;
          if (data.mergeReason !== undefined) (t as { mergeReason: string }).mergeReason = data.mergeReason;
        }
        return { count: targets.length };
      },
    },
    eventItem: {
      createMany: async ({ data }: { data: Array<{ eventId: string; itemId: string; role: string; mergeReason: string }> }) => {
        for (const d of data) state.eventItemCreates.push({ eventId: d.eventId, itemId: d.itemId, role: d.role });
        return { count: data.length };
      },
    },
    item: {
      updateMany: async ({ where, data }: { where: { id?: { in: string[] }; organizationId?: string }; data: { status?: string } }) => {
        state.itemStatusUpdates.push({ ids: where.id?.in ?? [], status: data.status ?? "" });
        return { count: where.id?.in?.length ?? 0 };
      },
    },
  };

  const prisma = {
    intelligenceEvent: {
      findMany: async (args: { where: unknown; include?: unknown; orderBy?: unknown }) => {
        state.findManyCalls.push({ where: args.where });
        // Return a defensive copy so callers can't mutate state.events directly.
        return state.events.map((e) => ({ ...e, eventItems: [...e.eventItems], primaryItem: e.primaryItem ? { ...e.primaryItem, source: { ...e.primaryItem.source } } : null, topic: { ...e.topic } }));
      },
    },
    $transaction: async (fn: (txClient: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return prisma as unknown as PrismaClientLike;
}

export async function runDedupOrchestrationFixtures(): Promise<void> {
  await testRecallIgnoresReadStatusInQuery();
  await testNoAiPathUsesDeterministicFallbackWithoutLlmCall();
  await testSameCanonicalTitleDifferentUrlMergesViaDeterministic();
  await testDifferentTopicNeverMerges();
  await testLateArrivingReportMergesWithinLookback();
  await testAiPathSkipsDeterministicMatchedEventForLlm();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function testRecallIgnoresReadStatusInQuery(): Promise<void> {
  const state: FakePrismaState = {
    events: [makeFakeEvent({ id: "e1", topicId: "t1", status: "READ" })],
    findManyCalls: [],
    mergeCalls: [],
    itemStatusUpdates: [],
    eventItemCreates: [],
  };
  const prisma = createFakePrisma(state);
  await runSemanticDedupCycle(prisma, "org-1", { resolveAiRuntime: async () => null });
  assert(state.findManyCalls.length === 1, "findMany must be called exactly once.");
  const where = state.findManyCalls[0]!.where as { status?: unknown; summaryStatus?: unknown; organizationId?: string };
  assert(where.status === undefined, `Recall query must NOT filter by status (脱离阅读状态). got status=${JSON.stringify(where.status)}`);
  assert(where.summaryStatus === "READY", `Recall must filter summaryStatus=READY. got ${where.summaryStatus}`);
  assert(where.organizationId === "org-1", "Recall must scope by organizationId.");
}

async function testNoAiPathUsesDeterministicFallbackWithoutLlmCall(): Promise<void> {
  // Two events with same canonical title, different sources/URLs. No AI runtime.
  let llmCalled = 0;
  const state: FakePrismaState = {
    events: [
      makeFakeEvent({ id: "old", topicId: "t1", title: "OpenAI 发布 GPT-5", entities: ["OpenAI"], sourceId: "src-A", occurredAt: new Date(Date.now() - 2 * 3600 * 1000), createdAt: new Date(Date.now() - 2 * 3600 * 1000) }),
      makeFakeEvent({ id: "new", topicId: "t1", title: "【突发】OpenAI 发布 GPT-5", entities: ["OpenAI"], sourceId: "src-B", occurredAt: new Date(Date.now() - 1 * 3600 * 1000), createdAt: new Date(Date.now() - 1 * 3600 * 1000) }),
    ],
    findManyCalls: [],
    mergeCalls: [],
    itemStatusUpdates: [],
    eventItemCreates: [],
  };
  const prisma = createFakePrisma(state);
  // mergeSemanticEvents calls $transaction -> we need to capture merge by intercepting the fake.
  // Our fake captures via state.mergeCalls through tx.updateMany reason field on the archived event.
  const result = await runSemanticDedupCycle(prisma, "org-1", {
    resolveAiRuntime: async () => ({ adapter: { chat: async () => { llmCalled += 1; return { content: "{}", raw: {} }; } }, model: "fake-model" }),
  });
  assert(llmCalled === 0, `No-AI-with-deterministic-hit must NOT call LLM. got ${llmCalled} calls.`);
  assert(result.merged === 1, `Deterministic merge must report merged=1. got ${result.merged}`);
  assert(result.llmCalls === 0, `No LLM calls when deterministic hits. got ${result.llmCalls}`);
  // Verify source preservation: eventItemCreates should have the merged item as SECONDARY.
  assert(state.eventItemCreates.length >= 1, `EventItem SECONDARY must be created for source preservation. got ${state.eventItemCreates.length}`);
  assert(state.eventItemCreates[0]!.role === "SECONDARY", `Merged item role must be SECONDARY. got ${state.eventItemCreates[0]!.role}`);
  // The merged (new) event must be ARCHIVED.
  const archivedEvent = state.events.find((e) => e.id === "new");
  assert(archivedEvent?.status === "ARCHIVED", `Merged event must be ARCHIVED. got ${archivedEvent?.status}`);
  // The merged item must be marked DUPLICATE.
  assert(state.itemStatusUpdates.some((u) => u.status === "DUPLICATE"), "Item must be marked DUPLICATE for source audit.");
}

async function testSameCanonicalTitleDifferentUrlMergesViaDeterministic(): Promise<void> {
  const state: FakePrismaState = {
    events: [
      makeFakeEvent({ id: "keep", topicId: "t1", title: "某公司发布新品", entities: [], sourceId: "src-A", occurredAt: new Date(Date.now() - 2 * 3600 * 1000), createdAt: new Date(Date.now() - 2 * 3600 * 1000) }),
      makeFakeEvent({ id: "merge", topicId: "t1", title: "【独家】某公司发布新品", entities: [], sourceId: "src-B", occurredAt: new Date(Date.now() - 90 * 60 * 1000), createdAt: new Date(Date.now() - 90 * 60 * 1000) }),
    ],
    findManyCalls: [],
    mergeCalls: [],
    itemStatusUpdates: [],
    eventItemCreates: [],
  };
  const prisma = createFakePrisma(state);
  const result = await runSemanticDedupCycle(prisma, "org-1", { resolveAiRuntime: async () => null });
  assert(result.merged === 1, `Different-URL same-canonical-title must merge via deterministic. got merged=${result.merged}`);
}

async function testDifferentTopicNeverMerges(): Promise<void> {
  const state: FakePrismaState = {
    events: [
      makeFakeEvent({ id: "t1-evt", topicId: "t1", title: "地震发生", entities: ["某地"], sourceId: "src-A", occurredAt: new Date(Date.now() - 2 * 3600 * 1000), createdAt: new Date(Date.now() - 2 * 3600 * 1000) }),
      makeFakeEvent({ id: "t2-evt", topicId: "t2", title: "地震发生", entities: ["某地"], sourceId: "src-B", occurredAt: new Date(Date.now() - 2 * 3600 * 1000), createdAt: new Date(Date.now() - 2 * 3600 * 1000) }),
    ],
    findManyCalls: [],
    mergeCalls: [],
    itemStatusUpdates: [],
    eventItemCreates: [],
  };
  const prisma = createFakePrisma(state);
  const result = await runSemanticDedupCycle(prisma, "org-1", { resolveAiRuntime: async () => null });
  assert(result.merged === 0, `Different-topic events must NEVER merge. got merged=${result.merged}`);
}

async function testLateArrivingReportMergesWithinLookback(): Promise<void> {
  // Late-arriving: occurredAt is old, but createdAt is recent (within lookback).
  const now = new Date();
  const oldOccurred = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2h ago
  const state: FakePrismaState = {
    events: [
      makeFakeEvent({ id: "first", topicId: "t1", title: "某地发生 7.0 级地震", entities: ["某地"], sourceId: "src-A", occurredAt: oldOccurred, createdAt: new Date(now.getTime() - 90 * 60 * 1000) }),
      makeFakeEvent({ id: "late", topicId: "t1", title: "某地强震已致多人伤亡", entities: ["某地"], sourceId: "src-B", occurredAt: new Date(oldOccurred.getTime() + 60 * 60 * 1000), createdAt: new Date(now.getTime() - 30 * 60 * 1000) }),
    ],
    findManyCalls: [],
    mergeCalls: [],
    itemStatusUpdates: [],
    eventItemCreates: [],
  };
  const prisma = createFakePrisma(state);
  const result = await runSemanticDedupCycle(prisma, "org-1", { resolveAiRuntime: async () => null });
  assert(result.merged === 1, `Late-arriving report with close occurredAt + shared entity must merge. got merged=${result.merged}`);
}

async function testAiPathSkipsDeterministicMatchedEventForLlm(): Promise<void> {
  // When deterministic already merged the new event, LLM should not be called for it.
  let llmCalls = 0;
  const state: FakePrismaState = {
    events: [
      makeFakeEvent({ id: "keep", topicId: "t1", title: "OpenAI 发布 GPT-5", entities: ["OpenAI"], sourceId: "src-A", occurredAt: new Date(Date.now() - 2 * 3600 * 1000), createdAt: new Date(Date.now() - 2 * 3600 * 1000) }),
      makeFakeEvent({ id: "dup", topicId: "t1", title: "OpenAI 发布 GPT-5", entities: ["OpenAI"], sourceId: "src-B", occurredAt: new Date(Date.now() - 1 * 3600 * 1000), createdAt: new Date(Date.now() - 1 * 3600 * 1000) }),
    ],
    findManyCalls: [],
    mergeCalls: [],
    itemStatusUpdates: [],
    eventItemCreates: [],
  };
  const prisma = createFakePrisma(state);
  await runSemanticDedupCycle(prisma, "org-1", {
    resolveAiRuntime: async () => ({ adapter: { chat: async () => { llmCalls += 1; return { content: "{}", raw: {} }; } }, model: "fake" }),
  });
  assert(llmCalls === 0, `LLM must be skipped when deterministic already matched. got ${llmCalls} calls.`);
}
