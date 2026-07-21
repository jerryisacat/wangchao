import { Prisma, type PrismaClient, type TaskRun } from "@prisma/client";
import {
  classifyTaskRunError,
  claimNextTaskRun,
  completeClaimedTaskRun,
  enqueueTaskRun,
  enqueueTaskRunWithMutation,
  failClaimedTaskRun,
  recoverExpiredTaskRuns,
  renewTaskRunLease,
  yieldClaimedTaskRun,
  type EnqueueTaskRunInput,
} from "./repositories/task-run.js";

export async function runTaskRunFixtures(): Promise<void> {
  await verifyEnqueueContract();
  await verifyAtomicEnqueueMutationContract();
  await verifyEnqueueConflictContract();
  await verifyInputValidation();
  await verifyClaimContract();
  await verifyLeaseFences();
  await verifyFailureTransitionContract();
  await verifyYieldContract();
  await verifyReaperContract();
  await verifyClassifierContract();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be a record.`);
  return value as Record<string, unknown>;
}

interface FakeOptions {
  create?: (args: unknown) => unknown;
  findFirst?: (args: unknown) => unknown;
  updateMany?: (args: unknown) => unknown;
  queryRaw?: (query: unknown) => unknown;
}

function fakePrisma(options: FakeOptions = {}) {
  const calls: Array<{ method: string; value: unknown }> = [];
  const prisma = {
    taskRun: {
      create: async (args: unknown) => {
        calls.push({ method: "create", value: args });
        return options.create?.(args) ?? taskRow(record(args, "create args").data);
      },
      findFirst: async (args: unknown) => {
        calls.push({ method: "findFirst", value: args });
        return options.findFirst?.(args) ?? null;
      },
      updateMany: async (args: unknown) => {
        calls.push({ method: "updateMany", value: args });
        return options.updateMany?.(args) ?? { count: 1 };
      },
    },
    $queryRaw: async (query: unknown) => {
      calls.push({ method: "queryRaw", value: query });
      return options.queryRaw?.(query) ?? [];
    },
    $transaction: async (run: (tx: PrismaClient) => Promise<unknown>) => run(prisma as unknown as PrismaClient),
  } as unknown as PrismaClient;
  return { calls, prisma };
}

async function verifyAtomicEnqueueMutationContract(): Promise<void> {
  const created = fakePrisma();
  let mutationCalls = 0;
  const result = await enqueueTaskRunWithMutation(
    created.prisma,
    baseEnqueue({ eventId: "event-1", itemId: "item-1", topicId: "topic-1" }),
    async (_tx, taskRun) => {
      mutationCalls += 1;
      assert(taskRun.eventId === "event-1", "Mutation must receive the newly bound task.");
    },
  );
  assert(result.created && mutationCalls === 1, "New enqueue must run its state mutation exactly once.");

  const winner = taskRow({ id: "winner", status: "PENDING" });
  const duplicate = fakePrisma({ findFirst: () => winner });
  mutationCalls = 0;
  const reused = await enqueueTaskRunWithMutation(
    duplicate.prisma,
    baseEnqueue(),
    async () => { mutationCalls += 1; },
  );
  assert(!reused.created && mutationCalls === 0, "Active duplicate must not reset state under the running task.");
}

function taskRow(overrides: unknown = {}): TaskRun {
  return {
    id: "task-1",
    organizationId: "org-1",
    topicId: null,
    sourceId: null,
    itemId: null,
    eventId: null,
    type: "SOURCE_FETCH",
    status: "PENDING",
    attempt: 0,
    maxAttempts: 3,
    scheduledAt: new Date("2026-08-01T00:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    input: null,
    output: null,
    idempotencyKey: "manual:org-1:1",
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...(overrides as Partial<TaskRun>),
  };
}

function baseEnqueue(overrides: Partial<EnqueueTaskRunInput> = {}): EnqueueTaskRunInput {
  return {
    organizationId: "org-1",
    type: "SOURCE_FETCH",
    idempotencyKey: "manual:org-1:1",
    maxAttempts: 3,
    input: { mode: "manual" },
    scheduledAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function sqlSource(value: unknown): string {
  const strings = record(value, "Prisma SQL").strings;
  assert(Array.isArray(strings), "Raw query must be built with Prisma.sql.");
  return strings.join("?");
}

function sqlValues(value: unknown): unknown[] {
  const values = record(value, "Prisma SQL").values;
  assert(Array.isArray(values), "Prisma SQL must expose parameter values.");
  return values;
}

function p2002(): Error {
  return new Prisma.PrismaClientKnownRequestError("active task conflict", {
    code: "P2002",
    clientVersion: "7.8.0",
  });
}

async function expectReject(run: () => Promise<unknown>, message: string): Promise<void> {
  let rejected = false;
  try {
    await run();
  } catch {
    rejected = true;
  }
  assert(rejected, message);
}

async function verifyEnqueueContract(): Promise<void> {
  const { prisma, calls } = fakePrisma();
  const result = await enqueueTaskRun(prisma, baseEnqueue({
    topicId: "topic-1",
    itemId: "item-1",
    eventId: "event-1",
  }));
  assert(result.created, "First enqueue must report created=true.");
  const data = record(record(calls[0]?.value, "create args").data, "create data");
  assert(data.status === "PENDING" && data.attempt === 0, "Enqueue must create an unclaimed PENDING task.");
  assert(data.startedAt === null && data.finishedAt === null, "Enqueue must not claim or finish the task.");
  assert(data.leaseOwner === null && data.leaseToken === null, "Enqueue must not create a lease.");
  assert(data.idempotencyKey === "manual:org-1:1", "Enqueue must persist the business key.");
  assert(
    data.topicId === "topic-1" && data.itemId === "item-1" && data.eventId === "event-1",
    "Enqueue must persist bound task subjects for exact-item dispatch.",
  );
}

async function verifyEnqueueConflictContract(): Promise<void> {
  const conflict = p2002();
  const winner = taskRow({ id: "winner", status: "RUNNING" });
  const { prisma, calls } = fakePrisma({
    create: () => { throw conflict; },
    findFirst: () => winner,
  });
  const result = await enqueueTaskRun(prisma, baseEnqueue());
  assert(!result.created && result.taskRun.id === "winner", "P2002 must return the exact active winner.");
  const where = record(record(calls[1]?.value, "find args").where, "find where");
  assert(where.organizationId === "org-1" && where.idempotencyKey === "manual:org-1:1", "Winner lookup must remain tenant/key scoped.");

  const missing = fakePrisma({ create: () => { throw conflict; }, findFirst: () => null });
  await expectReject(() => enqueueTaskRun(missing.prisma, baseEnqueue()), "P2002 without an active winner must be rethrown.");
}

async function verifyInputValidation(): Promise<void> {
  const { prisma } = fakePrisma();
  await expectReject(() => enqueueTaskRun(prisma, baseEnqueue({ idempotencyKey: " " })), "Blank key must fail.");
  await expectReject(() => enqueueTaskRun(prisma, baseEnqueue({ idempotencyKey: "x".repeat(201) })), "Oversized key must fail.");
  await expectReject(() => enqueueTaskRun(prisma, baseEnqueue({ maxAttempts: 0 })), "Invalid attempt budget must fail.");
  await expectReject(
    () => enqueueTaskRun(prisma, baseEnqueue({ input: { value: "😀".repeat(30_000) } })),
    "The JSON ceiling must use UTF-8 bytes, not JavaScript character count.",
  );
  await expectReject(
    () => claimNextTaskRun(prisma, { workerId: "worker\n1", types: ["SOURCE_FETCH"], leaseDurationMs: 30_000 }),
    "Control characters in worker identity must fail.",
  );
  await expectReject(
    () => claimNextTaskRun(prisma, { workerId: "worker-1", types: ["UNKNOWN" as never], leaseDurationMs: 30_000 }),
    "Unknown TaskRun types must fail closed.",
  );
}

async function verifyClaimContract(): Promise<void> {
  const claimed = taskRow({
    status: "RUNNING",
    attempt: 1,
    input: { mode: "manual" },
    leaseOwner: "worker-1",
    leaseToken: "token-with-enough-entropy-1234567890",
    leaseExpiresAt: new Date("2026-08-01T00:01:00.000Z"),
    heartbeatAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  const { prisma, calls } = fakePrisma({ queryRaw: () => [claimed] });
  const result = await claimNextTaskRun(prisma, {
    workerId: "worker-1",
    types: ["SOURCE_FETCH", "SOURCE_DISCOVERY"],
    leaseDurationMs: 30_000,
    now: new Date("2026-08-01T00:00:00.000Z"),
  });
  assert(result?.input !== null && result?.organizationId === "org-1", "Claim must return handler input and tenant scope.");
  const query = calls[0]?.value;
  const source = sqlSource(query);
  assert(source.includes("FOR UPDATE SKIP LOCKED"), "Claim must use SKIP LOCKED.");
  assert(!source.includes("worker-1") && !source.includes("SOURCE_FETCH"), "Claim values must remain parameterized.");
  const values = sqlValues(query);
  assert(values.includes("worker-1") && values.includes("SOURCE_FETCH"), "Claim parameters must carry exact owner/types.");
}

async function verifyLeaseFences(): Promise<void> {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const stale = fakePrisma({ updateMany: () => ({ count: 0 }) });
  assert(!(await renewTaskRunLease(stale.prisma, {
    taskRunId: "task-1", workerId: "worker-1", leaseToken: "stale", leaseDurationMs: 30_000, now,
  })), "Stale renew must affect zero rows.");
  assert(!(await completeClaimedTaskRun(stale.prisma, {
    taskRunId: "task-1", workerId: "worker-1", leaseToken: "stale", output: {}, now,
  })), "Stale complete must affect zero rows.");
  const where = record(record(stale.calls[0]?.value, "renew args").where, "renew where");
  assert(where.status === "RUNNING" && where.leaseToken === "stale", "Lease writes must include status/token fences.");
  assert(record(where.leaseExpiresAt, "expiry fence").gt === now, "Lease writes must reject expired ownership.");
}

async function verifyFailureTransitionContract(): Promise<void> {
  const now = new Date("2026-08-01T00:00:00.000Z");
  for (const status of ["PENDING", "FAILED"] as const) {
    const { prisma, calls } = fakePrisma({ queryRaw: () => [{ status }] });
    const result = await failClaimedTaskRun(prisma, {
      taskRunId: "task-1",
      workerId: "worker-1",
      leaseToken: "token-1",
      errorClass: "application_error",
      retryAt: now,
      now,
    });
    assert(result.settled && result.status === status, "Failure transition must report the DB-selected budget branch.");
    const source = sqlSource(calls[0]?.value);
    assert(source.includes('"attempt" < "maxAttempts"'), "Failure budget must be decided in the fenced SQL statement.");
    assert(source.includes("RETURNING"), "Failure transition must return the committed status.");
    assert(!source.includes("application_error"), "Error class must remain a bound parameter.");
    assert(sqlValues(calls[0]?.value).includes("application_error"), "Only the fixed error class may be persisted.");
  }
}

async function verifyYieldContract(): Promise<void> {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const { prisma, calls } = fakePrisma({ queryRaw: () => [{ id: "task-1" }] });
  assert(await yieldClaimedTaskRun(prisma, {
    taskRunId: "task-1",
    workerId: "worker-1",
    leaseToken: "token-1",
    scheduledAt: now,
    now,
  }), "A valid planned yield must commit.");
  const source = sqlSource(calls[0]?.value);
  assert(source.includes("GREATEST") && source.includes('"attempt" - 1'), "Planned yield must atomically restore failure budget.");
  assert(source.includes('"leaseExpiresAt" >'), "Planned yield must remain lease fenced.");
  // Yield must clear any stale errorClass left by a prior failed attempt so
  // a re-claimed run does not inherit an outdated error category.
  assert(/"errorMessage"\s*=\s*NULL/.test(source), "Planned yield must clear errorMessage to NULL.");
  // The clearing must be a literal SQL NULL, not an unsafe raw parameter.
  assert(!/"errorMessage"\s*=\s*\$\{/.test(source), "errorMessage clearing must be a literal NULL, never a bound parameter.");
}

async function verifyReaperContract(): Promise<void> {
  const now = new Date("2026-08-01T00:00:00.000Z");
  const { prisma, calls } = fakePrisma({
    queryRaw: () => [{ status: "PENDING" }, { status: "FAILED" }, { status: "PENDING" }],
  });
  const result = await recoverExpiredTaskRuns(prisma, {
    types: ["SOURCE_FETCH"],
    limit: 3,
    now,
  });
  assert(result.recovered === 2 && result.finalized === 1, "Reaper metrics must reflect committed branches.");
  const source = sqlSource(calls[0]?.value);
  assert(source.includes("FOR UPDATE SKIP LOCKED"), "Reaper must use bounded row locking.");
  assert(source.includes('"leaseExpiresAt" <=') && source.includes("RETURNING"), "Reaper must close the exact-expiry gap and return statuses.");
  assert(source.includes('NULL::timestamp(3)'), "Reaper timestamp CASE must be explicitly typed for PostgreSQL.");
}

/**
 * Classifier contract: structured error.code/name take priority; only the
 * fixed low-cardinality class is returned. URL path segments containing
 * `/config/` must NOT be mistaken for a configuration error. Non-Error
 * inputs (strings, null, plain objects without code) fall through to
 * application_error.
 */
async function verifyClassifierContract(): Promise<void> {
  // ── Structured error.code (highest priority) ──
  assert(classifyTaskRunError(Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" })) === "timeout", "ETIMEDOUT code must classify as timeout.");
  assert(classifyTaskRunError(Object.assign(new Error("aborted"), { code: "ABORT_ERR" })) === "timeout", "ABORT_ERR code must classify as timeout.");
  assert(classifyTaskRunError(Object.assign(new Error("refused"), { code: "ECONNREFUSED" })) === "upstream", "ECONNREFUSED code must classify as upstream.");
  assert(classifyTaskRunError(Object.assign(new Error("dns"), { code: "ENOTFOUND" })) === "upstream", "ENOTFOUND code must classify as upstream.");
  assert(classifyTaskRunError(Object.assign(new Error("dns retry"), { code: "EAI_AGAIN" })) === "upstream", "EAI_AGAIN code must classify as upstream.");
  assert(classifyTaskRunError(Object.assign(new Error("reset"), { code: "ECONNRESET" })) === "upstream", "ECONNRESET code must classify as upstream.");

  // Structured config errors via code/name (not raw message).
  assert(classifyTaskRunError(Object.assign(new Error("env"), { code: "ENCRYPTION_KEY" })) === "configuration", "ENCRYPTION_KEY code must classify as configuration.");
  assert(classifyTaskRunError(Object.assign(new Error("env"), { code: "DATABASE_URL" })) === "configuration", "DATABASE_URL code must classify as configuration.");
  assert(classifyTaskRunError({ name: "ConfigurationError" } as Error) === "configuration", "ConfigurationError name must classify as configuration.");

  // ── URL /config/ regression: must NOT be mistaken for configuration ──
  // An error whose message contains a URL path segment `/config/` but no
  // real configuration signal must fall through to application_error.
  assert(
    classifyTaskRunError(new Error("GET https://api.example.com/config/settings failed with 500")) === "application_error",
    "URL path containing /config/ must not be misclassified as configuration.",
  );

  // ── Message-based fallback (only when no structured code/name) ──
  assert(classifyTaskRunError(new Error("Operation timed out after 30000ms")) === "timeout", "Timeout message must classify as timeout.");
  assert(classifyTaskRunError(new Error("Missing env variable: DATABASE_URL")) === "configuration", "Missing env message must classify as configuration.");
  assert(classifyTaskRunError(new Error("Required but not set: API_KEY")) === "configuration", "Required-but-not-set message must classify as configuration.");
  assert(classifyTaskRunError(new Error("connection refused by host")) === "upstream", "Connection refused message must classify as upstream.");

  // ── Non-Error inputs ──
  assert(classifyTaskRunError("ETIMEDOUT") === "application_error", "Plain string input must not be treated as a structured error code.");
  assert(classifyTaskRunError(null) === "application_error", "null input must fall through to application_error.");
  assert(classifyTaskRunError(undefined) === "application_error", "undefined input must fall through to application_error.");
  assert(classifyTaskRunError(42) === "application_error", "Number input must fall through to application_error.");
  assert(classifyTaskRunError({ code: 500 }) === "application_error", "Non-string code property must fall through to application_error.");
  assert(classifyTaskRunError({ code: "UNKNOWN_CODE_XYZ" }) === "application_error", "Unknown structured code must fall through to application_error.");

  // ── Code priority over message: a timeout message with upstream code ──
  assert(
    classifyTaskRunError(Object.assign(new Error("Operation timed out"), { code: "ECONNREFUSED" })) === "upstream",
    "Structured error.code must take priority over the message-based heuristic.",
  );
}
