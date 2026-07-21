import {
  getQueueWorkerDrainBudgetMs,
  getQueueWorkerHeartbeatIntervalMs,
  getQueueWorkerMaxTasks,
  getQueueWorkerPollIntervalMs,
} from "./env.js";
import {
  isCycleShuttingDown,
  resetCycleTimeBudget,
} from "./lifecycle.js";
import {
  runTaskRunConsumerCycle,
  type TaskRunConsumerMetrics,
  type TaskRunConsumerOptions,
} from "./task-run-consumer.js";

export interface QueueWorkerMetrics extends TaskRunConsumerMetrics {
  iterations: number;
  idlePolls: number;
}

export interface QueueWorkerOptions {
  pollIntervalMs?: number;
  drainBudgetMs?: number;
  heartbeatIntervalMs?: number;
  maxTasksPerDrain?: number;
  /** Test-only loop bound. Production omits it and runs until SIGTERM/SIGINT. */
  maxIterations?: number;
}

export interface QueueWorkerDeps {
  runConsumer: (options: TaskRunConsumerOptions) => Promise<TaskRunConsumerMetrics>;
  resetBudget: (timeoutMs: number) => void;
  isShuttingDown: () => boolean;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  writeLog: (line: string) => void;
}

function emptyMetrics(): QueueWorkerMetrics {
  return {
    recovered: 0,
    finalized: 0,
    claimed: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    ownershipLost: 0,
    iterations: 0,
    idlePolls: 0,
  };
}

function addMetrics(total: QueueWorkerMetrics, current: TaskRunConsumerMetrics): void {
  total.recovered += current.recovered;
  total.finalized += current.finalized;
  total.claimed += current.claimed;
  total.succeeded += current.succeeded;
  total.retried += current.retried;
  total.failed += current.failed;
  total.ownershipLost += current.ownershipLost;
}

function writeStructuredLog(
  deps: QueueWorkerDeps,
  event: "queue-drain" | "queue-worker-heartbeat",
  metrics: Record<string, unknown>,
): void {
  deps.writeLog(`${JSON.stringify({
    event,
    timestamp: new Date(deps.now()).toISOString(),
    ...metrics,
  })}\n`);
}

/**
 * Persistent durable-queue process for Railway.
 *
 * Each drain receives a fresh bounded lifecycle budget; otherwise the shared
 * cycle deadline would expire once and permanently stop future claims. Empty
 * queues use bounded polling, while active queues drain again immediately.
 */
export async function runQueueWorker(
  options: QueueWorkerOptions = {},
  deps: QueueWorkerDeps = createDefaultDeps(),
): Promise<QueueWorkerMetrics> {
  const pollIntervalMs = options.pollIntervalMs ?? getQueueWorkerPollIntervalMs();
  const drainBudgetMs = options.drainBudgetMs ?? getQueueWorkerDrainBudgetMs();
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? getQueueWorkerHeartbeatIntervalMs();
  const maxTasksPerDrain = options.maxTasksPerDrain ?? getQueueWorkerMaxTasks();
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY;

  assertOptions({
    drainBudgetMs,
    heartbeatIntervalMs,
    maxIterations,
    maxTasksPerDrain,
    pollIntervalMs,
  });

  const total = emptyMetrics();
  let lastHeartbeatAt = deps.now();

  while (!deps.isShuttingDown() && total.iterations < maxIterations) {
    deps.resetBudget(drainBudgetMs);
    const current = await deps.runConsumer({ maxTasks: maxTasksPerDrain });
    total.iterations += 1;
    addMetrics(total, current);

    const hasActivity =
      current.claimed > 0 || current.recovered > 0 || current.finalized > 0;
    if (hasActivity) {
      writeStructuredLog(deps, "queue-drain", { metrics: current });
    }

    const now = deps.now();
    if (now - lastHeartbeatAt >= heartbeatIntervalMs) {
      writeStructuredLog(deps, "queue-worker-heartbeat", {
        metrics: total,
        status: "ok",
      });
      lastHeartbeatAt = now;
    }

    if (deps.isShuttingDown() || total.iterations >= maxIterations) break;
    if (current.claimed === 0) {
      total.idlePolls += 1;
      await deps.wait(pollIntervalMs);
    }
  }

  return total;
}

function assertOptions(options: Required<QueueWorkerOptions>): void {
  if (
    !Number.isFinite(options.pollIntervalMs) ||
    options.pollIntervalMs < 250 ||
    options.pollIntervalMs > 60_000
  ) {
    throw new Error("pollIntervalMs must be within [250, 60000]ms.");
  }
  if (
    !Number.isFinite(options.drainBudgetMs) ||
    options.drainBudgetMs < 1_000 ||
    options.drainBudgetMs > 300_000
  ) {
    throw new Error("drainBudgetMs must be within [1000, 300000]ms.");
  }
  if (
    !Number.isFinite(options.heartbeatIntervalMs) ||
    options.heartbeatIntervalMs < 5_000 ||
    options.heartbeatIntervalMs > 3_600_000
  ) {
    throw new Error("heartbeatIntervalMs must be within [5000, 3600000]ms.");
  }
  if (
    !Number.isInteger(options.maxTasksPerDrain) ||
    options.maxTasksPerDrain < 1 ||
    options.maxTasksPerDrain > 500
  ) {
    throw new Error("maxTasksPerDrain must be an integer within [1, 500].");
  }
  if (
    options.maxIterations !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(options.maxIterations) || options.maxIterations < 1)
  ) {
    throw new Error("maxIterations must be a positive integer when provided.");
  }
}

function createDefaultDeps(): QueueWorkerDeps {
  return {
    runConsumer: (options) => runTaskRunConsumerCycle(options),
    resetBudget: (timeoutMs) => resetCycleTimeBudget(timeoutMs),
    isShuttingDown: () => isCycleShuttingDown(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    writeLog: (line) => process.stdout.write(line),
  };
}
