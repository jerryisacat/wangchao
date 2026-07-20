import type { PrismaClient } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────

export type AuditActorType = "PLATFORM_ADMIN" | "SYSTEM" | "USER";

export interface CreateAuditLogInput {
  actorType: AuditActorType;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

export interface AuditLogRecord {
  id: string;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: Date;
}

// ─── Repository functions ─────────────────────────────────────

/**
 * Create an immutable audit log entry.
 *
 * This is the ONLY write method on the AuditLog repository.
 * There are no update or delete methods — the audit log is append-only.
 *
 * Validation:
 *   - action, actorId, targetId must be non-empty.
 *   - reason, before, after, requestId are optional (nullable).
 *
 * The `now` parameter is injected for testability.
 */
export async function createAuditLog(
  prisma: PrismaClient,
  input: CreateAuditLogInput,
  now: Date = new Date(),
): Promise<AuditLogRecord> {
  const action = input.action.trim();
  if (action.length === 0) {
    throw new Error("createAuditLog: action must not be empty.");
  }

  const actorId = input.actorId.trim();
  if (actorId.length === 0) {
    throw new Error("createAuditLog: actorId must not be empty.");
  }

  const targetId = input.targetId.trim();
  if (targetId.length === 0) {
    throw new Error("createAuditLog: targetId must not be empty.");
  }

  const result = await prisma.auditLog.create({
    data: {
      actorType: input.actorType,
      actorId,
      action,
      targetType: input.targetType,
      targetId,
      reason: input.reason ?? null,
      before: (input.before ?? null) as never,
      after: (input.after ?? null) as never,
      requestId: input.requestId ?? null,
      createdAt: now,
    },
  });

  return toRecord(result);
}

/**
 * Get a single audit log entry by ID. Returns null if not found.
 */
export async function getAuditLogById(
  prisma: PrismaClient,
  id: string,
): Promise<AuditLogRecord | null> {
  const result = await prisma.auditLog.findUnique({
    where: { id },
  });
  return result ? toRecord(result) : null;
}

/**
 * List audit log entries by actor, ordered newest-first.
 *
 * @param limit Maximum number of entries to return (default 100).
 */
export async function listAuditLogsByActor(
  prisma: PrismaClient,
  actorType: AuditActorType,
  actorId: string,
  limit: number = 100,
): Promise<AuditLogRecord[]> {
  const results = await prisma.auditLog.findMany({
    where: { actorType, actorId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return results.map(toRecord);
}

/**
 * List audit log entries by target, ordered newest-first.
 *
 * @param limit Maximum number of entries to return (default 100).
 */
export async function listAuditLogsByTarget(
  prisma: PrismaClient,
  targetType: string,
  targetId: string,
  limit: number = 100,
): Promise<AuditLogRecord[]> {
  const results = await prisma.auditLog.findMany({
    where: { targetType, targetId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return results.map(toRecord);
}

/**
 * List audit log entries by action, ordered newest-first.
 *
 * @param limit Maximum number of entries to return (default 100).
 */
export async function listAuditLogsByAction(
  prisma: PrismaClient,
  action: string,
  limit: number = 100,
): Promise<AuditLogRecord[]> {
  const results = await prisma.auditLog.findMany({
    where: { action },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return results.map(toRecord);
}

// ─── Internal helpers ─────────────────────────────────────────

function toRecord(row: {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: Date;
}): AuditLogRecord {
  return {
    id: row.id,
    actorType: row.actorType as AuditActorType,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    before: row.before,
    after: row.after,
    requestId: row.requestId,
    createdAt: row.createdAt,
  };
}