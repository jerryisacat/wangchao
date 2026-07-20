/**
 * Platform admin RBAC fixtures for Issue #154.
 *
 * Tests the platform admin repository using mocked PrismaClient.
 * No DATABASE_URL required — pure unit tests.
 *
 * Key constraints:
 *   * PlatformAdmin is a global identity independent of MembershipRole.
 *   * One PlatformAdmin row per user (userId unique).
 *   * Role hierarchy: PLATFORM_OWNER > PLATFORM_ADMIN > PLATFORM_AUDITOR.
 *   * Workspace OWNER/ADMIN must NOT grant platform access.
 */
import type { PrismaClient } from "@prisma/client";
import {
  assignPlatformRole,
  getPlatformAdminByUserId,
  listPlatformAdmins,
  updatePlatformMfa,
  updatePlatformReauth,
  removePlatformAdmin,
  isPlatformAdmin,
  hasPlatformRole,
  PlatformAdminError,
  type PlatformAdminRole,
  type PlatformAdminRecord,
} from "./repositories/platform-admin.js";

export async function runPlatformAdminFixtures(): Promise<void> {
  // ── assignPlatformRole ──
  await verifyAssignPlatformRoleCreatesNewAdmin();
  await verifyAssignPlatformRoleUpsertsExistingAdmin();
  await verifyAssignPlatformRoleRejectsBlankUserId();
  await verifyAssignPlatformRoleInjectsNow();

  // ── getPlatformAdminByUserId ──
  await verifyGetPlatformAdminByUserIdReturnsRecord();
  await verifyGetPlatformAdminByUserIdReturnsNullForMissing();

  // ── isPlatformAdmin ──
  await verifyIsPlatformAdminReturnsTrueForExistingAdmin();
  await verifyIsPlatformAdminReturnsFalseForNonAdmin();

  // ── hasPlatformRole ──
  await verifyHasPlatformRoleReturnsTrueForExactRole();
  await verifyHasPlatformRoleReturnsTrueForHigherRole();
  await verifyHasPlatformRoleReturnsFalseForLowerRole();
  await verifyHasPlatformRoleReturnsFalseForNonAdmin();

  // ── listPlatformAdmins ──
  await verifyListPlatformAdminsReturnsAllAdminsOrderedByCreatedAt();

  // ── updatePlatformMfa ──
  await verifyUpdatePlatformMfaSetsMfaEnabled();

  // ── updatePlatformReauth ──
  await verifyUpdatePlatformReauthSetsLastReauthAt();

  // ── removePlatformAdmin ──
  await verifyRemovePlatformAdminDeletesRow();
  await verifyRemovePlatformAdminReturnsFalseForMissing();

  // ── Error shape ──
  await verifyPlatformAdminErrorHasStableCodeAndNoPrismaLeak();
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

interface MockPlatformAdminRecord {
  id: string;
  userId: string;
  role: PlatformAdminRole;
  mfaEnabled: boolean | null;
  lastReauthAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MockPlatformAdminDelegate {
  findUnique: (args: unknown) => Promise<unknown>;
  findFirst: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<unknown>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  upsert: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<{ count: number }>;
  deleteMany: (args: unknown) => Promise<{ count: number }>;
  count: (args: unknown) => Promise<number>;
}

interface MockPrisma {
  prisma: { platformAdmin: MockPlatformAdminDelegate };
  calls: Array<{ args: unknown; method: string }>;
}

function createMockWithAdmin(admin: MockPlatformAdminRecord | null): MockPrisma {
  const calls: Array<{ args: unknown; method: string }> = [];
  const adminRecord: MockPlatformAdminRecord | null = admin;
  const delegate: MockPlatformAdminDelegate = {
    findUnique: async (args: unknown) => {
      calls.push({ args, method: "platformAdmin.findUnique" });
      return adminRecord;
    },
    findFirst: async (args: unknown) => {
      calls.push({ args, method: "platformAdmin.findFirst" });
      return adminRecord;
    },
    findMany: async (args: unknown) => {
      calls.push({ args, method: "platformAdmin.findMany" });
      return adminRecord ? [adminRecord] : [];
    },
    create: async (args: unknown) => {
      calls.push({ args, method: "platformAdmin.create" });
      const data = readRecord(args, "create args");
      const fields = readRecord(data.data, "create.data");
      return {
        id: "pa-new",
        userId: fields.userId ?? "user-1",
        role: fields.role ?? "PLATFORM_AUDITOR",
        mfaEnabled: null,
        lastReauthAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    update: async (args: unknown) => {
      calls.push({ args, method: "platformAdmin.update" });
      return adminRecord;
    },
    upsert: async (args: unknown) => {
      calls.push({ args, method: "platformAdmin.upsert" });
      const data = readRecord(args, "upsert args");
      const createFields = readRecord(data.create, "upsert.create");
      return {
        id: "pa-upserted",
        userId: createFields.userId ?? "user-1",
        role: createFields.role ?? "PLATFORM_AUDITOR",
        mfaEnabled: null,
        lastReauthAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    delete: async (args: unknown) => {
      calls.push({ args, method: "platformAdmin.delete" });
      return { count: adminRecord ? 1 : 0 };
    },
    deleteMany: async (args: unknown) => {
      calls.push({ args, method: "platformAdmin.deleteMany" });
      return { count: adminRecord ? 1 : 0 };
    },
    count: async (args: unknown) => {
      calls.push({ args, method: "platformAdmin.count" });
      return adminRecord ? 1 : 0;
    },
  };
  return { prisma: { platformAdmin: delegate }, calls };
}

function makeAdmin(overrides: Partial<MockPlatformAdminRecord> = {}): MockPlatformAdminRecord {
  return {
    id: "pa-1",
    userId: "user-1",
    role: "PLATFORM_ADMIN",
    mfaEnabled: null,
    lastReauthAt: null,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    updatedAt: new Date("2026-07-20T00:00:00.000Z"),
    ...overrides,
  };
}

// ─── assignPlatformRole tests ─────────────────────────────────

async function verifyAssignPlatformRoleCreatesNewAdmin(): Promise<void> {
  const { prisma, calls } = createMockWithAdmin(null);
  await assignPlatformRole(prisma as unknown as PrismaClient, {
    userId: "user-new",
    role: "PLATFORM_ADMIN",
  });

  const upsertCall = calls.find((c) => c.method === "platformAdmin.upsert");
  assert(upsertCall, "assignPlatformRole must call platformAdmin.upsert.");
  const args = readRecord(upsertCall!.args, "upsert args");
  const where = readRecord(args.where, "upsert.where");
  assert(where.userId === "user-new", "upsert must target the given userId.");
  const create = readRecord(args.create, "upsert.create");
  assert(create.role === "PLATFORM_ADMIN", "upsert.create must set the role.");
  const update = readRecord(args.update, "upsert.update");
  assert(update.role === "PLATFORM_ADMIN", "upsert.update must set the role.");
}

async function verifyAssignPlatformRoleUpsertsExistingAdmin(): Promise<void> {
  const existing = makeAdmin({ role: "PLATFORM_AUDITOR" });
  const { prisma, calls } = createMockWithAdmin(existing);
  await assignPlatformRole(prisma as unknown as PrismaClient, {
    userId: "user-1",
    role: "PLATFORM_OWNER",
  });

  const upsertCall = calls.find((c) => c.method === "platformAdmin.upsert");
  assert(upsertCall, "assignPlatformRole must call platformAdmin.upsert for existing admin.");
}

async function verifyAssignPlatformRoleRejectsBlankUserId(): Promise<void> {
  const { prisma } = createMockWithAdmin(null);
  const { error } = await expectError(
    () => assignPlatformRole(prisma as unknown as PrismaClient, {
      userId: "",
      role: "PLATFORM_ADMIN",
    }),
    "assignPlatformRole with empty userId must throw.",
  );
  assert(
    error instanceof PlatformAdminError,
    "Error must be PlatformAdminError.",
  );
  assert(
    (error as PlatformAdminError).code === "INVALID_INPUT",
    "Error code must be INVALID_INPUT.",
  );
}

async function verifyAssignPlatformRoleInjectsNow(): Promise<void> {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const { prisma } = createMockWithAdmin(null);
  const result = await assignPlatformRole(
    prisma as unknown as PrismaClient,
    { userId: "user-1", role: "PLATFORM_ADMIN" },
    now,
  );
  assert(result !== null, "assignPlatformRole must return a record.");
}

// ─── getPlatformAdminByUserId tests ───────────────────────────

async function verifyGetPlatformAdminByUserIdReturnsRecord(): Promise<void> {
  const admin = makeAdmin({ role: "PLATFORM_OWNER" });
  const { prisma, calls } = createMockWithAdmin(admin);
  const result = await getPlatformAdminByUserId(prisma as unknown as PrismaClient, "user-1");
  assert(result !== null, "Must return a record for existing admin.");
  assert(result!.userId === "user-1", "Record must include userId.");
  assert(result!.role === "PLATFORM_OWNER", "Record must include role.");

  const findCall = calls.find((c) => c.method === "platformAdmin.findUnique");
  assert(findCall, "Must call platformAdmin.findUnique.");
}

async function verifyGetPlatformAdminByUserIdReturnsNullForMissing(): Promise<void> {
  const { prisma } = createMockWithAdmin(null);
  const result = await getPlatformAdminByUserId(prisma as unknown as PrismaClient, "nonexistent");
  assert(result === null, "Must return null for missing admin.");
}

// ─── isPlatformAdmin tests ────────────────────────────────────

async function verifyIsPlatformAdminReturnsTrueForExistingAdmin(): Promise<void> {
  const { prisma } = createMockWithAdmin(makeAdmin());
  const result = await isPlatformAdmin(prisma as unknown as PrismaClient, "user-1");
  assert(result === true, "isPlatformAdmin must return true for existing admin.");
}

async function verifyIsPlatformAdminReturnsFalseForNonAdmin(): Promise<void> {
  const { prisma } = createMockWithAdmin(null);
  const result = await isPlatformAdmin(prisma as unknown as PrismaClient, "user-1");
  assert(result === false, "isPlatformAdmin must return false for non-admin.");
}

// ─── hasPlatformRole tests ────────────────────────────────────

async function verifyHasPlatformRoleReturnsTrueForExactRole(): Promise<void> {
  const { prisma } = createMockWithAdmin(makeAdmin({ role: "PLATFORM_ADMIN" }));
  const result = await hasPlatformRole(prisma as unknown as PrismaClient, "user-1", "PLATFORM_ADMIN");
  assert(result === true, "hasPlatformRole must return true for exact role match.");
}

async function verifyHasPlatformRoleReturnsTrueForHigherRole(): Promise<void> {
  const { prisma } = createMockWithAdmin(makeAdmin({ role: "PLATFORM_OWNER" }));
  const result = await hasPlatformRole(prisma as unknown as PrismaClient, "user-1", "PLATFORM_ADMIN");
  assert(result === true, "hasPlatformRole must return true when user role is higher.");
}

async function verifyHasPlatformRoleReturnsFalseForLowerRole(): Promise<void> {
  const { prisma } = createMockWithAdmin(makeAdmin({ role: "PLATFORM_AUDITOR" }));
  const result = await hasPlatformRole(prisma as unknown as PrismaClient, "user-1", "PLATFORM_ADMIN");
  assert(result === false, "hasPlatformRole must return false when user role is lower.");
}

async function verifyHasPlatformRoleReturnsFalseForNonAdmin(): Promise<void> {
  const { prisma } = createMockWithAdmin(null);
  const result = await hasPlatformRole(prisma as unknown as PrismaClient, "user-1", "PLATFORM_AUDITOR");
  assert(result === false, "hasPlatformRole must return false for non-admin.");
}

// ─── listPlatformAdmins tests ─────────────────────────────────

async function verifyListPlatformAdminsReturnsAllAdminsOrderedByCreatedAt(): Promise<void> {
  const admin = makeAdmin();
  const { prisma, calls } = createMockWithAdmin(admin);
  const result = await listPlatformAdmins(prisma as unknown as PrismaClient);
  assert(Array.isArray(result), "listPlatformAdmins must return an array.");
  assert(result.length === 1, "Must return the mock admin.");

  const findManyCall = calls.find((c) => c.method === "platformAdmin.findMany");
  assert(findManyCall, "Must call platformAdmin.findMany.");
  const args = readRecord(findManyCall!.args, "findMany args");
  const orderBy = readRecord(args.orderBy, "findMany.orderBy");
  assert(orderBy.createdAt === "asc", "findMany must order by createdAt asc.");
}

// ─── updatePlatformMfa tests ──────────────────────────────────

async function verifyUpdatePlatformMfaSetsMfaEnabled(): Promise<void> {
  const admin = makeAdmin({ mfaEnabled: false });
  const { prisma, calls } = createMockWithAdmin(admin);
  await updatePlatformMfa(prisma as unknown as PrismaClient, "user-1", true);

  const updateCall = calls.find((c) => c.method === "platformAdmin.update");
  assert(updateCall, "Must call platformAdmin.update.");
  const args = readRecord(updateCall!.args, "update args");
  const data = readRecord(args.data, "update.data");
  assert(data.mfaEnabled === true, "update.data must set mfaEnabled to true.");
}

// ─── updatePlatformReauth tests ───────────────────────────────

async function verifyUpdatePlatformReauthSetsLastReauthAt(): Promise<void> {
  const admin = makeAdmin();
  const now = new Date("2026-07-20T10:00:00.000Z");
  const { prisma, calls } = createMockWithAdmin(admin);
  await updatePlatformReauth(prisma as unknown as PrismaClient, "user-1", now);

  const updateCall = calls.find((c) => c.method === "platformAdmin.update");
  assert(updateCall, "Must call platformAdmin.update.");
  const args = readRecord(updateCall!.args, "update args");
  const data = readRecord(args.data, "update.data");
  assert(data.lastReauthAt === now, "update.data must set lastReauthAt to the injected timestamp.");
}

// ─── removePlatformAdmin tests ────────────────────────────────

async function verifyRemovePlatformAdminDeletesRow(): Promise<void> {
  const admin = makeAdmin();
  const { prisma, calls } = createMockWithAdmin(admin);
  const result = await removePlatformAdmin(prisma as unknown as PrismaClient, "user-1");
  assert(result === true, "Must return true when a row is deleted.");

  const deleteCall = calls.find(
    (c) => c.method === "platformAdmin.delete" || c.method === "platformAdmin.deleteMany",
  );
  assert(deleteCall, "Must call platformAdmin.delete or deleteMany.");
}

async function verifyRemovePlatformAdminReturnsFalseForMissing(): Promise<void> {
  const { prisma } = createMockWithAdmin(null);
  const result = await removePlatformAdmin(prisma as unknown as PrismaClient, "nonexistent");
  assert(result === false, "Must return false when no row exists.");
}

// ─── Error shape tests ────────────────────────────────────────

async function verifyPlatformAdminErrorHasStableCodeAndNoPrismaLeak(): Promise<void> {
  const { prisma } = createMockWithAdmin(null);
  const { error } = await expectError(
    () => assignPlatformRole(prisma as unknown as PrismaClient, {
      userId: "  ",
      role: "PLATFORM_ADMIN",
    }),
    "assignPlatformRole with whitespace userId must throw.",
  );
  assert(
    error instanceof PlatformAdminError,
    "Error must be PlatformAdminError.",
  );
  const msg = String((error as Error).message);
  assert(!msg.includes("Prisma"), "Error message must not leak Prisma internals.");
  assert(!msg.includes("prisma"), "Error message must not leak prisma internals.");
}
