import type { PrismaClient } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────

export interface RevokedSessionsResult {
  userId: string;
  revokedCount: number;
}

// ─── Repository functions ─────────────────────────────────────

/**
 * Revoke (delete) all sessions for a user.
 *
 * This is the primary session invalidation mechanism used when:
 *   - A platform admin suspends a user (Issue #157).
 *   - A user's account transitions to DELETED.
 *   - Security incident response requires immediate session invalidation.
 *
 * Uses deleteMany with { userId } predicate. The count returned reflects
 * the actual number of sessions deleted, which is useful for audit logging.
 *
 * This operation is idempotent: if the user has no sessions, it returns count=0.
 */
export async function revokeUserSessions(
  prisma: PrismaClient,
  userId: string,
): Promise<RevokedSessionsResult> {
  const trimmedUserId = userId.trim();
  if (trimmedUserId.length === 0) {
    throw new Error("revokeUserSessions: userId must not be empty.");
  }

  const result = await prisma.session.deleteMany({
    where: { userId: trimmedUserId },
  });

  return {
    userId: trimmedUserId,
    revokedCount: result.count,
  };
}

/**
 * Count active sessions for a user without deleting them.
 * Useful for diagnostics and audit logging before revocation.
 */
export async function countUserSessions(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  const trimmedUserId = userId.trim();
  if (trimmedUserId.length === 0) {
    throw new Error("countUserSessions: userId must not be empty.");
  }

  return prisma.session.count({
    where: { userId: trimmedUserId },
  });
}
