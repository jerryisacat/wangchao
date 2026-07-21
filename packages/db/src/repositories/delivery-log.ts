import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantScope } from "./types.js";

export const DELIVERY_MAX_ATTEMPTS = 3;
/** Exponential backoff base in ms; doubled per attempt. */
export const DELIVERY_BACKOFF_BASE_MS = 30_000;
/** Backoff cap in ms (1 hour) to avoid excessively long waits. */
export const DELIVERY_BACKOFF_CAP_MS = 60 * 60_000;
/** Treat a FAILED delivery as stale enough to retry after this age even without a precise nextAttemptAt. */
export const DELIVERY_STALE_FAILED_MS = 5 * 60_000;

export interface DeliveryLogRecord {
  id: string;
  briefingId: string;
  channel: "TELEGRAM";
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  attempt: number;
  errorMessage: string | null;
  errorCode: string | null;
  sentAt: Date | null;
  updatedAt: Date;
}

/**
 * Compute the backoff delay (ms) for a given attempt number.
 * attempt=1 (first failure) -> 30s, attempt=2 -> 60s, capped at 1h.
 */
export function computeDeliveryBackoffMs(attempt: number, now: Date = new Date()): number {
  const safe = Math.max(0, attempt - 1);
  return Math.min(DELIVERY_BACKOFF_CAP_MS, DELIVERY_BACKOFF_BASE_MS * 2 ** safe);
}

/**
 * Decide whether a FAILED DeliveryLog is retryable at `now`.
 * Retryable when: attempt has not hit the cap AND the backoff window since
 * the last failure (tracked via updatedAt) has elapsed.
 */
export function isFailedRetryable(
  log: { status: string; attempt: number; updatedAt: Date },
  now: Date,
  maxAttempts: number = DELIVERY_MAX_ATTEMPTS,
): boolean {
  if (log.status !== "FAILED") return false;
  if (log.attempt >= maxAttempts) return false;
  const backoff = computeDeliveryBackoffMs(log.attempt, now);
  const eligibleAt = new Date(log.updatedAt.getTime() + backoff);
  return eligibleAt <= now;
}

export async function findPendingDeliveryForBriefing(
  prisma: PrismaClient,
  briefingId: string,
  channel: "TELEGRAM",
): Promise<DeliveryLogRecord | null> {
  const log = await prisma.deliveryLog.findUnique({
    where: { briefingId_channel: { briefingId, channel } },
  });

  if (!log) {
    return null;
  }

  return toDeliveryLogRecord(log);
}

export async function createDeliveryLog(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    briefingId: string;
    channel: "TELEGRAM";
    status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
    recipientRef?: string | null;
    errorMessage?: string | null;
    errorCode?: string | null;
    metadata?: unknown;
  },
): Promise<DeliveryLogRecord> {
  const log = await prisma.deliveryLog.create({
    data: {
      organizationId: input.organizationId,
      briefingId: input.briefingId,
      channel: input.channel,
      status: input.status,
      attempt: input.status === "PENDING" ? 0 : 1,
      recipientRef: input.recipientRef ?? null,
      errorMessage: input.errorMessage ?? null,
      errorCode: input.errorCode ?? null,
      sentAt: input.status === "SENT" ? new Date() : null,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });

  return toDeliveryLogRecord(log);
}

/**
 * Atomically claim a DeliveryLog for delivery: create if absent, or transition
 * a PENDING / retryable-FAILED record into a state ready for the next attempt.
 *
 * Returns null (and leaves the log untouched) when the record is SENT/SKIPPED,
 * has exhausted `maxAttempts`, or is a FAILED record still inside its backoff
 * window. This is the DeliveryLog equivalent of instant-push claimInstantPush,
 * adapted to the constrained DeliveryStatus enum (no SENDING state) by relying
 * on `updatedAt` as the implicit "last attempt" timestamp for backoff.
 *
 * On a successful claim the attempt counter is incremented; the caller is
 * expected to either markDeliverySent or markDeliveryFailed afterwards.
 */
export async function claimDeliveryLog(
  prisma: PrismaClient,
  input: {
    briefingId: string;
    organizationId: string;
    channel: "TELEGRAM";
    recipientRef: string;
    maxAttempts?: number;
    now?: Date;
  },
): Promise<DeliveryLogRecord | null> {
  const now = input.now ?? new Date();
  const maxAttempts = input.maxAttempts ?? DELIVERY_MAX_ATTEMPTS;
  const existing = await prisma.deliveryLog.findUnique({
    where: { briefingId_channel: { briefingId: input.briefingId, channel: input.channel } },
  });

  if (!existing) {
    try {
      const created = await prisma.deliveryLog.create({
        data: {
          organizationId: input.organizationId,
          briefingId: input.briefingId,
          channel: input.channel,
          status: "PENDING",
          // attempt = 1 on the first claim; markDeliveryFailed / markDeliverySent
          // use this as the "attempt number" for the in-flight delivery.
          attempt: 1,
          recipientRef: input.recipientRef,
        },
      });
      return toDeliveryLogRecord(created);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // A concurrent worker created the record; the caller will pick it up
        // on the next cycle rather than double-delivering.
        return null;
      }
      throw error;
    }
  }

  if (existing.status === "SENT" || existing.status === "SKIPPED") return null;
  if (existing.attempt >= maxAttempts) return null;

  const retryable =
    existing.status === "PENDING" || isFailedRetryable(existing, now, maxAttempts);
  if (!retryable) return null;

  const updated = await prisma.deliveryLog.updateMany({
    where: { id: existing.id, status: existing.status, attempt: existing.attempt },
    data: {
      attempt: { increment: 1 },
      errorMessage: null,
      errorCode: null,
      status: "PENDING",
    },
  });
  if (updated.count !== 1) {
    // State changed concurrently; skip this cycle.
    return null;
  }
  const refreshed = await prisma.deliveryLog.findUnique({ where: { id: existing.id } });
  return refreshed ? toDeliveryLogRecord(refreshed) : null;
}

export async function markDeliverySent(
  prisma: PrismaClient,
  deliveryLogId: string,
  input?: { metadata?: unknown },
): Promise<void> {
  await prisma.deliveryLog.update({
    where: { id: deliveryLogId },
    data: {
      status: "SENT",
      sentAt: new Date(),
      errorMessage: null,
      errorCode: null,
      ...(input?.metadata !== undefined ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
    },
  });
}

export async function markDeliveryFailed(
  prisma: PrismaClient,
  deliveryLogId: string,
  input: {
    attempt: number;
    errorMessage: string;
    errorCode?: string | null;
    maxAttempts?: number;
  },
): Promise<{ finalized: boolean; retryable: boolean }> {
  const maxAttempts = input.maxAttempts ?? DELIVERY_MAX_ATTEMPTS;
  const retryable = input.attempt < maxAttempts;
  await prisma.deliveryLog.update({
    where: { id: deliveryLogId },
    data: {
      // Reuse SKIPPED as the terminal "give up" state so the row is never
      // re-claimed by claimDeliveryLog. The original errorCode/message are
      // preserved for diagnostics; updatedAt advances implicitly.
      status: retryable ? "FAILED" : "SKIPPED",
      errorMessage: input.errorMessage.slice(0, 1000),
      errorCode: input.errorCode ?? null,
    },
  });
  return { finalized: !retryable, retryable };
}

/**
 * @deprecated Use markDeliverySent. Kept temporarily for callers not yet migrated.
 */
export async function updateDeliveryLog(
  prisma: PrismaClient,
  deliveryLogId: string,
  input: {
    status: "SENT" | "FAILED" | "SKIPPED";
    attempt?: number;
    errorMessage?: string | null;
    errorCode?: string | null;
    metadata?: unknown;
  },
): Promise<void> {
  await prisma.deliveryLog.update({
    where: { id: deliveryLogId },
    data: {
      status: input.status,
      attempt: input.attempt,
      errorMessage: input.errorMessage,
      errorCode: input.errorCode,
      sentAt: input.status === "SENT" ? new Date() : undefined,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

/**
 * List briefings eligible for Telegram delivery within the tenant scope.
 *
 * A briefing is eligible when it has NO terminal delivery record — i.e. it
 * has never been attempted, or the existing record is PENDING / FAILED (and
 * therefore still retryable, subject to backoff which claimDeliveryLog enforces).
 * Briefings with a SENT or SKIPPED record are excluded so we do not re-scan
 * finalized deliveries every cycle.
 *
 * This is the fix for the permanent-drop bug: the previous query used
 * `deliveryLogs: { none: { channel: "TELEGRAM" } }`, which excluded any
 * briefing that had ANY delivery log — including FAILED ones — so the first
 * failure permanently removed the briefing from the retry pool.
 */
export async function findBriefingsForTelegramDelivery(
  prisma: PrismaClient,
  scope: TenantScope,
  since: Date,
): Promise<
  Array<{
    briefingId: string;
    briefingTitle: string;
    markdown: string | null;
    topicName: string;
    period: string;
  }>
> {
  const briefings = await prisma.briefing.findMany({
    where: {
      organizationId: scope.organizationId,
      generatedAt: { gte: since },
      // Exclude briefings that already have a terminal (SENT/SKIPPED) delivery
      // for this channel. Briefings with no log, a PENDING log, or a FAILED log
      // (still retryable) remain eligible - claimDeliveryLog enforces backoff.
      deliveryLogs: {
        none: { channel: "TELEGRAM", status: { in: ["SENT", "SKIPPED"] } },
      },
    },
    select: {
      id: true,
      title: true,
      markdown: true,
      period: true,
      topic: { select: { name: true } },
    },
    orderBy: { generatedAt: "asc" },
    take: 50,
  });

  return briefings.map((b) => ({
    briefingId: b.id,
    briefingTitle: b.title,
    markdown: b.markdown,
    topicName: b.topic.name,
    period: b.period,
  }));
}

function toDeliveryLogRecord(row: {
  id: string;
  briefingId: string;
  channel: "TELEGRAM";
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  attempt: number;
  errorMessage: string | null;
  errorCode: string | null;
  sentAt: Date | null;
  updatedAt: Date;
}): DeliveryLogRecord {
  return {
    id: row.id,
    briefingId: row.briefingId,
    channel: row.channel,
    status: row.status,
    attempt: row.attempt,
    errorMessage: row.errorMessage,
    errorCode: row.errorCode,
    sentAt: row.sentAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
