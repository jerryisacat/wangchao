import type { PrismaClient } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────

export type Plan = "FREE" | "PLUS" | "PRO";
export type PlatformNoteTargetType = "User" | "Organization";

export interface PlatformNoteRecord {
  id: string;
  targetType: string;
  targetId: string;
  authorId: string;
  content: string;
  createdAt: Date;
}

export interface CreatePlatformNoteInput {
  targetType: string;
  targetId: string;
  authorId: string;
  content: string;
}

export type PlatformOpsErrorCode =
  | "INVALID_INPUT"
  | "SUBSCRIPTION_NOT_FOUND"
  | "INVALID_PLAN";

export interface TempPlanOverrideView {
  organizationId: string;
  basePlan: Plan;
  tempPlanOverride: Plan | null;
  tempPlanExpiresAt: Date | null;
  tempPlanReason: string | null;
  effectivePlan: Plan;
  overrideActive: boolean;
}

// ─── Domain errors ────────────────────────────────────────────

export class PlatformOpsError extends Error {
  readonly code: PlatformOpsErrorCode;

  constructor(code: PlatformOpsErrorCode, message: string) {
    super(message);
    this.name = "PlatformOpsError";
    this.code = code;
  }
}

// ─── Repository functions (notes) ─────────────────────────────

/**
 * Create an append-only platform note (客服备注).
 *
 * Notes are immutable: there are no update or delete methods.
 * Validation: targetType, targetId, authorId, content must be non-empty.
 * The `now` parameter is injected for testability.
 */
export async function createPlatformNote(
  prisma: PrismaClient,
  input: CreatePlatformNoteInput,
  now: Date = new Date(),
): Promise<PlatformNoteRecord> {
  const targetType = input.targetType.trim();
  if (targetType.length === 0) {
    throw new PlatformOpsError("INVALID_INPUT", "createPlatformNote: targetType must not be empty.");
  }

  const targetId = input.targetId.trim();
  if (targetId.length === 0) {
    throw new PlatformOpsError("INVALID_INPUT", "createPlatformNote: targetId must not be empty.");
  }

  const authorId = input.authorId.trim();
  if (authorId.length === 0) {
    throw new PlatformOpsError("INVALID_INPUT", "createPlatformNote: authorId must not be empty.");
  }

  const content = input.content.trim();
  if (content.length === 0) {
    throw new PlatformOpsError("INVALID_INPUT", "createPlatformNote: content must not be empty.");
  }

  const result = await prisma.platformNote.create({
    data: {
      targetType,
      targetId,
      authorId,
      content,
      createdAt: now,
    },
  });

  return toNoteRecord(result);
}

/**
 * Get a single platform note by ID. Returns null if not found.
 */
export async function getPlatformNoteById(
  prisma: PrismaClient,
  id: string,
): Promise<PlatformNoteRecord | null> {
  const result = await prisma.platformNote.findUnique({
    where: { id },
  });
  return result ? toNoteRecord(result) : null;
}

/**
 * List platform notes for a target, ordered newest-first.
 *
 * @param limit Maximum number of entries to return (default 100).
 */
export async function listPlatformNotes(
  prisma: PrismaClient,
  targetType: string,
  targetId: string,
  limit: number = 100,
): Promise<PlatformNoteRecord[]> {
  const results = await prisma.platformNote.findMany({
    where: { targetType, targetId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return results.map(toNoteRecord);
}

// ─── Repository functions (temp plan override) ─────────────────

/**
 * Grant a temporary plan override to an organization's subscription.
 *
 * Sets tempPlanOverride, tempPlanExpiresAt, tempPlanReason.
 * The base `plan` field is NOT modified - when the override expires or is
 * revoked, the base plan takes effect again.
 *
 * Writes an AuditLog entry with before/after snapshots and reason.
 */
export async function grantTempPlanOverride(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    tempPlan: Plan;
    expiresAt: Date;
    reason: string;
    actorId: string;
    requestId?: string | null;
  },
  now: Date = new Date(),
): Promise<TempPlanOverrideView> {
  const orgId = input.organizationId.trim();
  if (orgId.length === 0) {
    throw new PlatformOpsError("INVALID_INPUT", "grantTempPlanOverride: organizationId must not be empty.");
  }

  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new PlatformOpsError("INVALID_INPUT", "grantTempPlanOverride: reason must not be empty.");
  }

  if (!isPlan(input.tempPlan)) {
    throw new PlatformOpsError("INVALID_PLAN", `grantTempPlanOverride: invalid plan value: ${input.tempPlan}.`);
  }

  // Read current subscription for before snapshot.
  const existing = await prisma.subscription.findUnique({
    where: { organizationId: orgId },
    select: {
      plan: true,
      tempPlanOverride: true,
      tempPlanExpiresAt: true,
      tempPlanReason: true,
    },
  });

  if (!existing) {
    throw new PlatformOpsError("SUBSCRIPTION_NOT_FOUND", `Subscription not found for organization: ${orgId}.`);
  }

  const before = {
    plan: existing.plan,
    tempPlanOverride: existing.tempPlanOverride,
    tempPlanExpiresAt: existing.tempPlanExpiresAt?.toISOString() ?? null,
    tempPlanReason: existing.tempPlanReason,
  };

  // Update the subscription with the temp override.
  const updated = await prisma.subscription.update({
    where: { organizationId: orgId },
    data: {
      tempPlanOverride: input.tempPlan,
      tempPlanExpiresAt: input.expiresAt,
      tempPlanReason: reason,
    },
  });

  const after = {
    plan: updated.plan,
    tempPlanOverride: updated.tempPlanOverride,
    tempPlanExpiresAt: updated.tempPlanExpiresAt?.toISOString() ?? null,
    tempPlanReason: updated.tempPlanReason,
  };

  // Write audit log.
  await prisma.auditLog.create({
    data: {
      actorType: "PLATFORM_ADMIN",
      actorId: input.actorId,
      action: "platform.subscription.temp_plan.grant",
      targetType: "Subscription",
      targetId: orgId,
      reason,
      before: before as never,
      after: after as never,
      requestId: input.requestId ?? null,
      createdAt: now,
    },
  });

  return toOverrideView(orgId, updated);
}

/**
 * Revoke (clear) a temporary plan override.
 *
 * Sets tempPlanOverride, tempPlanExpiresAt, tempPlanReason back to null.
 * The base `plan` immediately takes effect again.
 *
 * Writes an AuditLog entry with before/after snapshots and reason.
 */
export async function revokeTempPlanOverride(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    reason: string;
    actorId: string;
    requestId?: string | null;
  },
  now: Date = new Date(),
): Promise<TempPlanOverrideView> {
  const orgId = input.organizationId.trim();
  if (orgId.length === 0) {
    throw new PlatformOpsError("INVALID_INPUT", "revokeTempPlanOverride: organizationId must not be empty.");
  }

  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new PlatformOpsError("INVALID_INPUT", "revokeTempPlanOverride: reason must not be empty.");
  }

  const existing = await prisma.subscription.findUnique({
    where: { organizationId: orgId },
    select: {
      plan: true,
      tempPlanOverride: true,
      tempPlanExpiresAt: true,
      tempPlanReason: true,
    },
  });

  if (!existing) {
    throw new PlatformOpsError("SUBSCRIPTION_NOT_FOUND", `Subscription not found for organization: ${orgId}.`);
  }

  const before = {
    plan: existing.plan,
    tempPlanOverride: existing.tempPlanOverride,
    tempPlanExpiresAt: existing.tempPlanExpiresAt?.toISOString() ?? null,
    tempPlanReason: existing.tempPlanReason,
  };

  const updated = await prisma.subscription.update({
    where: { organizationId: orgId },
    data: {
      tempPlanOverride: null,
      tempPlanExpiresAt: null,
      tempPlanReason: null,
    },
  });

  const after = {
    plan: updated.plan,
    tempPlanOverride: updated.tempPlanOverride,
    tempPlanExpiresAt: updated.tempPlanExpiresAt?.toISOString() ?? null,
    tempPlanReason: updated.tempPlanReason,
  };

  await prisma.auditLog.create({
    data: {
      actorType: "PLATFORM_ADMIN",
      actorId: input.actorId,
      action: "platform.subscription.temp_plan.revoke",
      targetType: "Subscription",
      targetId: orgId,
      reason,
      before: before as never,
      after: after as never,
      requestId: input.requestId ?? null,
      createdAt: now,
    },
  });

  return toOverrideView(orgId, updated);
}

/**
 * Get the current temp plan override view for an organization.
 *
 * Returns null if no subscription exists.
 * The `effectivePlan` field resolves the temp override against the base plan,
 * considering expiry: if tempPlanExpiresAt has passed, the base plan is returned
 * and `overrideActive` is false.
 */
export async function getTempPlanOverrideView(
  prisma: PrismaClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<TempPlanOverrideView | null> {
  const sub = await prisma.subscription.findUnique({
    where: { organizationId },
    select: {
      plan: true,
      tempPlanOverride: true,
      tempPlanExpiresAt: true,
      tempPlanReason: true,
    },
  });

  if (!sub) return null;

  return resolveOverrideView(organizationId, sub, now);
}

// ─── Internal helpers ─────────────────────────────────────────

function isPlan(value: unknown): value is Plan {
  return value === "FREE" || value === "PLUS" || value === "PRO";
}

function resolveOverrideView(
  organizationId: string,
  sub: {
    plan: string;
    tempPlanOverride: string | null;
    tempPlanExpiresAt: Date | null;
    tempPlanReason: string | null;
  },
  now: Date,
): TempPlanOverrideView {
  const basePlan = sub.plan as Plan;
  const tempOverride = sub.tempPlanOverride as Plan | null;

  let overrideActive = false;
  let effectivePlan = basePlan;

  if (tempOverride !== null && sub.tempPlanExpiresAt !== null) {
    if (sub.tempPlanExpiresAt > now) {
      overrideActive = true;
      effectivePlan = tempOverride;
    }
    // If expired, override is stale - base plan applies.
  }

  return {
    organizationId,
    basePlan,
    tempPlanOverride: tempOverride,
    tempPlanExpiresAt: sub.tempPlanExpiresAt,
    tempPlanReason: sub.tempPlanReason,
    effectivePlan,
    overrideActive,
  };
}

function toOverrideView(
  organizationId: string,
  sub: {
    plan: string;
    tempPlanOverride: string | null;
    tempPlanExpiresAt: Date | null;
    tempPlanReason: string | null;
  },
): TempPlanOverrideView {
  // For write operations, we don't check expiry - the caller just set it.
  // The override is active if tempPlanOverride is non-null.
  const basePlan = sub.plan as Plan;
  const tempOverride = sub.tempPlanOverride as Plan | null;
  const overrideActive = tempOverride !== null;
  const effectivePlan = overrideActive ? tempOverride! : basePlan;

  return {
    organizationId,
    basePlan,
    tempPlanOverride: tempOverride,
    tempPlanExpiresAt: sub.tempPlanExpiresAt,
    tempPlanReason: sub.tempPlanReason,
    effectivePlan,
    overrideActive,
  };
}

function toNoteRecord(row: {
  id: string;
  targetType: string;
  targetId: string;
  authorId: string;
  content: string;
  createdAt: Date;
}): PlatformNoteRecord {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    authorId: row.authorId,
    content: row.content,
    createdAt: row.createdAt,
  };
}
