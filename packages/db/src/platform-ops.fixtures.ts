/**
 * Platform operations fixtures for Issue #159.
 *
 * Tests the platform operations repository (notes, temp plan override) using
 * mocked PrismaClient. No DATABASE_URL required — pure unit tests.
 *
 * Key constraints:
 *   * PlatformNote is append-only: no update or delete methods exist.
 *   * Temp plan override does NOT modify base plan; on revoke/expiry base plan
 *     takes effect.
 *   * Every grant/revoke writes an AuditLog entry with before/after/reason.
 *   * getTempPlanOverrideView resolves effective plan considering expiry.
 */
import type { PrismaClient } from "@prisma/client";
import {
  createPlatformNote,
  getPlatformNoteById,
  listPlatformNotes,
  grantTempPlanOverride,
  revokeTempPlanOverride,
  getTempPlanOverrideView,
  PlatformOpsError,
  type Plan,
} from "./repositories/platform-ops.js";

export async function runPlatformOpsFixtures(): Promise<void> {
  // ── createPlatformNote ──
  await verifyCreatePlatformNoteCallsCreateOnly();
  await verifyCreatePlatformNoteSetsAllFields();
  await verifyCreatePlatformNoteInjectsCreatedAt();
  await verifyCreatePlatformNoteRejectsBlankTargetType();
  await verifyCreatePlatformNoteRejectsBlankTargetId();
  await verifyCreatePlatformNoteRejectsBlankAuthorId();
  await verifyCreatePlatformNoteRejectsBlankContent();

  // ── getPlatformNoteById ──
  await verifyGetPlatformNoteByIdReturnsRecord();
  await verifyGetPlatformNoteByIdReturnsNullForMissing();

  // ── listPlatformNotes ──
  await verifyListPlatformNotesCallsFindManyWithTargetFilter();
  await verifyListPlatformNotesOrdersByCreatedAtDesc();
  await verifyListPlatformNotesAppliesLimit();

  // ── grantTempPlanOverride ──
  await verifyGrantTempPlanOverrideUpdatesOverrideFields();
  await verifyGrantTempPlanOverrideDoesNotModifyBasePlan();
  await verifyGrantTempPlanOverrideWritesAuditLog();
  await verifyGrantTempPlanOverrideRejectsBlankReason();
  await verifyGrantTempPlanOverrideRejectsBlankOrgId();
  await verifyGrantTempPlanOverrideRejectsMissingSubscription();

  // ── revokeTempPlanOverride ──
  await verifyRevokeTempPlanOverrideClearsOverrideFields();
  await verifyRevokeTempPlanOverrideWritesAuditLog();
  await verifyRevokeTempPlanOverrideRejectsBlankReason();
  await verifyRevokeTempPlanOverrideRejectsMissingSubscription();

  // ── getTempPlanOverrideView ──
  await verifyGetTempPlanOverrideViewResolvesActiveOverride();
  await verifyGetTempPlanOverrideViewResolvesExpiredOverride();
  await verifyGetTempPlanOverrideViewResolvesNoOverride();
  await verifyGetTempPlanOverrideViewReturnsNullForMissingSubscription();

  // ── Immutability: notes have no update/delete methods ──
  await verifyNoUpdateOrDeleteMethodsOnNotes();
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

function assertErrorCode(error: unknown, expectedCode: string, context: string): void {
  assert(
    error instanceof PlatformOpsError,
    `${context}: error must be PlatformOpsError, got: ${error?.constructor?.name ?? typeof error}`,
  );
  assert(
    (error as PlatformOpsError).code === expectedCode,
    `${context}: error.code must be ${expectedCode}, got: ${(error as PlatformOpsError).code}`,
  );
}

// ─── Mock helpers (notes) ─────────────────────────────────────

interface MockNoteDelegate {
  findUnique: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<unknown>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
  deleteMany: (args: unknown) => Promise<unknown>;
}

interface MockNotePrisma {
  prisma: { platformNote: MockNoteDelegate };
  calls: Array<{ args: unknown; method: string }>;
}

function createMockNotePrisma(record: unknown | null): MockNotePrisma {
  const calls: Array<{ args: unknown; method: string }> = [];
  const delegate: MockNoteDelegate = {
    findUnique: async (args: unknown) => {
      calls.push({ args, method: "platformNote.findUnique" });
      return record;
    },
    findMany: async (args: unknown) => {
      calls.push({ args, method: "platformNote.findMany" });
      return record ? [record] : [];
    },
    create: async (args: unknown) => {
      calls.push({ args, method: "platformNote.create" });
      const data = readRecord(args, "create args");
      const fields = readRecord(data.data, "create.data");
      return {
        id: "note-new",
        targetType: fields.targetType,
        targetId: fields.targetId,
        authorId: fields.authorId,
        content: fields.content,
        createdAt: fields.createdAt ?? new Date(),
      };
    },
    update: async (args: unknown) => {
      calls.push({ args, method: "platformNote.update" });
      return record;
    },
    delete: async (args: unknown) => {
      calls.push({ args, method: "platformNote.delete" });
      return { count: 1 };
    },
    deleteMany: async (args: unknown) => {
      calls.push({ args, method: "platformNote.deleteMany" });
      return { count: 1 };
    },
  };
  return { prisma: { platformNote: delegate }, calls };
}

// ─── Mock helpers (subscription + auditLog) ───────────────────

interface MockSubscription {
  plan: string;
  tempPlanOverride: string | null;
  tempPlanExpiresAt: Date | null;
  tempPlanReason: string | null;
}

interface MockSubscriptionDelegate {
  findUnique: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
}

interface MockAuditLogDelegate {
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
  deleteMany: (args: unknown) => Promise<unknown>;
}

interface MockOpsPrisma {
  prisma: {
    subscription: MockSubscriptionDelegate;
    auditLog: MockAuditLogDelegate;
    platformNote: MockNoteDelegate;
  };
  calls: Array<{ args: unknown; method: string }>;
}

function createMockOpsPrisma(sub: MockSubscription | null): MockOpsPrisma {
  const calls: Array<{ args: unknown; method: string }> = [];
  let currentSub: MockSubscription | null = sub ? { ...sub } : null;

  const subscriptionDelegate: MockSubscriptionDelegate = {
    findUnique: async (args: unknown) => {
      calls.push({ args, method: "subscription.findUnique" });
      return currentSub;
    },
    update: async (args: unknown) => {
      calls.push({ args, method: "subscription.update" });
      if (!currentSub) throw new Error("mock: subscription not found");
      const data = readRecord(args, "update args").data as Record<string, unknown>;
      Object.assign(currentSub, data);
      return { ...currentSub };
    },
  };

  const auditLogDelegate: MockAuditLogDelegate = {
    create: async (args: unknown) => {
      calls.push({ args, method: "auditLog.create" });
      return { id: "al-new" };
    },
    update: async (args: unknown) => {
      calls.push({ args, method: "auditLog.update" });
      return {};
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

  const noteDelegate: MockNoteDelegate = {
    findUnique: async (args: unknown) => { calls.push({ args, method: "platformNote.findUnique" }); return null; },
    findMany: async (args: unknown) => { calls.push({ args, method: "platformNote.findMany" }); return []; },
    create: async (args: unknown) => { calls.push({ args, method: "platformNote.create" }); return { id: "note-new" }; },
    update: async (args: unknown) => { calls.push({ args, method: "platformNote.update" }); return {}; },
    delete: async (args: unknown) => { calls.push({ args, method: "platformNote.delete" }); return { count: 1 }; },
    deleteMany: async (args: unknown) => { calls.push({ args, method: "platformNote.deleteMany" }); return { count: 1 }; },
  };

  return {
    prisma: {
      subscription: subscriptionDelegate,
      auditLog: auditLogDelegate,
      platformNote: noteDelegate,
    },
    calls,
  };
}

// ─── createPlatformNote tests ─────────────────────────────────

async function verifyCreatePlatformNoteCallsCreateOnly(): Promise<void> {
  const { prisma, calls } = createMockNotePrisma(null);
  await createPlatformNote(prisma as unknown as PrismaClient, {
    targetType: "User",
    targetId: "user-1",
    authorId: "admin-1",
    content: "Spam account, monitoring",
  });

  assert(calls.some((c) => c.method === "platformNote.create"), "createPlatformNote must call platformNote.create.");
  assert(!calls.some((c) => c.method === "platformNote.update"), "createPlatformNote must NOT call platformNote.update (append-only).");
  assert(!calls.some((c) => c.method === "platformNote.delete" || c.method === "platformNote.deleteMany"), "createPlatformNote must NOT call delete/deleteMany (append-only).");
}

async function verifyCreatePlatformNoteSetsAllFields(): Promise<void> {
  const { prisma, calls } = createMockNotePrisma(null);
  await createPlatformNote(prisma as unknown as PrismaClient, {
    targetType: "User",
    targetId: "user-1",
    authorId: "admin-1",
    content: "Spam account, monitoring",
  });

  const createCall = calls.find((c) => c.method === "platformNote.create");
  assert(createCall, "Must call platformNote.create.");
  const data = readRecord(readRecord(createCall!.args, "args").data, "data");
  assert(data.targetType === "User", "data.targetType must be set.");
  assert(data.targetId === "user-1", "data.targetId must be set.");
  assert(data.authorId === "admin-1", "data.authorId must be set.");
  assert(data.content === "Spam account, monitoring", "data.content must be set.");
}

async function verifyCreatePlatformNoteInjectsCreatedAt(): Promise<void> {
  const now = new Date("2026-07-21T10:00:00.000Z");
  const { prisma, calls } = createMockNotePrisma(null);
  await createPlatformNote(
    prisma as unknown as PrismaClient,
    { targetType: "User", targetId: "user-1", authorId: "admin-1", content: "Note" },
    now,
  );

  const data = readRecord(readRecord(calls.find((c) => c.method === "platformNote.create")!.args, "args").data, "data");
  assert(data.createdAt === now, "createPlatformNote must inject createdAt.");
}

async function verifyCreatePlatformNoteRejectsBlankTargetType(): Promise<void> {
  const { prisma } = createMockNotePrisma(null);
  const { error } = await expectError(
    () => createPlatformNote(prisma as unknown as PrismaClient, { targetType: "", targetId: "user-1", authorId: "admin-1", content: "Note" }),
    "createPlatformNote with empty targetType must throw.",
  );
  assertErrorCode(error, "INVALID_INPUT", "createPlatformNote blank targetType");
}

async function verifyCreatePlatformNoteRejectsBlankTargetId(): Promise<void> {
  const { prisma } = createMockNotePrisma(null);
  const { error } = await expectError(
    () => createPlatformNote(prisma as unknown as PrismaClient, { targetType: "User", targetId: "", authorId: "admin-1", content: "Note" }),
    "createPlatformNote with empty targetId must throw.",
  );
  assertErrorCode(error, "INVALID_INPUT", "createPlatformNote blank targetId");
}

async function verifyCreatePlatformNoteRejectsBlankAuthorId(): Promise<void> {
  const { prisma } = createMockNotePrisma(null);
  const { error } = await expectError(
    () => createPlatformNote(prisma as unknown as PrismaClient, { targetType: "User", targetId: "user-1", authorId: "", content: "Note" }),
    "createPlatformNote with empty authorId must throw.",
  );
  assertErrorCode(error, "INVALID_INPUT", "createPlatformNote blank authorId");
}

async function verifyCreatePlatformNoteRejectsBlankContent(): Promise<void> {
  const { prisma } = createMockNotePrisma(null);
  const { error } = await expectError(
    () => createPlatformNote(prisma as unknown as PrismaClient, { targetType: "User", targetId: "user-1", authorId: "admin-1", content: "  " }),
    "createPlatformNote with whitespace content must throw.",
  );
  assertErrorCode(error, "INVALID_INPUT", "createPlatformNote blank content");
}

// ─── getPlatformNoteById tests ────────────────────────────────

async function verifyGetPlatformNoteByIdReturnsRecord(): Promise<void> {
  const record = {
    id: "note-1",
    targetType: "User",
    targetId: "user-1",
    authorId: "admin-1",
    content: "Test note",
    createdAt: new Date("2026-07-21T10:00:00.000Z"),
  };
  const { prisma } = createMockNotePrisma(record);
  const result = await getPlatformNoteById(prisma as unknown as PrismaClient, "note-1");
  assert(result !== null, "Must return a record for existing note.");
  assert(result!.id === "note-1", "Record must include id.");
  assert(result!.content === "Test note", "Record must include content.");
}

async function verifyGetPlatformNoteByIdReturnsNullForMissing(): Promise<void> {
  const { prisma } = createMockNotePrisma(null);
  const result = await getPlatformNoteById(prisma as unknown as PrismaClient, "nonexistent");
  assert(result === null, "Must return null for missing note.");
}

// ─── listPlatformNotes tests ──────────────────────────────────

async function verifyListPlatformNotesCallsFindManyWithTargetFilter(): Promise<void> {
  const { prisma, calls } = createMockNotePrisma(null);
  await listPlatformNotes(prisma as unknown as PrismaClient, "User", "user-1");

  const findManyCall = calls.find((c) => c.method === "platformNote.findMany");
  assert(findManyCall, "Must call platformNote.findMany.");
  const where = readRecord(readRecord(findManyCall!.args, "args").where, "where");
  assert(where.targetType === "User", "where must filter by targetType.");
  assert(where.targetId === "user-1", "where must filter by targetId.");
}

async function verifyListPlatformNotesOrdersByCreatedAtDesc(): Promise<void> {
  const { prisma, calls } = createMockNotePrisma(null);
  await listPlatformNotes(prisma as unknown as PrismaClient, "User", "user-1");

  const findManyCall = calls.find((c) => c.method === "platformNote.findMany");
  const orderBy = readRecord(readRecord(findManyCall!.args, "args").orderBy, "orderBy");
  assert(orderBy.createdAt === "desc", "findMany must order by createdAt desc.");
}

async function verifyListPlatformNotesAppliesLimit(): Promise<void> {
  const { prisma, calls } = createMockNotePrisma(null);
  await listPlatformNotes(prisma as unknown as PrismaClient, "User", "user-1", 50);

  const findManyCall = calls.find((c) => c.method === "platformNote.findMany");
  const args = readRecord(findManyCall!.args, "args");
  assert(args.take === 50, "findMany must apply take limit.");
}

// ─── grantTempPlanOverride tests ──────────────────────────────

async function verifyGrantTempPlanOverrideUpdatesOverrideFields(): Promise<void> {
  const { prisma, calls } = createMockOpsPrisma({
    plan: "FREE",
    tempPlanOverride: null,
    tempPlanExpiresAt: null,
    tempPlanReason: null,
  });
  const expiresAt = new Date("2026-08-01T00:00:00.000Z");

  await grantTempPlanOverride(prisma as unknown as PrismaClient, {
    organizationId: "org-1",
    tempPlan: "PRO",
    expiresAt,
    reason: "Promotional trial",
    actorId: "admin-1",
  });

  const updateCall = calls.find((c) => c.method === "subscription.update");
  assert(updateCall, "Must call subscription.update.");
  const data = readRecord(readRecord(updateCall!.args, "args").data, "data");
  assert(data.tempPlanOverride === "PRO", "Must set tempPlanOverride to PRO.");
  assert(data.tempPlanExpiresAt === expiresAt, "Must set tempPlanExpiresAt.");
  assert(data.tempPlanReason === "Promotional trial", "Must set tempPlanReason.");
}

async function verifyGrantTempPlanOverrideDoesNotModifyBasePlan(): Promise<void> {
  const { prisma, calls } = createMockOpsPrisma({
    plan: "FREE",
    tempPlanOverride: null,
    tempPlanExpiresAt: null,
    tempPlanReason: null,
  });

  await grantTempPlanOverride(prisma as unknown as PrismaClient, {
    organizationId: "org-1",
    tempPlan: "PRO",
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    reason: "Promotional trial",
    actorId: "admin-1",
  });

  const updateCall = calls.find((c) => c.method === "subscription.update");
  const data = readRecord(readRecord(updateCall!.args, "args").data, "data");
  assert(data.plan === undefined, "grantTempPlanOverride must NOT modify the base plan field.");
}

async function verifyGrantTempPlanOverrideWritesAuditLog(): Promise<void> {
  const { prisma, calls } = createMockOpsPrisma({
    plan: "FREE",
    tempPlanOverride: null,
    tempPlanExpiresAt: null,
    tempPlanReason: null,
  });

  await grantTempPlanOverride(prisma as unknown as PrismaClient, {
    organizationId: "org-1",
    tempPlan: "PRO",
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    reason: "Promotional trial",
    actorId: "admin-1",
    requestId: "req-123",
  });

  const auditCall = calls.find((c) => c.method === "auditLog.create");
  assert(auditCall, "grantTempPlanOverride must write an audit log.");
  const data = readRecord(readRecord(auditCall!.args, "args").data, "auditLog.data");
  assert(data.actorType === "PLATFORM_ADMIN", "Audit actorType must be PLATFORM_ADMIN.");
  assert(data.actorId === "admin-1", "Audit actorId must be set.");
  assert(data.action === "platform.subscription.temp_plan.grant", "Audit action must be set.");
  assert(data.targetType === "Subscription", "Audit targetType must be Subscription.");
  assert(data.targetId === "org-1", "Audit targetId must be set.");
  assert(data.reason === "Promotional trial", "Audit reason must be set.");
  assert(data.requestId === "req-123", "Audit requestId must be set.");

  const before = readRecord(data.before, "auditLog.before");
  const after = readRecord(data.after, "auditLog.after");
  assert(before.tempPlanOverride === null, "Audit before must show null tempPlanOverride.");
  assert(after.tempPlanOverride === "PRO", "Audit after must show PRO tempPlanOverride.");
}

async function verifyGrantTempPlanOverrideRejectsBlankReason(): Promise<void> {
  const { prisma } = createMockOpsPrisma({
    plan: "FREE",
    tempPlanOverride: null,
    tempPlanExpiresAt: null,
    tempPlanReason: null,
  });
  const { error } = await expectError(
    () => grantTempPlanOverride(prisma as unknown as PrismaClient, {
      organizationId: "org-1",
      tempPlan: "PRO",
      expiresAt: new Date("2026-08-01"),
      reason: "",
      actorId: "admin-1",
    }),
    "grantTempPlanOverride with empty reason must throw.",
  );
  assertErrorCode(error, "INVALID_INPUT", "grantTempPlanOverride blank reason");
}

async function verifyGrantTempPlanOverrideRejectsBlankOrgId(): Promise<void> {
  const { prisma } = createMockOpsPrisma({
    plan: "FREE",
    tempPlanOverride: null,
    tempPlanExpiresAt: null,
    tempPlanReason: null,
  });
  const { error } = await expectError(
    () => grantTempPlanOverride(prisma as unknown as PrismaClient, {
      organizationId: "",
      tempPlan: "PRO",
      expiresAt: new Date("2026-08-01"),
      reason: "test",
      actorId: "admin-1",
    }),
    "grantTempPlanOverride with empty organizationId must throw.",
  );
  assertErrorCode(error, "INVALID_INPUT", "grantTempPlanOverride blank orgId");
}

async function verifyGrantTempPlanOverrideRejectsMissingSubscription(): Promise<void> {
  const { prisma } = createMockOpsPrisma(null);
  const { error } = await expectError(
    () => grantTempPlanOverride(prisma as unknown as PrismaClient, {
      organizationId: "org-1",
      tempPlan: "PRO",
      expiresAt: new Date("2026-08-01"),
      reason: "test",
      actorId: "admin-1",
    }),
    "grantTempPlanOverride on missing subscription must throw.",
  );
  assertErrorCode(error, "SUBSCRIPTION_NOT_FOUND", "grantTempPlanOverride missing subscription");
}

// ─── revokeTempPlanOverride tests ─────────────────────────────

async function verifyRevokeTempPlanOverrideClearsOverrideFields(): Promise<void> {
  const { prisma, calls } = createMockOpsPrisma({
    plan: "FREE",
    tempPlanOverride: "PRO",
    tempPlanExpiresAt: new Date("2026-08-01"),
    tempPlanReason: "old reason",
  });

  await revokeTempPlanOverride(prisma as unknown as PrismaClient, {
    organizationId: "org-1",
    reason: "Trial ended",
    actorId: "admin-1",
  });

  const updateCall = calls.find((c) => c.method === "subscription.update");
  const data = readRecord(readRecord(updateCall!.args, "args").data, "data");
  assert(data.tempPlanOverride === null, "Must clear tempPlanOverride to null.");
  assert(data.tempPlanExpiresAt === null, "Must clear tempPlanExpiresAt to null.");
  assert(data.tempPlanReason === null, "Must clear tempPlanReason to null.");
}

async function verifyRevokeTempPlanOverrideWritesAuditLog(): Promise<void> {
  const { prisma, calls } = createMockOpsPrisma({
    plan: "FREE",
    tempPlanOverride: "PRO",
    tempPlanExpiresAt: new Date("2026-08-01"),
    tempPlanReason: "old reason",
  });

  await revokeTempPlanOverride(prisma as unknown as PrismaClient, {
    organizationId: "org-1",
    reason: "Trial ended",
    actorId: "admin-1",
  });

  const auditCall = calls.find((c) => c.method === "auditLog.create");
  assert(auditCall, "revokeTempPlanOverride must write an audit log.");
  const data = readRecord(readRecord(auditCall!.args, "args").data, "data");
  assert(data.action === "platform.subscription.temp_plan.revoke", "Audit action must be revoke.");

  const before = readRecord(data.before, "before");
  const after = readRecord(data.after, "after");
  assert(before.tempPlanOverride === "PRO", "Audit before must show PRO override.");
  assert(after.tempPlanOverride === null, "Audit after must show null override.");
}

async function verifyRevokeTempPlanOverrideRejectsBlankReason(): Promise<void> {
  const { prisma } = createMockOpsPrisma({
    plan: "FREE",
    tempPlanOverride: "PRO",
    tempPlanExpiresAt: new Date("2026-08-01"),
    tempPlanReason: "old",
  });
  const { error } = await expectError(
    () => revokeTempPlanOverride(prisma as unknown as PrismaClient, {
      organizationId: "org-1",
      reason: "",
      actorId: "admin-1",
    }),
    "revokeTempPlanOverride with empty reason must throw.",
  );
  assertErrorCode(error, "INVALID_INPUT", "revokeTempPlanOverride blank reason");
}

async function verifyRevokeTempPlanOverrideRejectsMissingSubscription(): Promise<void> {
  const { prisma } = createMockOpsPrisma(null);
  const { error } = await expectError(
    () => revokeTempPlanOverride(prisma as unknown as PrismaClient, {
      organizationId: "org-1",
      reason: "test",
      actorId: "admin-1",
    }),
    "revokeTempPlanOverride on missing subscription must throw.",
  );
  assertErrorCode(error, "SUBSCRIPTION_NOT_FOUND", "revokeTempPlanOverride missing subscription");
}

// ─── getTempPlanOverrideView tests ────────────────────────────

async function verifyGetTempPlanOverrideViewResolvesActiveOverride(): Promise<void> {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const { prisma } = createMockOpsPrisma({
    plan: "FREE",
    tempPlanOverride: "PRO",
    tempPlanExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
    tempPlanReason: "Trial",
  });

  const result = await getTempPlanOverrideView(prisma as unknown as PrismaClient, "org-1", now);
  assert(result !== null, "Must return a view for existing subscription.");
  assert(result!.basePlan === "FREE", "basePlan must be FREE.");
  assert(result!.effectivePlan === "PRO", "effectivePlan must resolve to PRO (override active).");
  assert(result!.overrideActive === true, "overrideActive must be true.");
}

async function verifyGetTempPlanOverrideViewResolvesExpiredOverride(): Promise<void> {
  const now = new Date("2026-08-15T12:00:00.000Z");
  const { prisma } = createMockOpsPrisma({
    plan: "FREE",
    tempPlanOverride: "PRO",
    tempPlanExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
    tempPlanReason: "Trial",
  });

  const result = await getTempPlanOverrideView(prisma as unknown as PrismaClient, "org-1", now);
  assert(result !== null, "Must return a view for existing subscription.");
  assert(result!.basePlan === "FREE", "basePlan must be FREE.");
  assert(result!.effectivePlan === "FREE", "effectivePlan must fall back to FREE (override expired).");
  assert(result!.overrideActive === false, "overrideActive must be false for expired override.");
  assert(result!.tempPlanOverride === "PRO", "tempPlanOverride still stored (not auto-cleared).");
}

async function verifyGetTempPlanOverrideViewResolvesNoOverride(): Promise<void> {
  const { prisma } = createMockOpsPrisma({
    plan: "PLUS",
    tempPlanOverride: null,
    tempPlanExpiresAt: null,
    tempPlanReason: null,
  });

  const result = await getTempPlanOverrideView(prisma as unknown as PrismaClient, "org-1");
  assert(result !== null, "Must return a view.");
  assert(result!.effectivePlan === "PLUS", "effectivePlan must be PLUS (no override).");
  assert(result!.overrideActive === false, "overrideActive must be false.");
}

async function verifyGetTempPlanOverrideViewReturnsNullForMissingSubscription(): Promise<void> {
  const { prisma } = createMockOpsPrisma(null);
  const result = await getTempPlanOverrideView(prisma as unknown as PrismaClient, "nonexistent");
  assert(result === null, "Must return null for missing subscription.");
}

// ─── Immutability test ────────────────────────────────────────

async function verifyNoUpdateOrDeleteMethodsOnNotes(): Promise<void> {
  const mod = await import("./repositories/platform-ops.js");
  const exportNames = Object.keys(mod);
  assert(!exportNames.includes("updatePlatformNote"), "Repository must NOT export updatePlatformNote (append-only).");
  assert(!exportNames.includes("deletePlatformNote"), "Repository must NOT export deletePlatformNote (append-only).");
  assert(!exportNames.includes("deletePlatformNoteMany"), "Repository must NOT export deletePlatformNoteMany (append-only).");
}
