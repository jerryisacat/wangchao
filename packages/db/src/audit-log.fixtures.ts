/**
 * Immutable audit log fixtures for Issue #154.
 *
 * Tests the audit log repository using mocked PrismaClient.
 * No DATABASE_URL required — pure unit tests.
 *
 * Key constraints:
 *   * AuditLog is append-only: no update or delete methods exist.
 *   * Every platform write operation must include reason, before/after,
 *     and requestId.
 *   * The repository exposes create + read methods only.
 */
import type { PrismaClient } from "@prisma/client";
import {
  createAuditLog,
  getAuditLogById,
  listAuditLogsByActor,
  listAuditLogsByTarget,
  listAuditLogsByAction,
  type AuditActorType,
  type CreateAuditLogInput,
  type AuditLogRecord,
} from "./repositories/audit-log.js";

export async function runAuditLogFixtures(): Promise<void> {
  // ── createAuditLog ──
  await verifyCreateAuditLogCallsCreateOnly();
  await verifyCreateAuditLogSetsAllFields();
  await verifyCreateAuditLogInjectsCreatedAt();
  await verifyCreateAuditLogRejectsBlankAction();
  await verifyCreateAuditLogRejectsBlankActorId();
  await verifyCreateAuditLogRejectsBlankTargetId();
  await verifyCreateAuditLogAllowsNullReason();
  await verifyCreateAuditLogAllowsNullBeforeAfter();
  await verifyCreateAuditLogAllowsNullRequestId();

  // ── getAuditLogById ──
  await verifyGetAuditLogByIdReturnsRecord();
  await verifyGetAuditLogByIdReturnsNullForMissing();

  // ── listAuditLogsByActor ──
  await verifyListAuditLogsByActorCallsFindManyWithActorFilter();
  await verifyListAuditLogsByActorOrdersByCreatedAtDesc();
  await verifyListAuditLogsByActorAppliesLimit();

  // ── listAuditLogsByTarget ──
  await verifyListAuditLogsByTargetCallsFindManyWithTargetFilter();

  // ── listAuditLogsByAction ──
  await verifyListAuditLogsByActionCallsFindManyWithActionFilter();

  // ── Immutability: no update/delete methods ──
  await verifyNoUpdateOrDeleteMethodsCalled();
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

interface MockAuditLogRecord {
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

interface MockAuditLogDelegate {
  findUnique: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<unknown>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
  deleteMany: (args: unknown) => Promise<unknown>;
}

interface MockPrisma {
  prisma: { auditLog: MockAuditLogDelegate };
  calls: Array<{ args: unknown; method: string }>;
}

function createMockWithAuditLog(record: MockAuditLogRecord | null): MockPrisma {
  const calls: Array<{ args: unknown; method: string }> = [];
  const delegate: MockAuditLogDelegate = {
    findUnique: async (args: unknown) => {
      calls.push({ args, method: "auditLog.findUnique" });
      return record;
    },
    findMany: async (args: unknown) => {
      calls.push({ args, method: "auditLog.findMany" });
      return record ? [record] : [];
    },
    create: async (args: unknown) => {
      calls.push({ args, method: "auditLog.create" });
      const data = readRecord(args, "create args");
      const fields = readRecord(data.data, "create.data");
      return {
        id: "al-new",
        actorType: fields.actorType,
        actorId: fields.actorId,
        action: fields.action,
        targetType: fields.targetType,
        targetId: fields.targetId,
        reason: fields.reason ?? null,
        before: fields.before ?? null,
        after: fields.after ?? null,
        requestId: fields.requestId ?? null,
        createdAt: fields.createdAt ?? new Date(),
      };
    },
    update: async (args: unknown) => {
      calls.push({ args, method: "auditLog.update" });
      return record;
    },
    delete: async (args: unknown) => {
      calls.push({ args, method: "auditLog.delete" });
      return { count: 1 };
    },
    deleteMany: async (args: unknown) => {
      calls.push({ args, method: "auditLog.deleteMany" });
      return { count: 1 };
    },
  };
  return { prisma: { auditLog: delegate }, calls };
}

function makeAuditLog(overrides: Partial<MockAuditLogRecord> = {}): MockAuditLogRecord {
  return {
    id: "al-1",
    actorType: "PLATFORM_ADMIN",
    actorId: "user-1",
    action: "platform.user.suspend",
    targetType: "User",
    targetId: "user-2",
    reason: "Terms violation",
    before: { accountStatus: "ACTIVE" },
    after: { accountStatus: "SUSPENDED" },
    requestId: "req-abc-123",
    createdAt: new Date("2026-07-20T12:00:00.000Z"),
    ...overrides,
  };
}

// ─── createAuditLog tests ─────────────────────────────────────

async function verifyCreateAuditLogCallsCreateOnly(): Promise<void> {
  const { prisma, calls } = createMockWithAuditLog(null);
  await createAuditLog(prisma as unknown as PrismaClient, {
    actorType: "PLATFORM_ADMIN",
    actorId: "user-1",
    action: "platform.user.suspend",
    targetType: "User",
    targetId: "user-2",
    reason: "Terms violation",
    before: { accountStatus: "ACTIVE" },
    after: { accountStatus: "SUSPENDED" },
    requestId: "req-abc-123",
  });

  assert(
    calls.some((c) => c.method === "auditLog.create"),
    "createAuditLog must call auditLog.create.",
  );
  assert(
    !calls.some((c) => c.method === "auditLog.update"),
    "createAuditLog must NOT call auditLog.update (append-only).",
  );
  assert(
    !calls.some((c) => c.method === "auditLog.delete" || c.method === "auditLog.deleteMany"),
    "createAuditLog must NOT call auditLog.delete or deleteMany (append-only).",
  );
}

async function verifyCreateAuditLogSetsAllFields(): Promise<void> {
  const { prisma, calls } = createMockWithAuditLog(null);
  await createAuditLog(prisma as unknown as PrismaClient, {
    actorType: "PLATFORM_ADMIN",
    actorId: "user-1",
    action: "platform.user.suspend",
    targetType: "User",
    targetId: "user-2",
    reason: "Terms violation",
    before: { accountStatus: "ACTIVE" },
    after: { accountStatus: "SUSPENDED" },
    requestId: "req-abc-123",
  });

  const createCall = calls.find((c) => c.method === "auditLog.create");
  assert(createCall, "Must call auditLog.create.");
  const args = readRecord(createCall!.args, "create args");
  const data = readRecord(args.data, "create.data");
  assert(data.actorType === "PLATFORM_ADMIN", "data.actorType must be set.");
  assert(data.actorId === "user-1", "data.actorId must be set.");
  assert(data.action === "platform.user.suspend", "data.action must be set.");
  assert(data.targetType === "User", "data.targetType must be set.");
  assert(data.targetId === "user-2", "data.targetId must be set.");
  assert(data.reason === "Terms violation", "data.reason must be set.");
  assert(data.requestId === "req-abc-123", "data.requestId must be set.");
}

async function verifyCreateAuditLogInjectsCreatedAt(): Promise<void> {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const { prisma, calls } = createMockWithAuditLog(null);
  await createAuditLog(
    prisma as unknown as PrismaClient,
    {
      actorType: "SYSTEM",
      actorId: "system",
      action: "system.cron.tick",
      targetType: "System",
      targetId: "cron-worker",
    },
    now,
  );

  const createCall = calls.find((c) => c.method === "auditLog.create");
  const data = readRecord(readRecord(createCall!.args, "args").data, "data");
  assert(data.createdAt === now, "createAuditLog must inject createdAt.");
}

async function verifyCreateAuditLogRejectsBlankAction(): Promise<void> {
  const { prisma } = createMockWithAuditLog(null);
  const { error } = await expectError(
    () => createAuditLog(prisma as unknown as PrismaClient, {
      actorType: "PLATFORM_ADMIN",
      actorId: "user-1",
      action: "",
      targetType: "User",
      targetId: "user-2",
    }),
    "createAuditLog with empty action must throw.",
  );
  assert(error instanceof Error, "Must throw an Error.");
  assert(
    (error as Error).message.includes("action"),
    "Error message must mention action.",
  );
}

async function verifyCreateAuditLogRejectsBlankActorId(): Promise<void> {
  const { prisma } = createMockWithAuditLog(null);
  const { error } = await expectError(
    () => createAuditLog(prisma as unknown as PrismaClient, {
      actorType: "PLATFORM_ADMIN",
      actorId: "",
      action: "platform.user.suspend",
      targetType: "User",
      targetId: "user-2",
    }),
    "createAuditLog with empty actorId must throw.",
  );
  assert(error instanceof Error, "Must throw an Error.");
}

async function verifyCreateAuditLogRejectsBlankTargetId(): Promise<void> {
  const { prisma } = createMockWithAuditLog(null);
  const { error } = await expectError(
    () => createAuditLog(prisma as unknown as PrismaClient, {
      actorType: "PLATFORM_ADMIN",
      actorId: "user-1",
      action: "platform.user.suspend",
      targetType: "User",
      targetId: "",
    }),
    "createAuditLog with empty targetId must throw.",
  );
  assert(error instanceof Error, "Must throw an Error.");
}

async function verifyCreateAuditLogAllowsNullReason(): Promise<void> {
  const { prisma, calls } = createMockWithAuditLog(null);
  await createAuditLog(prisma as unknown as PrismaClient, {
    actorType: "SYSTEM",
    actorId: "system",
    action: "system.cron.tick",
    targetType: "System",
    targetId: "cron-worker",
    // reason intentionally omitted
  });

  const createCall = calls.find((c) => c.method === "auditLog.create");
  assert(createCall, "Must call auditLog.create even without reason.");
}

async function verifyCreateAuditLogAllowsNullBeforeAfter(): Promise<void> {
  const { prisma } = createMockWithAuditLog(null);
  await createAuditLog(prisma as unknown as PrismaClient, {
    actorType: "PLATFORM_ADMIN",
    actorId: "user-1",
    action: "platform.admin.role.assign",
    targetType: "PlatformAdmin",
    targetId: "user-2",
    reason: "Promotion",
    // before/after intentionally omitted
  });
  // No throw = pass
}

async function verifyCreateAuditLogAllowsNullRequestId(): Promise<void> {
  const { prisma } = createMockWithAuditLog(null);
  await createAuditLog(prisma as unknown as PrismaClient, {
    actorType: "PLATFORM_ADMIN",
    actorId: "user-1",
    action: "platform.admin.role.assign",
    targetType: "PlatformAdmin",
    targetId: "user-2",
    reason: "Promotion",
    // requestId intentionally omitted
  });
  // No throw = pass
}

// ─── getAuditLogById tests ────────────────────────────────────

async function verifyGetAuditLogByIdReturnsRecord(): Promise<void> {
  const record = makeAuditLog();
  const { prisma } = createMockWithAuditLog(record);
  const result = await getAuditLogById(prisma as unknown as PrismaClient, "al-1");
  assert(result !== null, "Must return a record for existing audit log.");
  assert(result!.id === "al-1", "Record must include id.");
  assert(result!.action === "platform.user.suspend", "Record must include action.");
}

async function verifyGetAuditLogByIdReturnsNullForMissing(): Promise<void> {
  const { prisma } = createMockWithAuditLog(null);
  const result = await getAuditLogById(prisma as unknown as PrismaClient, "nonexistent");
  assert(result === null, "Must return null for missing audit log.");
}

// ─── listAuditLogsByActor tests ───────────────────────────────

async function verifyListAuditLogsByActorCallsFindManyWithActorFilter(): Promise<void> {
  const record = makeAuditLog();
  const { prisma, calls } = createMockWithAuditLog(record);
  await listAuditLogsByActor(prisma as unknown as PrismaClient, "PLATFORM_ADMIN", "user-1");

  const findManyCall = calls.find((c) => c.method === "auditLog.findMany");
  assert(findManyCall, "Must call auditLog.findMany.");
  const args = readRecord(findManyCall!.args, "findMany args");
  const where = readRecord(args.where, "findMany.where");
  assert(where.actorType === "PLATFORM_ADMIN", "where must filter by actorType.");
  assert(where.actorId === "user-1", "where must filter by actorId.");
}

async function verifyListAuditLogsByActorOrdersByCreatedAtDesc(): Promise<void> {
  const record = makeAuditLog();
  const { prisma, calls } = createMockWithAuditLog(record);
  await listAuditLogsByActor(prisma as unknown as PrismaClient, "PLATFORM_ADMIN", "user-1");

  const findManyCall = calls.find((c) => c.method === "auditLog.findMany");
  const args = readRecord(findManyCall!.args, "findMany args");
  const orderBy = readRecord(args.orderBy, "findMany.orderBy");
  assert(orderBy.createdAt === "desc", "findMany must order by createdAt desc.");
}

async function verifyListAuditLogsByActorAppliesLimit(): Promise<void> {
  const record = makeAuditLog();
  const { prisma, calls } = createMockWithAuditLog(record);
  await listAuditLogsByActor(prisma as unknown as PrismaClient, "PLATFORM_ADMIN", "user-1", 50);

  const findManyCall = calls.find((c) => c.method === "auditLog.findMany");
  const args = readRecord(findManyCall!.args, "findMany args");
  assert(args.take === 50, "findMany must apply take limit.");
}

// ─── listAuditLogsByTarget tests ──────────────────────────────

async function verifyListAuditLogsByTargetCallsFindManyWithTargetFilter(): Promise<void> {
  const record = makeAuditLog();
  const { prisma, calls } = createMockWithAuditLog(record);
  await listAuditLogsByTarget(prisma as unknown as PrismaClient, "User", "user-2");

  const findManyCall = calls.find((c) => c.method === "auditLog.findMany");
  assert(findManyCall, "Must call auditLog.findMany.");
  const args = readRecord(findManyCall!.args, "findMany args");
  const where = readRecord(args.where, "findMany.where");
  assert(where.targetType === "User", "where must filter by targetType.");
  assert(where.targetId === "user-2", "where must filter by targetId.");
}

// ─── listAuditLogsByAction tests ──────────────────────────────

async function verifyListAuditLogsByActionCallsFindManyWithActionFilter(): Promise<void> {
  const record = makeAuditLog();
  const { prisma, calls } = createMockWithAuditLog(record);
  await listAuditLogsByAction(prisma as unknown as PrismaClient, "platform.user.suspend");

  const findManyCall = calls.find((c) => c.method === "auditLog.findMany");
  assert(findManyCall, "Must call auditLog.findMany.");
  const args = readRecord(findManyCall!.args, "findMany args");
  const where = readRecord(args.where, "findMany.where");
  assert(where.action === "platform.user.suspend", "where must filter by action.");
}

// ─── Immutability test ────────────────────────────────────────

async function verifyNoUpdateOrDeleteMethodsCalled(): Promise<void> {
  // The repository module must not export update or delete functions.
  // We verify by importing the module and checking that no update/delete
  // functions exist on the module object.
  const mod = await import("./repositories/audit-log.js");
  const exportNames = Object.keys(mod);
  assert(
    !exportNames.includes("updateAuditLog"),
    "Repository must NOT export updateAuditLog (append-only).",
  );
  assert(
    !exportNames.includes("deleteAuditLog"),
    "Repository must NOT export deleteAuditLog (append-only).",
  );
  assert(
    !exportNames.includes("updateAuditLogMany"),
    "Repository must NOT export updateAuditLogMany (append-only).",
  );
  assert(
    !exportNames.includes("deleteAuditLogMany"),
    "Repository must NOT export deleteAuditLogMany (append-only).",
  );
}