import type { ClaimedTaskRun } from "@wangchao/db";
import {
  runEventSummaryRegeneration,
  type SummaryRegenerationDeps,
} from "./summary-regeneration.js";

interface FakeState {
  eventData: Record<string, unknown>[];
  itemData: Record<string, unknown>[];
  taskData: Record<string, unknown>[];
  usageCount: number;
}

export async function runSummaryRegenerationFixtures(): Promise<void> {
  await verifyEmbeddedMarkdownRegeneratesExactlyOneSummary();
  await verifyInsufficientCaptureStopsBeforeAi();
  await verifyAiFailurePersistsStatusAndRequestsDurableRetry();
}

function fakePrisma(event: Record<string, unknown>) {
  const state: FakeState = { eventData: [], itemData: [], taskData: [], usageCount: 0 };
  const prisma = {
    intelligenceEvent: {
      findUnique: async () => event,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.eventData.push(data);
        return { ...event, ...data };
      },
    },
    item: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.itemData.push(data);
        return data;
      },
    },
    taskRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.taskData.push(data);
        return { id: "audit-1", ...data };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.taskData.push(data);
        return { id: "audit-1", ...data };
      },
    },
    usageEvent: {
      create: async () => {
        state.usageCount += 1;
        return { id: "usage-1" };
      },
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  };
  return { prisma, state };
}

function eventFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { primaryItem: primaryItemOverride, ...eventOverrides } = overrides;
  return {
    id: "event-1",
    organizationId: "org-1",
    topicId: "topic-1",
    topic: {
      description: "Track important AI changes.",
      name: "AI",
      profile: { keywords: ["AI"] },
    },
    primaryItem: {
      id: "item-1",
      title: "AI release",
      summary: "Feed summary",
      url: "https://example.com/article",
      publishedAt: new Date("2026-07-21T00:00:00.000Z"),
      rawContent: "# Article\n\nCaptured Markdown body with enough factual detail.",
      contentSource: "RSS_EMBEDDED",
      contentStatus: "READY",
      source: { name: "Example" },
      ...((primaryItemOverride as Record<string, unknown> | undefined) ?? {}),
    },
    ...eventOverrides,
  };
}

function claimedTask(): ClaimedTaskRun {
  return {
    id: "task-1",
    organizationId: "org-1",
    topicId: "topic-1",
    sourceId: null,
    itemId: "item-1",
    eventId: "event-1",
    type: "CONTENT_FETCH",
    status: "RUNNING",
    attempt: 1,
    maxAttempts: 3,
    scheduledAt: new Date(),
    startedAt: new Date(),
    input: { mode: "event-summary-regeneration", userId: "user-1" },
    leaseOwner: "worker-1",
    leaseToken: "lease-token",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    heartbeatAt: new Date(),
  };
}

function successDeps(overrides: Partial<SummaryRegenerationDeps> = {}): SummaryRegenerationDeps {
  return {
    fetchArticleMarkdown: async () => ({
      contentSource: "ARTICLE_HTML",
      markdown: "# Fetched\n\nArticle body.",
      status: "READY",
    }),
    createAnalysisRuntime: async () => ({
      adapter: { chat: async () => ({ content: "{}", raw: {} }) },
      model: "fixture-model",
      source: "byok",
    }),
    extractEvent: async () => ({
      category: "AI",
      entities: ["AI"],
      followUpSuggestion: "Track updates.",
      importanceExplanation: "Important release.",
      importanceScore: 80,
      isRelevant: true,
      matchedKeywords: ["AI"],
      raw: {},
      relevanceScore: 90,
      summary: "重新生成后的摘要。",
      title: "AI release",
    }),
    ...overrides,
  };
}

async function verifyEmbeddedMarkdownRegeneratesExactlyOneSummary(): Promise<void> {
  const { prisma, state } = fakePrisma(eventFixture());
  let fetchCalls = 0;
  let extractionCalls = 0;
  const deps = successDeps({
    fetchArticleMarkdown: async (...args) => {
      fetchCalls += 1;
      return successDeps().fetchArticleMarkdown(...args);
    },
    extractEvent: async (...args) => {
      extractionCalls += 1;
      return successDeps().extractEvent(...args);
    },
  });
  const output = await runEventSummaryRegeneration(
    prisma as never,
    { organizationId: "org-1", userId: "user-1" },
    claimedTask(),
    deps,
  );
  assert(fetchCalls === 0, "RSS embedded Markdown must be reused without an article request.");
  assert(extractionCalls === 1, "Summary regeneration must invoke AI exactly once.");
  assert(output.summaryStatus === "READY", "Successful regeneration must return READY.");
  assert(
    state.eventData.some((data) => data.summary === "重新生成后的摘要。" && data.summaryStatus === "READY"),
    "Successful regeneration must persist the new READY summary.",
  );
  assert(state.usageCount === 1, "One logical regeneration AI call must create one UsageEvent.");
}

async function verifyInsufficientCaptureStopsBeforeAi(): Promise<void> {
  const event = eventFixture({
    primaryItem: {
      rawContent: null,
      contentSource: "ARTICLE_HTML",
      contentStatus: "FETCH_FAILED",
    },
  });
  const { prisma, state } = fakePrisma(event);
  let extractionCalls = 0;
  const deps = successDeps({
    fetchArticleMarkdown: async () => ({
      contentSource: "ARTICLE_HTML",
      errorCode: "CONTENT_TOO_SHORT",
      status: "INSUFFICIENT",
    }),
    extractEvent: async (...args) => {
      extractionCalls += 1;
      return successDeps().extractEvent(...args);
    },
  });
  const output = await runEventSummaryRegeneration(
    prisma as never,
    { organizationId: "org-1", userId: "user-1" },
    claimedTask(),
    deps,
  );
  assert(extractionCalls === 0, "Insufficient content must never be sent to AI.");
  assert(output.summaryStatus === "CONTENT_INSUFFICIENT", "Capture outcome must propagate.");
  assert(
    state.eventData.some((data) => data.summaryStatus === "CONTENT_INSUFFICIENT"),
    "Insufficient capture must persist the structured event status.",
  );
}

async function verifyAiFailurePersistsStatusAndRequestsDurableRetry(): Promise<void> {
  const { prisma, state } = fakePrisma(eventFixture());
  const deps = successDeps({
    extractEvent: async () => {
      throw new Error("provider timeout");
    },
  });
  let rejected = false;
  try {
    await runEventSummaryRegeneration(
      prisma as never,
      { organizationId: "org-1", userId: "user-1" },
      claimedTask(),
      deps,
    );
  } catch {
    rejected = true;
  }
  assert(rejected, "AI transport failure must bubble to the durable retry policy.");
  assert(
    state.eventData.some((data) => data.summaryStatus === "AI_FAILED"),
    "AI transport failure must persist AI_FAILED before retry settlement.",
  );
  assert(state.usageCount === 1, "Failed logical AI attempts must still be metered once.");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
