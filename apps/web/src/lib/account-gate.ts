import type { UserAccountStatus } from "@wangchao/db";

/**
 * Issue #157 — Account status authorization gate.
 *
 * Determines whether a user with the given accountStatus is allowed
 * to maintain an active session.
 *
 * Rules:
 *   - ACTIVE: allowed.
 *   - SUSPENDED: denied. The user's sessions must be revoked.
 *   - DELETION_PENDING: allowed (the user may still log in to complete
 *     the deletion flow or cancel it).
 *   - DELETED: denied. Terminal state — all sessions must be revoked.
 */

export type AccountGateDecision =
  | { allowed: true }
  | { allowed: false; reason: AccountDenialReason };

export type AccountDenialReason =
  | "ACCOUNT_SUSPENDED"
  | "ACCOUNT_DELETED";

/**
 * Evaluate whether the given account status permits an active session.
 *
 * This is a pure function — no DB calls, no side effects.
 * The caller is responsible for revoking sessions when `allowed` is false.
 */
export function evaluateAccountGate(
  accountStatus: UserAccountStatus | null | undefined,
): AccountGateDecision {
  if (accountStatus === null || accountStatus === undefined) {
    // If we can't determine the status, allow the request to proceed.
    // The session check itself (better-auth) is the primary gate.
    return { allowed: true };
  }

  switch (accountStatus) {
    case "ACTIVE":
    case "DELETION_PENDING":
      return { allowed: true };

    case "SUSPENDED":
      return { allowed: false, reason: "ACCOUNT_SUSPENDED" };

    case "DELETED":
      return { allowed: false, reason: "ACCOUNT_DELETED" };

    default:
      // Unknown status — fail open (allow) to avoid locking out users
      // due to a schema mismatch. The session check is still enforced.
      return { allowed: true };
  }
}

/**
 * Check if a denial reason should trigger session revocation.
 *
 * Both SUSPENDED and DELETED should revoke existing sessions, but
 * the caller may want to distinguish them for audit logging.
 */
export function shouldRevokeSessions(
  decision: AccountGateDecision,
): decision is { allowed: false; reason: AccountDenialReason } {
  return !decision.allowed;
}
