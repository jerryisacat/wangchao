import { formatSafeError } from "./lib/safe-log.js";
import {
  createContentHash,
  createIntelligenceEventDraft,
  createIntelligenceEventDraftFromExtraction,
  createUtcDayRange,
  createUtcMonthRange,
  createUtcWeekRange,
  buildTopicProfileContext,
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

import { setupSignalHandlers, resetCycleStartTime, isCycleShuttingDown, isCycleTimeExhausted } from "./modules/lifecycle.js";
import { runInstantPushCycle } from "./modules/instant-push.js";
import { runSourceDiscoveryCycle } from "./modules/discovery.js";
import { runAnalysisCycle, resolveFilteredNoiseReason } from "./modules/analysis.js";
import { runSemanticDedupCycle } from "./modules/dedup.js";
import { runPreferenceLearningCycle } from "./modules/preference.js";
import { runDailyBriefingCycle, runPeriodBriefingCycle } from "./modules/briefing.js";
import { fetchSourceWithRetries, runArticleFetchCycle } from "./modules/fetch.js";
import { createAnalysisRuntimeWithPlan, createSourceRecommendationRuntime } from "./modules/runtime.js";
import {
  runSourceGovernanceObservationCycle,
  runCandidateObservationCycle,
  runExpiredCandidateReviewCycle,
} from "./modules/governance.js";
import { pLimit, getFetchConcurrency, readPositiveIntegerEnv, getTotalConcurrency } from "./modules/env.js";

import type {
  WorkerFetchCycleResult,
  SourceDiscoveryCycleResult,
  SourceDiscoveryCycleOptions,
  WorkerHealthCheckResult,
  InstantPushCycleResult,
  TelegramDeliveryResult,
  ReportGenerationCycleResult,
  ReportGenerationInput,
  DiscoveryChannel,
} from "./modules/types.js";

export type {
  WorkerFetchCycleResult,
  SourceDiscoveryCycleResult,
  SourceDiscoveryCycleOptions,
  WorkerHealthCheckResult,
  InstantPushCycleResult,
  TelegramDeliveryResult,
  ReportGenerationCycleResult,
  ReportGenerationInput,
  DiscoveryChannel,
};

export {
  resolveFilteredNoiseReason,
  runInstantPushCycle,
  runSourceDiscoveryCycle,
  runAnalysisCycle,
  runSemanticDedupCycle,
  runPreferenceLearningCycle,
  runDailyBriefingCycle,
  runPeriodBriefingCycle,
  runSourceGovernanceObservationCycle,
  runCandidateObservationCycle,
  runExpiredCandidateReviewCycle,
  fetchSourceWithRetries,
  runArticleFetchCycle,
};

export { createAnalysisRuntimeWithPlan, createSourceRecommendationRuntime };

const TELEGRAM_DELIVERY_LOOKBACK_HOURS = 2;
const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;

export function describeWorker(): string {
  return "Wangchao worker";
}

export interface StructuredLogStart {
  event: "cycle-start";
  cycle: string;
  timestamp: string;
}

export interface StructuredLogEnd {
  event: "cycle-end";
  cycle: string;
  timestamp: string;
  durationMs: number;
  status: "ok" | "degraded" | "error";
  [key: string]: unknown;
}

function emitStructuredLogStart(cycle: string): number {
  const log = {
    cycle,
    event: "cycle-start",
    timestamp: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(log)}\n`);
  return Date.now();
}

function emitStructuredLogEnd(
  cycle: string,
  startTime: number,
  status: "ok" | "degraded" | "error",
  metrics: Record<string, unknown>,
): void {
  const log = {
    cycle,
    durationMs: Date.now() - startTime,
    event: "cycle-end",
    status,
    timestamp: new Date().toISOString(),
    ...metrics,
  };
  process.stdout.write(`${JSON.stringify(log)}\n`);
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
  resetCycleStartTime();
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
    failedSubCycles: [],
    fetchedSources: 0,
    filteredItems: 0,
    generatedBriefings: 0,
    generatedMonthlyBriefings: 0,
    generatedWeeklyBriefings: 0,
    insertedOrUpdatedItems: 0,
    recordedSourceObservations: 0,
    updatedPreferenceMemories: 0,
  };

  const limit = pLimit(getTotalConcurrency());
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

  if (isCycleShuttingDown() || isCycleTimeExhausted()) return result;

  try {
    const analysisResult = await runAnalysisCycle(
      prisma,
      workspace.organizationId,
      workspace.userId,
    );
    result.analyzedItems = analysisResult.analyzedItems;
    result.createdOrUpdatedEvents = analysisResult.createdOrUpdatedEvents;
    result.filteredItems = analysisResult.filteredItems;
  } catch (error) {
    result.failedSubCycles.push("analysis");
    process.stderr.write(`[fetch-cycle] analysis sub-cycle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  if (isCycleShuttingDown() || isCycleTimeExhausted()) return result;

  try {
    const semanticDedupResult = await runSemanticDedupCycle(
      prisma,
      workspace.organizationId,
    );
    if (semanticDedupResult.llmCalls > 0) {
      await recordUsageEvent(prisma, {
        metadata: {
          merged: semanticDedupResult.merged,
          skipped: semanticDedupResult.skipped,
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
  } catch (error) {
    result.failedSubCycles.push("semantic-dedup");
    process.stderr.write(`[fetch-cycle] semantic-dedup sub-cycle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  if (isCycleShuttingDown() || isCycleTimeExhausted()) return result;

  try {
    result.updatedPreferenceMemories = await runPreferenceLearningCycle(
      prisma,
      workspace.organizationId,
      workspace.userId,
    );
  } catch (error) {
    result.failedSubCycles.push("preference-learning");
    process.stderr.write(`[fetch-cycle] preference-learning sub-cycle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  if (isCycleShuttingDown() || isCycleTimeExhausted()) return result;

  try {
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
  } catch (error) {
    result.failedSubCycles.push("daily-briefing");
    process.stderr.write(`[fetch-cycle] daily-briefing sub-cycle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  if (isCycleShuttingDown() || isCycleTimeExhausted()) return result;

  try {
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
  } catch (error) {
    result.failedSubCycles.push("weekly-briefing");
    process.stderr.write(`[fetch-cycle] weekly-briefing sub-cycle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  if (isCycleShuttingDown() || isCycleTimeExhausted()) return result;

  try {
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
  } catch (error) {
    result.failedSubCycles.push("monthly-briefing");
    process.stderr.write(`[fetch-cycle] monthly-briefing sub-cycle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  if (isCycleShuttingDown() || isCycleTimeExhausted()) return result;

  try {
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
  } catch (error) {
    result.failedSubCycles.push("source-governance");
    process.stderr.write(`[fetch-cycle] source-governance sub-cycle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  if (isCycleShuttingDown() || isCycleTimeExhausted()) return result;

  try {
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
  } catch (error) {
    result.failedSubCycles.push("expired-candidate-review");
    process.stderr.write(`[fetch-cycle] expired-candidate-review sub-cycle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  if (isCycleShuttingDown() || isCycleTimeExhausted()) return result;

  try {
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
  } catch (error) {
    result.failedSubCycles.push("telegram-delivery");
    process.stderr.write(`[fetch-cycle] telegram-delivery sub-cycle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  return result;
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
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
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

export async function runReportGenerationCycle(
  limit = 10,
): Promise<ReportGenerationCycleResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to generate reports.");
  }
  resetCycleStartTime();
  const prisma = getPrismaClient();
  const pending = await listPendingReports(prisma, limit);
  const result: ReportGenerationCycleResult = { scanned: pending.length, generated: 0, failed: 0 };
  for (const report of pending) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
    try {
      await runReportGeneration({
        reportId: report.id,
        organizationId: report.organizationId,
        userId: "report-cron",
      });
      result.generated += 1;
    } catch {
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

  return Array.from(new Set([...terms, ...cjkPhrases]))
    .map((keyword) => keyword.slice(0, 40))
    .slice(0, 10);
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
  setupSignalHandlers();

  const isHealth = process.argv.includes("--health");
  const isSourceDiscovery = process.argv.includes("--source-discovery");
  const isInstantPush = process.argv.includes("--instant-push");
  const isReportGeneration = process.argv.includes("--report-generation");
  const cycleType = isHealth
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
      const safeError = formatSafeError(error);
      emitStructuredLogEnd(cycleType, startTime, "error", { error: safeError });
      process.stderr.write(`worker error: ${safeError.message}\n`);
      process.exitCode = 1;
    })
    .finally(() => disconnectPrismaClient());
}
