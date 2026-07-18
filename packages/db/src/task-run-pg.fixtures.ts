/**
 * Disposable PostgreSQL concurrency fixtures for Issue #162 Lane 1C.
 *
 * Freezes real PostgreSQL SKIP LOCKED + fenced lease invariants against a
 * disposable database. No production code/schema/migration is modified.
 *
 * Fail-closed guard: only runs when ALL of:
 *   - RUN_TASK_RUN_PG_TESTS=1            (explicit opt-in)
 *   - WANGCHAO_DISPOSABLE_DATABASE=1     (acknowledge disposable DB)
 *   - DATABASE_URL host is localhost or 127.0.0.1
 *   - DATABASE_URL database name contains "task_run_pg"
 * Otherwise: skip (opt-in not enabled) or refuse (enabled but guard mismatched).
 *
 * Uses only production fenced APIs: enqueueTaskRun / claimNextTaskRun /
 * renewTaskRunLease / completeClaimedTaskRun / failClaimedTaskRun /
 * yieldClaimedTaskRun / recoverExpiredTaskRuns. No direct status UPDATE
 * except cascade cleanup via Organization delete.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type TaskRunType } from "@prisma/client";
import {
  claimNextTaskRun,
  completeClaimedTaskRun,
  enqueueTaskRun,
  failClaimedTaskRun,
  recoverExpiredTaskRuns,
  renewTaskRunLease,
  yieldClaimedTaskRun,
  type ClaimedTaskRun,
  type EnqueueTaskRunInput,
  type EnqueueTaskRunResult,
} from "./repositories/task-run.js";

// ── Constants ──

const SUITE_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 30_000;
const REAPER_LEASE_MS = 1_000;
const REAPER_WAIT_MS = 1_200;
const CONCURRENT_ENQUEUE_COUNT = 8;
const CONCURRENT_CLAIM_COUNT = 6;
const LEASE_DURATION_MS = 30_000;

// ── Helpers ──

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  label: string,
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `[task-run-pg] TIMEOUT: ${label} exceeded ${timeoutMs}ms.`,
          ),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Fail-closed guard ──

type GuardResult =
  | { kind: "skip"; message: string }
  | { kind: "refuse"; message: string }
  | { kind: "proceed"; dbUrl: string };

function parseDatabaseUrl(
  url: string,
): { host: string; dbName: string } | null {
  try {
    const parsed = new URL(url);
    const dbName = parsed.pathname.replace(/^\//, "");
    return { host: parsed.hostname, dbName };
  } catch {
    return null;
  }
}

function evaluateGuard(): GuardResult {
  if (process.env.RUN_TASK_RUN_PG_TESTS !== "1") {
    return {
      kind: "skip",
      message:
        "[task-run-pg] SKIP: RUN_TASK_RUN_PG_TESTS=1 not set (opt-in not enabled).",
    };
  }
  if (process.env.WANGCHAO_DISPOSABLE_DATABASE !== "1") {
    return {
      kind: "refuse",
      message:
        "[task-run-pg] REFUSE: RUN_TASK_RUN_PG_TESTS=1 is set but " +
        "WANGCHAO_DISPOSABLE_DATABASE is not 1. " +
        "The fixture only runs against a disposable database.",
    };
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return {
      kind: "refuse",
      message:
        "[task-run-pg] REFUSE: RUN_TASK_RUN_PG_TESTS=1 is set but " +
        "DATABASE_URL is not set.",
    };
  }
  const parsed = parseDatabaseUrl(dbUrl);
  if (!parsed) {
    return {
      kind: "refuse",
      message: "[task-run-pg] REFUSE: DATABASE_URL is not a valid URL.",
    };
  }
  if (parsed.host !== "localhost" && parsed.host !== "127.0.0.1") {
    return {
      kind: "refuse",
      message:
        `[task-run-pg] REFUSE: DATABASE_URL host must be localhost or ` +
        `127.0.0.1 (got "${parsed.host}").`,
    };
  }
  if (!parsed.dbName.includes("task_run_pg")) {
    return {
      kind: "refuse",
      message:
        `[task-run-pg] REFUSE: DATABASE_URL database name must contain ` +
        `"task_run_pg" (got "${parsed.dbName}").`,
    };
  }
  return { kind: "proceed", dbUrl };
}

// ── Fixture context ──

interface FixtureContext {
  runId: string;
  orgId: string;
  orgSlug: string;
  worker: (label: string) => string;
}

function createFixtureContext(): FixtureContext {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const runId = `${stamp}${rand}`;
  return {
    runId,
    orgId: `org-pg-${runId}`,
    orgSlug: `task-run-pg-${runId}`,
    worker: (label: string) => `worker-${runId}-${label}`,
  };
}

function baseEnqueue(
  ctx: FixtureContext,
  type: TaskRunType,
  key: string,
  maxAttempts: number,
): EnqueueTaskRunInput {
  return {
    organizationId: ctx.orgId,
    type,
    idempotencyKey: key,
    maxAttempts,
    input: { fixture: "task-run-pg" },
  };
}

async function completeClaimed(
  prisma: PrismaClient,
  claimed: ClaimedTaskRun,
): Promise<void> {
  const ok = await completeClaimedTaskRun(prisma, {
    taskRunId: claimed.id,
    workerId: claimed.leaseOwner,
    leaseToken: claimed.leaseToken,
    output: { settled: true },
  });
  assert(ok, `completeClaimed must succeed for task ${claimed.id}.`);
}

async function setupOrg(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  await prisma.organization.create({
    data: {
      id: ctx.orgId,
      name: `TaskRun PG Fixture ${ctx.runId}`,
      slug: ctx.orgSlug,
    },
  });
}

async function cleanupOrg(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: ctx.orgId } });
}

// ── Entry point ──

export async function runTaskRunPgFixtures(): Promise<void> {
  const guard = evaluateGuard();
  if (guard.kind === "skip") {
    console.log(guard.message);
    return;
  }
  if (guard.kind === "refuse") {
    throw new Error(guard.message);
  }
  await withTimeout(
    "task-run-pg-fixture-suite",
    () => runAllTests(guard.dbUrl),
    SUITE_TIMEOUT_MS,
  );
}

async function runAllTests(dbUrl: string): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: dbUrl }),
  });
  const ctx = createFixtureContext();
  try {
    await setupOrg(prisma, ctx);
    try {
      await withTimeout(
        "invariant-1-idempotent-enqueue",
        () => verifyConcurrentIdempotentEnqueue(prisma, ctx),
        TEST_TIMEOUT_MS,
      );
      await withTimeout(
        "invariant-2-claim-uniqueness",
        () => verifyConcurrentClaimUniqueness(prisma, ctx),
        TEST_TIMEOUT_MS,
      );
      await withTimeout(
        "invariant-3-stale-token-fence",
        () => verifyStaleTokenFence(prisma, ctx),
        TEST_TIMEOUT_MS,
      );
      await withTimeout(
        "invariant-4-failure-budget",
        () => verifyFailureBudget(prisma, ctx),
        TEST_TIMEOUT_MS,
      );
      await withTimeout(
        "invariant-5-planned-yield",
        () => verifyPlannedYield(prisma, ctx),
        TEST_TIMEOUT_MS,
      );
      await withTimeout(
        "invariant-6-reaper",
        () => verifyReaper(prisma, ctx),
        TEST_TIMEOUT_MS,
      );
      await withTimeout(
        "invariant-7-convergence",
        () => verifyConvergence(prisma, ctx),
        TEST_TIMEOUT_MS,
      );
    } finally {
      await cleanupOrg(prisma, ctx);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// ── Invariant 1: Concurrent idempotent enqueue ──
// 8 concurrent same org+type+idempotencyKey: exactly one created=true,
// one active row, all return same ID. After settlement, key is reusable.

async function verifyConcurrentIdempotentEnqueue(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  const key = `ideq:${ctx.runId}:1`;
  const input = baseEnqueue(ctx, "SOURCE_FETCH", key, 3);
  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENT_ENQUEUE_COUNT }, () =>
      enqueueTaskRun(prisma, input),
    ),
  );
  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<EnqueueTaskRunResult> =>
      r.status === "fulfilled",
  );
  assert(
    fulfilled.length === CONCURRENT_ENQUEUE_COUNT,
    "All concurrent enqueues must resolve (P2002 handled internally).",
  );
  const createdCount = fulfilled.filter((r) => r.value.created).length;
  assert(
    createdCount === 1,
    `Exactly one enqueue must report created=true (got ${createdCount}).`,
  );
  const taskIds = new Set(fulfilled.map((r) => r.value.taskRun.id));
  assert(taskIds.size === 1, "All concurrent enqueues must return same task ID.");
  const activeRows = await prisma.taskRun.findMany({
    where: {
      organizationId: ctx.orgId,
      idempotencyKey: key,
      status: { in: ["PENDING", "RUNNING"] },
    },
  });
  assert(
    activeRows.length === 1,
    `Exactly one active row must exist (got ${activeRows.length}).`,
  );
  // Settle the task so the key becomes reusable.
  const claimed = await claimNextTaskRun(prisma, {
    workerId: ctx.worker("ideq"),
    types: ["SOURCE_FETCH"],
    leaseDurationMs: LEASE_DURATION_MS,
  });
  assert(claimed !== null, "Claim must pick up the idempotent enqueue task.");
  const firstId = [...taskIds][0];
  assert(firstId !== undefined, "taskIds must not be empty.");
  assert(claimed.id === firstId, "Claim must pick the exact idempotent task.");
  await completeClaimed(prisma, claimed);
  // After settlement, the same key must be reusable.
  const reused = await enqueueTaskRun(prisma, input);
  assert(
    reused.created,
    "After settlement, the same idempotency key must be reusable.",
  );
  const reclaimed = await claimNextTaskRun(prisma, {
    workerId: ctx.worker("ideq"),
    types: ["SOURCE_FETCH"],
    leaseDurationMs: LEASE_DURATION_MS,
  });
  assert(reclaimed !== null, "Must claim the reused task.");
  assert(
    reclaimed.id === reused.taskRun.id,
    "Reclaimed task must match the reused enqueue.",
  );
  await completeClaimed(prisma, reclaimed);
}

// ── Invariant 2: Concurrent claim uniqueness ──
// Multiple unique due tasks + concurrent claim: each task claimed at most
// once, no duplicates. All claimed tasks completed via fenced API.

async function verifyConcurrentClaimUniqueness(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  const taskIds: string[] = [];
  for (let i = 0; i < CONCURRENT_CLAIM_COUNT; i++) {
    const result = await enqueueTaskRun(
      prisma,
      baseEnqueue(ctx, "CONTENT_FETCH", `claim:${ctx.runId}:${i}`, 3),
    );
    assert(result.created, `Task ${i} must be created.`);
    taskIds.push(result.taskRun.id);
  }
  const claimResults = await Promise.allSettled(
    Array.from({ length: CONCURRENT_CLAIM_COUNT }, (_, i) =>
      claimNextTaskRun(prisma, {
        workerId: ctx.worker(`claim-${i}`),
        types: ["CONTENT_FETCH"],
        leaseDurationMs: LEASE_DURATION_MS,
      }),
    ),
  );
  const claimedIds: string[] = [];
  for (const r of claimResults) {
    if (r.status === "fulfilled" && r.value !== null) {
      assert(
        taskIds.includes(r.value.id),
        "Claim must only pick tasks created by this test.",
      );
      claimedIds.push(r.value.id);
    }
  }
  const uniqueIds = new Set(claimedIds);
  assert(
    uniqueIds.size === claimedIds.length,
    "No task must be claimed by more than one worker.",
  );
  assert(
    claimedIds.length === CONCURRENT_CLAIM_COUNT,
    `All ${CONCURRENT_CLAIM_COUNT} tasks must be claimed (got ${claimedIds.length}).`,
  );
  for (const r of claimResults) {
    if (r.status === "fulfilled" && r.value !== null) {
      await completeClaimed(prisma, r.value);
    }
  }
}

// ── Invariant 3: Stale token fence ──
// Stale token complete/renew affects 0 rows; correct token succeeds.

async function verifyStaleTokenFence(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  const enqueue = await enqueueTaskRun(
    prisma,
    baseEnqueue(ctx, "AI_RELEVANCE", `fence:${ctx.runId}:1`, 3),
  );
  assert(enqueue.created, "Fence test task must be created.");
  const claimed = await claimNextTaskRun(prisma, {
    workerId: ctx.worker("fence"),
    types: ["AI_RELEVANCE"],
    leaseDurationMs: LEASE_DURATION_MS,
  });
  assert(claimed !== null, "Must claim the fence test task.");
  assert(
    claimed.id === enqueue.taskRun.id,
    "Claim must pick the exact fence task.",
  );
  // Stale token renew must affect 0 rows.
  const staleRenew = await renewTaskRunLease(prisma, {
    taskRunId: claimed.id,
    workerId: claimed.leaseOwner,
    leaseToken: "stale-token-xxxxxxxxxxxx",
    leaseDurationMs: 60_000,
  });
  assert(!staleRenew, "Stale token renew must affect 0 rows.");
  // Stale token complete must affect 0 rows.
  const staleComplete = await completeClaimedTaskRun(prisma, {
    taskRunId: claimed.id,
    workerId: claimed.leaseOwner,
    leaseToken: "stale-token-xxxxxxxxxxxx",
    output: {},
  });
  assert(!staleComplete, "Stale token complete must affect 0 rows.");
  // Correct token renew must succeed.
  const validRenew = await renewTaskRunLease(prisma, {
    taskRunId: claimed.id,
    workerId: claimed.leaseOwner,
    leaseToken: claimed.leaseToken,
    leaseDurationMs: 60_000,
  });
  assert(validRenew, "Correct token renew must succeed.");
  await completeClaimed(prisma, claimed);
}

// ── Invariant 4: maxAttempts=2 failure budget ──
// claim1+fail => PENDING; claim2+fail => FAILED.
// DB branch decides, caller never passes "exhausted".

async function verifyFailureBudget(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  const enqueue = await enqueueTaskRun(
    prisma,
    baseEnqueue(ctx, "BRIEFING_GENERATION", `budget:${ctx.runId}:1`, 2),
  );
  assert(enqueue.created, "Budget test task must be created.");
  // Attempt 1: claim + fail => PENDING (1 < 2).
  const claim1 = await claimNextTaskRun(prisma, {
    workerId: ctx.worker("budget"),
    types: ["BRIEFING_GENERATION"],
    leaseDurationMs: LEASE_DURATION_MS,
  });
  assert(claim1 !== null, "First claim must pick the budget task.");
  assert(claim1.id === enqueue.taskRun.id, "First claim must pick exact task.");
  assert(claim1.attempt === 1, "First claim must set attempt to 1.");
  const failNow1 = new Date();
  const fail1 = await failClaimedTaskRun(prisma, {
    taskRunId: claim1.id,
    workerId: claim1.leaseOwner,
    leaseToken: claim1.leaseToken,
    errorClass: "application_error",
    retryAt: failNow1,
    now: failNow1,
  });
  assert(fail1.settled, `First fail must settle (got settled=${fail1.settled}).`);
  assert(
    fail1.status === "PENDING",
    `First fail must return PENDING (got status=${fail1.status}).`,
  );
  // Attempt 2: claim + fail => FAILED (2 >= 2).
  const claim2 = await claimNextTaskRun(prisma, {
    workerId: ctx.worker("budget"),
    types: ["BRIEFING_GENERATION"],
    leaseDurationMs: LEASE_DURATION_MS,
  });
  assert(claim2 !== null, "Second claim must pick the same budget task.");
  assert(
    claim2.id === enqueue.taskRun.id,
    "Second claim must pick exact task.",
  );
  assert(claim2.attempt === 2, "Second claim must set attempt to 2.");
  const failNow2 = new Date();
  const fail2 = await failClaimedTaskRun(prisma, {
    taskRunId: claim2.id,
    workerId: claim2.leaseOwner,
    leaseToken: claim2.leaseToken,
    errorClass: "application_error",
    retryAt: failNow2,
    now: failNow2,
  });
  assert(fail2.settled, `Second fail must settle (got settled=${fail2.settled}).`);
  assert(
    fail2.status === "FAILED",
    `Second fail must return FAILED (got status=${fail2.status}).`,
  );
  // FAILED task must not be claimable.
  const claim3 = await claimNextTaskRun(prisma, {
    workerId: ctx.worker("budget"),
    types: ["BRIEFING_GENERATION"],
    leaseDurationMs: LEASE_DURATION_MS,
  });
  assert(claim3 === null, "FAILED task must not be claimable.");
}

// ── Invariant 5: maxAttempts=1 planned yield ──
// Claim then yield: attempt restores to 0. Re-claim gives attempt=1 and
// can complete, proving yield is failure-budget neutral.

async function verifyPlannedYield(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  const enqueue = await enqueueTaskRun(
    prisma,
    baseEnqueue(ctx, "EXPORT_GENERATION", `yield:${ctx.runId}:1`, 1),
  );
  assert(enqueue.created, "Yield test task must be created.");
  const claim1 = await claimNextTaskRun(prisma, {
    workerId: ctx.worker("yield"),
    types: ["EXPORT_GENERATION"],
    leaseDurationMs: LEASE_DURATION_MS,
  });
  assert(claim1 !== null, "First claim must pick the yield task.");
  assert(
    claim1.id === enqueue.taskRun.id,
    "First claim must pick exact task.",
  );
  assert(claim1.attempt === 1, "First claim must set attempt to 1.");
  // Yield: attempt restores to 0 (budget neutral).
  const yieldNow = new Date();
  const yieldResult = await yieldClaimedTaskRun(prisma, {
    taskRunId: claim1.id,
    workerId: claim1.leaseOwner,
    leaseToken: claim1.leaseToken,
    scheduledAt: yieldNow,
    now: yieldNow,
  });
  assert(yieldResult, "Yield must commit.");
  const afterYield = await prisma.taskRun.findUnique({
    where: { id: claim1.id },
    select: { attempt: true, status: true },
  });
  assert(afterYield !== null, "Task must exist after yield.");
  assert(afterYield.attempt === 0, "Yield must restore attempt to 0.");
  assert(afterYield.status === "PENDING", "Yield must set status to PENDING.");
  // Re-claim: attempt should be 1 again (0 + 1).
  const claim2 = await claimNextTaskRun(prisma, {
    workerId: ctx.worker("yield"),
    types: ["EXPORT_GENERATION"],
    leaseDurationMs: LEASE_DURATION_MS,
  });
  assert(claim2 !== null, "Second claim must pick the same yield task.");
  assert(
    claim2.id === enqueue.taskRun.id,
    "Second claim must pick exact task.",
  );
  assert(
    claim2.attempt === 1,
    "After yield+claim, attempt must be 1 again.",
  );
  await completeClaimed(prisma, claim2);
}

// ── Invariant 6: Exact-expiry reaper ──
// maxAttempts=2: first expired => PENDING/recovered; second expired =>
// FAILED/finalized. Lease fields cleared, errorMessage='lease_expired'.

async function verifyReaper(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  const enqueue = await enqueueTaskRun(
    prisma,
    baseEnqueue(ctx, "REPORT_GENERATION", `reaper:${ctx.runId}:1`, 2),
  );
  assert(enqueue.created, "Reaper test task must be created.");
  await reaperFirstCycle(prisma, ctx, enqueue.taskRun.id);
  await reaperSecondCycle(prisma, ctx, enqueue.taskRun.id);
}

async function reaperFirstCycle(
  prisma: PrismaClient,
  ctx: FixtureContext,
  taskId: string,
): Promise<void> {
  const claimed = await claimNextTaskRun(prisma, {
    workerId: ctx.worker("reaper"),
    types: ["REPORT_GENERATION"],
    leaseDurationMs: REAPER_LEASE_MS,
  });
  assert(claimed !== null, "Reaper first claim must pick the exact task.");
  assert(claimed.id === taskId, "Reaper first claim must pick exact task ID.");
  assert(claimed.attempt === 1, "First claim must set attempt to 1.");
  await sleep(REAPER_WAIT_MS);
  const result = await recoverExpiredTaskRuns(prisma, {
    types: ["REPORT_GENERATION"],
    limit: 10,
  });
  assert(
    result.recovered === 1 && result.finalized === 0,
    `First reaper must recover=1, finalize=0 (got recovered=${result.recovered}, finalized=${result.finalized}).`,
  );
  const row = await prisma.taskRun.findUnique({
    where: { id: taskId },
    select: {
      status: true,
      leaseOwner: true,
      leaseToken: true,
      leaseExpiresAt: true,
      errorMessage: true,
    },
  });
  assert(row !== null, "After first reaper, task must exist.");
  assert(row.status === "PENDING", "After first reaper, status must be PENDING.");
  assert(
    row.leaseOwner === null,
    "After first reaper, leaseOwner must be null.",
  );
  assert(
    row.leaseToken === null,
    "After first reaper, leaseToken must be null.",
  );
  assert(
    row.leaseExpiresAt === null,
    "After first reaper, leaseExpiresAt must be null.",
  );
  assert(
    row.errorMessage === "lease_expired",
    "After first reaper, errorMessage must be 'lease_expired'.",
  );
}

async function reaperSecondCycle(
  prisma: PrismaClient,
  ctx: FixtureContext,
  taskId: string,
): Promise<void> {
  const claimed = await claimNextTaskRun(prisma, {
    workerId: ctx.worker("reaper"),
    types: ["REPORT_GENERATION"],
    leaseDurationMs: REAPER_LEASE_MS,
  });
  assert(claimed !== null, "Reaper second claim must pick the same task.");
  assert(
    claimed.id === taskId,
    "Reaper second claim must pick exact task ID.",
  );
  assert(claimed.attempt === 2, "Second claim must set attempt to 2.");
  await sleep(REAPER_WAIT_MS);
  const result = await recoverExpiredTaskRuns(prisma, {
    types: ["REPORT_GENERATION"],
    limit: 10,
  });
  assert(
    result.recovered === 0 && result.finalized === 1,
    `Second reaper must recover=0, finalize=1 (got recovered=${result.recovered}, finalized=${result.finalized}).`,
  );
  const row = await prisma.taskRun.findUnique({
    where: { id: taskId },
    select: {
      status: true,
      leaseOwner: true,
      leaseToken: true,
      leaseExpiresAt: true,
      errorMessage: true,
      finishedAt: true,
    },
  });
  assert(row !== null, "After second reaper, task must exist.");
  assert(row.status === "FAILED", "After second reaper, status must be FAILED.");
  assert(
    row.leaseOwner === null,
    "After second reaper, leaseOwner must be null.",
  );
  assert(
    row.leaseToken === null,
    "After second reaper, leaseToken must be null.",
  );
  assert(
    row.leaseExpiresAt === null,
    "After second reaper, leaseExpiresAt must be null.",
  );
  assert(
    row.errorMessage === "lease_expired",
    "After second reaper, errorMessage must be 'lease_expired'.",
  );
  assert(
    row.finishedAt !== null,
    "After second reaper, finishedAt must be set.",
  );
}

// ── Invariant 7: Convergence ──
// All executable tasks created by this fixture must be in terminal state
// (SUCCEEDED or FAILED). No RUNNING or PENDING rows remain.

async function verifyConvergence(
  prisma: PrismaClient,
  ctx: FixtureContext,
): Promise<void> {
  const running = await prisma.taskRun.findMany({
    where: { organizationId: ctx.orgId, status: "RUNNING" },
    select: { id: true },
  });
  assert(
    running.length === 0,
    `No RUNNING tasks should remain (got ${running.length}).`,
  );
  const pending = await prisma.taskRun.findMany({
    where: { organizationId: ctx.orgId, status: "PENDING" },
    select: { id: true },
  });
  assert(
    pending.length === 0,
    `No PENDING tasks should remain (got ${pending.length}).`,
  );
}
