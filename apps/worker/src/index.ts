import {
  createIntelligenceEventDraft,
  createContentHash,
  evaluateRelevance,
  generatePreferenceDeltas,
  renderDailyBriefingMarkdown,
} from "@wangchao/core";
import {
  completeTaskRun,
  createDailyBriefing,
  createSourceFetchTaskRun,
  ensureDefaultWorkspace,
  failTaskRun,
  getPrismaClient,
  listActiveRssSourcesForFetch,
  listActiveTopics,
  listEventsForDailyBriefing,
  listFetchedItemsForAnalysis,
  listPreferenceMemoryForDashboard,
  listRecentFeedbackSignals,
  listSourceGovernanceReport,
  markItemFiltered,
  recordUsageEvent,
  recordSourceFetchSuccess,
  recordSourceQualityObservation,
  upsertFetchedItems,
  upsertIntelligenceEventFromItem,
  upsertPreferenceMemory,
  type FetchedSourceRecord,
} from "@wangchao/db";
import { fetchRssFeed } from "@wangchao/sources";

const MAX_FETCH_ATTEMPTS = 3;

export interface WorkerFetchCycleResult {
  analyzedItems: number;
  createdOrUpdatedEvents: number;
  fetchedSources: number;
  failedSources: number;
  filteredItems: number;
  generatedBriefings: number;
  insertedOrUpdatedItems: number;
  recordedSourceObservations: number;
  updatedPreferenceMemories: number;
}

export interface WorkerHealthCheckResult {
  checks: Record<string, { message?: string; status: "ok" | "down" | "skipped" }>;
  generatedAt: string;
  service: "wangchao-worker";
  status: "ok" | "degraded";
}

export function describeWorker(): string {
  return "Wangchao worker";
}

export async function runWorkerHealthCheck(): Promise<WorkerHealthCheckResult> {
  const database = await checkWorkerDatabase();
  const status = database.status === "down" ? "degraded" : "ok";

  return {
    checks: {
      database,
    },
    generatedAt: new Date().toISOString(),
    service: "wangchao-worker",
    status,
  };
}

export async function runFetchCycle(): Promise<WorkerFetchCycleResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to run the worker fetch pipeline.");
  }

  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  const sources = await listActiveRssSourcesForFetch(prisma, {
    organizationId: workspace.organizationId,
  });
  const result: WorkerFetchCycleResult = {
    analyzedItems: 0,
    createdOrUpdatedEvents: 0,
    failedSources: 0,
    fetchedSources: 0,
    filteredItems: 0,
    generatedBriefings: 0,
    insertedOrUpdatedItems: 0,
    recordedSourceObservations: 0,
    updatedPreferenceMemories: 0,
  };

  for (const source of sources) {
    const sourceResult = await fetchSourceWithRetries(prisma, source);
    result.fetchedSources += sourceResult.fetchedSources;
    result.failedSources += sourceResult.failedSources;
    result.insertedOrUpdatedItems += sourceResult.insertedOrUpdatedItems;
  }

  if (result.fetchedSources > 0 || result.insertedOrUpdatedItems > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        failedSources: result.failedSources,
        fetchedSources: result.fetchedSources,
      },
      organizationId: workspace.organizationId,
      quantity: result.insertedOrUpdatedItems,
      subjectType: "worker-fetch-cycle",
      type: "FETCH",
      unit: "item",
      userId: workspace.userId,
    });
  }

  const analysisResult = await runAnalysisCycle(prisma, workspace.organizationId);
  result.analyzedItems = analysisResult.analyzedItems;
  result.createdOrUpdatedEvents = analysisResult.createdOrUpdatedEvents;
  result.filteredItems = analysisResult.filteredItems;
  result.updatedPreferenceMemories = await runPreferenceLearningCycle(
    prisma,
    workspace.organizationId,
    workspace.userId,
  );
  result.generatedBriefings = await runDailyBriefingCycle(
    prisma,
    workspace.organizationId,
    workspace.userId,
  );
  if (result.generatedBriefings > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        source: "worker-daily-briefing-cycle",
      },
      organizationId: workspace.organizationId,
      quantity: result.generatedBriefings,
      subjectType: "daily-briefing-cycle",
      type: "BRIEFING",
      unit: "briefing",
      userId: workspace.userId,
    });
  }
  result.recordedSourceObservations = await runSourceGovernanceObservationCycle(
    prisma,
    workspace.organizationId,
  );
  if (result.recordedSourceObservations > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        source: "worker-source-governance-cycle",
      },
      organizationId: workspace.organizationId,
      quantity: result.recordedSourceObservations,
      subjectType: "source-observation-cycle",
      type: "SOURCE_GOVERNANCE",
      unit: "observation",
      userId: workspace.userId,
    });
  }

  return result;
}

async function runAnalysisCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<Pick<
  WorkerFetchCycleResult,
  "analyzedItems" | "createdOrUpdatedEvents" | "filteredItems"
>> {
  const items = await listFetchedItemsForAnalysis(prisma, { organizationId });
  const result = {
    analyzedItems: 0,
    createdOrUpdatedEvents: 0,
    filteredItems: 0,
  };

  for (const item of items) {
    const decision = evaluateRelevance({
      fetchedAt: item.fetchedAt,
      id: item.id,
      publishedAt: item.publishedAt,
      summary: item.summary,
      title: item.title,
      topicProfile: item.topicProfile,
      url: item.url,
    });
    const draft = createIntelligenceEventDraft(
      {
        fetchedAt: item.fetchedAt,
        id: item.id,
        publishedAt: item.publishedAt,
        summary: item.summary,
        title: item.title,
        topicProfile: item.topicProfile,
        url: item.url,
      },
      decision,
    );

    result.analyzedItems += 1;

    if (!draft) {
      await markItemFiltered(
        prisma,
        item.id,
        decision.noiseReason ?? "Item did not pass relevance threshold.",
      );
      result.filteredItems += 1;
      continue;
    }

    await upsertIntelligenceEventFromItem(prisma, {
      organizationId: item.organizationId,
      topicId: item.topicId,
      primaryItemId: item.id,
      title: draft.title,
      summary: draft.summary,
      category: draft.category,
      score: draft.score,
      gravityScore: draft.gravityScore,
      eventHash: draft.eventHash,
      explanation: draft.explanation,
      occurredAt: draft.occurredAt,
      rawAiResponse: {
        mode: "explainable-rules",
        relevance: decision,
      },
    });
    result.createdOrUpdatedEvents += 1;
  }

  return result;
}

async function runPreferenceLearningCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  userId: string,
): Promise<number> {
  const signals = await listRecentFeedbackSignals(prisma, {
    organizationId,
    userId,
  });
  const deltas = generatePreferenceDeltas(signals);

  await Promise.all(
    deltas.map((delta) =>
      upsertPreferenceMemory(prisma, {
        confidence: delta.confidence,
        explanation: delta.explanation,
        key: delta.key,
        organizationId,
        topicId: delta.topicId,
        userId,
        value: delta.value,
      }),
    ),
  );

  return deltas.length;
}

async function runDailyBriefingCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  userId: string,
): Promise<number> {
  const topics = await listActiveTopics(prisma, { organizationId });
  let generatedBriefings = 0;

  for (const topic of topics) {
    const [events, preferences] = await Promise.all([
      listEventsForDailyBriefing(prisma, {
        organizationId,
        topicId: topic.id,
      }),
      listPreferenceMemoryForDashboard(prisma, { organizationId, userId }),
    ]);

    if (events.length === 0) {
      continue;
    }

    const generatedAt = new Date();
    const markdown = renderDailyBriefingMarkdown({
      events: events.map((event) => ({
        category: event.category,
        explanation: event.explanation,
        occurredAt: event.occurredAt,
        score: event.score,
        sourceName: event.sourceName,
        sourceUrl: event.sourceUrl,
        summary: event.summary,
        title: event.title,
        url: event.url,
      })),
      generatedAt,
      preferences: preferences
        .filter((preference) => preference.topicId === topic.id)
        .map((preference) => ({
          explanation: preference.explanation,
          key: preference.key,
          weight: preference.weight,
        })),
      topicName: topic.name,
    });
    const rangeEnd = generatedAt;
    const rangeStart = new Date(generatedAt);
    rangeStart.setHours(0, 0, 0, 0);

    await createDailyBriefing(prisma, {
      content: markdown,
      eventIds: events.map((event) => event.eventId),
      markdown,
      metadata: {
        contentHash: createContentHash(markdown),
        mode: "explainable-rules",
      },
      organizationId,
      rangeEnd,
      rangeStart,
      title: `${topic.name} Daily Briefing`,
      topicId: topic.id,
    });
    generatedBriefings += 1;
  }

  return generatedBriefings;
}

async function runSourceGovernanceObservationCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<number> {
  const report = await listSourceGovernanceReport(prisma, { organizationId });

  await Promise.all(
    report.map((source) =>
      recordSourceQualityObservation(prisma, {
        duplicateRate: source.duplicateRate,
        evidence: {
          qualityScore: source.qualityScore,
          recommendation: source.recommendation,
          totalItems: source.totalItems,
        },
        hitRate: source.hitRate,
        noiseRate: source.noiseRate,
        organizationId,
        sourceId: source.sourceId,
        topicId: source.topicId,
      }),
    ),
  );

  return report.length;
}

async function fetchSourceWithRetries(
  prisma: ReturnType<typeof getPrismaClient>,
  source: FetchedSourceRecord,
): Promise<WorkerFetchCycleResult> {
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const result = await fetchSourceAttempt(prisma, source, attempt);

    if (result.fetchedSources === 1) {
      return result;
    }
  }

  return {
    analyzedItems: 0,
    createdOrUpdatedEvents: 0,
    failedSources: 1,
    fetchedSources: 0,
    filteredItems: 0,
    generatedBriefings: 0,
    insertedOrUpdatedItems: 0,
    recordedSourceObservations: 0,
    updatedPreferenceMemories: 0,
  };
}

async function fetchSourceAttempt(
  prisma: ReturnType<typeof getPrismaClient>,
  source: FetchedSourceRecord,
  attempt: number,
): Promise<WorkerFetchCycleResult> {
  const taskRun = await createSourceFetchTaskRun(prisma, source, {
    attempt,
    maxAttempts: MAX_FETCH_ATTEMPTS,
  });

  try {
    const items = await fetchRssFeed(source.url);
    const writtenItems = await upsertFetchedItems(
      prisma,
      items.map((item) => ({
        organizationId: source.organizationId,
        topicId: source.topicId,
        sourceId: source.id,
        title: item.title,
        url: item.url,
        canonicalUrl: item.canonicalUrl,
        summary: item.summary,
        author: item.author,
        publishedAt: item.publishedAt,
        contentHash: item.contentHash,
        rawMetadata: item.rawMetadata,
      })),
    );

    await recordSourceFetchSuccess(prisma, source.id);
    await completeTaskRun(prisma, taskRun.id, {
      fetchedItems: items.length,
      writtenItems: writtenItems.length,
    });

    return {
      analyzedItems: 0,
      createdOrUpdatedEvents: 0,
      failedSources: 0,
      fetchedSources: 1,
      filteredItems: 0,
      generatedBriefings: 0,
      insertedOrUpdatedItems: writtenItems.length,
      recordedSourceObservations: 0,
      updatedPreferenceMemories: 0,
    };
  } catch (error) {
    await failTaskRun(prisma, taskRun.id, error);
    return {
      analyzedItems: 0,
      createdOrUpdatedEvents: 0,
      failedSources: 0,
      fetchedSources: 0,
      filteredItems: 0,
      generatedBriefings: 0,
      insertedOrUpdatedItems: 0,
      recordedSourceObservations: 0,
      updatedPreferenceMemories: 0,
    };
  }
}

async function checkWorkerDatabase(): Promise<{
  message?: string;
  status: "ok" | "down" | "skipped";
}> {
  if (!process.env.DATABASE_URL) {
    return {
      message: "Database connection is not configured.",
      status: "skipped",
    };
  }

  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      status: "down",
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv.includes("--health")
    ? runWorkerHealthCheck()
    : runFetchCycle();

  command
    .then((result) => {
      process.stdout.write(`${describeWorker()}\n`);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if ("status" in result && result.status === "degraded") {
        process.exitCode = 1;
      }
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `worker error: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
