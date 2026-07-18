import {
  autoMuteFailingSources,
  classifyTaskRunError,
  getPrismaClient,
  listActiveRssSourcesForFetch,
  recordUsageEvent,
} from "@wangchao/db";
import { runAnalysisCycle } from "./analysis.js";
import { runDailyBriefingCycle, runPeriodBriefingCycle } from "./briefing.js";
import { fetchSourceWithRetries, runArticleFetchCycle } from "./fetch.js";
import {
  runCandidateObservationCycle,
  runExpiredCandidateReviewCycle,
  runSourceGovernanceObservationCycle,
} from "./governance.js";
import { getFetchConcurrency, pLimit, getTotalConcurrency, readPositiveIntegerEnv } from "./env.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";
import { runPreferenceLearningCycle } from "./preference.js";
import { runSemanticDedupCycle } from "./dedup.js";
import { runTelegramDeliveryCycle } from "./telegram-delivery.js";
import type { WorkerFetchCycleResult, WorkspaceScope } from "./types.js";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/**
 * Format a sub-cycle failure log line that never emits raw error.message,
 * URL, stack, or secret. It reuses @wangchao/db `classifyTaskRunError` to
 * derive a fixed low-cardinality error class and combines it with the fixed
 * cycle name. This is the single helper used by all sub-cycle catch blocks
 * (avoids 9 copies of the same sanitization logic).
 */
type FetchSubCycleName =
  | "analysis"
  | "semantic-dedup"
  | "preference-learning"
  | "daily-briefing"
  | "weekly-briefing"
  | "monthly-briefing"
  | "source-governance"
  | "expired-candidate-review"
  | "telegram-delivery";

export function formatSubCycleFailure(cycleName: FetchSubCycleName, error: unknown): string {
  const errorClass = classifyTaskRunError(error);
  return `[fetch-cycle] ${cycleName} sub-cycle failed: ${errorClass}`;
}

/**
 * Execute the full fetch pipeline strictly scoped to `workspace`.
 *
 * All queries, sub-cycles, and usage events use the passed-in
 * `workspace.organizationId` / `workspace.userId`. This function does NOT
 * call `ensureDefaultWorkspace` and does NOT create/complete/fail any
 * TaskRun — it is safe for a durable consumer (Lane 2B) to call after
 * claiming a TaskRun.
 *
 * Caller is responsible for `resetCycleStartTime()` when driving a fresh
 * standalone cycle (the legacy `runFetchCycle` wrapper does this).
 */
export async function runFetchCycleForWorkspace(
  prisma: PrismaClient,
  workspace: WorkspaceScope,
): Promise<WorkerFetchCycleResult> {
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
    autoMutedSources: 0,
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
    process.stderr.write(formatSubCycleFailure("analysis", error) + "\n");
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
    process.stderr.write(formatSubCycleFailure("semantic-dedup", error) + "\n");
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
    process.stderr.write(formatSubCycleFailure("preference-learning", error) + "\n");
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
    process.stderr.write(formatSubCycleFailure("daily-briefing", error) + "\n");
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
    process.stderr.write(formatSubCycleFailure("weekly-briefing", error) + "\n");
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
    process.stderr.write(formatSubCycleFailure("monthly-briefing", error) + "\n");
  }

  if (isCycleShuttingDown() || isCycleTimeExhausted()) return result;

  try {
    const governanceResult = await runSourceGovernanceObservationCycle(
      prisma,
      workspace.organizationId,
    );
    result.recordedSourceObservations = governanceResult.observed;
    result.autoMutedSources = governanceResult.autoMuted;
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
    process.stderr.write(formatSubCycleFailure("source-governance", error) + "\n");
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
    process.stderr.write(formatSubCycleFailure("expired-candidate-review", error) + "\n");
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
    process.stderr.write(formatSubCycleFailure("telegram-delivery", error) + "\n");
  }

  return result;
}
