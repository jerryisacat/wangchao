import {
  runQueueWorker,
  type QueueWorkerDeps,
} from "./queue-worker.js";
import type { TaskRunConsumerMetrics } from "./task-run-consumer.js";

export async function runQueueWorkerFixtures(): Promise<void> {
  await verifyIdlePollingAndFreshBudgets();
  await verifyActiveQueueDrainsWithoutSleeping();
  await verifyGracefulShutdownAfterWait();
  await verifyHeartbeatAndAggregateMetrics();
}

function metrics(overrides: Partial<TaskRunConsumerMetrics> = {}): TaskRunConsumerMetrics {
  return {
    recovered: 0,
    finalized: 0,
    claimed: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    ownershipLost: 0,
    ...overrides,
  };
}

function fakeDeps(results: TaskRunConsumerMetrics[]) {
  const budgets: number[] = [];
  const waits: number[] = [];
  const maxTasks: number[] = [];
  const logs: string[] = [];
  let now = 0;
  let shuttingDown = false;
  const deps: QueueWorkerDeps = {
    runConsumer: async (options) => {
      maxTasks.push(options.maxTasks ?? 0);
      return results.shift() ?? metrics();
    },
    resetBudget: (value) => budgets.push(value),
    isShuttingDown: () => shuttingDown,
    wait: async (value) => {
      waits.push(value);
      now += value;
    },
    now: () => now,
    writeLog: (line) => logs.push(line),
  };
  return {
    budgets,
    deps,
    logs,
    maxTasks,
    setShuttingDown: () => { shuttingDown = true; },
    setNow: (value: number) => { now = value; },
    waits,
  };
}

async function verifyIdlePollingAndFreshBudgets(): Promise<void> {
  const fake = fakeDeps([metrics(), metrics(), metrics()]);
  const result = await runQueueWorker({
    drainBudgetMs: 12_000,
    heartbeatIntervalMs: 60_000,
    maxIterations: 3,
    maxTasksPerDrain: 7,
    pollIntervalMs: 500,
  }, fake.deps);
  assert(result.iterations === 3 && result.idlePolls === 2, "Idle loop metrics must be stable.");
  assert(fake.budgets.join(",") === "12000,12000,12000", "Every drain needs a fresh budget.");
  assert(fake.waits.join(",") === "500,500", "Idle queues must wait between drains.");
  assert(fake.maxTasks.every((value) => value === 7), "Drain maxTasks must propagate.");
}

async function verifyActiveQueueDrainsWithoutSleeping(): Promise<void> {
  const fake = fakeDeps([
    metrics({ claimed: 2, succeeded: 2 }),
    metrics({ claimed: 1, succeeded: 1 }),
  ]);
  const result = await runQueueWorker({
    drainBudgetMs: 10_000,
    heartbeatIntervalMs: 60_000,
    maxIterations: 2,
    pollIntervalMs: 500,
  }, fake.deps);
  assert(fake.waits.length === 0, "Active queues must continue draining immediately.");
  assert(result.claimed === 3 && result.succeeded === 3, "Metrics must aggregate across drains.");
  assert(fake.logs.filter((line) => line.includes('"event":"queue-drain"')).length === 2, "Active drains must be observable.");
}

async function verifyGracefulShutdownAfterWait(): Promise<void> {
  const fake = fakeDeps([metrics(), metrics({ claimed: 1 })]);
  fake.deps.wait = async (value) => {
    fake.waits.push(value);
    fake.setShuttingDown();
  };
  const result = await runQueueWorker({
    drainBudgetMs: 10_000,
    heartbeatIntervalMs: 60_000,
    maxIterations: 5,
    pollIntervalMs: 500,
  }, fake.deps);
  assert(result.iterations === 1, "Shutdown must prevent the next claim cycle.");
  assert(result.idlePolls === 1, "The final idle wait must remain observable.");
}

async function verifyHeartbeatAndAggregateMetrics(): Promise<void> {
  const fake = fakeDeps([metrics({ claimed: 1, retried: 1 }), metrics()]);
  fake.setNow(10_000);
  const originalRun = fake.deps.runConsumer;
  fake.deps.runConsumer = async (options) => {
    const result = await originalRun(options);
    fake.setNow(fake.deps.now() + 6_000);
    return result;
  };
  const result = await runQueueWorker({
    drainBudgetMs: 10_000,
    heartbeatIntervalMs: 5_000,
    maxIterations: 2,
    pollIntervalMs: 500,
  }, fake.deps);
  assert(result.claimed === 1 && result.retried === 1, "Heartbeat uses aggregate metrics.");
  assert(fake.logs.some((line) => line.includes('"event":"queue-worker-heartbeat"')), "Persistent service must emit heartbeats.");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
