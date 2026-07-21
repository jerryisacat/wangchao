import type { ClaimedTaskRun, TaskRunErrorClass } from "@wangchao/db";
import {
  runTaskRunConsumerCycle,
  type TaskRunConsumerMetrics,
  type TaskRunConsumerOptions,
  type TaskRunConsumerDeps,
} from "./task-run-consumer.js";
import { formatSubCycleFailure } from "./fetch-cycle.js";

/**
 * Lane 2B durable TaskRun consumer fixtures.
 *
 * These fixtures exercise the consumer cycle against an injected fake
 * repository surface (no DB, no network). The production default wiring
 * (real @wangchao/db + Lane 2A handlers) is NOT used here - every
 * dependency is injected so the unit tests remain hermetic.
 *
 * Contract under test (see Issue #162 Lane 2B):
 *  - exact supported types: SOURCE_FETCH, SOURCE_DISCOVERY only
 *  - recoverExpiredTaskRuns runs first (reaper metrics)
 *  - bounded claim loop, one handler per claim, same Prisma client
 *  - claimed input strict parse: plain object, only mode/userId allowed
 *  - malformed input -> fenced application_error fail, handler NOT called
 *  - SOURCE_FETCH dispatches runFetchCycleForWorkspace(prisma, {org, userId})
 *  - SOURCE_DISCOVERY dispatches runSourceDiscoveryForWorkspace(prisma, scope, task.id, {mode, userId})
 *  - handler success -> completeClaimedTaskRun; failure -> failClaimedTaskRun
 *  - failure classification: configuration / timeout / upstream / application_error
 *  - retryAt exponential backoff with cap
 *  - lease heartbeat (~lease/3, serial renew); renew false or settle false -> ownershipLost
 *  - timer cleanup in finally; no timer leak for short tasks
 *  - maxTasks stops the loop; empty queue returns zero metrics
 *  - shutdown / time exhausted -> no new claims
 *  - never persists/logs raw message, URL, or stack
 */

export async function runTaskRunConsumerFixtures(): Promise<void> {
  await verifyExactSupportedTypesOnly();
  await verifyEmptyQueueReturnsZeros();
  await verifyReaperMetricsPropagated();
  await verifySourceFetchDispatchAndComplete();
  await verifySourceDiscoveryDispatchAndComplete();
  await verifyHandlerFailurePendingRetry();
  await verifyHandlerFailureFinalized();
  await verifyMalformedInputFencedFailNoHandler();
  await verifyStaleCompleteOwnershipLost();
  await verifyStaleFailOwnershipLost();
  await verifyHeartbeatRenewFalseOwnershipLost();
  await verifyHeartbeatRenewThrowCompleteTrueSucceeded();
  await verifyHeartbeatRenewThrowCompleteFalseOwnershipLost();
  await verifyMaxTasksStopsLoop();
  await verifyTimerCleanupNoLeak();
  await verifyShutdownSkipsNewClaims();
  await verifyNoRawErrorPersisted();
  await verifySubCycleFailureLogSafe();
}

// ── Fake infrastructure ──

interface FakeClaimedTask {
  id: string;
  organizationId: string;
  type: "SOURCE_FETCH" | "SOURCE_DISCOVERY";
  attempt: number;
  maxAttempts: number;
  input: unknown;
  leaseToken: string;
  leaseExpiresAt: Date;
  heartbeatAt: Date;
}

interface FakeReaperResult {
  recovered: number;
  finalized: number;
}

interface FakeFailResult {
  settled: boolean;
  status?: "PENDING" | "FAILED";
}

interface FetchScope {
  organizationId: string;
  userId: string;
}

interface DiscoveryOptions {
  mode: string;
  userId: string;
}

interface FakeDeps {
  claimQueue: FakeClaimedTask[];
  reaperResult: FakeReaperResult;
  renewResults: boolean[];
  renewErrors?: Error[];
  completeResults: boolean[];
  failResults: FakeFailResult[];
  fetchHandler?: (prisma: unknown, scope: FetchScope) => Promise<Record<string, unknown>>;
  discoveryHandler?: (
    prisma: unknown,
    scope: FetchScope,
    taskRunId: string,
    options: DiscoveryOptions,
  ) => Promise<Record<string, unknown>>;
  nowMs: number;
  timers: Array<() => void>;
}

function createFakeDeps(overrides: Partial<FakeDeps> = {}): FakeDeps {
  return {
    claimQueue: [],
    reaperResult: { recovered: 0, finalized: 0 },
    renewResults: [],
    completeResults: [],
    failResults: [],
    nowMs: Date.parse("2026-08-01T00:00:00.000Z"),
    timers: [],
    ...overrides,
  };
}

type ClaimFn = TaskRunConsumerDeps["claimNextTaskRun"];
type RenewFn = TaskRunConsumerDeps["renewTaskRunLease"];
type CompleteFn = TaskRunConsumerDeps["completeClaimedTaskRun"];
type FailFn = TaskRunConsumerDeps["failClaimedTaskRun"];
type FetchFn = TaskRunConsumerDeps["runFetchCycleForWorkspace"];
type DiscoveryFn = TaskRunConsumerDeps["runSourceDiscoveryForWorkspace"];

function buildDeps(fake: FakeDeps): TaskRunConsumerDeps {
  let renewIdx = 0;
  let completeIdx = 0;
  let failIdx = 0;
  const prisma = {} as never;
  const claimNextTaskRun: ClaimFn = async () => {
    const task = fake.claimQueue.shift() ?? null;
    if (task) {
      const claimed: ClaimedTaskRun = {
        id: task.id,
        organizationId: task.organizationId,
        topicId: null,
        sourceId: null,
        itemId: null,
        eventId: null,
        type: task.type,
        status: "RUNNING",
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        scheduledAt: new Date(fake.nowMs),
        startedAt: new Date(fake.nowMs),
        input: task.input as never,
        leaseOwner: "test-worker",
        leaseToken: task.leaseToken,
        leaseExpiresAt: task.leaseExpiresAt,
        heartbeatAt: task.heartbeatAt,
      };
      return claimed;
    }
    return null;
  };
  const renewTaskRunLease: RenewFn = async () => {
    const idx = renewIdx;
    renewIdx++;
    const error = fake.renewErrors?.[idx];
    if (error) throw error;
    return fake.renewResults[idx] ?? true;
  };
  const completeClaimedTaskRun: CompleteFn = async () => {
    const result = fake.completeResults[completeIdx] ?? true;
    completeIdx++;
    return result;
  };
  const failClaimedTaskRun: FailFn = async () => {
    const result = fake.failResults[failIdx] ?? { settled: true, status: "PENDING" };
    failIdx++;
    return result;
  };
  const noopFetch: FetchFn = async () => ({ fetchedSources: 0 });
  const runFetchCycleForWorkspace: FetchFn = fake.fetchHandler
    ? (async (_p: unknown, scope: FetchScope) =>
        fake.fetchHandler!(_p, scope)) as FetchFn
    : noopFetch;
  const noopDiscovery: DiscoveryFn = async () => ({ candidateSourcesWritten: 0 });
  const runSourceDiscoveryForWorkspace: DiscoveryFn = fake.discoveryHandler
    ? (async (
        _p: unknown,
        scope: FetchScope,
        id: string,
        opts: DiscoveryOptions,
      ) => fake.discoveryHandler!(_p, scope, id, opts)) as DiscoveryFn
    : noopDiscovery;
  return {
    prisma,
    recoverExpiredTaskRuns: async () => fake.reaperResult,
    claimNextTaskRun,
    renewTaskRunLease,
    completeClaimedTaskRun,
    failClaimedTaskRun,
    runFetchCycleForWorkspace,
    runSourceDiscoveryForWorkspace,
    setIntervalFn: (fn) => {
      const handle = () => fn();
      fake.timers.push(handle);
      return 0 as never;
    },
    clearIntervalFn: () => {},
    nowFn: () => new Date(fake.nowMs),
  };
}

function baseOptions(overrides: Partial<TaskRunConsumerOptions> = {}): TaskRunConsumerOptions {
  return {
    workerId: "test-worker",
    leaseDurationMs: 60_000,
    maxTasks: 10,
    ...overrides,
  };
}

function makeTask(overrides: Partial<FakeClaimedTask> = {}): FakeClaimedTask {
  return {
    id: "task-1",
    organizationId: "org-1",
    type: "SOURCE_FETCH",
    attempt: 1,
    maxAttempts: 3,
    input: { mode: "worker", userId: "user-1" },
    leaseToken: "token-1",
    leaseExpiresAt: new Date(Date.parse("2026-08-01T00:01:00.000Z")),
    heartbeatAt: new Date(Date.parse("2026-08-01T00:00:00.000Z")),
    ...overrides,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── Tests ──

async function verifyExactSupportedTypesOnly(): Promise<void> {
  let claimedTypes: string[] | null = null;
  const fake = createFakeDeps();
  const deps = buildDeps(fake);
  const originalClaim = deps.claimNextTaskRun;
  const wrappedClaim: ClaimFn = async (prisma, options) => {
    if (claimedTypes === null) {
      claimedTypes = [...options.types];
    }
    return originalClaim(prisma, options);
  };
  deps.claimNextTaskRun = wrappedClaim;
  await runTaskRunConsumerCycle(baseOptions(), deps);
  const types = claimedTypes as string[] | null;
  assert(
    types !== null && types.length === 2 &&
      types.includes("SOURCE_FETCH") && types.includes("SOURCE_DISCOVERY"),
    "Consumer must claim exactly SOURCE_FETCH and SOURCE_DISCOVERY (no prefix, no extras).",
  );
}

async function verifyEmptyQueueReturnsZeros(): Promise<void> {
  const fake = createFakeDeps();
  const deps = buildDeps(fake);
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(result.claimed === 0, "Empty queue must report 0 claimed.");
  assert(result.succeeded === 0, "Empty queue must report 0 succeeded.");
  assert(result.failed === 0, "Empty queue must report 0 failed.");
  assert(result.retried === 0, "Empty queue must report 0 retried.");
  assert(result.ownershipLost === 0, "Empty queue must report 0 ownershipLost.");
}

async function verifyReaperMetricsPropagated(): Promise<void> {
  const fake = createFakeDeps({
    reaperResult: { recovered: 3, finalized: 1 },
  });
  const deps = buildDeps(fake);
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(result.recovered === 3, "Reaper recovered count must propagate to metrics.");
  assert(result.finalized === 1, "Reaper finalized count must propagate to metrics.");
}

async function verifySourceFetchDispatchAndComplete(): Promise<void> {
  let fetchCalled = false;
  let fetchScope: FetchScope | null = null;
  const fake = createFakeDeps({
    claimQueue: [makeTask({ type: "SOURCE_FETCH", input: { mode: "worker", userId: "user-1" } })],
    fetchHandler: async (_prisma: unknown, scope: FetchScope) => {
      fetchCalled = true;
      fetchScope = scope;
      return { fetchedSources: 5 };
    },
  });
  const deps = buildDeps(fake);
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
 assert(fetchCalled, "SOURCE_FETCH task must dispatch runFetchCycleForWorkspace.");
 const scope = fetchScope as FetchScope | null;
 assert(
   scope !== null && scope.organizationId === "org-1" && scope.userId === "user-1",
   "Fetch handler must receive the claimed task's organizationId and userId.",
 );
  assert(result.claimed === 1, "One task claimed.");
  assert(result.succeeded === 1, "Successful handler must increment succeeded.");
}

async function verifySourceDiscoveryDispatchAndComplete(): Promise<void> {
  let discoveryCalled = false;
  let discoveryScope: FetchScope | null = null;
  let discoveryTaskRunId: string | null = null;
  let discoveryMode: string | null = null;
  let discoveryUserId: string | null = null;
  const fake = createFakeDeps({
    claimQueue: [makeTask({ id: "disc-1", type: "SOURCE_DISCOVERY", input: { mode: "manual", userId: "user-2" } })],
    discoveryHandler: async (_prisma: unknown, scope: FetchScope, taskRunId: string, options: DiscoveryOptions) => {
      discoveryCalled = true;
      discoveryScope = scope;
      discoveryTaskRunId = taskRunId;
      discoveryMode = options.mode;
      discoveryUserId = options.userId;
      return { candidateSourcesWritten: 2 };
    },
  });
  const deps = buildDeps(fake);
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
 assert(discoveryCalled, "SOURCE_DISCOVERY task must dispatch runSourceDiscoveryForWorkspace.");
 const dScope = discoveryScope as FetchScope | null;
 assert(
   dScope !== null && dScope.organizationId === "org-1" && dScope.userId === "user-2",
   "Discovery handler must receive claimed scope.",
 );
 assert(discoveryTaskRunId === "disc-1", "Discovery handler must receive the claimed taskRunId.");
 assert(discoveryMode === "manual", "Discovery handler must receive parsed mode.");
 assert(discoveryUserId === "user-2", "Discovery handler must receive parsed userId.");
  assert(result.succeeded === 1, "Successful discovery handler must increment succeeded.");
}

async function verifyHandlerFailurePendingRetry(): Promise<void> {
  const fake = createFakeDeps({
    claimQueue: [makeTask({ attempt: 1, maxAttempts: 3 })],
    fetchHandler: async () => {
      throw new Error("connection refused to https://internal.example.com:5432");
    },
    failResults: [{ settled: true, status: "PENDING" }],
  });
  const deps = buildDeps(fake);
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(result.retried === 1, "Handler failure with PENDING status must increment retried.");
  assert(result.failed === 0, "Handler failure with PENDING status must NOT increment failed.");
  assert(result.succeeded === 0, "Failed handler must not increment succeeded.");
}

async function verifyHandlerFailureFinalized(): Promise<void> {
  const fake = createFakeDeps({
    claimQueue: [makeTask({ attempt: 3, maxAttempts: 3 })],
    fetchHandler: async () => {
      throw new Error("timeout");
    },
    failResults: [{ settled: true, status: "FAILED" }],
  });
  const deps = buildDeps(fake);
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(result.failed === 1, "Handler failure with FAILED status must increment failed.");
  assert(result.retried === 0, "Finalized failure must NOT increment retried.");
}

async function verifyMalformedInputFencedFailNoHandler(): Promise<void> {
  let handlerCalled = false;
  const fake = createFakeDeps({
    claimQueue: [makeTask({ input: { mode: "invalid-mode", userId: "user-1" } })],
    fetchHandler: async () => {
      handlerCalled = true;
      return {};
    },
    failResults: [{ settled: true, status: "FAILED" }],
  });
  const deps = buildDeps(fake);
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(!handlerCalled, "Malformed input must NOT invoke the handler.");
  assert(result.failed === 1, "Malformed input must be fenced as a failure.");
  assert(result.succeeded === 0, "Malformed input must not count as success.");
}

async function verifyStaleCompleteOwnershipLost(): Promise<void> {
  const fake = createFakeDeps({
    claimQueue: [makeTask()],
    completeResults: [false],
  });
  const deps = buildDeps(fake);
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(result.ownershipLost === 1, "Stale complete (settled=false) must increment ownershipLost.");
  assert(result.succeeded === 0, "Stale complete must NOT count as succeeded.");
}

async function verifyStaleFailOwnershipLost(): Promise<void> {
  const fake = createFakeDeps({
    claimQueue: [makeTask()],
    fetchHandler: async () => {
      throw new Error("fail");
    },
    failResults: [{ settled: false }],
  });
  const deps = buildDeps(fake);
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(result.ownershipLost === 1, "Stale fail (settled=false) must increment ownershipLost.");
  assert(result.retried === 0 && result.failed === 0, "Stale fail must not count as retried or failed.");
}

async function verifyHeartbeatRenewFalseOwnershipLost(): Promise<void> {
  let handlerReleased = false;
  let completeCallCount = 0;
  const fake = createFakeDeps({
    claimQueue: [makeTask()],
    renewResults: [false],
    fetchHandler: async () => {
      // Simulate a long handler; heartbeat fires while we're "in" the handler.
      // The fake timer is captured; we trigger it manually to simulate renewal.
      const timer = fake.timers[0];
      if (timer) timer();
      handlerReleased = true;
      return { ok: true };
    },
  });
  const deps = buildDeps(fake);
  const originalComplete = deps.completeClaimedTaskRun;
  const wrappedComplete: CompleteFn = async (prisma, input) => {
    completeCallCount++;
    return originalComplete(prisma, input);
  };
  deps.completeClaimedTaskRun = wrappedComplete;
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(
    result.ownershipLost >= 1,
    "Heartbeat renew=false must count as ownershipLost.",
  );
  assert(handlerReleased, "Handler must still run even if heartbeat fails (it started before renewal).");
  assert(
    result.succeeded === 0,
    "Heartbeat renew=false must NOT count as succeeded.",
  );
  assert(
    completeCallCount === 0,
    "Heartbeat renew=false must skip settlement (completeClaimedTaskRun NOT called).",
  );
}

/**
 * renew throws (transient DB/network error) + complete returns true.
 * Expected: succeeded=1, ownershipLost=0.
 * Rationale: a transient renew error is NOT definitive ownership loss; the
 * fenced complete is the authority. If lease still valid, complete succeeds.
 */
async function verifyHeartbeatRenewThrowCompleteTrueSucceeded(): Promise<void> {
  let completeCallCount = 0;
  const fake = createFakeDeps({
    claimQueue: [makeTask()],
    renewErrors: [new Error("connection reset to https://db.internal:5432")],
    completeResults: [true],
    fetchHandler: async () => {
      const timer = fake.timers[0];
      if (timer) timer();
      return { ok: true };
    },
  });
  const deps = buildDeps(fake);
  const originalComplete = deps.completeClaimedTaskRun;
  const wrappedComplete: CompleteFn = async (prisma, input) => {
    completeCallCount++;
    return originalComplete(prisma, input);
  };
  deps.completeClaimedTaskRun = wrappedComplete;
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(
    result.ownershipLost === 0,
    "renew throw + complete true must NOT count as ownershipLost (transient renew error is not definitive loss).",
  );
  assert(
    result.succeeded === 1,
    "renew throw + complete true must count as succeeded (fenced complete is authority).",
  );
  assert(
    completeCallCount === 1,
    "renew throw must still attempt fenced complete (not skip settlement).",
  );
}

/**
 * renew throws (transient DB/network error) + complete returns false.
 * Expected: ownershipLost=1, succeeded=0.
 * Rationale: renew throw is not definitive, but if the fenced complete also
 * fails (settled=false), the authoritative settlement records ownershipLost.
 */
async function verifyHeartbeatRenewThrowCompleteFalseOwnershipLost(): Promise<void> {
  let completeCallCount = 0;
  const fake = createFakeDeps({
    claimQueue: [makeTask()],
    renewErrors: [new Error("connection reset to https://db.internal:5432")],
    completeResults: [false],
    fetchHandler: async () => {
      const timer = fake.timers[0];
      if (timer) timer();
      return { ok: true };
    },
  });
  const deps = buildDeps(fake);
  const originalComplete = deps.completeClaimedTaskRun;
  const wrappedComplete: CompleteFn = async (prisma, input) => {
    completeCallCount++;
    return originalComplete(prisma, input);
  };
  deps.completeClaimedTaskRun = wrappedComplete;
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(
    result.ownershipLost === 1,
    "renew throw + complete false must count as ownershipLost (fenced complete is authority).",
  );
  assert(
    result.succeeded === 0,
    "renew throw + complete false must NOT count as succeeded.",
  );
  assert(
    completeCallCount === 1,
    "renew throw must still attempt fenced complete (not skip settlement).",
  );
}

async function verifyMaxTasksStopsLoop(): Promise<void> {
  const fake = createFakeDeps({
    claimQueue: [
      makeTask({ id: "t1" }),
      makeTask({ id: "t2" }),
      makeTask({ id: "t3" }),
    ],
  });
  const deps = buildDeps(fake);
  const result = await runTaskRunConsumerCycle(baseOptions({ maxTasks: 2 }), deps);
  assert(result.claimed === 2, "maxTasks=2 must stop the loop after 2 claims.");
  assert(fake.claimQueue.length === 1, "maxTasks must leave remaining tasks in the queue.");
}

async function verifyTimerCleanupNoLeak(): Promise<void> {
  let timerCleared = false;
  const fake = createFakeDeps({
    claimQueue: [makeTask()],
  });
  const deps = buildDeps(fake);
  deps.clearIntervalFn = () => {
    timerCleared = true;
  };
  await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(timerCleared, "Heartbeat timer must be cleared in finally (no leak).");
}

async function verifyShutdownSkipsNewClaims(): Promise<void> {
  let claimCalled = false;
  const fake = createFakeDeps();
  const deps = buildDeps(fake);
  deps.claimNextTaskRun = async () => {
    claimCalled = true;
    return null;
  };
  deps.isShuttingDown = () => true;
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(!claimCalled, "Shutdown state must prevent new claims.");
  assert(result.claimed === 0, "Shutdown must yield 0 claimed.");
}

async function verifyNoRawErrorPersisted(): Promise<void> {
  let failErrorClass: TaskRunErrorClass | null = null;
  let failRetryAt: Date | null = null;
  const fake = createFakeDeps({
    claimQueue: [makeTask()],
    fetchHandler: async () => {
      throw new Error("ENCRYPTION_KEY is required but not set at https://secret.example.com/config");
    },
    failResults: [{ settled: true, status: "PENDING" }],
  });
  const deps = buildDeps(fake);
  const originalFail = deps.failClaimedTaskRun;
  const wrappedFail: FailFn = async (prisma, input) => {
    failErrorClass = input.errorClass;
    failRetryAt = input.retryAt;
    return originalFail(prisma, input);
  };
  deps.failClaimedTaskRun = wrappedFail;
  const result = await runTaskRunConsumerCycle(baseOptions(), deps);
  assert(
    failErrorClass === "configuration",
    "A required-but-missing runtime key must use the configuration error class.",
  );
  assert(
    failErrorClass !== null &&
      (failErrorClass === "configuration" ||
        failErrorClass === "timeout" ||
        failErrorClass === "upstream" ||
        failErrorClass === "application_error"),
    "failClaimedTaskRun must receive a fixed low-cardinality errorClass, never raw message.",
  );
  assert(failRetryAt !== null, "failClaimedTaskRun must receive a retryAt timestamp.");
  assert(result.retried === 1 || result.failed === 1, "Fenced failure must be counted.");
}

// Silence unused-import warning for re-exported type used in assertions only.
export type { TaskRunConsumerMetrics };

/**
 * fetch-cycle sub-cycle failure logging must never emit raw error.message,
 * URL, stack, or secret. It must reuse classifyTaskRunError and emit only a
 * fixed cycle name + a fixed low-cardinality error class.
 *
 * We verify by exercising the pure helper `formatSubCycleFailure` with a
 * credential-bearing, stack-like, URL-laden error and asserting the output
 * contains none of: the raw message, the URL, the secret token, a stack
 * fragment. The output must contain a fixed cycle name and a fixed
 * low-cardinality class.
 */
async function verifySubCycleFailureLogSafe(): Promise<void> {
  const secretUrl = "https://user:supersecret-token@db.internal.example.com:5432";
  const rawMessage = `ENCRYPTION_KEY is required but not set at ${secretUrl}\n    at Handler.doThing (/app/src/secret.ts:42:7)\n    at processTicksAndRejections (node:internal/process/task_queues:96:5)`;
  const error = new Error(rawMessage);
  const line = formatSubCycleFailure("analysis", error);
  assert(
    typeof line === "string" && line.length > 0,
    "formatSubCycleFailure must return a non-empty string.",
  );
  assert(
    !line.includes(secretUrl),
    "Sub-cycle failure log must NOT contain the credential URL.",
  );
  assert(
    !line.includes("supersecret-token"),
    "Sub-cycle failure log must NOT contain the secret token.",
  );
  assert(
    !line.includes(rawMessage),
    "Sub-cycle failure log must NOT contain the raw error message.",
  );
  assert(
    !line.includes("node:internal"),
    "Sub-cycle failure log must NOT contain stack-trace fragments.",
  );
  assert(
    !line.includes("/app/src/secret.ts"),
    "Sub-cycle failure log must NOT contain stack file paths.",
  );
  assert(
    line.includes("analysis"),
    "Sub-cycle failure log must contain the fixed cycle name.",
  );
  const ALLOWED_CLASSES = ["application_error", "configuration", "timeout", "upstream", "cancelled"];
  const matchedClass = ALLOWED_CLASSES.find((c) => line.includes(c));
  assert(
    matchedClass !== undefined,
    "Sub-cycle failure log must contain a fixed low-cardinality error class.",
  );
}
