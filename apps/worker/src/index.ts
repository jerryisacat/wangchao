import { disconnectPrismaClient } from "@wangchao/db";
import { formatSafeError } from "./lib/safe-log.js";
import {
  getCycleRemainingMs,
  resetCycleTimeBudget,
  setupSignalHandlers,
} from "./modules/lifecycle.js";
import { getSoftTimeoutMs } from "./modules/env.js";
import { runInstantPushCycle } from "./modules/instant-push.js";
import { runSourceDiscoveryCycle } from "./modules/discovery.js";
import { canUseCapturedContentForLlm, runAnalysisCycle, resolveFilteredNoiseReason } from "./modules/analysis.js";
import { runSemanticDedupCycle } from "./modules/dedup.js";
import { runPreferenceLearningCycle } from "./modules/preference.js";
import { runDailyBriefingCycle, runPeriodBriefingCycle } from "./modules/briefing.js";
import { fetchSourceWithRetries, mapFetchedSourceItem, runArticleFetchCycle } from "./modules/fetch.js";
import { createAnalysisRuntimeWithPlan, createSourceRecommendationRuntime } from "./modules/runtime.js";
import {
  runSourceGovernanceObservationCycle,
  runCandidateObservationCycle,
  runExpiredCandidateReviewCycle,
} from "./modules/governance.js";
import { emitStructuredLogStart, emitStructuredLogEnd } from "./modules/logging.js";
import { runWorkerHealthCheck } from "./modules/health.js";
import {
  runFetchCycle,
  runOrganizationFetchCycles,
} from "./modules/organization-cycle.js";
import {
  runTaskRunConsumerCycle,
  type TaskRunConsumerMetrics,
  type TaskRunConsumerOptions,
} from "./modules/task-run-consumer.js";
import { runReportGeneration, runReportGenerationCycle } from "./modules/report.js";
import { runQueueWorker, type QueueWorkerMetrics, type QueueWorkerOptions } from "./modules/queue-worker.js";

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
  OrganizationCycleResult,
  RunOrganizationFetchCyclesOptions,
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
  OrganizationCycleResult,
  RunOrganizationFetchCyclesOptions,
  TaskRunConsumerMetrics,
  TaskRunConsumerOptions,
  QueueWorkerMetrics,
  QueueWorkerOptions,
};

export {
  resolveFilteredNoiseReason,
  canUseCapturedContentForLlm,
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
  mapFetchedSourceItem,
  runArticleFetchCycle,
};

export { createAnalysisRuntimeWithPlan, createSourceRecommendationRuntime };
export { runFetchCycle, runTaskRunConsumerCycle, runQueueWorker, runWorkerHealthCheck, runReportGeneration, runReportGenerationCycle };

export interface MainCycleDeps {
  resetCycleTimeBudget: (timeoutMs?: number) => void;
  getCycleRemainingMs: () => number;
  getSoftTimeoutMs: () => number;
  runTaskRunConsumerCycle: () => Promise<TaskRunConsumerMetrics>;
  runOrganizationFetchCycles: (
    options?: RunOrganizationFetchCyclesOptions,
  ) => Promise<OrganizationCycleResult>;
}

export async function runMainCycleOrchestrator(
  deps: MainCycleDeps = createMainCycleDeps(),
): Promise<{ taskRuns: TaskRunConsumerMetrics; fetch: OrganizationCycleResult }> {
  deps.resetCycleTimeBudget(deps.getSoftTimeoutMs());
  const taskRuns = await deps.runTaskRunConsumerCycle();
  const remainingMs = deps.getCycleRemainingMs();
  const fetch = await deps.runOrganizationFetchCycles(
    remainingMs > 0
      ? { overallBudgetMs: remainingMs }
      : { budgetExhausted: true },
  );
  return { taskRuns, fetch };
}

export async function runMainWorkerCycle(): Promise<{
  taskRuns: TaskRunConsumerMetrics;
  fetch: OrganizationCycleResult;
}> {
  return runMainCycleOrchestrator();
}

function createMainCycleDeps(): MainCycleDeps {
  return {
    resetCycleTimeBudget,
    getCycleRemainingMs,
    getSoftTimeoutMs,
    runTaskRunConsumerCycle: () => runTaskRunConsumerCycle(),
    runOrganizationFetchCycles: (options) => runOrganizationFetchCycles(options),
  };
}

export function describeWorker(): string {
  return "Wangchao worker";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  setupSignalHandlers();

  const isHealth = process.argv.includes("--health");
  const isQueueWorker = process.argv.includes("--queue-worker");
  const isTaskRuns = process.argv.includes("--task-runs");
  const isSourceDiscovery = process.argv.includes("--source-discovery");
  const isInstantPush = process.argv.includes("--instant-push");
  const isReportGeneration = process.argv.includes("--report-generation");
  const cycleType = isHealth
    ? "health"
    : isQueueWorker
      ? "queue-worker"
    : isTaskRuns
      ? "task-runs"
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
    : isQueueWorker
      ? runQueueWorker()
    : isTaskRuns
      ? runTaskRunConsumerCycle()
      : isSourceDiscovery
        ? runSourceDiscoveryCycle({ mode: "worker" })
        : isInstantPush
          ? runInstantPushCycle()
          : isReportGeneration
            ? runReportGenerationCycle()
            : runMainWorkerCycle();

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
