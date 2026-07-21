/**
 * Durable TaskRun consumer (Lane 2B, Issue #162).
 *
 * Drains the durable TaskRun queue by claiming PENDING rows of the exact
 * supported types (SOURCE_FETCH, SOURCE_DISCOVERY, CONTENT_FETCH), executing the
 * corresponding Lane 2A workspace handler, and settling the lease.
 *
 * Security:
 *  - Only the three explicit durable command types are claimed (exact allowlist).
 *  - Claimed input is strict-parsed per type.
 *    Malformed input is fenced as application_error without invoking handler.
 *  - Handler failures are classified into a fixed low-cardinality set
 *    (configuration / timeout / upstream / application_error). Raw error
 *    messages, URLs, and stacks are never persisted or logged.
 *  - Lease heartbeat renews at ~lease/3; ownership loss is tracked honestly.
 *  - Timer is always cleaned up in finally; in-flight renewal is awaited.
 */
import { hostname } from "node:os";
import {
  claimNextTaskRun,
  classifyTaskRunError,
  completeClaimedTaskRun,
  failClaimedTaskRun,
  getPrismaClient,
  recoverExpiredTaskRuns,
  renewTaskRunLease,
  type ClaimedTaskRun,
  type TaskRunErrorClass,
} from "@wangchao/db";
import { runFetchCycleForWorkspace } from "./fetch-cycle.js";
import { runSourceDiscoveryForWorkspace } from "./discovery.js";
import { runEventSummaryRegeneration } from "./summary-regeneration.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";
import type { WorkspaceScope } from "./types.js";

// ── Constants ──

type PrismaClient = ReturnType<typeof getPrismaClient>;
type TaskRunType = ClaimedTaskRun["type"];

const SUPPORTED_TYPES: TaskRunType[] = ["SOURCE_FETCH", "SOURCE_DISCOVERY", "CONTENT_FETCH"];
const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]/;
const MAX_WORKER_ID_LENGTH = 128;
const MAX_USER_ID_LENGTH = 128;
const ALLOWED_MODES = new Set(["manual", "worker"]);
const HEARTBEAT_DIVISOR = 3;
const MIN_HEARTBEAT_MS = 250;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_TASKS = 50;
const MAX_MAX_TASKS = 500;
const DEFAULT_REAPER_LIMIT = 100;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 300_000;

// ── Exported types ──

export interface TaskRunConsumerMetrics {
  recovered: number;
  finalized: number;
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
  ownershipLost: number;
}

export interface TaskRunConsumerOptions {
  workerId?: string;
  leaseDurationMs?: number;
  maxTasks?: number;
  maxReaperLimit?: number;
}

export interface TaskRunConsumerDeps {
  prisma: PrismaClient;
  recoverExpiredTaskRuns: (
    prisma: PrismaClient,
    input: { types: TaskRunType[]; limit: number; now?: Date },
  ) => Promise<{ recovered: number; finalized: number }>;
  claimNextTaskRun: (
    prisma: PrismaClient,
    options: {
      workerId: string;
      types: TaskRunType[];
      leaseDurationMs: number;
      now?: Date;
    },
  ) => Promise<ClaimedTaskRun | null>;
  renewTaskRunLease: (
    prisma: PrismaClient,
    input: {
      taskRunId: string;
      workerId: string;
      leaseToken: string;
      leaseDurationMs: number;
      now?: Date;
    },
  ) => Promise<boolean>;
  completeClaimedTaskRun: (
    prisma: PrismaClient,
    input: {
      taskRunId: string;
      workerId: string;
      leaseToken: string;
      output: Record<string, unknown>;
      now?: Date;
    },
  ) => Promise<boolean>;
  failClaimedTaskRun: (
    prisma: PrismaClient,
    input: {
      taskRunId: string;
      workerId: string;
      leaseToken: string;
      errorClass: TaskRunErrorClass;
      retryAt: Date;
      now?: Date;
    },
  ) => Promise<{ settled: boolean; status?: "PENDING" | "FAILED" }>;
  runFetchCycleForWorkspace: (
    prisma: PrismaClient,
    scope: WorkspaceScope,
  ) => Promise<Record<string, unknown>>;
  runSourceDiscoveryForWorkspace: (
    prisma: PrismaClient,
    scope: WorkspaceScope,
    taskRunId: string,
    options: { mode: string; userId: string },
  ) => Promise<Record<string, unknown>>;
  runEventSummaryRegeneration: (
    prisma: PrismaClient,
    scope: WorkspaceScope,
    claimed: ClaimedTaskRun,
  ) => Promise<Record<string, unknown>>;
  setIntervalFn: (fn: () => void, intervalMs: number) => unknown;
  clearIntervalFn: (handle: unknown) => void;
  nowFn: () => Date;
  isShuttingDown?: () => boolean;
  isTimeExhausted?: () => boolean;
}

// ── Internal types ──

interface ParsedWorkspaceInput {
  mode: "manual" | "worker";
  userId: string;
}

interface ParsedSummaryInput {
  mode: "event-summary-regeneration";
  userId: string;
}

type ParsedInput = ParsedWorkspaceInput | ParsedSummaryInput;

interface HeartbeatHandle {
  timerHandle: unknown;
  lost: boolean;
  stopped: boolean;
  inFlight: Promise<void> | null;
}

// ── Main cycle ──

export async function runTaskRunConsumerCycle(
  options?: TaskRunConsumerOptions,
  deps?: TaskRunConsumerDeps,
): Promise<TaskRunConsumerMetrics> {
  const opts = resolveOptions(options);
  const d = deps ?? createDefaultDeps();
  const metrics: TaskRunConsumerMetrics = {
    recovered: 0,
    finalized: 0,
    claimed: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    ownershipLost: 0,
  };

  const reaperResult = await d.recoverExpiredTaskRuns(d.prisma, {
    types: SUPPORTED_TYPES,
    limit: opts.maxReaperLimit,
    now: d.nowFn(),
  });
  metrics.recovered = reaperResult.recovered;
  metrics.finalized = reaperResult.finalized;

  while (metrics.claimed < opts.maxTasks && !shouldStop(d)) {
    const claimed = await d.claimNextTaskRun(d.prisma, {
      workerId: opts.workerId,
      types: SUPPORTED_TYPES,
      leaseDurationMs: opts.leaseDurationMs,
      now: d.nowFn(),
    });
    if (claimed === null) break;
    await processClaimedTask(claimed, opts, d, metrics);
  }
  return metrics;
}

// ── Per-task processing ──

async function processClaimedTask(
  claimed: ClaimedTaskRun,
  opts: Required<TaskRunConsumerOptions>,
  deps: TaskRunConsumerDeps,
  metrics: TaskRunConsumerMetrics,
): Promise<void> {
  metrics.claimed++;
  const parsed = parseTaskRunInput(claimed.type, claimed.input);
  if (parsed === null) {
    await fencedFail(claimed, opts, deps, metrics, "application_error");
    return;
  }
  const heartbeat = startHeartbeat(claimed, opts, deps);
  let output: Record<string, unknown> | null = null;
  let failure: unknown;
  let failed = false;
  try {
    output = await dispatchHandler(claimed, parsed, deps);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    await stopHeartbeat(heartbeat, deps);
  }
  if (heartbeat.lost) {
    metrics.ownershipLost++;
  } else if (failed) {
    await settleFailure(claimed, opts, deps, metrics, failure);
  } else {
    await settleSuccess(claimed, opts, deps, metrics, output ?? {});
  }
}

// ── Dispatch ──

async function dispatchHandler(
  claimed: ClaimedTaskRun,
  parsed: ParsedInput,
  deps: TaskRunConsumerDeps,
): Promise<Record<string, unknown>> {
  const scope: WorkspaceScope = {
    organizationId: claimed.organizationId,
    userId: parsed.userId,
  };
  if (claimed.type === "SOURCE_FETCH") {
    return deps.runFetchCycleForWorkspace(deps.prisma, scope);
  }
  if (claimed.type === "SOURCE_DISCOVERY" && parsed.mode !== "event-summary-regeneration") {
    return deps.runSourceDiscoveryForWorkspace(deps.prisma, scope, claimed.id, {
      mode: parsed.mode,
      userId: parsed.userId,
    });
  }
  if (claimed.type === "CONTENT_FETCH" && parsed.mode === "event-summary-regeneration") {
    return deps.runEventSummaryRegeneration(deps.prisma, scope, claimed);
  }
  throw new Error("Task input does not match its claimed type.");
}

// ── Settle helpers ──

async function fencedFail(
  claimed: ClaimedTaskRun,
  opts: Required<TaskRunConsumerOptions>,
  deps: TaskRunConsumerDeps,
  metrics: TaskRunConsumerMetrics,
  errorClass: TaskRunErrorClass,
): Promise<void> {
  const now = deps.nowFn();
  const result = await deps.failClaimedTaskRun(deps.prisma, {
    taskRunId: claimed.id,
    workerId: opts.workerId,
    leaseToken: claimed.leaseToken,
    errorClass,
    retryAt: computeRetryAt(claimed.attempt, now),
    now,
  });
  countFailResult(result, metrics);
}

async function settleSuccess(
  claimed: ClaimedTaskRun,
  opts: Required<TaskRunConsumerOptions>,
  deps: TaskRunConsumerDeps,
  metrics: TaskRunConsumerMetrics,
  output: Record<string, unknown>,
): Promise<void> {
  const settled = await deps.completeClaimedTaskRun(deps.prisma, {
    taskRunId: claimed.id,
    workerId: opts.workerId,
    leaseToken: claimed.leaseToken,
    output,
    now: deps.nowFn(),
  });
  if (!settled) {
    metrics.ownershipLost++;
  } else {
    metrics.succeeded++;
  }
}

async function settleFailure(
  claimed: ClaimedTaskRun,
  opts: Required<TaskRunConsumerOptions>,
  deps: TaskRunConsumerDeps,
  metrics: TaskRunConsumerMetrics,
  error: unknown,
): Promise<void> {
  const now = deps.nowFn();
  const result = await deps.failClaimedTaskRun(deps.prisma, {
    taskRunId: claimed.id,
    workerId: opts.workerId,
    leaseToken: claimed.leaseToken,
    errorClass: classifyTaskRunError(error),
    retryAt: computeRetryAt(claimed.attempt, now),
    now,
  });
  countFailResult(result, metrics);
}

function countFailResult(
  result: { settled: boolean; status?: "PENDING" | "FAILED" },
  metrics: TaskRunConsumerMetrics,
): void {
  if (!result.settled) {
    metrics.ownershipLost++;
  } else if (result.status === "PENDING") {
    metrics.retried++;
  } else {
    metrics.failed++;
  }
}

// ── Heartbeat ──

function startHeartbeat(
  claimed: ClaimedTaskRun,
  opts: Required<TaskRunConsumerOptions>,
  deps: TaskRunConsumerDeps,
): HeartbeatHandle {
  const handle: HeartbeatHandle = {
    timerHandle: null,
    lost: false,
    stopped: false,
    inFlight: null,
  };
  const intervalMs = Math.max(
    MIN_HEARTBEAT_MS,
    Math.floor(opts.leaseDurationMs / HEARTBEAT_DIVISOR),
  );
  const tick = (): void => {
    if (handle.stopped || handle.inFlight !== null) return;
    handle.inFlight = renewLease(claimed, opts, deps, handle);
  };
  handle.timerHandle = deps.setIntervalFn(tick, intervalMs);
  return handle;
}

async function renewLease(
  claimed: ClaimedTaskRun,
  opts: Required<TaskRunConsumerOptions>,
  deps: TaskRunConsumerDeps,
  handle: HeartbeatHandle,
): Promise<void> {
  try {
    const ok = await deps.renewTaskRunLease(deps.prisma, {
      taskRunId: claimed.id,
      workerId: opts.workerId,
      leaseToken: claimed.leaseToken,
      leaseDurationMs: opts.leaseDurationMs,
      now: deps.nowFn(),
    });
    // renew=false is definitive ownership loss: the lease fence rejected us.
    // Skip settlement and count ownershipLost.
    if (!ok) handle.lost = true;
  } catch {
    // renew threw (transient DB/network error). This is NOT definitive
    // ownership loss - the lease may still be valid. Do NOT set lost=true.
    // Stop further heartbeat ticks (the renew path is unreliable) to avoid
    // spamming transient errors, but let the fenced complete/fail settlement
    // be the authority. If the lease has truly expired, the fenced settlement
    // will return settled=false and ownershipLost will be counted there.
    //
    // No raw error is logged (could contain URL/secret/stack).
    handle.stopped = true;
  } finally {
    handle.inFlight = null;
  }
}

async function stopHeartbeat(
  handle: HeartbeatHandle,
  deps: TaskRunConsumerDeps,
): Promise<void> {
  handle.stopped = true;
  if (handle.timerHandle !== null) {
    deps.clearIntervalFn(handle.timerHandle);
    handle.timerHandle = null;
  }
  if (handle.inFlight !== null) {
    await handle.inFlight;
  }
}

// ── Input parsing ──

function parseTaskRunInput(type: TaskRunType, input: unknown): ParsedInput | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 2 || !keys.includes("mode") || !keys.includes("userId")) {
    return null;
  }
  const mode = obj["mode"];
  const userId = obj["userId"];
  const validMode = type === "CONTENT_FETCH"
    ? mode === "event-summary-regeneration"
    : typeof mode === "string" && ALLOWED_MODES.has(mode);
  if (!validMode) {
    return null;
  }
  if (
    typeof userId !== "string" ||
    userId.length === 0 ||
    userId.length > MAX_USER_ID_LENGTH ||
    CONTROL_CHARS_PATTERN.test(userId)
  ) {
    return null;
  }
  return type === "CONTENT_FETCH"
    ? { mode: "event-summary-regeneration", userId }
    : { mode: mode as "manual" | "worker", userId };
}

// ── Backoff ──

function computeRetryAt(attempt: number, now: Date): Date {
  const exponent = Math.max(0, attempt - 1);
  const delayMs = Math.min(
    BACKOFF_BASE_MS * Math.pow(2, exponent),
    BACKOFF_MAX_MS,
  );
  return new Date(now.getTime() + delayMs);
}

// ── Options & workerId ──

function resolveOptions(
  options?: TaskRunConsumerOptions,
): Required<TaskRunConsumerOptions> {
  const resolved = {
    workerId: options?.workerId ?? buildDefaultWorkerId(),
    leaseDurationMs: options?.leaseDurationMs ?? DEFAULT_LEASE_MS,
    maxTasks: options?.maxTasks ?? DEFAULT_MAX_TASKS,
    maxReaperLimit: options?.maxReaperLimit ?? DEFAULT_REAPER_LIMIT,
  };
  assertConsumerOptions(resolved);
  return resolved;
}

function assertConsumerOptions(options: Required<TaskRunConsumerOptions>): void {
  if (
    options.workerId.trim().length === 0 ||
    options.workerId.length > MAX_WORKER_ID_LENGTH ||
    CONTROL_CHARS_PATTERN.test(options.workerId)
  ) throw new Error("workerId is invalid.");
  if (!Number.isInteger(options.maxTasks) || options.maxTasks < 1 || options.maxTasks > MAX_MAX_TASKS) {
    throw new Error(`maxTasks must be an integer within [1, ${MAX_MAX_TASKS}].`);
  }
  if (!Number.isInteger(options.maxReaperLimit) || options.maxReaperLimit < 1 || options.maxReaperLimit > 1_000) {
    throw new Error("maxReaperLimit must be an integer within [1, 1000].");
  }
  if (!Number.isInteger(options.leaseDurationMs) || options.leaseDurationMs < 1_000 || options.leaseDurationMs > 3_600_000) {
    throw new Error("leaseDurationMs must be an integer within [1000, 3600000].");
  }
}

function buildDefaultWorkerId(): string {
  const raw = `${hostname()}:${process.pid}`;
  const sanitized = raw
    .replace(CONTROL_CHARS_PATTERN, "")
    .slice(0, MAX_WORKER_ID_LENGTH);
  return sanitized.length > 0 ? sanitized : `worker:${process.pid}`;
}

function shouldStop(deps: TaskRunConsumerDeps): boolean {
  if (deps.isShuttingDown?.() === true) return true;
  if (deps.isTimeExhausted?.() === true) return true;
  return false;
}

// ── Production default deps ──

function createDefaultDeps(): TaskRunConsumerDeps {
  const prisma = getPrismaClient();
  return {
    prisma,
    recoverExpiredTaskRuns: (p, input) => recoverExpiredTaskRuns(p, input),
    claimNextTaskRun: (p, opts) => claimNextTaskRun(p, opts),
    renewTaskRunLease: (p, input) => renewTaskRunLease(p, input),
    completeClaimedTaskRun: (p, input) => completeClaimedTaskRun(p, input),
    failClaimedTaskRun: (p, input) => failClaimedTaskRun(p, input),
    runFetchCycleForWorkspace: (p, scope) =>
      runFetchCycleForWorkspace(p, scope) as unknown as Promise<Record<string, unknown>>,
    runSourceDiscoveryForWorkspace: (p, scope, id, opts) =>
      runSourceDiscoveryForWorkspace(p, scope, id, {
        mode: opts.mode as "manual" | "worker",
        userId: opts.userId,
      }) as unknown as Promise<Record<string, unknown>>,
    runEventSummaryRegeneration: (p, scope, claimed) =>
      runEventSummaryRegeneration(p, scope, claimed),
    setIntervalFn: (fn, ms) => setInterval(fn, ms),
    clearIntervalFn: (handle) =>
      clearInterval(handle as ReturnType<typeof setInterval>),
    nowFn: () => new Date(),
    isShuttingDown: () => isCycleShuttingDown(),
    isTimeExhausted: () => isCycleTimeExhausted(),
  };
}
