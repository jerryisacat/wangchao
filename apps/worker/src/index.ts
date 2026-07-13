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
  createUtcMonthRange,
  createUtcWeekRange,
  buildTopicProfileContext,
  DEFAULT_DIGEST_STYLE,
  evaluateRelevance,
  generatePreferenceDeltas,
  PLAN_LIMITS,
  checkAiCallQuota,
  checkInstantPushQuota,
  resolveEffectivePlan,
  shouldUseByok,
  renderDailyBriefingMarkdown,
  renderPeriodBriefingMarkdown,
  type AiEventExtraction,
  type Plan,
  type RelevanceDecision,
} from "@wangchao/core";
import {
  autoMuteFailingSources,
  completeTaskRun,
  createCandidateRssSource,
  createDailyBriefing,
  createDeliveryLog,
  createPeriodBriefing,
  createReport,
  createSourceDiscoveryTaskRun,
  createSourceFetchTaskRun,
  createTaskRun,
  disconnectPrismaClient,
  completeReport,
  ensureDefaultWorkspace,
  failReport,
  failTaskRun,
  getDecryptedCredentials,
  getDecryptedByokCredential,
  getDecryptedTelegramCredential,
  getInstantPushSettings,
  getMonthAiCallCount,
  getSubscriptionPlanView,
  getTodayAiCallCount,
  getPrismaClient,
  listActiveRssSourcesForFetch,
  listActiveTopics,
  listCandidateRssSourcesForObservation,
  listEventsForDailyBriefing,
  listExpiredCandidateSources,
  listFetchedItemsForAnalysis,
  findBriefingsForTelegramDelivery,
  findPendingDeliveryForBriefing,
  listHighScoreEventPagesForDiscovery,
  listItemsWithoutRawContent,
  listInstantPushCandidates,
  listInstantPushOrganizations,
  listPreferenceMemoryForDashboard,
  listRecentActiveSourcePagesForDiscovery,
  listRecentFeedbackSignals,
  listReports,
  listPendingReports,
  listSourceGovernanceReport,
  listTimelineEvents,
  listTopicsForSourceDiscovery,
  markItemFiltered,
  claimInstantPush,
  markInstantPushFailed,
  markInstantPushSent,
  mergeSemanticEvents,
  recordUsageEvent,
  recordSourceFetchFailure,
  recordSourceFetchSuccess,
  recordSourceQualityObservation,
  updateDeliveryLog,
  updateItemRawContent,
  updateReportStatus,
  upsertFetchedItems,
  upsertIntelligenceEventFromItem,
  upsertPreferenceMemory,
  searchReportEvidenceEvents,
  type FetchedSourceRecord,
  type SourceDiscoveryTopicRecord,
} from "@wangchao/db";
import {
  buildTopicSearchQueries,
  createSearchProvider as createSearchProviderFromSources,
  discoverFeedCandidatesFromPage,
  discoverFeedCandidatesFromSearchResult,
  extractExternalLinksFromPage,
  extractTopicKeywords,
  fetchArticleContent,
  fetchRssFeed,
  FetchRssError,
  isFetchRssRetryable,
  type FeedCandidate,
  type SearchProvider,
  type SearchProviderType,
} from "@wangchao/sources";
import {
  TelegramDeliveryError,
  formatEventForInstantPush,
  sendTelegramMessage,
} from "./telegram.js";

const MAX_FETCH_ATTEMPTS = 3;

function getFetchConcurrency(): number {
  const raw = process.env.WANGCHAO_FETCH_CONCURRENCY;
  if (!raw) return 5;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function getCandidateObservationConcurrency(): number {
  const raw = process.env.WANGCHAO_CANDIDATE_OBSERVATION_CONCURRENCY;
  if (!raw) return 3;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function getCandidateObservationLimit(): number {
  return Math.min(getFetchConcurrency(), getCandidateObservationConcurrency());
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
  generatedMonthlyBriefings: number;
  generatedWeeklyBriefings: number;
  insertedOrUpdatedItems: number;
  lastError?: unknown;
  recordedSourceObservations: number;
  updatedPreferenceMemories: number;
}

export interface SourceDiscoveryCycleResult {
  aiRecommendationAttempts: number;
  aiRecommendationFallbacks: number;
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

export interface InstantPushCycleResult {
  organizations: number;
  attempted: number;
  delivered: number;
  failed: number;
  skipped: number;
}

export function resolveFilteredNoiseReason(input: {
  llmNoiseReason?: string;
  ruleDecision?: RelevanceDecision | null;
  usedFallback: boolean;
}): string {
  return (
    input.ruleDecision?.noiseReason ??
    input.llmNoiseReason ??
    (input.usedFallback
      ? "AI 分析失败且规则判定为噪声。"
      : "Item did not pass relevance threshold.")
  );
}

export function describeWorker(): string {
  return "Wangchao worker";
}

type WorkerCycleType = "fetch" | "source-discovery" | "instant-push" | "report-generation" | "health";

interface StructuredLogStart {
  event: "cycle-start";
  cycle: WorkerCycleType;
  timestamp: string;
}

interface StructuredLogEnd {
  event: "cycle-end";
  cycle: WorkerCycleType;
  timestamp: string;
  durationMs: number;
  status: "ok" | "degraded" | "error";
  [key: string]: unknown;
}

function emitStructuredLogStart(cycle: WorkerCycleType): number {
  const log: StructuredLogStart = {
    cycle,
    event: "cycle-start",
    timestamp: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(log)}\n`);
  return Date.now();
}

function emitStructuredLogEnd(
  cycle: WorkerCycleType,
  startTime: number,
  status: "ok" | "degraded" | "error",
  metrics: Record<string, unknown>,
): void {
  const log: StructuredLogEnd = {
    cycle,
    durationMs: Date.now() - startTime,
    event: "cycle-end",
    status,
    timestamp: new Date().toISOString(),
    ...metrics,
  };
  process.stdout.write(`${JSON.stringify(log)}\n`);
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

export async function runInstantPushCycle(): Promise<InstantPushCycleResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to run instant push.");
  }
  const prisma = getPrismaClient();
  const result: InstantPushCycleResult = { organizations: 0, attempted: 0, delivered: 0, failed: 0, skipped: 0 };
  const organizations = await listInstantPushOrganizations(prisma);
  const scoreThreshold = readBoundedNumberEnv("WANGCHAO_INSTANT_PUSH_SCORE_THRESHOLD", 90, 0, 100);
  const maxPerCycle = readPositiveIntegerEnv("WANGCHAO_INSTANT_PUSH_MAX_PER_CYCLE", 10);
  const maxAttempts = readPositiveIntegerEnv("WANGCHAO_INSTANT_PUSH_MAX_ATTEMPTS", 3);

  for (const organization of organizations) {
    result.organizations += 1;
    const taskRun = await createTaskRun(prisma, {
      organizationId: organization.organizationId,
      type: "TELEGRAM_INSTANT_PUSH",
      input: { scoreThreshold, maxPerCycle, maxAttempts },
    });
    try {
      const settings = await getInstantPushSettings(prisma, { organizationId: organization.organizationId });
      const effectivePlan = resolveEffectivePlan({
        plan: settings.plan,
        status: settings.status,
        isSelfHosted: settings.isSelfHosted,
        currentPeriodEnd: settings.currentPeriodEnd,
      });
      const access = checkInstantPushQuota(effectivePlan, settings.isSelfHosted);
      const credential = access.allowed
        ? await getDecryptedTelegramCredential(prisma, { organizationId: organization.organizationId })
        : null;
      if (!access.allowed || !settings.enabledAt || !credential) {
        result.skipped += 1;
        await completeTaskRun(prisma, taskRun.id, {
          outcome: "skipped",
          reason: !access.allowed ? access.reason : "Instant push is not fully configured.",
        });
        continue;
      }
      const candidates = await listInstantPushCandidates(
        prisma,
        { organizationId: organization.organizationId },
        { enabledAt: settings.enabledAt, scoreThreshold, limit: maxPerCycle },
      );
      let delivered = 0;
      let failed = 0;
      let skipped = 0;
      for (const candidate of candidates) {
        const claimed = await claimInstantPush(prisma, {
          eventId: candidate.eventId,
          organizationId: organization.organizationId,
          score: candidate.score,
          recipientRef: credential.chatId,
          maxAttempts,
          staleBefore: new Date(Date.now() - 30 * 60_000),
        });
        if (!claimed) {
          skipped += 1;
          continue;
        }
        result.attempted += 1;
        try {
          await sendTelegramMessage(
            credential.botToken,
            credential.chatId,
            formatEventForInstantPush(candidate),
            "HTML",
          );
          await markInstantPushSent(prisma, claimed.id);
          delivered += 1;
          result.delivered += 1;
        } catch (error) {
          const telegramError = error instanceof TelegramDeliveryError ? error : null;
          await markInstantPushFailed(prisma, claimed.id, {
            attempt: claimed.attempt,
            errorMessage: error instanceof Error ? error.message : "Telegram delivery failed.",
            errorCode: telegramError?.code,
            retryAfterMs: telegramError?.retryAfterMs,
            retryable: (telegramError?.retryable ?? true) && claimed.attempt < maxAttempts,
          });
          failed += 1;
          result.failed += 1;
        }
        await sleep(200);
      }
      if (delivered > 0 || failed > 0) {
        await recordUsageEvent(prisma, {
          organizationId: organization.organizationId,
          userId: organization.userId ?? undefined,
          type: "INSTANT_PUSH",
          quantity: delivered,
          unit: "delivery",
          subjectType: "instant-push-cycle",
          metadata: { attempted: delivered + failed, delivered, failed, skipped },
        });
      }
      result.skipped += skipped;
      await completeTaskRun(prisma, taskRun.id, { outcome: "completed", delivered, failed, skipped });
    } catch (error) {
      result.failed += 1;
      await failTaskRun(prisma, taskRun.id, error);
    }
  }
  return result;
}

function readBoundedNumberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
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
    generatedMonthlyBriefings: 0,
    generatedWeeklyBriefings: 0,
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

  const autoMuteThreshold = readPositiveIntegerEnv("WANGCHAO_AUTO_MUTE_THRESHOLD", 10);
  const mutedSourceIds = await autoMuteFailingSources(prisma, {
    organizationId: workspace.organizationId,
  }, autoMuteThreshold);
  if (mutedSourceIds.length > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        autoMutedCount: mutedSourceIds.length,
        mutedSourceIds,
        source: "worker-auto-mute",
        threshold: autoMuteThreshold,
      },
      organizationId: workspace.organizationId,
      quantity: mutedSourceIds.length,
      subjectType: "source-auto-mute",
      type: "SOURCE_GOVERNANCE",
      unit: "source",
      userId: workspace.userId,
    });
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

  await runCandidateObservationCycle(prisma, workspace.organizationId);

  await runArticleFetchCycle(prisma, workspace.organizationId);

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
  result.generatedWeeklyBriefings = await runPeriodBriefingCycle(
    prisma,
    workspace.organizationId,
    workspace.userId,
    "WEEKLY",
  );
  if (result.generatedWeeklyBriefings > 0) {
    await recordUsageEvent(prisma, {
      metadata: { source: "worker-weekly-briefing-cycle" },
      organizationId: workspace.organizationId,
      quantity: result.generatedWeeklyBriefings,
      subjectType: "weekly-briefing-cycle",
      type: "BRIEFING",
      unit: "briefing",
      userId: workspace.userId,
    });
  }
  result.generatedMonthlyBriefings = await runPeriodBriefingCycle(
    prisma,
    workspace.organizationId,
    workspace.userId,
    "MONTHLY",
  );
  if (result.generatedMonthlyBriefings > 0) {
    await recordUsageEvent(prisma, {
      metadata: { source: "worker-monthly-briefing-cycle" },
      organizationId: workspace.organizationId,
      quantity: result.generatedMonthlyBriefings,
      subjectType: "monthly-briefing-cycle",
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

  const expiryResult = await runExpiredCandidateReviewCycle(
    prisma,
    workspace.organizationId,
  );
  if (expiryResult.reviewed > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        autoApproved: expiryResult.autoApproved,
        autoRejected: expiryResult.autoRejected,
        reviewed: expiryResult.reviewed,
        source: "worker-expired-candidate-review",
      },
      organizationId: workspace.organizationId,
      quantity: expiryResult.reviewed,
      subjectType: "candidate-review",
      type: "SOURCE_GOVERNANCE",
      unit: "review",
      userId: workspace.userId,
    });
  }

  const telegramResult = await runTelegramDeliveryCycle(
    prisma,
    workspace.organizationId,
    workspace.userId,
  );
  if (telegramResult.delivered > 0 || telegramResult.failed > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        delivered: telegramResult.delivered,
        failed: telegramResult.failed,
        skipped: telegramResult.skipped,
        source: "worker-telegram-delivery-cycle",
      },
      organizationId: workspace.organizationId,
      quantity: telegramResult.delivered + telegramResult.failed,
      subjectType: "telegram-delivery-cycle",
      type: "BRIEFING",
      unit: "delivery",
      userId: workspace.userId,
    });
  }

  return result;
}

async function runArticleFetchCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ fetched: number; failed: number }> {
  const result = { fetched: 0, failed: 0 };
  const items = await listItemsWithoutRawContent(prisma, { organizationId });

  if (items.length === 0) return result;

  const limit = pLimit(getFetchConcurrency());
  const articleResults = await Promise.all(
    items.map((item) =>
      limit(async () => {
        try {
          const content = await fetchArticleContent(item.url);
          if (content) {
            await updateItemRawContent(prisma, item.id, content);
            result.fetched += 1;
          }
        } catch {
          result.failed += 1;
        }
      }),
    ),
  );
  void articleResults;

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
    aiRecommendationAttempts: 0,
    aiRecommendationFallbacks: 0,
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
      result.aiRecommendationAttempts += recommendation.attemptedAi ? 1 : 0;
      result.aiRecommendationFallbacks +=
        recommendation.attemptedAi && !recommendation.usedAi ? 1 : 0;
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

    if (result.aiRecommendationAttempts > 0) {
      await recordUsageEvent(prisma, {
        metadata: {
          fallbackCalls: result.aiRecommendationFallbacks,
          source: "worker-source-recommendation",
          successfulCalls: result.aiRecommendations,
          taskRunId: taskRun.id,
        },
        organizationId: workspace.organizationId,
        quantity: result.aiRecommendationAttempts,
        subjectId: taskRun.id,
        subjectType: "task-run",
        type: "AI_CALL",
        unit: "call",
        userId: options.userId ?? workspace.userId,
      });
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
  const aiRuntime = await createAnalysisRuntimeWithPlan(prisma, organizationId);
  const ai = aiRuntime
    ? { adapter: aiRuntime.adapter, model: aiRuntime.model }
    : null;
  const aiSource = aiRuntime?.source ?? "official";
  const result = {
    analyzedItems: 0,
    createdOrUpdatedEvents: 0,
    filteredItems: 0,
    llmAttempts: 0,
    llmItems: 0,
    llmFallbackItems: 0,
  };

  for (const item of items) {
    const relevanceTask = await createTaskRun(prisma, {
      input: {
        mode: ai ? "llm-with-rules-fallback" : "explainable-rules",
      },
      itemId: item.id,
      organizationId,
      topicId: item.topicId,
      type: "AI_RELEVANCE",
    });

    try {
      let draft = null;
      let rawAiResponse: Record<string, unknown> = {
        mode: "uninitialized",
      };
      let ruleDecision: RelevanceDecision | null = null;
      let llmNoiseReason: string | undefined;
      let usedLlm = false;
      let usedFallback = false;

      if (ai) {
        result.llmAttempts += 1;
        const extractionTask = await createTaskRun(prisma, {
          input: { model: ai.model },
          itemId: item.id,
          organizationId,
          topicId: item.topicId,
          type: "AI_EVENT_EXTRACTION",
        });

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
          llmNoiseReason = extraction.noiseReason;
          usedLlm = true;
          await completeTaskRun(prisma, extractionTask.id, {
            isRelevant: extraction.isRelevant,
            model: ai.model,
            noiseReason: extraction.noiseReason,
            outcome: draft ? "draft-created" : "filtered",
          });
        } catch (error) {
          usedFallback = true;
          await failTaskRun(prisma, extractionTask.id, error);
          process.stderr.write(
            `[analysis-cycle] LLM extraction failed for item ${item.id} (topic ${item.topicId}): ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }

      if (!usedLlm) {
        ruleDecision = evaluateRelevance({
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
          ruleDecision,
        );
        rawAiResponse = {
          mode: "explainable-rules",
          relevance: ruleDecision,
          ...(usedFallback ? { llmFallback: true } : {}),
        };
      }

      result.analyzedItems += 1;
      if (usedLlm) result.llmItems += 1;
      if (usedFallback) result.llmFallbackItems += 1;

      if (!draft) {
        const noiseReason = resolveFilteredNoiseReason({
          llmNoiseReason,
          ruleDecision,
          usedFallback,
        });
        await markItemFiltered(prisma, item.id, noiseReason);
        result.filteredItems += 1;
        await completeTaskRun(prisma, relevanceTask.id, {
          llmFallback: usedFallback,
          mode: usedLlm ? "llm" : "explainable-rules",
          noiseReason,
          outcome: "filtered",
        });
        continue;
      }

      const event = await upsertIntelligenceEventFromItem(prisma, {
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
      await completeTaskRun(prisma, relevanceTask.id, {
        eventId: event.id,
        llmFallback: usedFallback,
        mode: usedLlm ? "llm" : "explainable-rules",
        outcome: "event-upserted",
      });
    } catch (error) {
      await failTaskRun(prisma, relevanceTask.id, error);
      throw error;
    }
  }

  if (ai && result.llmAttempts > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        aiSource,
        attemptedItems: result.llmAttempts,
        filteredItems: result.filteredItems,
        fallbackItems: result.llmFallbackItems,
        source: "worker-analysis-cycle",
        successfulItems: result.llmItems,
      },
      organizationId,
      quantity: result.llmAttempts,
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

  const aiRuntime = await createAnalysisRuntimeWithPlan(prisma, organizationId);
  if (!aiRuntime) return result;
  const ai = { adapter: aiRuntime.adapter, model: aiRuntime.model };

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
        result.llmCalls += 1;
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
    const taskRun = await createTaskRun(prisma, {
      input: {
        period: "DAILY",
        rangeEnd: rangeEnd.toISOString(),
        rangeStart: rangeStart.toISOString(),
      },
      organizationId,
      topicId: topic.id,
      type: "BRIEFING_GENERATION",
    });

    try {
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
        await completeTaskRun(prisma, taskRun.id, {
          eventCount: 0,
          outcome: "skipped-no-events",
        });
        continue;
      }

      const context = buildTopicProfileContext(topic.profile, {
        description: topic.description,
        name: topic.name,
      });

      const markdown = renderDailyBriefingMarkdown({
        digestStyle: context.digestStyle ?? DEFAULT_DIGEST_STYLE,
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
      const briefing = await createDailyBriefing(prisma, {
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
      await completeTaskRun(prisma, taskRun.id, {
        briefingId: briefing.id,
        eventCount: events.length,
        outcome: "upserted",
      });
      generatedBriefings += 1;
    } catch (error) {
      await failTaskRun(prisma, taskRun.id, error);
      throw error;
    }
  }

  return generatedBriefings;
}

async function runPeriodBriefingCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  userId: string,
  period: "WEEKLY" | "MONTHLY",
): Promise<number> {
  const topics = await listActiveTopics(prisma, { organizationId });
  let generatedBriefings = 0;

  for (const topic of topics) {
    const generatedAt = new Date();
    const { rangeEnd, rangeStart } =
      period === "WEEKLY"
        ? createUtcWeekRange(generatedAt)
        : createUtcMonthRange(generatedAt);

    const taskRun = await createTaskRun(prisma, {
      input: {
        period,
        rangeEnd: rangeEnd.toISOString(),
        rangeStart: rangeStart.toISOString(),
      },
      organizationId,
      topicId: topic.id,
      type: "BRIEFING_GENERATION",
    });

    try {
      const timelineResult = await listTimelineEvents(
        prisma,
        { organizationId, rangeEnd, rangeStart, topicId: topic.id },
        1,
        100,
      );
      const events = timelineResult.events;

      if (events.length === 0) {
        await completeTaskRun(prisma, taskRun.id, {
          eventCount: 0,
          outcome: "skipped-no-events",
          period,
        });
        continue;
      }

      const preferences = (
        await listPreferenceMemoryForDashboard(prisma, { organizationId, userId })
      )
        .filter((preference) => preference.topicId === topic.id)
        .map((preference) => ({
          explanation: preference.explanation,
          key: preference.key,
          weight: preference.weight,
        }));

      const context = buildTopicProfileContext(topic.profile, {
        description: topic.description,
        name: topic.name,
      });

      const markdown = renderPeriodBriefingMarkdown({
        digestStyle: context.digestStyle ?? DEFAULT_DIGEST_STYLE,
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
        period,
        preferences,
        rangeEnd,
        rangeStart,
        topicName: topic.name,
      });
      const titleSuffix = period === "WEEKLY" ? "Weekly Briefing" : "Monthly Briefing";
      const briefing = await createPeriodBriefing(prisma, {
        content: markdown,
        eventIds: events.map((event) => event.eventId),
        generatedAt,
        markdown,
        metadata: {
          contentHash: createContentHash(markdown),
          mode: "explainable-rules",
          period,
        },
        organizationId,
        period,
        rangeEnd,
        rangeStart,
        title: `${topic.name} ${titleSuffix}`,
        topicId: topic.id,
      });
      await completeTaskRun(prisma, taskRun.id, {
        briefingId: briefing.id,
        eventCount: events.length,
        outcome: "upserted",
        period,
      });
      generatedBriefings += 1;
    } catch (error) {
      await failTaskRun(prisma, taskRun.id, error);
      throw error;
    }
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

async function runCandidateObservationCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ observedCandidates: number; failedCandidates: number; insertedItems: number }> {
  const result = { observedCandidates: 0, failedCandidates: 0, insertedItems: 0 };

  if (process.env.WANGCHAO_CANDIDATE_OBSERVATION_ENABLED !== "true") {
    return result;
  }

  const candidates = await listCandidateRssSourcesForObservation(prisma, { organizationId });
  if (candidates.length === 0) return result;

  const limit = pLimit(getCandidateObservationLimit());

  const candidateResults = await Promise.all(
    candidates.map((source) => limit(async () => {
      try {
        const items = await fetchRssFeed(source.url);
        const writtenItems = await upsertFetchedItems(prisma, items.map((item) => ({
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
          rawMetadata: { ...item.rawMetadata, candidateObservation: true },
        })));
        await recordSourceFetchSuccess(prisma, source.id);
        result.observedCandidates += 1;
        result.insertedItems += writtenItems.length;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await recordSourceFetchFailure(prisma, source.id, errorMessage);
        result.failedCandidates += 1;
      }
    })),
  );
  void candidateResults;

  return result;
}

async function runExpiredCandidateReviewCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ reviewed: number; autoApproved: number; autoRejected: number }> {
  const result = { reviewed: 0, autoApproved: 0, autoRejected: 0 };

  const expired = await listExpiredCandidateSources(prisma, { organizationId });
  if (expired.length === 0) return result;

  for (const candidate of expired) {
    result.reviewed += 1;

    const itemCount = await prisma.item.count({
      where: {
        sourceId: candidate.sourceId,
        intelligenceEvents: { some: {} },
      },
    });

    if (itemCount > 0) {
      await prisma.source.update({
        data: { status: "ACTIVE", observeExpiresAt: null },
        where: { id: candidate.sourceId },
      });
      result.autoApproved += 1;
    } else {
      await prisma.source.update({
        data: { status: "REJECTED", observeExpiresAt: null },
        where: { id: candidate.sourceId },
      });
      result.autoRejected += 1;
    }
  }

  return result;
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
    generatedMonthlyBriefings: 0,
    generatedWeeklyBriefings: 0,
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
      generatedMonthlyBriefings: 0,
      generatedWeeklyBriefings: 0,
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
      generatedMonthlyBriefings: 0,
      generatedWeeklyBriefings: 0,
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
): Promise<{
  attemptedAi: boolean;
  usedAi: boolean;
  value: SourceRecommendation;
}> {
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
      attemptedAi: false,
      usedAi: false,
      value: fallbackSourceRecommendation(input),
    };
  }

  try {
    return {
      attemptedAi: true,
      usedAi: true,
      value: await recommendSourceCandidate(input, ai),
    };
  } catch {
    return {
      attemptedAi: true,
      usedAi: false,
      value: fallbackSourceRecommendation(input),
    };
  }
}

async function createSearchProvider(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<SearchProvider | null> {
  const creds = await getDecryptedCredentials(prisma, { organizationId });
  if (creds?.search?.apiKey) {
    const provider = creds.search.provider ?? "brave";
    const providerType = provider as SearchProviderType;
    if (providerType === "searxng") {
      return createSearchProviderFromSources("searxng", { baseUrl: creds.search.apiKey });
    }
    return createSearchProviderFromSources(providerType, { apiKey: creds.search.apiKey });
  }

  const envProvider = (process.env.WANGCHAO_SEARCH_PROVIDER ?? "brave") as SearchProviderType;

  if (envProvider === "searxng") {
    const baseUrl = process.env.SEARXNG_BASE_URL;
    return baseUrl ? createSearchProviderFromSources("searxng", { baseUrl }) : null;
  }

  const apiKey =
    envProvider === "tavily" ? process.env.TAVILY_API_KEY :
    envProvider === "serper" ? process.env.SERPER_API_KEY :
    process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) return null;
  return createSearchProviderFromSources(envProvider, { apiKey });
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

interface AnalysisRuntimeResult {
  adapter: EventExtractionAdapter;
  model: string;
  source: "official" | "byok" | "official_fallback";
}

async function createAnalysisRuntimeWithPlan(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<AnalysisRuntimeResult | null> {
  const planView = await getSubscriptionPlanView(prisma, { organizationId });
  const isSelfHosted = planView.isSelfHosted;
  const plan = resolveEffectivePlan({
    plan: planView.plan,
    status: planView.status ?? "ACTIVE",
    isSelfHosted,
    currentPeriodEnd: planView.currentPeriodEnd,
  });

  const todayCalls = await getTodayAiCallCount(prisma, { organizationId });
  const monthCalls = await getMonthAiCallCount(prisma, { organizationId });

  const quotaCheck = checkAiCallQuota(plan, todayCalls, monthCalls, isSelfHosted);
  if (!quotaCheck.allowed) {
    process.stderr.write(
      `[quota] AI calls blocked for org ${organizationId}: ${quotaCheck.reason}\n`,
    );
    return null;
  }

  const byokCred = await getDecryptedByokCredential(prisma, { organizationId });
  const hasByok =
    byokCred !== null && Boolean(byokCred.apiKey) && Boolean(byokCred.baseUrl);

  const byokStrategy = shouldUseByok(plan, monthCalls, isSelfHosted, hasByok);

  if (byokStrategy.useByok && byokCred) {
    return {
      adapter: createOpenAiCompatibleAdapter({
        apiKey: byokCred.apiKey,
        baseUrl: byokCred.baseUrl,
      }),
      model: byokCred.model,
      source: "byok",
    };
  }

  if (!byokStrategy.fallbackToOfficial) {
    process.stderr.write(
      `[quota] AI calls blocked for org ${organizationId}: ${byokStrategy.reason}\n`,
    );
    return null;
  }

  const officialRuntime = await createOfficialAiRuntime(prisma, organizationId);
  if (!officialRuntime) {
    return null;
  }

  return {
    ...officialRuntime,
    source: "official",
  };
}

async function createOfficialAiRuntime(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ adapter: EventExtractionAdapter; model: string } | null> {
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
    rawContent?: string | null;
    sourceId?: string | null;
    sourceName?: string | null;
    topicDescription?: string | null;
    topicName: string;
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
    rawContent?: string | null;
  };
  topic: {
    description?: string | null;
    entities?: string[];
    excludeScope?: string[];
    importanceRules?: string[];
    includeScope?: string[];
    keywords: string[];
    name: string;
    languagePreferences?: {
      outputLanguage: string;
      terminologyRules?: string[];
    };
  };} {
  const context = buildTopicProfileContext(topicProfile, {
    description: item.topicDescription,
    name: item.topicName,
  });

  return {
    item: {
      id: item.id,
      publishedAt: item.publishedAt?.toISOString() ?? null,
      sourceName: item.sourceName ?? null,
      summary: item.summary,
      title: item.title,
      url: item.url,
      rawContent: item.rawContent ?? null,
    },
    topic: {
      ...context,
      languagePreferences: context.languagePreferences,
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

const TELEGRAM_DELIVERY_LOOKBACK_HOURS = 2;
const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;

export interface TelegramDeliveryResult {
  delivered: number;
  failed: number;
  skipped: number;
}

async function runTelegramDeliveryCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  userId: string,
): Promise<TelegramDeliveryResult> {
  const result: TelegramDeliveryResult = { delivered: 0, failed: 0, skipped: 0 };

  const credential = await getDecryptedTelegramCredential(prisma, { organizationId });
  if (!credential) {
    return result;
  }

  const since = new Date();
  since.setUTCHours(since.getUTCHours() - TELEGRAM_DELIVERY_LOOKBACK_HOURS);

  const briefings = await findBriefingsForTelegramDelivery(
    prisma,
    { organizationId },
    since,
  );

  if (briefings.length === 0) {
    return result;
  }

  for (const briefing of briefings) {
    const existing = await findPendingDeliveryForBriefing(
      prisma,
      briefing.briefingId,
      "TELEGRAM",
    );
    if (existing && (existing.status === "SENT" || existing.status === "SKIPPED")) {
      result.skipped += 1;
      continue;
    }

    const deliveryLog = existing ?? await createDeliveryLog(prisma, {
      organizationId,
      briefingId: briefing.briefingId,
      channel: "TELEGRAM",
      status: "PENDING",
      recipientRef: credential.chatId,
    });

    const taskRun = await createTaskRun(prisma, {
      input: {
        briefingId: briefing.briefingId,
        channel: "TELEGRAM",
        chatId: credential.chatId,
      },
      organizationId,
      type: "TELEGRAM_DELIVERY",
    });

    try {
      const markdown = briefing.markdown ?? "";
      const messageText = formatBriefingForTelegram(
        markdown,
        briefing.briefingTitle,
        briefing.topicName,
      );

      await sendTelegramMessage(
        credential.botToken,
        credential.chatId,
        messageText,
      );

      await updateDeliveryLog(prisma, deliveryLog.id, {
        status: "SENT",
        attempt: deliveryLog.attempt + 1,
      });
      await completeTaskRun(prisma, taskRun.id, {
        briefingId: briefing.briefingId,
        outcome: "sent",
      });
      result.delivered += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = extractTelegramErrorCode(error);

      await updateDeliveryLog(prisma, deliveryLog.id, {
        status: "FAILED",
        attempt: deliveryLog.attempt + 1,
        errorMessage,
        errorCode,
      });
      await failTaskRun(prisma, taskRun.id, error);
      result.failed += 1;
    }
  }

  return result;
}

function formatBriefingForTelegram(
  markdown: string,
  title: string,
  topicName: string,
): string {
  const header = `📰 *${escapeTelegramMarkdown(title)}*\n`;
  const body = markdown
    .replace(/^---[\s\S]*?---\n?/m, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
    .trim();

  const full = `${header}\n${body}`;
  if (full.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    return full;
  }

  return `${full.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 20)}\n\n…（已截断）`;
}

function escapeTelegramMarkdown(text: string): string {
  return text.replace(/[*_`\[\]]/g, "\\$&");
}

function extractTelegramErrorCode(error: unknown): string | null {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : String(code);
  }
  return null;
}

export interface ReportGenerationInput {
  reportId: string;
  organizationId: string;
  userId: string;
}

export async function runReportGeneration(
  input: ReportGenerationInput,
): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to generate reports.");
  }

  const prisma = getPrismaClient();
  const report = await prisma.report.findFirst({
    where: {
      id: input.reportId,
      organizationId: input.organizationId,
    },
  });

  if (!report) {
    throw new Error("Report not found.");
  }
  if (report.status !== "PENDING") {
    return;
  }

  await updateReportStatus(prisma, report.id, "GENERATING");

  const taskRun = await createTaskRun(prisma, {
    input: { reportId: report.id, question: report.question },
    organizationId: input.organizationId,
    type: "REPORT_GENERATION",
  });

  try {
    const keywords = extractReportKeywords(report.question);
    const events = await searchReportEvidenceEvents(
      prisma,
      { organizationId: input.organizationId },
      { keywords, limit: 30 },
    );

    if (events.length < 3) {
      await completeReport(prisma, report.id, {
        markdown: buildInsufficientDataReport(report.question, events),
        summary: "情报库中没有足够的相关信息来生成专题报告。",
        eventCount: events.length,
        itemCount: 0,
        topicIds: Array.from(new Set(events.map((e) => e.topicId))),
        sourceIds: Array.from(new Set(events.map((e) => e.sourceId).filter(Boolean))) as string[],
        coverageNote: `情报库中仅找到 ${events.length} 条相关事件（建议阈值 ≥ 3）。建议创建相关主题或补充信源。`,
        metadata: { keywords, threshold: 3 },
      });
      await completeTaskRun(prisma, taskRun.id, {
        outcome: "insufficient-data",
        eventCount: events.length,
      });
      return;
    }

    const aiRuntime = await createAnalysisRuntimeWithPlan(
      prisma,
      input.organizationId,
    );
    const ai = aiRuntime
      ? { adapter: aiRuntime.adapter, model: aiRuntime.model }
      : null;
    let markdown: string;
    if (ai) {
      markdown = await generateReportWithAi(ai, report.question, events);
    } else {
      markdown = generateReportRuleBased(report.question, events);
    }

    const summary = markdown.slice(0, 200).replace(/\n/g, " ").trim();
    const topicIds = Array.from(new Set(events.map((e) => e.topicId)));
    const sourceIds = Array.from(
      new Set(events.map((e) => e.sourceId).filter((id): id is string => Boolean(id))),
    );

    await completeReport(prisma, report.id, {
      markdown,
      summary,
      eventCount: events.length,
      itemCount: events.length,
      topicIds,
      sourceIds,
      coverageNote: `报告基于情报库中 ${events.length} 条相关事件生成，涉及 ${topicIds.length} 个主题和 ${sourceIds.length} 个信源。`,
      metadata: {
        keywords,
        topicsInvolved: topicIds.length,
        sourcesInvolved: sourceIds.length,
        usedAi: Boolean(ai),
      },
    });
    await completeTaskRun(prisma, taskRun.id, {
      outcome: "completed",
      eventCount: events.length,
    });

    await recordUsageEvent(prisma, {
      metadata: {
        keywords,
        reportId: report.id,
        source: "worker-report-generation",
        usedAi: Boolean(ai),
      },
      organizationId: input.organizationId,
      quantity: 1,
      subjectId: report.id,
      subjectType: "report",
      type: "AI_CALL",
      unit: "report",
      userId: input.userId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await failReport(prisma, report.id, errorMessage);
    await failTaskRun(prisma, taskRun.id, error);
    throw error;
  }
}

export interface ReportGenerationCycleResult {
  scanned: number;
  generated: number;
  failed: number;
}

/**
 * 扫描所有 PENDING 报告并逐个生成。
 * 作为独立 Railway Cron service 运行，与 Web 进程解耦。
 * 每个报告独立处理，单个失败不影响后续报告。
 */
export async function runReportGenerationCycle(
  limit = 10,
): Promise<ReportGenerationCycleResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to generate reports.");
  }
  const prisma = getPrismaClient();
  const pending = await listPendingReports(prisma, limit);
  const result: ReportGenerationCycleResult = { scanned: pending.length, generated: 0, failed: 0 };
  for (const report of pending) {
    try {
      await runReportGeneration({
        reportId: report.id,
        organizationId: report.organizationId,
        userId: "report-cron",
      });
      result.generated += 1;
    } catch {
      // runReportGeneration 内部已 failReport + failTaskRun，这里只计数
      result.failed += 1;
    }
  }
  return result;
}

function extractReportKeywords(question: string): string[] {
  const cleaned = question
    .replace(/[？?！!。，,.;:：、\s]+/g, " ")
    .trim();
  const terms = cleaned
    .split(" ")
    .filter((term) => term.length >= 2)
    .filter((term) => !REPORT_STOP_WORDS.has(term.toLowerCase()));

  const cjkPhrases = [...question.matchAll(/[\u4e00-\u9fff]{2,10}/g)].map((m) => m[0]);

  return Array.from(new Set([...terms, ...cjkPhrases])).slice(0, 10);
}

const REPORT_STOP_WORDS = new Set([
  "怎么样",
  "怎么样了",
  "现在",
  "目前",
  "最新",
  "情况",
  "状态",
  "如何",
  "什么",
  "有哪些",
  "关于",
  "最近",
  "今天",
  "昨天",
  "这个",
  "那个",
  "they",
  "them",
  "what",
  "how",
  "when",
  "where",
  "why",
  "the",
  "and",
]);

function buildInsufficientDataReport(
  question: string,
  events: Array<{ title: string; summary: string; sourceName: string | null }>,
): string {
  const lines = [
    `# ${question}`,
    "",
    "## 当前情报库覆盖不足",
    "",
    `望潮情报库中关于此问题的相关信息不足（仅找到 ${events.length} 条相关事件），无法生成完整专题报告。`,
    "",
    "### 建议",
    "",
    "- 创建更精准的关注主题，覆盖此问题",
    "- 为相关主题补充更多信源",
    "- 等待系统后续抓取周期积累更多信息",
  ];

  if (events.length > 0) {
    lines.push("", "### 已找到的相关事件", "");
    for (const event of events.slice(0, 5)) {
      lines.push(`- **${event.title}** — ${event.summary.slice(0, 100)}`);
      if (event.sourceName) {
        lines.push(`  - 来源: ${event.sourceName}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function generateReportRuleBased(
  question: string,
  events: Array<{
    title: string;
    summary: string;
    category: string | null;
    score: number;
    occurredAt: Date | null;
    sourceName: string | null;
    topicName: string;
  }>,
): string {
  const now = new Date();
  const lines: Array<string | undefined> = [
    "---",
    `title: ${JSON.stringify(question)}`,
    `created: ${now.toISOString()}`,
    "format: wangchao-topic-report",
    `events: ${events.length}`,
    "---",
    "",
    `# ${question}`,
    "",
    `> 基于情报库中 ${events.length} 条相关事件生成 · ${now.toISOString()}`,
    "",
    "## 1. 摘要判断",
    "",
    `本报告基于望潮情报库中已抓取并分析的 ${events.length} 条情报事件，围绕"${question}"提供当前态势概览。报告仅基于已有情报，不做推测。`,
    "",
    "## 2. 最近关键进展",
    "",
  ];

  for (const [index, event] of events.slice(0, 10).entries()) {
    lines.push(`### ${index + 1}. ${event.title}`, "");
    lines.push(event.summary);
    lines.push("");
    lines.push(`- 主题: ${event.topicName}`);
    if (event.sourceName) {
      lines.push(`- 来源: ${event.sourceName}`);
    }
    if (event.occurredAt) {
      lines.push(`- 时间: ${event.occurredAt.toISOString()}`);
    }
    lines.push(`- 评分: ${Math.round(event.score)}`);
    lines.push("");
  }

  if (events.length > 10) {
    lines.push(`> 还有 ${events.length - 10} 条事件未在此列出。`, "");
  }

  lines.push("## 3. 信息来源与可信度", "");
  const sources = Array.from(
    new Set(events.map((e) => e.sourceName).filter((s): s is string => Boolean(s))),
  );
  for (const source of sources.slice(0, 10)) {
    lines.push(`- ${source}`);
  }
  lines.push("");

  lines.push(
    "## 4. 信息覆盖不足",
    "",
    `本报告仅基于望潮情报库中已有信息，可能存在覆盖不足。情报库中没有的信息不会出现在报告中。`,
    "",
    "## 5. 建议后续关注点",
    "",
    "- 持续关注相关主题的最新抓取",
    "- 补充更多信源以提升覆盖面",
    "- 利用 AI 重新生成获取更深度的分析（需要配置 AI 凭证）",
  );

  return `${lines.filter((l): l is string => l !== undefined).join("\n")}\n`;
}

async function generateReportWithAi(
  ai: { adapter: EventExtractionAdapter; model: string },
  question: string,
  events: Array<{
    title: string;
    summary: string;
    category: string | null;
    score: number;
    occurredAt: Date | null;
    sourceName: string | null;
    topicName: string;
  }>,
): Promise<string> {
  const systemPrompt = `你是一个专业的情报分析师。基于用户提供的情报事件，围绕用户问题生成一份结构化的中文专题报告。

要求：
1. 只使用提供的事件作为信息来源，不编造信息。
2. 如果信息不足，明确说明覆盖不足，不补全推测。
3. 报告格式为 Markdown，包含以下章节：
   ## 1. 摘要判断
   ## 2. 最近关键进展
   ## 3. 主要参与方与立场
   ## 4. 时间线
   ## 5. 影响分析
   ## 6. 信息来源与可信度
   ## 7. 当前情报库覆盖不足
   ## 8. 建议后续关注点
4. 关键判断尽量关联具体事件。`;

  const eventsContext = events
    .slice(0, 20)
    .map(
      (e, i) =>
        `[${i + 1}] ${e.title}\n摘要: ${e.summary}\n来源: ${e.sourceName ?? "未知"}\n主题: ${e.topicName}\n时间: ${e.occurredAt?.toISOString() ?? "未知"}\n评分: ${Math.round(e.score)}`,
    )
    .join("\n\n");

  const userPrompt = `问题：${question}\n\n相关情报事件（共 ${events.length} 条）：\n\n${eventsContext}`;

  const response = await ai.adapter.chat({
    maxTokens: 2000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    model: ai.model,
    temperature: 0.3,
  });

  const now = new Date();
  const header = [
    "---",
    `title: ${JSON.stringify(question)}`,
    `created: ${now.toISOString()}`,
    "format: wangchao-topic-report",
    `events: ${events.length}`,
    "ai_generated: true",
    "---",
    "",
    `# ${question}`,
    "",
    `> 基于情报库中 ${events.length} 条相关事件由 AI 生成 · ${now.toISOString()}`,
    "",
  ].join("\n");

  return `${header}\n${response.content.trim()}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const isHealth = process.argv.includes("--health");
  const isSourceDiscovery = process.argv.includes("--source-discovery");
  const isInstantPush = process.argv.includes("--instant-push");
  const isReportGeneration = process.argv.includes("--report-generation");
  const cycleType: WorkerCycleType = isHealth
    ? "health"
    : isSourceDiscovery
      ? "source-discovery"
      : isInstantPush
        ? "instant-push"
      : isReportGeneration
        ? "report-generation"
      : "fetch";

  const startTime = emitStructuredLogStart(cycleType);

  const command = isHealth
    ? runWorkerHealthCheck()
    : isSourceDiscovery
      ? runSourceDiscoveryCycle({ mode: "worker" })
      : isInstantPush
        ? runInstantPushCycle()
      : isReportGeneration
        ? runReportGenerationCycle()
      : runFetchCycle();

  command
    .then((result) => {
      if ("status" in result && result.status === "degraded") {
        emitStructuredLogEnd(cycleType, startTime, "degraded", { result });
        process.exitCode = 1;
      } else {
        emitStructuredLogEnd(cycleType, startTime, "ok", { result });
      }
    })
    .catch((error: unknown) => {
      emitStructuredLogEnd(cycleType, startTime, "error", {
        error: error instanceof Error ? error.message : String(error),
      });
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
    })
    .finally(() => disconnectPrismaClient());
}
