import type { PrismaClient, User } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────

export type UserAccountStatus = "ACTIVE" | "SUSPENDED" | "DELETION_PENDING" | "DELETED";

export type UserLifecycleErrorCode =
  | "USER_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INVALID_REASON";

export interface UserLifecycleStatus {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  accountStatus: UserAccountStatus;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  suspendEndsAt: Date | null;
  deletionRequestedAt: Date | null;
  deletedAt: Date | null;
  lastLoginAt: Date | null;
  lastActivityAt: Date | null;
}

export interface SuspendUserInput {
  userId: string;
  reason: string;
  suspendEndsAt?: Date | null;
}

// ─── Domain errors ────────────────────────────────────────────

/**
 * Thrown when a user lifecycle transition is rejected.
 *
 * Uses stable `code` values that do NOT leak Prisma internals.
 * Callers should branch on `code`, not on `message`.
 */
export class UserLifecycleTransitionError extends Error {
  readonly code: UserLifecycleErrorCode;
  readonly userId: string;

  constructor(code: UserLifecycleErrorCode, userId: string, message: string) {
    super(message);
    this.name = "UserLifecycleTransitionError";
    this.code = code;
    this.userId = userId;
  }
}

// ─── Repository functions ──────────────────────────────────────

export async function getUserLifecycleStatus(
  prisma: PrismaClient,
  userId: string,
): Promise<UserLifecycleStatus | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
      image: true,
      accountStatus: true,
      suspendedAt: true,
      suspendedReason: true,
      suspendEndsAt: true,
      deletionRequestedAt: true,
      deletedAt: true,
      lastLoginAt: true,
      lastActivityAt: true,
    },
  });

  if (!user) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    image: user.image,
    accountStatus: user.accountStatus as UserAccountStatus,
    suspendedAt: user.suspendedAt,
    suspendedReason: user.suspendedReason,
    suspendEndsAt: user.suspendEndsAt,
    deletionRequestedAt: user.deletionRequestedAt,
    deletedAt: user.deletedAt,
    lastLoginAt: user.lastLoginAt,
    lastActivityAt: user.lastActivityAt,
  };
}

// ─── Internal helpers ─────────────────────────────────────────

/**
 * After an updateMany returns count=0, perform a minimal findUnique to
 * distinguish USER_NOT_FOUND from INVALID_TRANSITION.
 *
 * This is NOT used as an authorization gate (no read-before-write race);
 * the atomic updateMany predicate is the guard. This lookup only disambiguates
 * the failure reason for a better error.
 */
async function resolveZeroCountError(
  prisma: PrismaClient,
  userId: string,
  allowedStatuses: readonly UserAccountStatus[],
): Promise<never> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountStatus: true },
  });

  if (!user) {
    throw new UserLifecycleTransitionError(
      "USER_NOT_FOUND",
      userId,
      `User not found: ${userId}`,
    );
  }

  const currentStatus = user.accountStatus as UserAccountStatus;
  throw new UserLifecycleTransitionError(
    "INVALID_TRANSITION",
    userId,
    `Cannot transition from ${currentStatus} (allowed: ${allowedStatuses.join(" | ")})`,
  );
}

// ─── suspendUser ──────────────────────────────────────────────

/**
 * Suspend an ACTIVE user.
 *
 * Atomic: uses updateMany with { id, accountStatus: "ACTIVE" } predicate.
 * If count=0, the user is either missing or not ACTIVE.
 *
 * Validation: reason is trimmed; empty/whitespace-only reason is rejected
 * with INVALID_REASON before any DB call.
 *
 * Suspension metadata: sets suspendedAt, suspendedReason, suspendEndsAt.
 */
export async function suspendUser(
  prisma: PrismaClient,
  input: SuspendUserInput,
  now: Date = new Date(),
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new UserLifecycleTransitionError(
      "INVALID_REASON",
      input.userId,
      "Suspension reason must not be empty.",
    );
  }

  const allowed: readonly UserAccountStatus[] = ["ACTIVE"];
  const result = await prisma.user.updateMany({
    where: { id: input.userId, accountStatus: "ACTIVE" },
    data: {
      accountStatus: "SUSPENDED",
      suspendedAt: now,
      suspendedReason: reason,
      suspendEndsAt: input.suspendEndsAt ?? null,
    },
  });

  if (result.count === 0) {
    await resolveZeroCountError(prisma, input.userId, allowed);
  }
}

// ─── reactivateUser ───────────────────────────────────────────

/**
 * Reactivate a SUSPENDED user.
 *
 * Atomic: uses updateMany with { id, accountStatus: "SUSPENDED" } predicate.
 * Clears all suspension metadata.
 */
export async function reactivateUser(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  const allowed: readonly UserAccountStatus[] = ["SUSPENDED"];
  const result = await prisma.user.updateMany({
    where: { id: userId, accountStatus: "SUSPENDED" },
    data: {
      accountStatus: "ACTIVE",
      suspendedAt: null,
      suspendedReason: null,
      suspendEndsAt: null,
    },
  });

  if (result.count === 0) {
    await resolveZeroCountError(prisma, userId, allowed);
  }
}

// ─── requestUserDeletion ───────────────────────────────────────

/**
 * Request deletion of an ACTIVE or SUSPENDED user.
 *
 * Atomic: uses updateMany with { id, accountStatus: { in: [ACTIVE, SUSPENDED] } } predicate.
 *
 * Suspension metadata is cleared: once deletion is requested, the prior
 * suspension reason/end is no longer relevant. This keeps the transition
 * table consistent: DELETION_PENDING rows never carry stale suspension fields,
 * and markUserDeleted does not need to distinguish "was suspended" vs "was active".
 */
export async function requestUserDeletion(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const allowed: readonly UserAccountStatus[] = ["ACTIVE", "SUSPENDED"];
  const result = await prisma.user.updateMany({
    where: { id: userId, accountStatus: { in: ["ACTIVE", "SUSPENDED"] } },
    data: {
      accountStatus: "DELETION_PENDING",
      deletionRequestedAt: now,
      // Clear suspension metadata: no longer relevant after deletion request.
      suspendedAt: null,
      suspendedReason: null,
      suspendEndsAt: null,
    },
  });

  if (result.count === 0) {
    await resolveZeroCountError(prisma, userId, allowed);
  }
}

// ─── markUserDeleted ───────────────────────────────────────────

/**
 * Mark a DELETION_PENDING user as DELETED.
 *
 * Atomic: uses updateMany with { id, accountStatus: "DELETION_PENDING" } predicate.
 * Sets deletedAt. Does not touch suspension or deletion-request metadata
 * (those fields remain as audit trail of the last transition).
 */
export async function markUserDeleted(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const allowed: readonly UserAccountStatus[] = ["DELETION_PENDING"];
  const result = await prisma.user.updateMany({
    where: { id: userId, accountStatus: "DELETION_PENDING" },
    data: {
      accountStatus: "DELETED",
      deletedAt: now,
    },
  });

  if (result.count === 0) {
    await resolveZeroCountError(prisma, userId, allowed);
  }
}

// ─── recordUserLogin ──────────────────────────────────────────

/**
 * Update lastLoginAt timestamp for a non-DELETED user.
 *
 * Atomic: uses updateMany with { id, accountStatus: { not: "DELETED" } } predicate.
 * DELETED users are terminal and must not have activity recorded.
 * Does not change accountStatus or any lifecycle metadata.
 */
export async function recordUserLogin(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const allowed: readonly UserAccountStatus[] = ["ACTIVE", "SUSPENDED", "DELETION_PENDING"];
  const result = await prisma.user.updateMany({
    where: { id: userId, accountStatus: { not: "DELETED" } },
    data: {
      lastLoginAt: now,
    },
  });

  if (result.count === 0) {
    await resolveZeroCountError(prisma, userId, allowed);
  }
}

// ─── recordUserActivity ────────────────────────────────────────

/**
 * Update lastActivityAt timestamp for a non-DELETED user.
 *
 * Atomic: uses updateMany with { id, accountStatus: { not: "DELETED" } } predicate.
 * DELETED users are terminal and must not have activity recorded.
 * Does not change accountStatus or any lifecycle metadata.
 */
export async function recordUserActivity(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const allowed: readonly UserAccountStatus[] = ["ACTIVE", "SUSPENDED", "DELETION_PENDING"];
  const result = await prisma.user.updateMany({
    where: { id: userId, accountStatus: { not: "DELETED" } },
    data: {
      lastActivityAt: now,
    },
  });

  if (result.count === 0) {
    await resolveZeroCountError(prisma, userId, allowed);
  }
}
