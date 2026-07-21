/**
 * Session revocation fixtures for Issue #157.
 *
 * Tests the session revocation repository using mocked PrismaClient.
 * No DATABASE_URL required — pure unit tests.
 *
 * Key constraints:
 *   * revokeUserSessions deletes ALL sessions for a user via deleteMany.
 *   * The returned count reflects actual sessions deleted.
 *   * Operation is idempotent (0 sessions → count=0, no error).
 *   * Blank userId is rejected before any DB call.
 */
import type { PrismaClient } from "@prisma/client";
import {
  revokeUserSessions,
  countUserSessions,
} from "./repositories/session-revocation.js";

export async function runSessionRevocationFixtures(): Promise<void> {
  // ── revokeUserSessions ──
  await verifyRevokeUserSessionsCallsDeleteManyWithUserIdPredicate();
  await verifyRevokeUserSessionsReturnsCount();
  await verifyRevokeUserSessionsReturnsZeroForNoSessions();
  await verifyRevokeUserSessionsRejectsBlankUserId();
  await verifyRevokeUserSessionsRejectsWhitespaceUserId();
  await verifyRevokeUserSessionsTrimsUserId();

  // ── countUserSessions ──
  await verifyCountUserSessionsCallsCountWithUserIdPredicate();
  await verifyCountUserSessionsRejectsBlankUserId();
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Expected object for ${label}, got: ${String(value)}`);
  }
  return value as Record<string, unknown>;
}

function expectError(
  fn: () => Promise<unknown>,
  message: string,
): Promise<{ error: unknown }> {
  return fn().then(
    () => { throw new Error(message); },
    (error: unknown) => ({ error }),
  );
}

// ─── Mock helpers ─────────────────────────────────────────────

interface MockSessionDelegate {
  deleteMany: (args: unknown) => Promise<{ count: number }>;
  count: (args: unknown) => Promise<number>;
}

interface MockPrisma {
  prisma: { session: MockSessionDelegate };
  calls: Array<{ args: unknown; method: string }>;
}

function createMockSessionPrisma(deleteCount: number, countValue: number): MockPrisma {
  const calls: Array<{ args: unknown; method: string }> = [];
  const delegate: MockSessionDelegate = {
    deleteMany: async (args: unknown) => {
      calls.push({ args, method: "session.deleteMany" });
      return { count: deleteCount };
    },
    count: async (args: unknown) => {
      calls.push({ args, method: "session.count" });
      return countValue;
    },
  };
  return { prisma: { session: delegate }, calls };
}

// ─── revokeUserSessions tests ─────────────────────────────────

async function verifyRevokeUserSessionsCallsDeleteManyWithUserIdPredicate(): Promise<void> {
  const { prisma, calls } = createMockSessionPrisma(3, 3);
  await revokeUserSessions(prisma as unknown as PrismaClient, "user-1");

  const deleteCall = calls.find((c) => c.method === "session.deleteMany");
  assert(deleteCall, "revokeUserSessions must call session.deleteMany.");

  const args = readRecord(deleteCall!.args, "deleteMany args");
  const where = readRecord(args.where, "deleteMany.where");
  assert(where.userId === "user-1", "deleteMany.where must target the given userId.");
}

async function verifyRevokeUserSessionsReturnsCount(): Promise<void> {
  const { prisma } = createMockSessionPrisma(5, 5);
  const result = await revokeUserSessions(prisma as unknown as PrismaClient, "user-1");

  assert(result.userId === "user-1", "Result must include userId.");
  assert(result.revokedCount === 5, "Result.revokedCount must reflect deleted sessions.");
}

async function verifyRevokeUserSessionsReturnsZeroForNoSessions(): Promise<void> {
  const { prisma } = createMockSessionPrisma(0, 0);
  const result = await revokeUserSessions(prisma as unknown as PrismaClient, "user-1");

  assert(result.revokedCount === 0, "revokeUserSessions with no sessions must return count=0, not throw.");
}

async function verifyRevokeUserSessionsRejectsBlankUserId(): Promise<void> {
  const { prisma } = createMockSessionPrisma(0, 0);
  const { error } = await expectError(
    () => revokeUserSessions(prisma as unknown as PrismaClient, ""),
    "revokeUserSessions with empty userId must throw.",
  );
  assert(error instanceof Error, "Must throw an Error.");
  assert(
    String((error as Error).message).includes("userId"),
    "Error message must mention userId.",
  );
}

async function verifyRevokeUserSessionsRejectsWhitespaceUserId(): Promise<void> {
  const { prisma } = createMockSessionPrisma(0, 0);
  const { error } = await expectError(
    () => revokeUserSessions(prisma as unknown as PrismaClient, "   "),
    "revokeUserSessions with whitespace userId must throw.",
  );
  assert(error instanceof Error, "Must throw an Error for whitespace userId.");
}

async function verifyRevokeUserSessionsTrimsUserId(): Promise<void> {
  const { prisma, calls } = createMockSessionPrisma(1, 1);
  await revokeUserSessions(prisma as unknown as PrismaClient, "  user-1  ");

  const deleteCall = calls.find((c) => c.method === "session.deleteMany");
  assert(deleteCall, "Must call session.deleteMany.");
  const where = readRecord(readRecord(deleteCall!.args, "args").where, "where");
  assert(
    where.userId === "user-1",
    "revokeUserSessions must trim userId before passing to deleteMany.",
  );
}

// ─── countUserSessions tests ──────────────────────────────────

async function verifyCountUserSessionsCallsCountWithUserIdPredicate(): Promise<void> {
  const { prisma, calls } = createMockSessionPrisma(0, 7);
  const result = await countUserSessions(prisma as unknown as PrismaClient, "user-1");

  const countCall = calls.find((c) => c.method === "session.count");
  assert(countCall, "countUserSessions must call session.count.");

  const where = readRecord(readRecord(countCall!.args, "args").where, "where");
  assert(where.userId === "user-1", "count.where must target the given userId.");
  assert(result === 7, "countUserSessions must return the count value.");
}

async function verifyCountUserSessionsRejectsBlankUserId(): Promise<void> {
  const { prisma } = createMockSessionPrisma(0, 0);
  const { error } = await expectError(
    () => countUserSessions(prisma as unknown as PrismaClient, ""),
    "countUserSessions with empty userId must throw.",
  );
  assert(error instanceof Error, "Must throw for empty userId.");
}
