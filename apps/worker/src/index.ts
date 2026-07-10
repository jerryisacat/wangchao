import {
  createOpenAiCompatibleAdapter,
  dedupEvent,
  extractEvent,
  fallbackSourceRecommendation,
  recommendSourceCandidate,
  type EventExtractionAdapter,
  type EventExtractionResult,
  type SemanticDedupCandidate,
  type SemanticDedupInput,
  type SemanticDedupResult,
  type SourceRecommendation,
  type SourceRecommendationAdapter,
} from "@wangchao/ai";
import {
  createContentHash,
  createIntelligenceEventDraft,
  createIntelligenceEventDraftFromExtraction,
  createUtcDayRange,
  evaluateRelevance,
  generatePreferenceDeltas,
  renderDailyBriefingMarkdown,
  type AiEventExtraction,
} from "@wangchao/core";
import {
  completeTaskRun,
  createCandidateRssSource,
  createDailyBriefing,
  createSourceDiscoveryTaskRun,
  createSourceFetchTaskRun,
  ensureDefaultWorkspace,
  failTaskRun,
  getDecryptedCredentials,
  getPrismaClient,
  listActiveRssSourcesForFetch,
  listActiveTopics,
  listEventsForDailyBriefing,
  listFetchedItemsForAnalysis,
  listHighScoreEventPagesForDiscovery,
  listPreferenceMemoryForDashboard,
  listRecentActiveSourcePagesForDiscovery,
  listRecentFeedbackSignals,
  listSourceGovernanceReport,
  listTopicsForSourceDiscovery,
  markItemFiltered,
  mergeSemanticEvents,
  recordUsageEvent,
  recordSourceFetchFailure,
  recordSourceFetchSuccess,
  recordSourceQualityObservation,
  upsertFetchedItems,
  upsertIntelligenceEventFromItem,
  upsertPreferenceMemory,
  type FetchedSourceRecord,
  type SourceDiscoveryTopicRecord,
} from "@wangchao/db";
import {
  BraveSearchProvider,
  buildTopicSearchQueries,
  discoverFeedCandidatesFromPage,
  discoverFeedCandidatesFromSearchResult,
  extractExternalLinksFromPage,
  extractTopicKeywords,
  fetchRssFeed,
  FetchRssError,
  isFetchRssRetryable,
  type FeedCandidate,
  type SearchProvider,
} from "@wangchao/sources";

const MAX_FETCH_ATTEMPTS = 3;

function getFetchConcurrency(): number {
  const raw = process.env.WANGCHAO_FETCH_CONCURRENCY;
  if (!raw) return 5;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function getBackoffBaseMs(): number {
  const raw = process.env.WANGCHAO_FETCH_BACKOFF_BASE_MS;
  if (!raw) return 1000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const queue: Array<() => void> = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      queue.shift()!();
    }
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        activeCount++;
        fn().then(
          (result) => {
            resolve(result);
            next();
          },
          (error) => {
            reject(error);
            next();
          },
        );
      };

      if (activeCount < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
}

export interface WorkerFetchCycleResult {
  analyzedItems: number;
  createdOrUpdatedEvents: number;
  fetchedSources: number;
  failedSources: number;
  filteredItems: number;
  generatedBriefings: number;
  insertedOrUpdatedItems: number;
  lastError?: unknown;
  recordedSourceObservations: number;
  updatedPreferenceMemories: number;
}

export interface SourceDiscoveryCycleResult {
  aiRecommendations: number;
  backlinkedCandidates: number;
  candidateSourcesWritten: number;
  existingSourcesObserved: number;
  failedCandidates: number;
  keywordCandidates: number;
  outlinkCandidates: number;
  skippedKeywordSearch: boolean;
  taskRunId: string;
  topicsScanned: number;
}

export interface SourceDiscoveryCycleOptions {
  mode?: "manual" | "worker";
  userId?: string;
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

  const limit = pLimit(getFetchConcurrency());
  const sourceResults = await Promise.all(
    sources.map((source) => limit(() => fetchSourceWithRetries(prisma, source))),
  );
  for (const sourceResult of sourceResults) {
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

  const analysisResult = await runAnalysisCycle(
    prisma,
    workspace.organizationId,
    workspace.userId,
  );
  result.analyzedItems = analysisResult.analyzedItems;
  result.createdOrUpdatedEvents = analysisResult.createdOrUpdatedEvents;
  result.filteredItems = analysisResult.filteredItems;
  const semanticDedupResult = await runSemanticDedupCycle(
    prisma,
    workspace.organizationId,
  );
  if (semanticDedupResult.llmCalls > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        merged: semanticDedupResult.merged,
        source: "worker-semantic-dedup-cycle",
      },
      organizationId: workspace.organizationId,
      quantity: semanticDedupResult.llmCalls,
      subjectType: "semantic-dedup-cycle",
      type: "AI_CALL",
      unit: "call",
      userId: workspace.userId,
    });
  }
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

export async function runSourceDiscoveryCycle(
  options: SourceDiscoveryCycleOptions = {},
): Promise<SourceDiscoveryCycleResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to run source discovery.");
  }

  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  const taskRun = await createSourceDiscoveryTaskRun(prisma, {
    input: {
      mode: options.mode ?? "worker",
    },
    organizationId: workspace.organizationId,
    userId: options.userId ?? workspace.userId,
  });
  const result: SourceDiscoveryCycleResult = {
    aiRecommendations: 0,
    backlinkedCandidates: 0,
    candidateSourcesWritten: 0,
    existingSourcesObserved: 0,
    failedCandidates: 0,
    keywordCandidates: 0,
    outlinkCandidates: 0,
    skippedKeywordSearch: false,
    taskRunId: taskRun.id,
    topicsScanned: 0,
  };

  try {
    const topics = await listTopicsForSourceDiscovery(prisma, {
      organizationId: workspace.organizationId,
    });
    result.topicsScanned = topics.length;
    const searchProvider = await createSearchProvider(prisma, workspace.organizationId);
    const ai = await createSourceRecommendationRuntime(prisma, workspace.organizationId);
    const candidates: DiscoveryCandidate[] = [];

    if (searchProvider) {
      candidates.push(...(await discoverFromKeywordSearch(topics, searchProvider)));
    } else {
      result.skippedKeywordSearch = true;
    }

    candidates.push(
      ...(await discoverFromHighScoreBacklinks(workspace.organizationId, topics)),
      ...(await discoverFromActiveSourceOutlinks(workspace.organizationId, topics)),
    );

    const limitedCandidates = limitCandidatesPerTopic(
      dedupeDiscoveryCandidates(candidates),
      readPositiveIntegerEnv("WANGCHAO_DISCOVERY_WEEKLY_LIMIT", 5),
    );

    for (const candidate of limitedCandidates) {
      const recommendation = await getSourceRecommendation(candidate, ai);
      result.aiRecommendations += recommendation.usedAi ? 1 : 0;

      try {
        const source = await createCandidateRssSource(prisma, {
          description: candidate.evidence.snippet
            ? String(candidate.evidence.snippet).slice(0, 240)
            : undefined,
          discoveryChannel: candidate.channel,
          evidence: {
            ...candidate.evidence,
            recommendationMode: recommendation.usedAi ? "llm" : "fallback",
            source: "source-discovery-cycle",
          },
          name: candidate.name,
          organizationId: candidate.topic.organizationId,
          recommendationReason: recommendation.value.reason,
          relevanceScore: recommendation.value.relevanceScore,
          topicId: candidate.topic.id,
          url: candidate.feedUrl,
        });

        if (source.status === "CANDIDATE") {
          result.candidateSourcesWritten += 1;
          if (candidate.channel === "keyword-search") result.keywordCandidates += 1;
          if (candidate.channel === "backlink-from-highscore") {
            result.backlinkedCandidates += 1;
          }
          if (candidate.channel === "outlink-network") result.outlinkCandidates += 1;
        } else {
          result.existingSourcesObserved += 1;
        }
      } catch {
        result.failedCandidates += 1;
      }
    }

    await completeTaskRun(prisma, taskRun.id, { ...result });
    await recordUsageEvent(prisma, {
      metadata: {
        mode: options.mode ?? "worker",
        taskRunId: taskRun.id,
      },
      organizationId: workspace.organizationId,
      quantity: result.candidateSourcesWritten,
      subjectId: taskRun.id,
      subjectType: "task-run",
      type: "SOURCE_DISCOVERY",
      unit: "candidate",
      userId: options.userId ?? workspace.userId,
    });

    return result;
  } catch (error) {
    await failTaskRun(prisma, taskRun.id, error);
    throw error;
  }
}

async function runAnalysisCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  userId: string,
): Promise<Pick<
  WorkerFetchCycleResult,
  "analyzedItems" | "createdOrUpdatedEvents" | "filteredItems"
>> {
  const items = await listFetchedItemsForAnalysis(prisma, { organizationId });
  const ai = await createAnalysisRuntime(prisma, organizationId);
  const result = {
    analyzedItems: 0,
    createdOrUpdatedEvents: 0,
    filteredItems: 0,
    llmItems: 0,
    llmFallbackItems: 0,
  };

  for (const item of items) {
    let draft = null;
    let rawAiResponse: Record<string, unknown> = {
      mode: "uninitialized",
    };
    let usedLlm = false;
    let usedFallback = false;

    if (ai) {
      try {
        const extractionInput = buildExtractionInput(item, item.topicProfile);
        const extraction = await extractEvent(extractionInput, {
          adapter: ai.adapter,
          model: ai.model,
        });
        draft = createIntelligenceEventDraftFromExtraction(
          {
            fetchedAt: item.fetchedAt,
            id: item.id,
            publishedAt: item.publishedAt,
            summary: item.summary,
            title: item.title,
            topicProfile: item.topicProfile,
            url: item.url,
          },
          extractionToAiEventExtraction(extraction),
        );
        rawAiResponse = { mode: "llm", extraction };
        usedLlm = true;
      } catch (error) {
        usedFallback = true;
        process.stderr.write(
          `[analysis-cycle] LLM extraction failed for item ${item.id} (topic ${item.topicId}): ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }

    if (!usedLlm) {
      const decision = evaluateRelevance({
        fetchedAt: item.fetchedAt,
        id: item.id,
        publishedAt: item.publishedAt,
        summary: item.summary,
        title: item.title,
        topicProfile: item.topicProfile,
        url: item.url,
      });
      draft = createIntelligenceEventDraft(
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
      rawAiResponse = {
        mode: "explainable-rules",
        relevance: decision,
        ...(usedFallback ? { llmFallback: true } : {}),
      };
    }

    result.analyzedItems += 1;
    if (usedLlm) result.llmItems += 1;
    if (usedFallback) result.llmFallbackItems += 1;

    if (!draft) {
      const noiseReason = usedFallback
        ? "AI 分析失败且规则判定为噪声。"
        : "Item did not pass relevance threshold.";
      await markItemFiltered(prisma, item.id, noiseReason);
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
      entities: draft.entities,
      score: draft.score,
      gravityScore: draft.gravityScore,
      eventHash: draft.eventHash,
      titleHash: draft.titleHash,
      explanation: draft.explanation,
      followUpSuggestion: draft.followUpSuggestion,
      mergeReason: draft.mergeReason,
      occurredAt: draft.occurredAt,
      rawAiResponse,
    });
    result.createdOrUpdatedEvents += 1;
  }

  if (ai && result.llmItems > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        filteredItems: result.filteredItems,
        fallbackItems: result.llmFallbackItems,
        llmItems: result.llmItems,
        source: "worker-analysis-cycle",
      },
      organizationId,
      quantity: result.llmItems,
      subjectType: "analysis-cycle",
      type: "AI_CALL",
      unit: "item",
      userId,
    });
  }

  return result;
}

async function runSemanticDedupCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ merged: number; llmCalls: number }> {
  const result = { merged: 0, llmCalls: 0 };

  const ai = await createAnalysisRuntime(prisma, organizationId);
  if (!ai) return result;

  const since = new Date();
  since.setHours(since.getHours() - 48);

  const recentEvents = await prisma.intelligenceEvent.findMany({
    where: {
      organizationId,
      status: "UNREAD",
      createdAt: { gte: since },
    },
    include: {
      eventItems: {
        include: {
          item: {
            select: {
              sourceId: true,
              source: { select: { name: true } },
            },
          },
        },
      },
      primaryItem: {
        select: {
          sourceId: true,
          source: { select: { name: true } },
        },
      },
      topic: {
        select: { name: true, description: true },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  if (recentEvents.length < 2) return result;

  const eventsByTopic = new Map<string, typeof recentEvents>();
  for (const event of recentEvents) {
    const list = eventsByTopic.get(event.topicId) ?? [];
    list.push(event);
    eventsByTopic.set(event.topicId, list);
  }

  for (const [, topicEvents] of eventsByTopic) {
    if (topicEvents.length < 2) continue;

    for (let i = 1; i < topicEvents.length; i += 1) {
      const newEvent = topicEvents[i];

      const currentEvent = topicEvents[i]!;
      const candidates = topicEvents.slice(0, i).filter((candidate) => {
        const newSourceId = currentEvent.primaryItem?.sourceId;
        const candSourceId = candidate.primaryItem?.sourceId;
        if (newSourceId && candSourceId && newSourceId === candSourceId) {
          return false;
        }
        const shareEntity = currentEvent.entities.some((e) =>
          candidate.entities.includes(e),
        );
        return shareEntity || candidate.entities.length === 0;
      });

      if (candidates.length === 0) continue;

      try {
        const dedupResult = await dedupEvent(
          {
            newEvent: {
              eventId: currentEvent.id,
              title: currentEvent.title,
              summary: currentEvent.summary,
              sourceName: currentEvent.primaryItem?.source.name ?? null,
              occurredAt: currentEvent.occurredAt?.toISOString() ?? null,
            },
            candidateEvents: candidates.map((c) => ({
              eventId: c.id,
              title: c.title,
              summary: c.summary,
              sourceName: c.primaryItem?.source.name ?? null,
              occurredAt: c.occurredAt?.toISOString() ?? null,
            })),
            topicName: currentEvent.topic?.name ?? "",
          },
          {
            adapter: ai.adapter,
            model: ai.model,
          },
        );

        result.llmCalls += 1;

        if (dedupResult.duplicateEventId && dedupResult.confidence >= 0.7) {
          await mergeSemanticEvents(prisma, {
            keepEventId: dedupResult.duplicateEventId,
            mergeEventIds: [currentEvent.id],
            reason: `LLM语义聚类 (置信度 ${dedupResult.confidence.toFixed(2)}): ${dedupResult.reason}`,
          });
          result.merged += 1;
        }
      } catch {
        // LLM call failed, skip this pair
      }
    }
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
    const generatedAt = new Date();
    const { rangeEnd, rangeStart } = createUtcDayRange(generatedAt);
    const [events, preferences] = await Promise.all([
      listEventsForDailyBriefing(prisma, {
        organizationId,
        rangeEnd,
        rangeStart,
        topicId: topic.id,
      }),
      listPreferenceMemoryForDashboard(prisma, { organizationId, userId }),
    ]);

    if (events.length === 0) {
      continue;
    }

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
    await createDailyBriefing(prisma, {
      content: markdown,
      eventIds: events.map((event) => event.eventId),
      generatedAt,
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
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const result = await fetchSourceAttempt(prisma, source, attempt);

    if (result.fetchedSources === 1) {
      return result;
    }

    lastError = result.lastError;

    if (!isFetchRssRetryable(lastError)) {
      break;
    }

    if (attempt < MAX_FETCH_ATTEMPTS) {
      const backoffMs = getBackoffBaseMs() * 2 ** (attempt - 1);
      const jitterMs = backoffMs * (0.5 + Math.random() * 0.5);
      await sleep(Math.round(jitterMs));
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
    lastError,
    recordedSourceObservations: 0,
    updatedPreferenceMemories: 0,
  };
}

async function fetchSourceAttempt(
  prisma: ReturnType<typeof getPrismaClient>,
  source: FetchedSourceRecord,
  attempt: number,
): Promise<WorkerFetchCycleResult & { lastError?: unknown }> {
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    await failTaskRun(prisma, taskRun.id, error);
    await recordSourceFetchFailure(prisma, source.id, errorMessage);

    return {
      analyzedItems: 0,
      createdOrUpdatedEvents: 0,
      failedSources: 0,
      fetchedSources: 0,
      filteredItems: 0,
      generatedBriefings: 0,
      insertedOrUpdatedItems: 0,
      lastError: error,
      recordedSourceObservations: 0,
      updatedPreferenceMemories: 0,
    };
  }
}

type DiscoveryChannel =
  | "backlink-from-highscore"
  | "keyword-search"
  | "outlink-network";

interface DiscoveryCandidate {
  channel: DiscoveryChannel;
  evidence: Record<string, unknown>;
  feedUrl: string;
  name: string;
  pageUrl: string;
  topic: SourceDiscoveryTopicRecord;
}

async function discoverFromKeywordSearch(
  topics: SourceDiscoveryTopicRecord[],
  searchProvider: SearchProvider,
): Promise<DiscoveryCandidate[]> {
  const candidates: DiscoveryCandidate[] = [];

  for (const topic of topics) {
    const queries = buildTopicSearchQueries({
      keywords: extractTopicKeywords(topic.profile),
      topicName: topic.name,
    });

    for (const query of queries) {
      try {
        const results = await searchProvider.searchSources(query, { count: 5 });
        for (const result of results) {
          const feeds = await discoverFeedCandidatesFromSearchResult(result, {
            maxCandidates: 4,
          });
          candidates.push(
            ...feeds.map((feed) =>
              feedCandidateToDiscoveryCandidate(feed, topic, "keyword-search", {
                query,
                snippet: result.snippet,
              }),
            ),
          );
        }
      } catch {
        continue;
      }
    }
  }

  return candidates;
}

async function discoverFromHighScoreBacklinks(
  organizationId: string,
  topics: SourceDiscoveryTopicRecord[],
): Promise<DiscoveryCandidate[]> {
  const topicById = mapTopicsById(topics);
  const pages = await listHighScoreEventPagesForDiscovery(getPrismaClient(), {
    days: readPositiveIntegerEnv("WANGCHAO_DISCOVERY_LOOKBACK_DAYS", 14),
    organizationId,
    threshold: readFloatEnv("WANGCHAO_DISCOVERY_HIGHSCORE_THRESHOLD", 0.7),
  }, readPositiveIntegerEnv("WANGCHAO_DISCOVERY_HIGHSCORE_PAGE_LIMIT", 10));
  const candidates: DiscoveryCandidate[] = [];

  for (const page of pages) {
    const topic = topicById.get(page.topicId);
    if (!topic) {
      continue;
    }

    try {
      const feeds = await discoverFeedCandidatesFromPage(page.url, {
        maxCandidates: 4,
        timeoutMs: readPositiveIntegerEnv("WANGCHAO_DISCOVERY_FETCH_TIMEOUT_MS", 5_000),
      });
      candidates.push(
        ...feeds.map((feed) =>
          feedCandidateToDiscoveryCandidate(feed, topic, "backlink-from-highscore", {
            primaryItemUrl: page.url,
          }),
        ),
      );
    } catch {
      continue;
    }
  }

  return candidates;
}

async function discoverFromActiveSourceOutlinks(
  organizationId: string,
  topics: SourceDiscoveryTopicRecord[],
): Promise<DiscoveryCandidate[]> {
  const topicById = mapTopicsById(topics);
  const pages = await listRecentActiveSourcePagesForDiscovery(getPrismaClient(), {
    organizationId,
  }, readPositiveIntegerEnv("WANGCHAO_DISCOVERY_ACTIVE_PAGE_LIMIT", 12));
  const candidates: DiscoveryCandidate[] = [];

  for (const page of pages) {
    const topic = topicById.get(page.topicId);
    if (!topic) {
      continue;
    }

    try {
      const outlinks = await extractExternalLinksFromPage(page.url, {
        timeoutMs: readPositiveIntegerEnv("WANGCHAO_DISCOVERY_FETCH_TIMEOUT_MS", 5_000),
      });
      for (const outlink of outlinks.slice(
        0,
        readPositiveIntegerEnv("WANGCHAO_DISCOVERY_OUTLINKS_PER_PAGE", 3),
      )) {
        try {
          const feeds = await discoverFeedCandidatesFromPage(outlink, {
            maxCandidates: 3,
            timeoutMs: readPositiveIntegerEnv(
              "WANGCHAO_DISCOVERY_FETCH_TIMEOUT_MS",
              5_000,
            ),
          });
          candidates.push(
            ...feeds.map((feed) =>
              feedCandidateToDiscoveryCandidate(feed, topic, "outlink-network", {
                sourceItemUrl: page.url,
                sourceId: page.sourceId,
              }),
            ),
          );
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return candidates;
}

function feedCandidateToDiscoveryCandidate(
  feed: FeedCandidate,
  topic: SourceDiscoveryTopicRecord,
  channel: DiscoveryChannel,
  evidence: Record<string, unknown>,
): DiscoveryCandidate {
  return {
    channel,
    evidence: {
      ...feed.evidence,
      ...evidence,
      pageUrl: feed.pageUrl,
    },
    feedUrl: feed.feedUrl,
    name: feed.name,
    pageUrl: feed.pageUrl,
    topic,
  };
}

async function getSourceRecommendation(
  candidate: DiscoveryCandidate,
  ai: { adapter: SourceRecommendationAdapter; model: string } | null,
): Promise<{ usedAi: boolean; value: SourceRecommendation }> {
  const input = {
    evidence: candidate.evidence,
    sourceName: candidate.name,
    sourceUrl: candidate.feedUrl,
    topicDescription: candidate.topic.description,
    topicKeywords: extractTopicKeywords(candidate.topic.profile),
    topicName: candidate.topic.name,
  };

  if (!ai) {
    return {
      usedAi: false,
      value: fallbackSourceRecommendation(input),
    };
  }

  try {
    return {
      usedAi: true,
      value: await recommendSourceCandidate(input, ai),
    };
  } catch {
    return {
      usedAi: false,
      value: fallbackSourceRecommendation(input),
    };
  }
}

async function createSearchProvider(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<SearchProvider | null> {
  // 1. Try DB-stored credential
  const creds = await getDecryptedCredentials(prisma, { organizationId });
  if (creds?.search?.apiKey) {
    const provider = creds.search.provider ?? "brave";
    if (provider === "brave") {
      return new BraveSearchProvider({ apiKey: creds.search.apiKey });
    }
  }

  // 2. Fallback to env var
  const envProvider = process.env.WANGCHAO_SEARCH_PROVIDER ?? "brave";
  if (envProvider !== "brave") {
    return null;
  }
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new BraveSearchProvider({ apiKey });
}

async function createSourceRecommendationRuntime(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{
  adapter: SourceRecommendationAdapter;
  model: string;
} | null> {
  // 1. Try DB-stored credential
  const creds = await getDecryptedCredentials(prisma, { organizationId });
  if (creds?.ai?.apiKey && creds.ai.baseUrl) {
    return {
      adapter: createOpenAiCompatibleAdapter({
        apiKey: creds.ai.apiKey,
        baseUrl: creds.ai.baseUrl,
      }),
      model: creds.ai.model,
    };
  }

  // 2. Fallback to env var
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  if (!apiKey || !baseUrl) {
    return null;
  }
  return {
    adapter: createOpenAiCompatibleAdapter({
      apiKey,
      baseUrl,
    }),
    model: process.env.AI_MODEL_L1 ?? "gpt-4o-mini",
  };
}

async function createAnalysisRuntime(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{
  adapter: EventExtractionAdapter;
  model: string;
} | null> {
  // 1. Try DB-stored credential
  const creds = await getDecryptedCredentials(prisma, { organizationId });
  if (creds?.ai?.apiKey && creds.ai.baseUrl) {
    return {
      adapter: createOpenAiCompatibleAdapter({
        apiKey: creds.ai.apiKey,
        baseUrl: creds.ai.baseUrl,
      }),
      model: creds.ai.model,
    };
  }

  // 2. Fallback to env var
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  if (!apiKey || !baseUrl) {
    return null;
  }
  return {
    adapter: createOpenAiCompatibleAdapter({
      apiKey,
      baseUrl,
    }),
    model: process.env.AI_MODEL_L1 ?? "gpt-4o-mini",
  };
}

function buildExtractionInput(
  item: {
    id: string;
    title: string;
    summary?: string | null;
    url: string;
    publishedAt?: Date | null;
    sourceId?: string | null;
    sourceName?: string | null;
  },
  topicProfile: unknown,
): {
  item: {
    id: string;
    title: string;
    summary?: string | null;
    url: string;
    publishedAt?: string | null;
    sourceName?: string | null;
  };
  topic: {
    description?: string | null;
    entities?: string[];
    excludeScope?: string[];
    importanceRules?: string[];
    includeScope?: string[];
    keywords: string[];
    name: string;
  };
} {
  const profile = (topicProfile ?? {}) as Record<string, unknown>;
  const keywords = Array.isArray(profile.keywords)
    ? profile.keywords.filter((k): k is string => typeof k === "string")
    : [];
  const entities = Array.isArray(profile.entities)
    ? profile.entities.filter((e): e is string => typeof e === "string")
    : [];
  const includeScope = Array.isArray(profile.includeScope)
    ? profile.includeScope.filter((s): s is string => typeof s === "string")
    : [];
  const excludeScope = Array.isArray(profile.excludeScope)
    ? profile.excludeScope.filter((s): s is string => typeof s === "string")
    : [];
  const importanceRules = Array.isArray(profile.importanceRules)
    ? profile.importanceRules.filter((r): r is string => typeof r === "string")
    : [];

  return {
    item: {
      id: item.id,
      publishedAt: item.publishedAt?.toISOString() ?? null,
      sourceName: item.sourceName ?? null,
      summary: item.summary,
      title: item.title,
      url: item.url,
    },
    topic: {
      description: (profile.description as string | null | undefined) ?? null,
      entities,
      excludeScope,
      importanceRules,
      includeScope,
      keywords,
      name: (profile.name as string | undefined) ?? "",
    },
  };
}

function extractionToAiEventExtraction(
  extraction: EventExtractionResult,
): AiEventExtraction {
  return {
    category: extraction.category,
    entities: extraction.entities ?? [],
    followUpSuggestion: extraction.followUpSuggestion ?? "",
    importanceExplanation: extraction.importanceExplanation,
    isRelevant: extraction.isRelevant,
    matchedKeywords: extraction.matchedKeywords,
    noiseReason: extraction.noiseReason,
    relevanceScore: extraction.relevanceScore,
    summary: extraction.summary,
    title: extraction.title,
  };
}

function dedupeDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  const seen = new Set<string>();
  const unique: DiscoveryCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.topic.id}:${canonicalFeedKey(candidate.feedUrl)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

function limitCandidatesPerTopic(
  candidates: DiscoveryCandidate[],
  limit: number,
): DiscoveryCandidate[] {
  const counts = new Map<string, number>();
  const limited: DiscoveryCandidate[] = [];

  for (const candidate of candidates) {
    const count = counts.get(candidate.topic.id) ?? 0;
    if (count >= limit) {
      continue;
    }
    counts.set(candidate.topic.id, count + 1);
    limited.push(candidate);
  }

  return limited;
}

function mapTopicsById(
  topics: SourceDiscoveryTopicRecord[],
): Map<string, SourceDiscoveryTopicRecord> {
  return new Map(topics.map((topic) => [topic.id, topic]));
}

function canonicalFeedKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

function readPositiveIntegerEnv(key: string, fallback: number): number {
  const value = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readFloatEnv(key: string, fallback: number): number {
  const value = Number.parseFloat(process.env[key] ?? "");
  return Number.isFinite(value) ? value : fallback;
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
    : process.argv.includes("--source-discovery")
      ? runSourceDiscoveryCycle({ mode: "worker" })
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
      if (error instanceof Error && error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }
      if (error !== null && typeof error === "object" && "code" in error) {
        const code = (error as { code: unknown }).code;
        const meta = "meta" in error ? (error as { meta: unknown }).meta : undefined;
        process.stderr.write(`prisma code: ${String(code)}\n`);
        if (meta !== undefined) {
          process.stderr.write(`prisma meta: ${JSON.stringify(meta)}\n`);
        }
      }
      process.exitCode = 1;
    });
}
