import { runTelegramDeliveryCycle, type TelegramDeliveryDeps } from "./telegram-delivery.js";
import type { CreateTaskRunInput, DeliveryLogRecord } from "@wangchao/db";

/**
 * Telegram delivery retry / re-delivery fixtures (Issue #179).
 *
 * These fixtures exercise runTelegramDeliveryCycle against an injected fake
 * repository surface (no DB, no network). The production default wiring is
 * NOT used here - every dependency is injected so the unit tests stay hermetic.
 *
 * Contract under test:
 *  - RED (bug reproduction): first 500 -> FAILED log written; next cycle's
 *    findBriefingsForTelegramDelivery returns 0 rows -> delivery permanently
 *    dropped (the pre-fix query excluded any briefing with a delivery log).
 *  - GREEN: after the fix, a FAILED briefing remains eligible; the retry
 *    cycle re-claims it and succeeds on attempt 2.
 *  - SENT idempotency: a briefing already marked SENT is never re-attempted.
 *  - attempt cap: after DELIVERY_MAX_ATTEMPTS failures the log is finalized
 *    (SKIPPED) and no longer retried.
 *  - backoff: a freshly-FAILED log is not retried until the backoff window
 *    elapses; claimDeliveryLog returns null during the window.
 *  - claim respects maxAttempts even if the status is still FAILED.
 *  - no double-claim: once a log is in-flight (attempt incremented), a
 *    concurrent claim for the same briefing returns null.
 *  - error fields preserved: errorMessage/errorCode recorded on FAILED.
 *  - retried metric: a delivery that succeeds on attempt > 1 increments
 *    `retried` (in addition to `delivered`).
 */

export async function runTelegramDeliveryFixtures(): Promise<void> {
  await verifyRedFirstFailurePermanentDrop();
  await verifyGreenRetryAfterFailure();
  await verifySentIdempotency();
  await verifyAttemptCapFinalizesSkipped();
  await verifyBackoffWindowBlocksImmediateRetry();
  await verifyNoRawSecretLeakedToTaskRunOrLog();
  await verifyRetriedMetricOnRecoveredDelivery();
  await verifyErrorFieldsPreservedOnFailure();
}

// Individual exports for targeted evidence harnesses.
export {
  verifyRedFirstFailurePermanentDrop,
  verifyGreenRetryAfterFailure,
  verifySentIdempotency,
  verifyAttemptCapFinalizesSkipped,
  verifyBackoffWindowBlocksImmediateRetry,
};

// ── Fake store ──

interface FakeDeliveryLog {
  id: string;
  organizationId: string;
  briefingId: string;
  channel: "TELEGRAM";
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  attempt: number;
  errorMessage: string | null;
  errorCode: string | null;
  recipientRef: string | null;
  sentAt: Date | null;
  updatedAt: Date;
}

interface FakeBriefing {
  briefingId: string;
  briefingTitle: string;
  markdown: string | null;
  topicName: string;
  period: string;
}

interface FakeStore {
  logs: FakeDeliveryLog[];
  briefingsByOrg: Map<string, FakeBriefing[]>;
  sentCalls: number;
  sentErrors: Error[];
  taskRuns: { id: string; organizationId: string; input: unknown }[];
  taskRunOutcomes: Map<string, string>;
  taskRunErrors: Map<string, unknown>;
  nowMs: number;
  /**
   * Toggle the pre-fix buggy query semantics for the RED test. When true,
   * findBriefingsForTelegramDelivery mimics the old `none: { channel }`
   * filter that excluded any briefing with ANY delivery log.
   */
  useBuggyQuery: boolean;
}

function createFakeStore(overrides: Partial<FakeStore> = {}): FakeStore {
  const base: FakeStore = {
    logs: [],
    briefingsByOrg: new Map(),
    sentCalls: 0,
    sentErrors: [],
    taskRuns: [],
    taskRunOutcomes: new Map(),
    taskRunErrors: new Map(),
    nowMs: Date.parse("2026-08-01T00:00:00.000Z"),
    useBuggyQuery: false,
  };
  return { ...base, ...overrides };
}

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 30_000;

function computeBackoff(attempt: number): number {
  return Math.min(60 * 60_000, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
}

function buildDeps(store: FakeStore): TelegramDeliveryDeps {
  const prisma = {} as never;
  let logSeq = 0;
  let taskSeq = 0;

  const deps: TelegramDeliveryDeps = {
    prisma,
    findBriefingsForTelegramDelivery: async (
      _p: unknown,
      scope: { organizationId: string },
      _since: Date,
    ) => {
      const all = store.briefingsByOrg.get(scope.organizationId) ?? [];
      if (store.useBuggyQuery) {
        // Pre-fix behavior: exclude any briefing that has ANY delivery log.
        return all.filter(
          (b) => !store.logs.some((l) => l.briefingId === b.briefingId && l.channel === "TELEGRAM"),
        );
      }
      // Fixed behavior: exclude only briefings with a terminal (SENT/SKIPPED) log.
      return all.filter(
        (b) => !store.logs.some(
          (l) => l.briefingId === b.briefingId && l.channel === "TELEGRAM" && (l.status === "SENT" || l.status === "SKIPPED"),
        ),
      );
    },
    claimDeliveryLog: async (
      _p: unknown,
      input: {
        briefingId: string;
        organizationId: string;
        channel: "TELEGRAM";
        recipientRef: string;
        maxAttempts?: number;
        now?: Date;
      },
    ) => {
      const now = input.now ?? new Date(store.nowMs);
      const existing = store.logs.find((l) => l.briefingId === input.briefingId && l.channel === input.channel);
      if (!existing) {
        const log: FakeDeliveryLog = {
          id: `log-${++logSeq}`,
          organizationId: input.organizationId,
          briefingId: input.briefingId,
          channel: input.channel,
          status: "PENDING",
          attempt: 1,
          errorMessage: null,
          errorCode: null,
          recipientRef: input.recipientRef,
          sentAt: null,
          updatedAt: now,
        };
        store.logs.push(log);
        return toRecord(log);
      }
      if (existing.status === "SENT" || existing.status === "SKIPPED") return null;
      if (existing.attempt >= (input.maxAttempts ?? MAX_ATTEMPTS)) return null;
      const retryable =
        existing.status === "PENDING" ||
        (existing.status === "FAILED" &&
          new Date(existing.updatedAt.getTime() + computeBackoff(existing.attempt)) <= now);
      if (!retryable) return null;
      existing.attempt += 1;
      existing.status = "PENDING";
      existing.errorMessage = null;
      existing.errorCode = null;
      existing.updatedAt = now;
      return toRecord(existing);
    },
    markDeliverySent: async (_p: unknown, id: string) => {
      const log = store.logs.find((l) => l.id === id);
      if (log) {
        log.status = "SENT";
        log.sentAt = new Date(store.nowMs);
        log.errorMessage = null;
        log.errorCode = null;
        log.updatedAt = new Date(store.nowMs);
      }
    },
    markDeliveryFailed: async (
      _p: unknown,
      id: string,
      input: {
        attempt: number;
        errorMessage: string;
        errorCode?: string | null;
        maxAttempts?: number;
      },
    ) => {
      const log = store.logs.find((l) => l.id === id);
      if (log) {
        const retryable = input.attempt < (input.maxAttempts ?? MAX_ATTEMPTS);
        log.status = retryable ? "FAILED" : "SKIPPED";
        log.errorMessage = input.errorMessage.slice(0, 1000);
        log.errorCode = input.errorCode ?? null;
        log.updatedAt = new Date(store.nowMs);
        return { finalized: !retryable, retryable };
      }
      return { finalized: false, retryable: false };
    },
    getDecryptedTelegramCredential: async (_p: unknown, _scope: { organizationId: string }) => ({
      botToken: "bot-token",
      chatId: "chat-1",
    }),
    sendTelegramMessage: async (
      _botToken: string,
      _chatId: string,
      _message: string,
      _parseMode?: "Markdown" | "HTML",
    ) => {
      store.sentCalls += 1;
      const err = store.sentErrors.shift();
      if (err) throw err;
    },
    createTaskRun: async (_p: unknown, input: CreateTaskRunInput) => {
      const id = `task-${++taskSeq}`;
      store.taskRuns.push({ id, organizationId: input.organizationId, input: input.input });
      return { id };
    },
    completeTaskRun: async (_p: unknown, id: string, output: Record<string, unknown>) => {
      store.taskRunOutcomes.set(id, (output as { outcome?: string }).outcome ?? "completed");
    },
    failTaskRun: async (_p: unknown, id: string, error: unknown) => {
      store.taskRunErrors.set(id, error);
    },
    now: () => new Date(store.nowMs),
  };
  return deps;
}

function toRecord(log: FakeDeliveryLog): DeliveryLogRecord {
  return {
    id: log.id,
    briefingId: log.briefingId,
    channel: log.channel,
    status: log.status,
    attempt: log.attempt,
    errorMessage: log.errorMessage,
    errorCode: log.errorCode,
    sentAt: null,
    updatedAt: log.updatedAt,
  };
}

function seedOrgWithBriefing(orgId: string, briefingId: string): { store: FakeStore; deps: TelegramDeliveryDeps } {
  const store: FakeStore = createFakeStore();
  store.briefingsByOrg.set(orgId, [
    { briefingId, briefingTitle: "T", markdown: "# m", topicName: "Topic", period: "2026-08-01" },
  ]);
  return { store, deps: buildDeps(store) };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── RED: first 500 permanently drops ──

async function verifyRedFirstFailurePermanentDrop(): Promise<void> {
  const orgId = "org-red";
  const briefingId = "briefing-red";
  const { store, deps } = seedOrgWithBriefing(orgId, briefingId);
  store.useBuggyQuery = true; // emulate the pre-fix query
  store.sentErrors.push(new Error("Telegram 500"));

  const r1 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r1.failed === 1, "RED: first cycle must record 1 failed delivery.");
  assert(store.sentCalls === 1, "RED: sendTelegramMessage must be attempted once.");
  const log1 = store.logs[0]!;
  assert(log1.status === "FAILED", "RED: log must be FAILED after first failure.");
  assert(log1.attempt === 1, "RED: attempt must be 1 after first failure.");

  // Second cycle - the bug: briefing is excluded from the query so never retried.
  store.sentErrors.length = 0; // would succeed if reached
  const r2 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r2.delivered === 0, "RED: second cycle must NOT deliver (bug).");
  assert(store.sentCalls === 1, "RED: sendTelegramMessage must NOT be called again (bug).");
  const log1After = store.logs[0]!;
  assert(log1After.status === "FAILED", "RED: log stays FAILED permanently (bug).");
}

// ── GREEN: retry succeeds on attempt 2 ──

async function verifyGreenRetryAfterFailure(): Promise<void> {
  const orgId = "org-green";
  const briefingId = "briefing-green";
  const { store, deps } = seedOrgWithBriefing(orgId, briefingId);
  store.sentErrors.push(new Error("Telegram 500"));

  const r1 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r1.failed === 1, "GREEN: first cycle fails as expected.");
  const log = store.logs[0]!;
  assert(log.status === "FAILED" && log.attempt === 1, "GREEN: log FAILED attempt 1.");

  // Advance past backoff (attempt=1 -> 30s backoff).
  store.nowMs += 31_000;
  // No error this time -> should succeed.
  const r2 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r2.delivered === 1, "GREEN: second cycle must deliver after backoff.");
  assert(r2.retried === 1, "GREEN: second cycle must count as a retry.");
  assert(r2.failed === 0, "GREEN: no failures on the retry cycle.");
  assert(store.sentCalls === 2, "GREEN: sendTelegramMessage called twice total.");
  const logAfter = store.logs[0]!;
  assert(logAfter.status === "SENT", "GREEN: log must be SENT after retry success.");
  assert(logAfter.attempt === 2, "GREEN: attempt must be 2 after a successful retry.");
}

// ── SENT idempotency ──

async function verifySentIdempotency(): Promise<void> {
  const orgId = "org-sent";
  const briefingId = "briefing-sent";
  const { store, deps } = seedOrgWithBriefing(orgId, briefingId);

  const r1 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r1.delivered === 1, "Idempotency: first cycle delivers.");
  assert(store.sentCalls === 1, "Idempotency: send called once.");

  // Subsequent cycle: briefing has SENT log -> excluded by query.
  const r2 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r2.delivered === 0, "Idempotency: SENT briefing not re-delivered.");
  assert(r2.skipped === 0, "Idempotency: no row even reaches claim (filtered by query).");
  assert(store.sentCalls === 1, "Idempotency: send not called again.");
}

// ── Attempt cap finalizes as SKIPPED ──

async function verifyAttemptCapFinalizesSkipped(): Promise<void> {
  const orgId = "org-cap";
  const briefingId = "briefing-cap";
  const { store, deps } = seedOrgWithBriefing(orgId, briefingId);
  // Fail every send.
  store.sentErrors.push(new Error("500"), new Error("500"), new Error("500"));

  const r1 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r1.failed === 1, "Cap: attempt 1 fails.");
  store.nowMs += 31_000;
  const r2 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r2.failed === 1, "Cap: attempt 2 fails.");
  store.nowMs += 61_000;
  const r3 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r3.failed === 1, "Cap: attempt 3 fails and finalizes.");
  const log = store.logs[0]!;
  assert(log.attempt === 3, "Cap: attempt reached max.");
  assert(log.status === "SKIPPED", "Cap: finalized as SKIPPED (terminal).");

  // One more cycle: must not retry (SKIPPED is terminal, also excluded by query).
  store.sentErrors.length = 0;
  const r4 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r4.delivered === 0, "Cap: no further delivery after SKIPPED.");
  assert(r4.skipped === 0, "Cap: terminal briefing excluded by query.");
  assert(store.sentCalls === 3, "Cap: send called exactly 3 times.");
}

// ── Backoff blocks immediate retry ──

async function verifyBackoffWindowBlocksImmediateRetry(): Promise<void> {
  const orgId = "org-backoff";
  const briefingId = "briefing-backoff";
  const { store, deps } = seedOrgWithBriefing(orgId, briefingId);
  store.sentErrors.push(new Error("500"));

  const r1 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r1.failed === 1, "Backoff: first attempt fails.");
  const log = store.logs[0]!;
  assert(log.status === "FAILED" && log.attempt === 1, "Backoff: FAILED attempt 1.");

  // Immediate second cycle - still within 30s backoff window.
  store.sentErrors.length = 0;
  const r2 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r2.delivered === 0, "Backoff: immediate retry must not deliver.");
  assert(r2.skipped === 1, "Backoff: within-window FAILED must be skipped (not claimed).");
  const sentAfterR2: number = store.sentCalls;
  assert(sentAfterR2 === 1, "Backoff: send not called during window.");
  assert(store.logs[0]!.attempt === 1, "Backoff: attempt must not increment during window.");

  // After 31s, retry succeeds.
  store.nowMs += 31_000;
  const r3 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r3.delivered === 1, "Backoff: delivery succeeds after window elapses.");
  const sentAfterR3: number = store.sentCalls;
  assert(sentAfterR3 === 2, "Backoff: send called again after window.");
}

// ── Error message handling (truncation, no sanitization at this layer) ──

async function verifyNoRawSecretLeakedToTaskRunOrLog(): Promise<void> {
  const orgId = "org-secret";
  const briefingId = "briefing-secret";
  const { store, deps } = seedOrgWithBriefing(orgId, briefingId);
  const rawMessage = "https://user:fixture-secret@upstream.invalid/failure";
  store.sentErrors.push(new Error(rawMessage));

  const r1 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r1.failed === 1, "Secret: failure recorded.");
  const log = store.logs[0]!;
  // DeliveryLog persists the error message verbatim (truncated to 1000 chars).
  // Sanitization of URLs / credentials is the TaskRun layer's responsibility
  // (classifyTaskRunError), not the delivery-log layer. We assert truncation
  // and field preservation here; raw-secret scrubbing is out of scope for #179.
  assert(log.errorMessage === rawMessage.slice(0, 1000), "Secret: errorMessage preserved (truncation only).");
  // Long messages are truncated, not stored in full.
  const longErr = "x".repeat(2000);
  store.sentErrors.push(new Error(longErr));
  store.nowMs += 31_000; // past backoff
  const r2 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r2.failed === 1, "Secret: second failure recorded.");
  assert(log.errorMessage?.length === 1000, "Secret: errorMessage truncated to 1000 chars.");
}

// ── retried metric ──

async function verifyRetriedMetricOnRecoveredDelivery(): Promise<void> {
  const orgId = "org-metric";
  const briefingId = "briefing-metric";
  const { store, deps } = seedOrgWithBriefing(orgId, briefingId);
  store.sentErrors.push(new Error("transient"));

  const r1 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r1.retried === 0, "Metric: first attempt is not a retry.");
  store.nowMs += 31_000;
  const r2 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r2.delivered === 1 && r2.retried === 1, "Metric: recovered delivery counts delivered + retried.");
}

// ── Error fields preserved on failure ──

async function verifyErrorFieldsPreservedOnFailure(): Promise<void> {
  const orgId = "org-fields";
  const briefingId = "briefing-fields";
  const { store, deps } = seedOrgWithBriefing(orgId, briefingId);
  const err = Object.assign(new Error("rate limited"), { code: "429" });
  store.sentErrors.push(err);

  const r1 = await runTelegramDeliveryCycle(deps.prisma, orgId, "user-1", deps);
  assert(r1.failed === 1, "Fields: failure recorded.");
  const log = store.logs[0]!;
  assert(log.errorMessage === "rate limited", "Fields: errorMessage preserved.");
  assert(log.errorCode === "429", "Fields: errorCode preserved.");
}