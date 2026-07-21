/**
 * Durable TaskRun repository for Issue #162 Lane 1B.
 *
 * State machine (all transitions fenced - status + leaseOwner + leaseToken +
 * leaseExpiresAt > now predicate, no read-then-unfenced-update):
 *
 *   enqueue  -> PENDING          attempt=0, lease*=null, idempotency set
 *   claim    -> RUNNING         attempt+1, startedAt=COALESCE(startedAt,now),
 *                               lease owner/token/expiry/heartbeat set,
 *                               finished/error/output cleared
 *   renew    -> RUNNING (extend) leaseExpiresAt = now + duration, heartbeat=now
 *   complete -> SUCCEEDED       output bounded (100KB), finishedAt=now, lease cleared
 *   fail     -> PENDING|FAILED  attempt < maxAttempts ? PENDING(scheduledAt=retryAt)
 *                               : FAILED(finishedAt); lease cleared; errorClass fixed
 *   yield    -> PENDING         planned budget neutral (attempt=GREATEST(attempt-1,0)),
 *                               scheduledAt injected, lease cleared
 *   reaper   -> PENDING|FAILED  expired RUNNING rows; attempt < maxAttempts ?
 *                               PENDING(lease_expired) : FAILED; lease cleared
 *
 * Security:
 *  - All raw SQL uses Prisma.sql / Prisma.join (parameterized), never string
 *    interpolation or \$queryRawUnsafe.
 *  - JSON input/output is bounded to 100KB; oversized payloads fail closed
 *    (no silent truncation to invalid JSON).
 *  - errorClass is restricted to a fixed low-cardinality allowlist; raw
 *    Error.message / URLs / secrets are never persisted.
 *  - workerId/type/duration validators reject empty / oversized / control-char
 *    / out-of-range values before any DB call.
 *
 * Lane 1C will freeze real PostgreSQL SKIP LOCKED concurrency invariants.
 */
import { Buffer } from "node:buffer";
import {
  Prisma,
  TaskRunType,
  type PrismaClient,
  type TaskRun,
} from "@prisma/client";

// ── Constants ──

const MAX_JSON_BYTES = 100 * 1024;
const MAX_WORKER_ID_LENGTH = 128;
const MAX_TYPE_ALLOWLIST_SIZE = 20;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 3_600_000;
const MAX_REAPER_LIMIT = 1_000;
const MIN_IDEMPOTENCY_KEY_LENGTH = 1;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 10;
const LEASE_TOKEN_BYTES = 32;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

const ACTIVE_IDEMPOTENCY_STATUSES = ["PENDING", "RUNNING"] as const;

/**
 * Fixed low-cardinality error classes. The repository NEVER accepts or
 * persists raw Error.message, URLs, or secrets - only this allowlist.
 * Adding a class is a deliberate, reviewed schema decision.
 */
export type TaskRunErrorClass =
  | "application_error"
  | "configuration"
  | "timeout"
  | "upstream"
  | "cancelled";

const ERROR_CLASS_SET: ReadonlySet<TaskRunErrorClass> = new Set([
  "application_error",
  "configuration",
  "timeout",
  "upstream",
  "cancelled",
]);

const TIMEOUT_CODES = new Set(["ETIMEDOUT", "ERR_OPERATION_TIMED_OUT", "ABORT_ERR"]);
const UPSTREAM_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH"]);
const CONFIG_CODES = new Set(["ENCRYPTION_KEY", "DATABASE_URL"]);

export function classifyTaskRunError(error: unknown): TaskRunErrorClass {
  const record = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : null;
  const code = typeof record?.["code"] === "string"
    ? record["code"].toUpperCase()
    : "";
  if (TIMEOUT_CODES.has(code)) return "timeout";
  if (UPSTREAM_CODES.has(code)) return "upstream";
  if (CONFIG_CODES.has(code)) return "configuration";

  const rawName = error instanceof Error
    ? error.name
    : typeof record?.["name"] === "string" ? record["name"] : "";
  const name = rawName.toLowerCase();
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (name.includes("timeout") || /\b(?:timeout|timed out)\b/.test(message)) {
    return "timeout";
  }
  if (
    name.includes("configuration") ||
    /\b(?:database_url|encryption_key|missing (?:env|environment)|required but not set|required-but-not-set|configuration error)\b/.test(message)
  ) {
    return "configuration";
  }
  if (/\b(?:connection refused|econnrefused|upstream|unreachable|network error)\b/.test(message)) {
    return "upstream";
  }
  return "application_error";
}

// ── Types ──

export interface EnqueueTaskRunInput {
  organizationId: string;
  type: TaskRunType;
  topicId?: string;
  sourceId?: string;
  itemId?: string;
  eventId?: string;
  /** 1..200 chars, no control characters. Required. */
  idempotencyKey: string;
  /** 1..10. */
  maxAttempts: number;
  /** Bounded to 100KB; oversized input fails closed. */
  input?: Record<string, unknown>;
  /** Injected scheduledAt; defaults to now(). */
  scheduledAt?: Date;
}

export interface EnqueueTaskRunResult {
  taskRun: TaskRun;
  created: boolean;
}

export type EnqueueTaskRunMutation = (
  tx: Prisma.TransactionClient,
  taskRun: TaskRun,
) => Promise<void>;

export type ClaimedTaskRun = Pick<
  TaskRun,
  | "id"
  | "organizationId"
  | "topicId"
  | "sourceId"
  | "itemId"
  | "eventId"
  | "type"
  | "status"
  | "attempt"
  | "maxAttempts"
  | "scheduledAt"
  | "startedAt"
  | "input"
> & {
  status: "RUNNING";
  leaseOwner: string;
  leaseToken: string;
  leaseExpiresAt: Date;
  heartbeatAt: Date;
};

export interface RenewTaskRunLeaseInput {
  taskRunId: string;
  workerId: string;
  leaseToken: string;
  leaseDurationMs: number;
  now?: Date;
}

export interface CompleteClaimedTaskRunInput {
  taskRunId: string;
  workerId: string;
  leaseToken: string;
  output: Record<string, unknown>;
  now?: Date;
}

export interface FailClaimedTaskRunInput {
  taskRunId: string;
  workerId: string;
  leaseToken: string;
  errorClass: TaskRunErrorClass;
  retryAt: Date;
  now?: Date;
}

export interface FailClaimedTaskRunResult {
  settled: boolean;
  status?: "PENDING" | "FAILED";
}

export interface YieldClaimedTaskRunInput {
  taskRunId: string;
  workerId: string;
  leaseToken: string;
  scheduledAt: Date;
  now?: Date;
}

export interface RecoverExpiredTaskRunsInput {
  types: TaskRunType[];
  limit: number;
  now?: Date;
}

export interface RecoverExpiredTaskRunsResult {
  recovered: number;
  finalized: number;
}

// ── Validation helpers ──

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be blank.`);
  }
}

function assertNoControlChars(value: string, label: string): void {
  if (CONTROL_CHARS.test(value)) {
    throw new Error(`${label} must not contain control characters.`);
  }
}

function assertBoundedString(
  value: string,
  min: number,
  max: number,
  label: string,
): void {
  if (value.length < min || value.length > max) {
    throw new Error(
      `${label} length must be within [${min}, ${max}] (got ${value.length}).`,
    );
  }
}

function assertValidWorkerId(workerId: string): void {
  assertNonEmpty(workerId, "workerId");
  assertNoControlChars(workerId, "workerId");
  assertBoundedString(workerId, 1, MAX_WORKER_ID_LENGTH, "workerId");
}

function assertValidTypeAllowlist(types: TaskRunType[]): void {
  if (types.length === 0) {
    throw new Error("types allowlist must not be empty.");
  }
  if (types.length > MAX_TYPE_ALLOWLIST_SIZE) {
    throw new Error(
      `types allowlist must not exceed ${MAX_TYPE_ALLOWLIST_SIZE} entries (got ${types.length}).`,
    );
  }
  const allowed = new Set(Object.values(TaskRunType));
  for (const t of types) {
    assertNonEmpty(t, "type");
    assertNoControlChars(t, "type");
    if (!allowed.has(t)) {
      throw new Error(`Unknown TaskRun type: ${t}.`);
    }
  }
}

function assertValidLeaseDuration(durationMs: number): void {
  if (
    !Number.isFinite(durationMs) ||
    durationMs < MIN_LEASE_MS ||
    durationMs > MAX_LEASE_MS
  ) {
    throw new Error(
      `leaseDurationMs must be within [${MIN_LEASE_MS}, ${MAX_LEASE_MS}] (got ${durationMs}).`,
    );
  }
}

function assertValidIdempotencyKey(key: string): void {
  assertBoundedString(
    key.trim(),
    MIN_IDEMPOTENCY_KEY_LENGTH,
    MAX_IDEMPOTENCY_KEY_LENGTH,
    "idempotencyKey",
  );
  assertNoControlChars(key, "idempotencyKey");
}

function assertValidMaxAttempts(value: number): void {
  if (!Number.isInteger(value) || value < MIN_MAX_ATTEMPTS || value > MAX_MAX_ATTEMPTS) {
    throw new Error(
      `maxAttempts must be an integer within [${MIN_MAX_ATTEMPTS}, ${MAX_MAX_ATTEMPTS}] (got ${value}).`,
    );
  }
}

function assertValidErrorClass(value: TaskRunErrorClass): void {
  if (!ERROR_CLASS_SET.has(value)) {
    throw new Error(
      `errorClass must be one of: ${[...ERROR_CLASS_SET].join(", ")} (got ${String(value)}).`,
    );
  }
}

function assertJsonBounded(value: Record<string, unknown>, label: string): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON-serializable.`);
  }
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > MAX_JSON_BYTES) {
    throw new Error(
      `${label} exceeds the ${MAX_JSON_BYTES}-byte bound (got ${byteLength}); fail closed.`,
    );
  }
}

function assertValidReaperLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REAPER_LIMIT) {
    throw new Error(
      `reaper limit must be an integer within [1, ${MAX_REAPER_LIMIT}] (got ${limit}).`,
    );
  }
}

function assertValidSchedule(value: Date, now: Date, label: string): void {
  if (!Number.isFinite(value.getTime()) || value.getTime() < now.getTime()) {
    throw new Error(`${label} must be a valid date at or after now.`);
  }
}

async function queryRows<T>(prisma: PrismaClient, query: Prisma.Sql): Promise<T[]> {
  return (prisma as unknown as {
    $queryRaw<R>(sql: Prisma.Sql): Promise<R>;
  }).$queryRaw<T[]>(query);
}

function isP2002(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error as { code?: string }).code === "P2002"
  );
}

function generateLeaseToken(): string {
  // High-entropy opaque token. 32 random bytes -> base64url (~43 chars).
  const bytes = new Uint8Array(LEASE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)] : "";
    out += i + 2 < bytes.length ? alphabet[b2 & 0x3f] : "";
  }
  return out;
}

// ── 1. enqueueTaskRun ──

function buildEnqueueCreateData(input: EnqueueTaskRunInput) {
  assertNonEmpty(input.organizationId, "organizationId");
  assertNonEmpty(input.type, "type");
  assertValidIdempotencyKey(input.idempotencyKey);
  assertValidMaxAttempts(input.maxAttempts);
  if (input.input !== undefined) {
    assertJsonBounded(input.input, "input");
  }

  const scheduledAt = input.scheduledAt ?? new Date();
  return {
    organizationId: input.organizationId,
    topicId: input.topicId,
    sourceId: input.sourceId,
    itemId: input.itemId,
    eventId: input.eventId,
    type: input.type,
    status: "PENDING" as const,
    attempt: 0,
    maxAttempts: input.maxAttempts,
    scheduledAt,
    startedAt: null,
    finishedAt: null,
    idempotencyKey: input.idempotencyKey,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    ...(input.input === undefined
      ? {}
      : { input: input.input as Prisma.InputJsonValue }),
  };
}

async function findActiveIdempotencyWinner(
  prisma: Pick<PrismaClient, "taskRun">,
  input: EnqueueTaskRunInput,
): Promise<TaskRun | null> {
  return prisma.taskRun.findFirst({
    where: {
      organizationId: input.organizationId,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      status: { in: [...ACTIVE_IDEMPOTENCY_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function enqueueTaskRun(
  prisma: PrismaClient,
  input: EnqueueTaskRunInput,
): Promise<EnqueueTaskRunResult> {
  const createData = buildEnqueueCreateData(input);

  try {
    const taskRun = await prisma.taskRun.create({ data: createData });
    return { taskRun, created: true };
  } catch (error) {
    if (!isP2002(error)) {
      // Non-P2002 errors propagate verbatim - never swallowed.
      throw error;
    }
    // P2002 winner fallback: another worker won the active-idempotency race.
    // Find the existing active row by the same business key. If not found,
    // rethrow the original P2002 (do not synthesize a phantom row).
    const existing = await findActiveIdempotencyWinner(prisma, input);
    if (existing === null) {
      throw error;
    }
    return { taskRun: existing, created: false };
  }
}

/**
 * Atomically enqueue a durable task and apply the producer's local state
 * transition. This prevents a fast consumer from completing between task
 * creation and the UI-visible PENDING update. Active-key races are resolved
 * outside the aborted transaction against the committed winner.
 */
export async function enqueueTaskRunWithMutation(
  prisma: PrismaClient,
  input: EnqueueTaskRunInput,
  mutate: EnqueueTaskRunMutation,
): Promise<EnqueueTaskRunResult> {
  const createData = buildEnqueueCreateData(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await findActiveIdempotencyWinner(tx, input);
      if (existing) return { taskRun: existing, created: false };
      const taskRun = await tx.taskRun.create({ data: createData });
      await mutate(tx, taskRun);
      return { taskRun, created: true };
    });
  } catch (error) {
    if (!isP2002(error)) throw error;
    const existing = await findActiveIdempotencyWinner(prisma, input);
    if (!existing) throw error;
    return { taskRun: existing, created: false };
  }
}

// ── 2. claimNextTaskRun ──

export async function claimNextTaskRun(
  prisma: PrismaClient,
  options: {
    workerId: string;
    types: TaskRunType[];
    leaseDurationMs: number;
    now?: Date;
  },
): Promise<ClaimedTaskRun | null> {
  assertValidWorkerId(options.workerId);
  assertValidTypeAllowlist(options.types);
  assertValidLeaseDuration(options.leaseDurationMs);

  const now = options.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + options.leaseDurationMs);
  const leaseToken = generateLeaseToken();

  // Single-statement PostgreSQL CTE with FOR UPDATE SKIP LOCKED + UPDATE
  // RETURNING. Exact type allowlist (Prisma.join, no interpolation).
  const query = Prisma.sql`
    WITH next_run AS (
      SELECT "id" FROM "TaskRun"
      WHERE "status" = 'PENDING'
        AND "type" IN (${Prisma.join(options.types)})
        AND "scheduledAt" <= ${now}
        AND "attempt" < "maxAttempts"
      ORDER BY "scheduledAt" ASC, "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "TaskRun"
    SET "status" = 'RUNNING',
        "attempt" = "attempt" + 1,
        "startedAt" = COALESCE("startedAt", ${now}),
        "leaseOwner" = ${options.workerId},
        "leaseToken" = ${leaseToken},
        "leaseExpiresAt" = ${leaseExpiresAt},
        "heartbeatAt" = ${now},
        "finishedAt" = NULL,
        "errorMessage" = NULL,
        "output" = NULL,
        "updatedAt" = ${now}
    FROM next_run
    WHERE "TaskRun"."id" = next_run."id"
    RETURNING "TaskRun"."id", "TaskRun"."organizationId", "TaskRun"."topicId",
              "TaskRun"."sourceId", "TaskRun"."itemId", "TaskRun"."eventId",
              "TaskRun"."type", "TaskRun"."scheduledAt", "TaskRun"."startedAt",
              "TaskRun"."input",
              "TaskRun"."status", "TaskRun"."attempt", "TaskRun"."maxAttempts",
              "TaskRun"."leaseOwner", "TaskRun"."leaseToken",
              "TaskRun"."leaseExpiresAt", "TaskRun"."heartbeatAt"`;

  const rows = (await (prisma as unknown as {
    $queryRaw<T>(query: unknown): Promise<T>;
  }).$queryRaw<ClaimedTaskRun[]>(query)) as ClaimedTaskRun[];
  if (rows.length === 0) {
    return null;
  }
  return rows[0]!;
}

// ── 3. renewTaskRunLease ──

export async function renewTaskRunLease(
  prisma: PrismaClient,
  input: RenewTaskRunLeaseInput,
): Promise<boolean> {
  assertValidWorkerId(input.workerId);
  assertNonEmpty(input.taskRunId, "taskRunId");
  assertNonEmpty(input.leaseToken, "leaseToken");
  assertValidLeaseDuration(input.leaseDurationMs);

  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);

  // Five-fold fence: id + status=RUNNING + leaseOwner + leaseToken +
  // leaseExpiresAt > now (lease not yet expired). Stale token or expired
  // lease affects 0 rows -> return false.
  const result = await prisma.taskRun.updateMany({
    where: {
      id: input.taskRunId,
      status: "RUNNING",
      leaseOwner: input.workerId,
      leaseToken: input.leaseToken,
      leaseExpiresAt: { gt: now },
    },
    data: {
      leaseExpiresAt,
      heartbeatAt: now,
      updatedAt: now,
    },
  });
  return result.count === 1;
}

// ── 4. completeClaimedTaskRun ──

export async function completeClaimedTaskRun(
  prisma: PrismaClient,
  input: CompleteClaimedTaskRunInput,
): Promise<boolean> {
  assertValidWorkerId(input.workerId);
  assertNonEmpty(input.taskRunId, "taskRunId");
  assertNonEmpty(input.leaseToken, "leaseToken");
  assertJsonBounded(input.output, "output");

  const now = input.now ?? new Date();

  // Atomic fenced transition to SUCCEEDED. Stale token / expired lease -> 0
  // rows affected -> return false (the worker no longer owns the lease).
  const result = await prisma.taskRun.updateMany({
    where: {
      id: input.taskRunId,
      status: "RUNNING",
      leaseOwner: input.workerId,
      leaseToken: input.leaseToken,
      leaseExpiresAt: { gt: now },
    },
    data: {
      status: "SUCCEEDED",
      output: input.output as never,
      finishedAt: now,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      updatedAt: now,
    },
  });
  return result.count === 1;
}

// ── 5. failClaimedTaskRun ──

export async function failClaimedTaskRun(
  prisma: PrismaClient,
  input: FailClaimedTaskRunInput,
): Promise<FailClaimedTaskRunResult> {
  assertValidWorkerId(input.workerId);
  assertNonEmpty(input.taskRunId, "taskRunId");
  assertNonEmpty(input.leaseToken, "leaseToken");
  assertValidErrorClass(input.errorClass);

  const now = input.now ?? new Date();
  assertValidSchedule(input.retryAt, now, "retryAt");
  const rows = await queryRows<{ status: "PENDING" | "FAILED" }>(
    prisma,
    buildFailureTransition(input, now),
  );
  const row = rows[0];
  return row ? { settled: true, status: row.status } : { settled: false };
}

function buildFailureTransition(input: FailClaimedTaskRunInput, now: Date): Prisma.Sql {
  return Prisma.sql`
    UPDATE "TaskRun"
    SET "status" = CASE WHEN "attempt" < "maxAttempts"
          THEN 'PENDING'::"TaskRunStatus" ELSE 'FAILED'::"TaskRunStatus" END,
        "scheduledAt" = CASE WHEN "attempt" < "maxAttempts"
          THEN ${input.retryAt} ELSE "scheduledAt" END,
        "finishedAt" = CASE WHEN "attempt" < "maxAttempts"
          THEN NULL::timestamp(3) ELSE ${now} END,
        "errorMessage" = ${input.errorClass},
        "leaseOwner" = NULL, "leaseToken" = NULL,
        "leaseExpiresAt" = NULL, "heartbeatAt" = NULL, "updatedAt" = ${now}
    WHERE "id" = ${input.taskRunId} AND "status" = 'RUNNING'
      AND "leaseOwner" = ${input.workerId} AND "leaseToken" = ${input.leaseToken}
      AND "leaseExpiresAt" > ${now}
    RETURNING "status"`;
}

// ── 6. yieldClaimedTaskRun ──

export async function yieldClaimedTaskRun(
  prisma: PrismaClient,
  input: YieldClaimedTaskRunInput,
): Promise<boolean> {
  assertValidWorkerId(input.workerId);
  assertNonEmpty(input.taskRunId, "taskRunId");
  assertNonEmpty(input.leaseToken, "leaseToken");
  const now = input.now ?? new Date();
  assertValidSchedule(input.scheduledAt, now, "scheduledAt");

  const rows = await queryRows<{ id: string }>(prisma, Prisma.sql`
    UPDATE "TaskRun"
    SET "status" = 'PENDING', "scheduledAt" = ${input.scheduledAt},
        "attempt" = GREATEST("attempt" - 1, 0), "finishedAt" = NULL,
        "errorMessage" = NULL,
        "leaseOwner" = NULL, "leaseToken" = NULL,
        "leaseExpiresAt" = NULL, "heartbeatAt" = NULL, "updatedAt" = ${now}
    WHERE "id" = ${input.taskRunId} AND "status" = 'RUNNING'
      AND "leaseOwner" = ${input.workerId} AND "leaseToken" = ${input.leaseToken}
      AND "leaseExpiresAt" > ${now}
    RETURNING "id"`);
  return rows.length === 1;
}

// ── 7. recoverExpiredTaskRuns ──

export async function recoverExpiredTaskRuns(
  prisma: PrismaClient,
  options: RecoverExpiredTaskRunsInput,
): Promise<RecoverExpiredTaskRunsResult> {
  assertValidTypeAllowlist(options.types);
  assertValidReaperLimit(options.limit);
  const now = options.now ?? new Date();

  const rows = await queryRows<{ status: "PENDING" | "FAILED" }>(prisma, Prisma.sql`
    WITH expired AS (
      SELECT "id", "attempt", "maxAttempts" FROM "TaskRun"
      WHERE "status" = 'RUNNING' AND "type" IN (${Prisma.join(options.types)})
        AND "leaseExpiresAt" IS NOT NULL AND "leaseExpiresAt" <= ${now}
      ORDER BY "leaseExpiresAt" ASC, "id" ASC
      LIMIT ${options.limit} FOR UPDATE SKIP LOCKED
    )
    UPDATE "TaskRun"
    SET "status" = CASE WHEN expired."attempt" < expired."maxAttempts"
          THEN 'PENDING'::"TaskRunStatus" ELSE 'FAILED'::"TaskRunStatus" END,
        "scheduledAt" = CASE WHEN expired."attempt" < expired."maxAttempts"
          THEN ${now} ELSE "TaskRun"."scheduledAt" END,
        "finishedAt" = CASE WHEN expired."attempt" < expired."maxAttempts"
          THEN NULL::timestamp(3) ELSE ${now} END,
        -- Reserved system marker written only by the lease reaper. This is not
        -- caller-provided TaskRunErrorClass data and never contains raw errors.
        "errorMessage" = 'lease_expired',
        "leaseOwner" = NULL, "leaseToken" = NULL,
        "leaseExpiresAt" = NULL, "heartbeatAt" = NULL, "updatedAt" = ${now}
    FROM expired WHERE "TaskRun"."id" = expired."id"
    RETURNING "TaskRun"."status"`);

  return {
    recovered: rows.filter((row) => row.status === "PENDING").length,
    finalized: rows.filter((row) => row.status === "FAILED").length,
  };
}
