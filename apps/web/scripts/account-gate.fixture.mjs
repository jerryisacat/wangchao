/**
 * Account gate fixtures for Issue #157.
 *
 * Tests the account status authorization gate as a pure function.
 * No DB calls, no side effects.
 *
 * Key constraints:
 *   * ACTIVE -> allowed
 *   * DELETION_PENDING -> allowed (user may complete deletion flow)
 *   * SUSPENDED -> denied with ACCOUNT_SUSPENDED reason
 *   * DELETED -> denied with ACCOUNT_DELETED reason
 *   * null/undefined -> allowed (fail open, session check is primary)
 *   * shouldRevokeSessions returns true only when denied
 */
import {
  evaluateAccountGate,
  shouldRevokeSessions,
} from "../src/lib/account-gate.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runAccountGateFixtures() {
  // ── ACTIVE ──
  {
    const decision = evaluateAccountGate("ACTIVE");
    assert(decision.allowed === true, "ACTIVE must be allowed.");
    assert(
      shouldRevokeSessions(decision) === false,
      "ACTIVE must not trigger session revocation.",
    );
  }

  // ── DELETION_PENDING ──
  {
    const decision = evaluateAccountGate("DELETION_PENDING");
    assert(decision.allowed === true, "DELETION_PENDING must be allowed.");
    assert(
      shouldRevokeSessions(decision) === false,
      "DELETION_PENDING must not trigger session revocation.",
    );
  }

  // ── SUSPENDED ──
  {
    const decision = evaluateAccountGate("SUSPENDED");
    assert(decision.allowed === false, "SUSPENDED must be denied.");
    assert(decision.reason === "ACCOUNT_SUSPENDED", "SUSPENDED denial reason must be ACCOUNT_SUSPENDED.");
    assert(
      shouldRevokeSessions(decision) === true,
      "SUSPENDED must trigger session revocation.",
    );
  }

  // ── DELETED ──
  {
    const decision = evaluateAccountGate("DELETED");
    assert(decision.allowed === false, "DELETED must be denied.");
    assert(decision.reason === "ACCOUNT_DELETED", "DELETED denial reason must be ACCOUNT_DELETED.");
    assert(
      shouldRevokeSessions(decision) === true,
      "DELETED must trigger session revocation.",
    );
  }

  // ── null/undefined (fail open) ──
  {
    const nullDecision = evaluateAccountGate(null);
    assert(nullDecision.allowed === true, "null status must fail open (allowed).");

    const undefinedDecision = evaluateAccountGate(undefined);
    assert(undefinedDecision.allowed === true, "undefined status must fail open (allowed).");
  }

  // ── unknown status (fail open) ──
  {
    const decision = evaluateAccountGate("UNKNOWN_STATUS");
    assert(decision.allowed === true, "Unknown status must fail open (allowed).");
  }

  console.log("All account-gate fixtures passed!");
}

runAccountGateFixtures().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
