/**
 * User lifecycle repository fixtures for Issue #153 Lane 1B-1.
 *
 * Tests the user lifecycle state machine using mocked PrismaClient.
 * No DATABASE_URL required — these are pure unit tests.
 *
 * State machine:
 *   ACTIVE ──suspend──▶ SUSPENDED
 *   SUSPENDED ──reactivate──▶ ACTIVE
 *   ACTIVE|SUSPENDED ──requestDeletion──▶ DELETION_PENDING
 *   DELETION_PENDING ──markDeleted──▶ DELETED
 *   DELETED is terminal: no suspend/reactivate/requestDeletion/markDeleted/login/activity
 */
import type { PrismaClient } from "@prisma/client";
import {
  getUserLifecycleStatus,
  suspendUser,
  reactivateUser,
  requestUserDeletion,
  markUserDeleted,
  recordUserLogin,
  recordUserActivity,
  UserLifecycleTransitionError,
  type UserAccountStatus,
  type SuspendUserInput,
} from "./repositories/user-lifecycle.js";
import { runUserLifecycleSchemaFixtures } from "./user-lifecycle-schema.fixtures.js";

export async function runUserLifecycleFixtures(): Promise<void> {
  await runUserLifecycleSchemaFixtures();

  // ── getUserLifecycleStatus ──
  await verifyGetUserLifecycleStatusReturnsAllFieldsIncludingDeletedAt();
  await verifyGetUserLifecycleStatusReturnsNullForMissingUser();

  // ── suspendUser ──
  await verifySuspendUserUsesAtomicUpdateManyWithActivePredicate();
  await verifySuspendUserSetsSuspendedAtReasonAndEnd();
  await verifySuspendUserInjectsNowParameter();
  await verifySuspendUserRejectsBlankReason();
  await verifySuspendUserRejectsWhitespaceOnlyReason();

  // ── reactivateUser ──
  await verifyReactivateUserUsesAtomicUpdateManyWithSuspendedPredicate();
  await verifyReactivateUserClearsSuspendFields();

  // ── requestUserDeletion ──
  await verifyRequestUserDeletionFromActiveUsesAtomicUpdateMany();
  await verifyRequestUserDeletionFromSuspendedUsesAtomicUpdateMany();
  await verifyRequestUserDeletionSetsDeletionRequestedAt();
  await verifyRequestUserDeletionClearsSuspensionMetadata();

  // ── markUserDeleted ──
  await verifyMarkUserDeletedUsesAtomicUpdateManyWithPendingPredicate();
  await verifyMarkUserDeletedSetsDeletedAt();
  await verifyMarkUserDeletedDoesNotTouchSuspensionFields();

  // ── Invalid transitions ──
  await verifySuspendUserRejectsSuspendedUser();
  await verifySuspendUserRejectsDeletionPendingUser();
  await verifySuspendUserRejectsDeletedUser();
  await verifyReactivateUserRejectsActiveUser();
  await verifyReactivateUserRejectsDeletionPendingUser();
  await verifyReactivateUserRejectsDeletedUser();
  await verifyRequestUserDeletionRejectsDeletionPendingUser();
  await verifyRequestUserDeletionRejectsDeletedUser();
  await verifyMarkUserDeletedRejectsActiveUser();
  await verifyMarkUserDeletedRejectsSuspendedUser();
  await verifyMarkUserDeletedRejectsDeletedUser();

  // ── Not found ──
  await verifySuspendUserThrowsUserNotFoundWhenUserMissing();
  await verifyReactivateUserThrowsUserNotFoundWhenUserMissing();
  await verifyRequestUserDeletionThrowsUserNotFoundWhenUserMissing();
  await verifyMarkUserDeletedThrowsUserNotFoundWhenUserMissing();

  // ── recordUserLogin / recordUserActivity ──
  await verifyRecordUserLoginUpdatesLastLoginAtOnly();
  await verifyRecordUserActivityUpdatesLastActivityAtOnly();
  await verifyRecordUserLoginInjectsNowParameter();
  await verifyRecordUserActivityInjectsNowParameter();
  await verifyRecordUserLoginRejectsDeletedUser();
  await verifyRecordUserActivityRejectsDeletedUser();
  await verifyRecordUserLoginThrowsUserNotFoundWhenUserMissing();
  await verifyRecordUserActivityThrowsUserNotFoundWhenUserMissing();

  // ── Error shape ──
  await verifyUserLifecycleTransitionErrorHasStableCodeAndNoPrismaLeak();
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// ─── Mock helpers ─────────────────────────────────────────────

/**
 * Minimal user record shape for mocking findUnique/updateMany.
 */
interface MockUserRecord {
  id: string;
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

/**
 * Create a user record with the given status. All lifecycle fields default
 * to null; the caller can override individual fields.
 */
function makeUser(overrides: Partial<MockUserRecord> = {}): MockUserRecord {
  return {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    emailVerified: true,
    image: "https://example.com/avatar.png",
    accountStatus: "ACTIVE",
    suspendedAt: null,
    suspendedReason: null,
    suspendEndsAt: null,
    deletionRequestedAt: null,
    deletedAt: null,
    lastLoginAt: null,
    lastActivityAt: null,
    ...overrides,
  };
}

interface MockUserDelegate {
  findUnique: (args: unknown) => Promise<unknown>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
  update: (args: unknown) => Promise<unknown>;
}

interface MockPrisma {
  prisma: { user: MockUserDelegate };
  calls: Array<{ args: unknown; method: string }>;
}

/**
 * Create a mock PrismaClient whose user.updateMany returns count=1 (success)
 * and user.findUnique returns the given user record.
 */
function createMockWithUser(user: MockUserRecord | null): MockPrisma {
  const calls: Array<{ args: unknown; method: string }> = [];
  const delegate: MockUserDelegate = {
    findUnique: async (args: unknown) => {
      calls.push({ args, method: "user.findUnique" });
      return user;
    },
    updateMany: async (args: unknown) => {
      calls.push({ args, method: "user.updateMany" });
      return { count: 1 };
    },
    update: async (args: unknown) => {
      calls.push({ args, method: "user.update" });
      return {};
    },
  };
  return { prisma: { user: delegate }, calls };
}

/**
 * Create a mock where user.updateMany always returns count=0.
 * findUnique returns the given user (so we can test INVALID_TRANSITION path),
 * or null (to test USER_NOT_FOUND path).
 */
function createMockWithUpdateManyCountZero(user: MockUserRecord | null): MockPrisma {
  const calls: Array<{ args: unknown; method: string }> = [];
  const delegate: MockUserDelegate = {
    findUnique: async (args: unknown) => {
      calls.push({ args, method: "user.findUnique" });
      return user;
    },
    updateMany: async (args: unknown) => {
      calls.push({ args, method: "user.updateMany" });
      return { count: 0 };
    },
    update: async (args: unknown) => {
      calls.push({ args, method: "user.update" });
      return {};
    },
  };
  return { prisma: { user: delegate }, calls };
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

function assertErrorCode(error: unknown, expectedCode: string, context: string): void {
  assert(
    error instanceof UserLifecycleTransitionError,
    `${context}: error must be UserLifecycleTransitionError, got: ${error?.constructor?.name ?? typeof error}`,
  );
  assert(
    (error as UserLifecycleTransitionError).code === expectedCode,
    `${context}: error.code must be ${expectedCode}, got: ${(error as UserLifecycleTransitionError).code}`,
  );
}

function assertNoPrismaProperties(error: unknown, context: string): void {
  const msg = String((error as Error)?.message ?? error);
  assert(
    !msg.includes("Prisma"),
    `${context}: error message must not leak Prisma internals: ${msg}`,
  );
  assert(
    !msg.includes("prisma"),
    `${context}: error message must not leak prisma internals: ${msg}`,
  );
}

// ─── getUserLifecycleStatus tests ─────────────────────────────

async function verifyGetUserLifecycleStatusReturnsAllFieldsIncludingDeletedAt(): Promise<void> {
  const user = makeUser({
    accountStatus: "DELETED",
    deletedAt: new Date("2026-07-15T12:00:00.000Z"),
  });
  const { prisma, calls } = createMockWithUser(user);

  const result = await getUserLifecycleStatus(prisma as unknown as PrismaClient, "user-1");

  assert(result !== null, "getUserLifecycleStatus must return a result for existing user.");
  assert(result!.userId === "user-1", "Lifecycle status must include userId.");
  assert(result!.email === "test@example.com", "Lifecycle status must include email.");
  assert(result!.name === "Test User", "Lifecycle status must include name.");
  assert(result!.emailVerified === true, "Lifecycle status must include emailVerified.");
  assert(result!.image === "https://example.com/avatar.png", "Lifecycle status must include image.");
  assert(result!.accountStatus === "DELETED", "Lifecycle status must include accountStatus.");
  assert(result!.suspendedAt === null, "Lifecycle status must include suspendedAt.");
  assert(result!.suspendedReason === null, "Lifecycle status must include suspendedReason.");
  assert(result!.suspendEndsAt === null, "Lifecycle status must include suspendEndsAt.");
  assert(result!.deletionRequestedAt === null, "Lifecycle status must include deletionRequestedAt.");
  assert(result!.deletedAt !== null && result!.deletedAt!.toISOString() === "2026-07-15T12:00:00.000Z",
    "Lifecycle status must include deletedAt.");
  assert(result!.lastLoginAt === null, "Lifecycle status must include lastLoginAt.");
  assert(result!.lastActivityAt === null, "Lifecycle status must include lastActivityAt.");

  const findUniqueCall = calls.find((c) => c.method === "user.findUnique");
  assert(findUniqueCall, "getUserLifecycleStatus must call user.findUnique.");
  const select = readRecord(findUniqueCall!.args, "getUserLifecycleStatus.args").select;
  const selectFields = readRecord(select, "getUserLifecycleStatus.args.select");
  for (const field of [
    "id", "email", "name", "emailVerified", "image", "accountStatus",
    "suspendedAt", "suspendedReason", "suspendEndsAt", "deletionRequestedAt",
    "deletedAt", "lastLoginAt", "lastActivityAt",
  ]) {
    assert(
      selectFields[field] === true,
      `getUserLifecycleStatus select must include ${field}.`,
    );
  }
}

async function verifyGetUserLifecycleStatusReturnsNullForMissingUser(): Promise<void> {
  const { prisma } = createMockWithUser(null);
  const result = await getUserLifecycleStatus(prisma as unknown as PrismaClient, "nonexistent");
  assert(result === null, "getUserLifecycleStatus must return null for missing user.");
}

// ─── suspendUser tests ────────────────────────────────────────

async function verifySuspendUserUsesAtomicUpdateManyWithActivePredicate(): Promise<void> {
  const { prisma, calls } = createMockWithUser(makeUser());
  await suspendUser(prisma as unknown as PrismaClient, {
    userId: "user-1",
    reason: "spam",
  });

  const updateManyCall = calls.find((c) => c.method === "user.updateMany");
  assert(updateManyCall, "suspendUser must call user.updateMany (not user.update).");

  const args = readRecord(updateManyCall!.args, "suspendUser.args");
  const where = readRecord(args.where, "suspendUser.args.where");
  assert(where.id === "user-1", "suspendUser where must target the correct userId.");
  assert(where.accountStatus === "ACTIVE",
    "suspendUser where must include accountStatus: ACTIVE predicate.");

  assert(calls.filter((c) => c.method === "user.update").length === 0,
    "suspendUser must NOT use user.update (must use atomic updateMany).");
}

async function verifySuspendUserSetsSuspendedAtReasonAndEnd(): Promise<void> {
  const now = new Date("2026-07-17T10:00:00.000Z");
  const suspendEndsAt = new Date("2026-07-20T00:00:00.000Z");
  const { prisma, calls } = createMockWithUser(makeUser());

  await suspendUser(prisma as unknown as PrismaClient, {
    userId: "user-1",
    reason: "spam",
    suspendEndsAt,
  }, now);

  const args = readRecord(
    calls.find((c) => c.method === "user.updateMany")!.args,
    "suspendUser.args",
  );
  const data = readRecord(args.data, "suspendUser.data");
  assert(data.accountStatus === "SUSPENDED", "suspendUser must set accountStatus to SUSPENDED.");
  assert(data.suspendedReason === "spam", "suspendUser must set suspendedReason.");
  assert(data.suspendEndsAt === suspendEndsAt, "suspendUser must set suspendEndsAt.");
  assert(data.suspendedAt === now, "suspendUser must set suspendedAt to injected now.");
}

async function verifySuspendUserInjectsNowParameter(): Promise<void> {
  const now = new Date("2026-01-15T08:30:00.000Z");
  const { prisma, calls } = createMockWithUser(makeUser());

  await suspendUser(prisma as unknown as PrismaClient, {
    userId: "user-1",
    reason: "abuse",
  }, now);

  const data = readRecord(
    readRecord(calls.find((c) => c.method === "user.updateMany")!.args, "args").data,
    "data",
  );
  assert(data.suspendedAt === now, "suspendUser must use injected now for suspendedAt.");
}

async function verifySuspendUserRejectsBlankReason(): Promise<void> {
  const { prisma } = createMockWithUser(makeUser());
  const { error } = await expectError(
    () => suspendUser(prisma as unknown as PrismaClient, { userId: "user-1", reason: "" }),
    "suspendUser with empty reason must throw.",
  );
  assertErrorCode(error, "INVALID_REASON", "suspendUser blank reason");
  assertNoPrismaProperties(error, "suspendUser blank reason");
}

async function verifySuspendUserRejectsWhitespaceOnlyReason(): Promise<void> {
  const { prisma } = createMockWithUser(makeUser());
  const { error } = await expectError(
    () => suspendUser(prisma as unknown as PrismaClient, { userId: "user-1", reason: "   \t  " }),
    "suspendUser with whitespace-only reason must throw.",
  );
  assertErrorCode(error, "INVALID_REASON", "suspendUser whitespace reason");
  assertNoPrismaProperties(error, "suspendUser whitespace reason");
}

async function verifySuspendUserRejectsSuspendedUser(): Promise<void> {
  const user = makeUser({ accountStatus: "SUSPENDED", suspendedAt: new Date() });
  const { prisma } = createMockWithUpdateManyCountZero(user);
  const { error } = await expectError(
    () => suspendUser(prisma as unknown as PrismaClient, { userId: "user-1", reason: "spam" }),
    "suspendUser on SUSPENDED user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "suspendUser SUSPENDED");
  assertNoPrismaProperties(error, "suspendUser SUSPENDED");
}

async function verifySuspendUserRejectsDeletionPendingUser(): Promise<void> {
  const user = makeUser({ accountStatus: "DELETION_PENDING" });
  const { prisma } = createMockWithUpdateManyCountZero(user);
  const { error } = await expectError(
    () => suspendUser(prisma as unknown as PrismaClient, { userId: "user-1", reason: "spam" }),
    "suspendUser on DELETION_PENDING user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "suspendUser DELETION_PENDING");
}

async function verifySuspendUserRejectsDeletedUser(): Promise<void> {
  const user = makeUser({ accountStatus: "DELETED", deletedAt: new Date() });
  const { prisma } = createMockWithUpdateManyCountZero(user);
  const { error } = await expectError(
    () => suspendUser(prisma as unknown as PrismaClient, { userId: "user-1", reason: "spam" }),
    "suspendUser on DELETED user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "suspendUser DELETED");
}

async function verifySuspendUserThrowsUserNotFoundWhenUserMissing(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(null);
  const { error } = await expectError(
    () => suspendUser(prisma as unknown as PrismaClient, { userId: "nonexistent", reason: "spam" }),
    "suspendUser on missing user must throw USER_NOT_FOUND.",
  );
  assertErrorCode(error, "USER_NOT_FOUND", "suspendUser missing user");
}

// ─── reactivateUser tests ─────────────────────────────────────

async function verifyReactivateUserUsesAtomicUpdateManyWithSuspendedPredicate(): Promise<void> {
  const user = makeUser({ accountStatus: "SUSPENDED" });
  const { prisma, calls } = createMockWithUser(user);

  await reactivateUser(prisma as unknown as PrismaClient, "user-1");

  const updateManyCall = calls.find((c) => c.method === "user.updateMany");
  assert(updateManyCall, "reactivateUser must call user.updateMany.");
  const where = readRecord(readRecord(updateManyCall!.args, "args").where, "where");
  assert(where.id === "user-1", "reactivateUser where must target correct userId.");
  assert(where.accountStatus === "SUSPENDED",
    "reactivateUser where must include accountStatus: SUSPENDED predicate.");
  assert(calls.filter((c) => c.method === "user.update").length === 0,
    "reactivateUser must NOT use user.update.");
}

async function verifyReactivateUserClearsSuspendFields(): Promise<void> {
  const user = makeUser({ accountStatus: "SUSPENDED" });
  const { prisma, calls } = createMockWithUser(user);

  await reactivateUser(prisma as unknown as PrismaClient, "user-1");

  const data = readRecord(
    readRecord(calls.find((c) => c.method === "user.updateMany")!.args, "args").data,
    "data",
  );
  assert(data.accountStatus === "ACTIVE", "reactivateUser must set accountStatus to ACTIVE.");
  assert(data.suspendedAt === null, "reactivateUser must clear suspendedAt.");
  assert(data.suspendedReason === null, "reactivateUser must clear suspendedReason.");
  assert(data.suspendEndsAt === null, "reactivateUser must clear suspendEndsAt.");
}

async function verifyReactivateUserRejectsActiveUser(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(makeUser({ accountStatus: "ACTIVE" }));
  const { error } = await expectError(
    () => reactivateUser(prisma as unknown as PrismaClient, "user-1"),
    "reactivateUser on ACTIVE user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "reactivateUser ACTIVE");
}

async function verifyReactivateUserRejectsDeletionPendingUser(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(makeUser({ accountStatus: "DELETION_PENDING" }));
  const { error } = await expectError(
    () => reactivateUser(prisma as unknown as PrismaClient, "user-1"),
    "reactivateUser on DELETION_PENDING user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "reactivateUser DELETION_PENDING");
}

async function verifyReactivateUserRejectsDeletedUser(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(makeUser({ accountStatus: "DELETED", deletedAt: new Date() }));
  const { error } = await expectError(
    () => reactivateUser(prisma as unknown as PrismaClient, "user-1"),
    "reactivateUser on DELETED user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "reactivateUser DELETED");
}

async function verifyReactivateUserThrowsUserNotFoundWhenUserMissing(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(null);
  const { error } = await expectError(
    () => reactivateUser(prisma as unknown as PrismaClient, "nonexistent"),
    "reactivateUser on missing user must throw USER_NOT_FOUND.",
  );
  assertErrorCode(error, "USER_NOT_FOUND", "reactivateUser missing user");
}

// ─── requestUserDeletion tests ────────────────────────────────

async function verifyRequestUserDeletionFromActiveUsesAtomicUpdateMany(): Promise<void> {
  const { prisma, calls } = createMockWithUser(makeUser({ accountStatus: "ACTIVE" }));
  await requestUserDeletion(prisma as unknown as PrismaClient, "user-1");

  const updateManyCall = calls.find((c) => c.method === "user.updateMany");
  assert(updateManyCall, "requestUserDeletion must call user.updateMany.");
  const where = readRecord(readRecord(updateManyCall!.args, "args").where, "where");
  assert(where.id === "user-1", "requestUserDeletion where must target correct userId.");
  // Predicate must accept both ACTIVE and SUSPENDED
  const statusClause = readRecord(where.accountStatus, "where.accountStatus");
  const inList = statusClause.in as unknown[] | undefined;
  assert(
    Array.isArray(inList) && inList.includes("ACTIVE") && inList.includes("SUSPENDED"),
    "requestUserDeletion predicate must use { in: [ACTIVE, SUSPENDED] }.",
  );
}

async function verifyRequestUserDeletionFromSuspendedUsesAtomicUpdateMany(): Promise<void> {
  const { prisma, calls } = createMockWithUser(makeUser({ accountStatus: "SUSPENDED" }));
  await requestUserDeletion(prisma as unknown as PrismaClient, "user-1");

  const updateManyCall = calls.find((c) => c.method === "user.updateMany");
  assert(updateManyCall, "requestUserDeletion must call user.updateMany.");
  const where = readRecord(readRecord(updateManyCall!.args, "args").where, "where");
  assert(where.id === "user-1", "requestUserDeletion where must target correct userId.");
  // Predicate must accept both ACTIVE and SUSPENDED
  const statusClause = readRecord(where.accountStatus, "where.accountStatus");
  const inList = statusClause.in as unknown[] | undefined;
  assert(
    Array.isArray(inList) && inList.includes("ACTIVE") && inList.includes("SUSPENDED"),
    "requestUserDeletion predicate must use { in: [ACTIVE, SUSPENDED] }.",
  );
}

async function verifyRequestUserDeletionSetsDeletionRequestedAt(): Promise<void> {
  const now = new Date("2026-07-17T10:00:00.000Z");
  const { prisma, calls } = createMockWithUser(makeUser());

  await requestUserDeletion(prisma as unknown as PrismaClient, "user-1", now);

  const data = readRecord(
    readRecord(calls.find((c) => c.method === "user.updateMany")!.args, "args").data,
    "data",
  );
  assert(data.accountStatus === "DELETION_PENDING",
    "requestUserDeletion must set accountStatus to DELETION_PENDING.");
  assert(data.deletionRequestedAt === now,
    "requestUserDeletion must set deletionRequestedAt to injected now.");
}

async function verifyRequestUserDeletionClearsSuspensionMetadata(): Promise<void> {
  const { prisma, calls } = createMockWithUser(makeUser({ accountStatus: "SUSPENDED" }));

  await requestUserDeletion(prisma as unknown as PrismaClient, "user-1");

  const data = readRecord(
    readRecord(calls.find((c) => c.method === "user.updateMany")!.args, "args").data,
    "data",
  );
  assert(data.suspendedAt === null,
    "requestUserDeletion must clear suspendedAt (suspension metadata is no longer relevant once deletion is requested).");
  assert(data.suspendedReason === null,
    "requestUserDeletion must clear suspendedReason.");
  assert(data.suspendEndsAt === null,
    "requestUserDeletion must clear suspendEndsAt.");
}

async function verifyRequestUserDeletionRejectsDeletionPendingUser(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(makeUser({ accountStatus: "DELETION_PENDING" }));
  const { error } = await expectError(
    () => requestUserDeletion(prisma as unknown as PrismaClient, "user-1"),
    "requestUserDeletion on DELETION_PENDING user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "requestUserDeletion DELETION_PENDING");
}

async function verifyRequestUserDeletionRejectsDeletedUser(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(makeUser({ accountStatus: "DELETED", deletedAt: new Date() }));
  const { error } = await expectError(
    () => requestUserDeletion(prisma as unknown as PrismaClient, "user-1"),
    "requestUserDeletion on DELETED user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "requestUserDeletion DELETED");
}

async function verifyRequestUserDeletionThrowsUserNotFoundWhenUserMissing(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(null);
  const { error } = await expectError(
    () => requestUserDeletion(prisma as unknown as PrismaClient, "nonexistent"),
    "requestUserDeletion on missing user must throw USER_NOT_FOUND.",
  );
  assertErrorCode(error, "USER_NOT_FOUND", "requestUserDeletion missing user");
}

// ─── markUserDeleted tests ────────────────────────────────────

async function verifyMarkUserDeletedUsesAtomicUpdateManyWithPendingPredicate(): Promise<void> {
  const user = makeUser({ accountStatus: "DELETION_PENDING", deletionRequestedAt: new Date() });
  const { prisma, calls } = createMockWithUser(user);

  await markUserDeleted(prisma as unknown as PrismaClient, "user-1");

  const updateManyCall = calls.find((c) => c.method === "user.updateMany");
  assert(updateManyCall, "markUserDeleted must call user.updateMany.");
  const where = readRecord(readRecord(updateManyCall!.args, "args").where, "where");
  assert(where.id === "user-1", "markUserDeleted where must target correct userId.");
  assert(where.accountStatus === "DELETION_PENDING",
    "markUserDeleted where must include accountStatus: DELETION_PENDING predicate.");
  assert(calls.filter((c) => c.method === "user.update").length === 0,
    "markUserDeleted must NOT use user.update.");
}

async function verifyMarkUserDeletedSetsDeletedAt(): Promise<void> {
  const now = new Date("2026-07-17T12:00:00.000Z");
  const user = makeUser({ accountStatus: "DELETION_PENDING", deletionRequestedAt: new Date() });
  const { prisma, calls } = createMockWithUser(user);

  await markUserDeleted(prisma as unknown as PrismaClient, "user-1", now);

  const data = readRecord(
    readRecord(calls.find((c) => c.method === "user.updateMany")!.args, "args").data,
    "data",
  );
  assert(data.accountStatus === "DELETED", "markUserDeleted must set accountStatus to DELETED.");
  assert(data.deletedAt === now, "markUserDeleted must set deletedAt to injected now.");
}

async function verifyMarkUserDeletedDoesNotTouchSuspensionFields(): Promise<void> {
  const user = makeUser({ accountStatus: "DELETION_PENDING", deletionRequestedAt: new Date() });
  const { prisma, calls } = createMockWithUser(user);

  await markUserDeleted(prisma as unknown as PrismaClient, "user-1");

  const data = readRecord(
    readRecord(calls.find((c) => c.method === "user.updateMany")!.args, "args").data,
    "data",
  );
  assert(data.suspendedAt === undefined,
    "markUserDeleted must not touch suspendedAt.");
  assert(data.suspendedReason === undefined,
    "markUserDeleted must not touch suspendedReason.");
  assert(data.suspendEndsAt === undefined,
    "markUserDeleted must not touch suspendEndsAt.");
  assert(data.deletionRequestedAt === undefined,
    "markUserDeleted must not touch deletionRequestedAt.");
}

async function verifyMarkUserDeletedRejectsActiveUser(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(makeUser({ accountStatus: "ACTIVE" }));
  const { error } = await expectError(
    () => markUserDeleted(prisma as unknown as PrismaClient, "user-1"),
    "markUserDeleted on ACTIVE user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "markUserDeleted ACTIVE");
}

async function verifyMarkUserDeletedRejectsSuspendedUser(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(makeUser({ accountStatus: "SUSPENDED" }));
  const { error } = await expectError(
    () => markUserDeleted(prisma as unknown as PrismaClient, "user-1"),
    "markUserDeleted on SUSPENDED user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "markUserDeleted SUSPENDED");
}

async function verifyMarkUserDeletedRejectsDeletedUser(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(makeUser({ accountStatus: "DELETED", deletedAt: new Date() }));
  const { error } = await expectError(
    () => markUserDeleted(prisma as unknown as PrismaClient, "user-1"),
    "markUserDeleted on DELETED user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "markUserDeleted DELETED");
}

async function verifyMarkUserDeletedThrowsUserNotFoundWhenUserMissing(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(null);
  const { error } = await expectError(
    () => markUserDeleted(prisma as unknown as PrismaClient, "nonexistent"),
    "markUserDeleted on missing user must throw USER_NOT_FOUND.",
  );
  assertErrorCode(error, "USER_NOT_FOUND", "markUserDeleted missing user");
}

// ─── recordUserLogin tests ────────────────────────────────────

async function verifyRecordUserLoginUpdatesLastLoginAtOnly(): Promise<void> {
  const now = new Date("2026-07-17T10:00:00.000Z");
  const { prisma, calls } = createMockWithUser(makeUser());

  await recordUserLogin(prisma as unknown as PrismaClient, "user-1", now);

  const updateManyCall = calls.find((c) => c.method === "user.updateMany");
  assert(updateManyCall, "recordUserLogin must call user.updateMany.");
  const data = readRecord(readRecord(updateManyCall!.args, "args").data, "data");
  assert(data.lastLoginAt === now, "recordUserLogin must set lastLoginAt to injected now.");
  assert(data.lastActivityAt === undefined, "recordUserLogin must not update lastActivityAt.");
  assert(data.accountStatus === undefined, "recordUserLogin must not change accountStatus.");
}

async function verifyRecordUserLoginInjectsNowParameter(): Promise<void> {
  const now = new Date("2026-03-01T00:00:00.000Z");
  const { prisma, calls } = createMockWithUser(makeUser());

  await recordUserLogin(prisma as unknown as PrismaClient, "user-1", now);

  const data = readRecord(
    readRecord(calls.find((c) => c.method === "user.updateMany")!.args, "args").data,
    "data",
  );
  assert(data.lastLoginAt === now, "recordUserLogin must use injected now.");
}

async function verifyRecordUserLoginRejectsDeletedUser(): Promise<void> {
  const user = makeUser({ accountStatus: "DELETED", deletedAt: new Date() });
  const { prisma } = createMockWithUpdateManyCountZero(user);
  const { error } = await expectError(
    () => recordUserLogin(prisma as unknown as PrismaClient, "user-1"),
    "recordUserLogin on DELETED user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "recordUserLogin DELETED");
}

async function verifyRecordUserLoginThrowsUserNotFoundWhenUserMissing(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(null);
  const { error } = await expectError(
    () => recordUserLogin(prisma as unknown as PrismaClient, "nonexistent"),
    "recordUserLogin on missing user must throw USER_NOT_FOUND.",
  );
  assertErrorCode(error, "USER_NOT_FOUND", "recordUserLogin missing user");
}

// ─── recordUserActivity tests ─────────────────────────────────

async function verifyRecordUserActivityUpdatesLastActivityAtOnly(): Promise<void> {
  const now = new Date("2026-07-17T10:00:00.000Z");
  const { prisma, calls } = createMockWithUser(makeUser());

  await recordUserActivity(prisma as unknown as PrismaClient, "user-1", now);

  const updateManyCall = calls.find((c) => c.method === "user.updateMany");
  assert(updateManyCall, "recordUserActivity must call user.updateMany.");
  const data = readRecord(readRecord(updateManyCall!.args, "args").data, "data");
  assert(data.lastActivityAt === now, "recordUserActivity must set lastActivityAt to injected now.");
  assert(data.lastLoginAt === undefined, "recordUserActivity must not update lastLoginAt.");
  assert(data.accountStatus === undefined, "recordUserActivity must not change accountStatus.");
}

async function verifyRecordUserActivityInjectsNowParameter(): Promise<void> {
  const now = new Date("2026-06-15T14:30:00.000Z");
  const { prisma, calls } = createMockWithUser(makeUser());

  await recordUserActivity(prisma as unknown as PrismaClient, "user-1", now);

  const data = readRecord(
    readRecord(calls.find((c) => c.method === "user.updateMany")!.args, "args").data,
    "data",
  );
  assert(data.lastActivityAt === now, "recordUserActivity must use injected now.");
}

async function verifyRecordUserActivityRejectsDeletedUser(): Promise<void> {
  const user = makeUser({ accountStatus: "DELETED", deletedAt: new Date() });
  const { prisma } = createMockWithUpdateManyCountZero(user);
  const { error } = await expectError(
    () => recordUserActivity(prisma as unknown as PrismaClient, "user-1"),
    "recordUserActivity on DELETED user must throw INVALID_TRANSITION.",
  );
  assertErrorCode(error, "INVALID_TRANSITION", "recordUserActivity DELETED");
}

async function verifyRecordUserActivityThrowsUserNotFoundWhenUserMissing(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(null);
  const { error } = await expectError(
    () => recordUserActivity(prisma as unknown as PrismaClient, "nonexistent"),
    "recordUserActivity on missing user must throw USER_NOT_FOUND.",
  );
  assertErrorCode(error, "USER_NOT_FOUND", "recordUserActivity missing user");
}

// ─── Error shape tests ────────────────────────────────────────

async function verifyUserLifecycleTransitionErrorHasStableCodeAndNoPrismaLeak(): Promise<void> {
  const { prisma } = createMockWithUpdateManyCountZero(null);
  const { error } = await expectError(
    () => suspendUser(prisma as unknown as PrismaClient, { userId: "x", reason: "spam" }),
    "Should throw for missing user.",
  );

  assert(
    error instanceof UserLifecycleTransitionError,
    "Thrown error must be instance of UserLifecycleTransitionError.",
  );
  const e = error as UserLifecycleTransitionError;
  assert(e.code === "USER_NOT_FOUND", `code must be USER_NOT_FOUND, got ${e.code}.`);
  assert(e.userId === "x", `userId must be preserved on error, got ${e.userId}.`);
  assert(typeof e.message === "string" && e.message.length > 0, "message must be non-empty.");
  assertNoPrismaProperties(e, "error shape");

  // Verify stable code union
  const validCodes = ["USER_NOT_FOUND", "INVALID_TRANSITION", "INVALID_REASON"] as const;
  assert(
    validCodes.includes(e.code),
    `code must be one of ${validCodes.join(", ")}, got ${e.code}.`,
  );
}
