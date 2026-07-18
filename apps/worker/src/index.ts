import { disconnectPrismaClient } from "@wangchao/db";
import { formatSafeError } from "./lib/safe-log.js";
import { setupSignalHandlers } from "./modules/lifecycle.js";
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
import { runFetchCycle } from "./modules/fetch-cycle.js";
import {
  runTaskRunConsumerCycle,
  type TaskRunConsumerMetrics,
  type TaskRunConsumerOptions,
} from "./modules/task-run-consumer.js";
import { runReportGeneration, runReportGenerationCycle } from "./modules/report.js";

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
  TaskRunConsumerMetrics,
  TaskRunConsumerOptions,
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
export { runFetchCycle, runTaskRunConsumerCycle, runWorkerHealthCheck, runReportGeneration, runReportGenerationCycle };

export async function runMainWorkerCycle(): Promise<{
  taskRuns: TaskRunConsumerMetrics;
  fetch: WorkerFetchCycleResult;
}> {
  const taskRuns = await runTaskRunConsumerCycle();
  const fetch = await runFetchCycle();
  return { taskRuns, fetch };
}

export function describeWorker(): string {
  return "Wangchao worker";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  setupSignalHandlers();

  const isHealth = process.argv.includes("--health");
  const isTaskRuns = process.argv.includes("--task-runs");
  const isSourceDiscovery = process.argv.includes("--source-discovery");
  const isInstantPush = process.argv.includes("--instant-push");
  const isReportGeneration = process.argv.includes("--report-generation");
  const cycleType = isHealth
    ? "health"
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
