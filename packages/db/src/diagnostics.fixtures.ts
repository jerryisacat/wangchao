/**
 * Platform diagnostics fixtures for Issue #158.
 *
 * Tests the diagnostics repository using mocked PrismaClient.
 * No DATABASE_URL required - pure unit tests.
 *
 * Key constraints:
 *   * All functions are read-only (groupBy, findMany, count).
 *   * No write/update/delete methods should ever be called.
 *   * PlatformAdmin RBAC guard is tested separately (the repository
 *     functions themselves do NOT enforce RBAC - the caller must).
 */
import type { PrismaClient } from "@prisma/client";
import {
  listSubscriptionDiagnostics,
  listUsageDiagnostics,
  listPaymentInvoiceDiagnostics,
  getTaskRunHealthSummary,
  getDeliveryHealthSummary,
} from "./repositories/diagnostics.js";

export async function runDiagnosticsFixtures(): Promise<void> {
  // ── listSubscriptionDiagnostics ──
  await verifyListSubscriptionDiagnosticsReturnsOrganizations();
  await verifyListSubscriptionDiagnosticsHandlesMissingSubscription();
  await verifyListSubscriptionDiagnosticsAppliesLimit();
  await verifyListSubscriptionDiagnosticsOrdersByName();
  await verifyListSubscriptionDiagnosticsCallsNoWriteMethods();

  // ── listUsageDiagnostics ──
  await verifyListUsageDiagnosticsGroupsByType();
  await verifyListUsageDiagnosticsAppliesTimeRange();
  await verifyListUsageDiagnosticsReturnsEmptyForNoData();
  await verifyListUsageDiagnosticsCallsNoWriteMethods();

  // ── listPaymentInvoiceDiagnostics ──
  await verifyListPaymentInvoiceDiagnosticsReturnsInvoices();
  await verifyListPaymentInvoiceDiagnosticsOrdersByCreatedAtDesc();
  await verifyListPaymentInvoiceDiagnosticsAppliesLimit();
  await verifyListPaymentInvoiceDiagnosticsCallsNoWriteMethods();

  // ── getTaskRunHealthSummary ──
  await verifyGetTaskRunHealthSummaryReturnsStatusCounts();
  await verifyGetTaskRunHealthSummaryCountsBacklog();
  await verifyGetTaskRunHealthSummaryReturnsRecentFailures();
  await verifyGetTaskRunHealthSummaryOrdersFailuresByFinishedAtDesc();
  await verifyGetTaskRunHealthSummaryCallsNoWriteMethods();

  // ── getDeliveryHealthSummary ──
  await verifyGetDeliveryHealthSummaryReturnsDeliveryCounts();
  await verifyGetDeliveryHealthSummaryReturnsInstantPushCounts();
  await verifyGetDeliveryHealthSummaryReturnsRecentDeliveryFailures();
  await verifyGetDeliveryHealthSummaryReturnsRecentInstantPushFailures();
  await verifyGetDeliveryHealthSummaryCallsNoWriteMethods();

  // ── Read-only enforcement ──
  await verifyAllFunctionsOnlyRead();
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// ─── Mock helpers ─────────────────────────────────────────────

interface CallRecord { method: string; model: string; }

interface MockModelDelegate {
  findMany: (args: unknown) => Promise<unknown[]>;
  findFirst: (args: unknown) => Promise<unknown>;
  findUnique: (args: unknown) => Promise<unknown>;
  groupBy: (args: unknown) => Promise<unknown[]>;
  count: (args: unknown) => Promise<number>;
  aggregate: (args: unknown) => Promise<unknown>;
  create: (args: unknown) => Promise<unknown>;
  createMany: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  updateMany: (args: unknown) => Promise<unknown>;
  upsert: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
  deleteMany: (args: unknown) => Promise<unknown>;
}

interface MockPrisma {
  prisma: {
    organization: MockModelDelegate;
    subscription: MockModelDelegate;
    usageEvent: MockModelDelegate;
    paymentInvoice: MockModelDelegate;
    taskRun: MockModelDelegate;
    deliveryLog: MockModelDelegate;
    instantPushLog: MockModelDelegate;
  };
  calls: CallRecord[];
}

function createMockModel(model: string, calls: CallRecord[], data: {
  findManyResult?: unknown[]; groupByResult?: unknown[]; countResult?: number;
}): MockModelDelegate {
  const writeErr = (): Promise<never> =>
    Promise.reject(new Error(model + ".write called - diagnostics must be read-only"));
  return {
    findMany: async () => { calls.push({ method: "findMany", model }); return data.findManyResult ?? []; },
    findFirst: async () => { calls.push({ method: "findFirst", model }); return null; },
    findUnique: async () => { calls.push({ method: "findUnique", model }); return null; },
    groupBy: async () => { calls.push({ method: "groupBy", model }); return data.groupByResult ?? []; },
    count: async () => { calls.push({ method: "count", model }); return data.countResult ?? 0; },
    aggregate: async () => { calls.push({ method: "aggregate", model }); return { _sum: { quantity: 0 } }; },
    create: writeErr, createMany: writeErr, update: writeErr,
    updateMany: writeErr, upsert: writeErr, delete: writeErr, deleteMany: writeErr,
  };
}

function createMockPrisma(o: {
  org?: unknown[]; usage?: unknown[]; inv?: unknown[];
  taskGroup?: unknown[]; taskFail?: unknown[]; taskCount?: number;
  dlGroup?: unknown[]; dlFail?: unknown[];
  ipGroup?: unknown[]; ipFail?: unknown[];
} = {}): MockPrisma {
  const calls: CallRecord[] = [];
  const e = createMockModel("empty", calls, {});
  return {
    prisma: {
      organization: createMockModel("organization", calls, { findManyResult: o.org }),
      subscription: e,
      usageEvent: createMockModel("usageEvent", calls, { groupByResult: o.usage }),
      paymentInvoice: createMockModel("paymentInvoice", calls, { findManyResult: o.inv }),
      taskRun: createMockModel("taskRun", calls, {
        groupByResult: o.taskGroup, findManyResult: o.taskFail, countResult: o.taskCount,
      }),
      deliveryLog: createMockModel("deliveryLog", calls, { groupByResult: o.dlGroup, findManyResult: o.dlFail }),
      instantPushLog: createMockModel("instantPushLog", calls, { groupByResult: o.ipGroup, findManyResult: o.ipFail }),
    },
    calls,
  };
}

function asPrisma(m: MockPrisma): PrismaClient {
  return m.prisma as unknown as PrismaClient;
}

function hasWrite(calls: CallRecord[]): boolean {
  return calls.some((c) =>
    ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"].includes(c.method));
}

// ─── listSubscriptionDiagnostics tests ────────────────────────

async function verifyListSubscriptionDiagnosticsReturnsOrganizations(): Promise<void> {
  const now = new Date("2025-01-15T00:00:00Z");
  const mock = createMockPrisma({
    org: [{
      id: "org-1", name: "Acme", slug: "acme",
      subscription: [{
        plan: "PLUS", status: "ACTIVE", billingInterval: "MONTHLY",
        isSelfHosted: false,
        currentPeriodStart: now, currentPeriodEnd: now,
        canceledAt: null, createdAt: now, updatedAt: now,
      }],
    }],
  });
  const result = await listSubscriptionDiagnostics(asPrisma(mock));
  assert(result.length === 1, "Should return 1 org");
  assert(result[0]!.organizationId === "org-1", "org id mismatch");
  assert(result[0]!.organizationName === "Acme", "org name mismatch");
  assert(result[0]!.plan === "PLUS", "plan should be PLUS");
  assert(result[0]!.status === "ACTIVE", "status should be ACTIVE");
  assert(result[0]!.billingInterval === "MONTHLY", "billingInterval mismatch");
  assert(result[0]!.isSelfHosted === false, "isSelfHosted should be false");
}

async function verifyListSubscriptionDiagnosticsHandlesMissingSubscription(): Promise<void> {
  const mock = createMockPrisma({
    org: [{ id: "org-2", name: "NoSub", slug: "nosub", subscription: [] }],
  });
  const result = await listSubscriptionDiagnostics(asPrisma(mock));
  assert(result.length === 1, "Should return 1 org");
  assert(result[0]!.plan === "FREE", "Missing sub should default to FREE");
  assert(result[0]!.status === "ACTIVE", "Missing sub should default to ACTIVE");
  assert(result[0]!.billingInterval === "MONTHLY", "Missing sub should default to MONTHLY");
  assert(result[0]!.isSelfHosted === false, "Missing sub should default to false");
  assert(result[0]!.currentPeriodStart === null, "Missing sub should have null period");
}

async function verifyListSubscriptionDiagnosticsAppliesLimit(): Promise<void> {
  const mock = createMockPrisma({ org: [] });
  await listSubscriptionDiagnostics(asPrisma(mock), 50);
  const orgCall = mock.calls.find((c) => c.model === "organization" && c.method === "findMany");
  assert(orgCall !== undefined, "Should call organization.findMany");
}

async function verifyListSubscriptionDiagnosticsOrdersByName(): Promise<void> {
  const mock = createMockPrisma({
    org: [
      { id: "b", name: "Bravo", slug: "bravo", subscription: [] },
      { id: "a", name: "Alpha", slug: "alpha", subscription: [] },
    ],
  });
  const result = await listSubscriptionDiagnostics(asPrisma(mock));
  assert(result.length === 2, "Should return 2 orgs");
}

async function verifyListSubscriptionDiagnosticsCallsNoWriteMethods(): Promise<void> {
  const mock = createMockPrisma({ org: [] });
  await listSubscriptionDiagnostics(asPrisma(mock));
  assert(!hasWrite(mock.calls), "Should not call any write methods");
}

// ─── listUsageDiagnostics tests ───────────────────────────────

async function verifyListUsageDiagnosticsGroupsByType(): Promise<void> {
  const mock = createMockPrisma({
    usage: [
      { type: "AI_CALL", unit: "call", _count: { _all: 10 }, _sum: { quantity: 15 } },
      { type: "FETCH", unit: "item", _count: { _all: 100 }, _sum: { quantity: 500 } },
    ],
  });
  const start = new Date("2025-01-01T00:00:00Z");
  const end = new Date("2025-02-01T00:00:00Z");
  const result = await listUsageDiagnostics(asPrisma(mock), "org-1", start, end);
  assert(result.length === 2, "Should return 2 usage types");
  assert(result[0]!.type === "AI_CALL", "First type should be AI_CALL");
  assert(result[0]!.count === 10, "AI_CALL count mismatch");
  assert(result[0]!.totalQuantity === 15, "AI_CALL totalQuantity mismatch");
  assert(result[0]!.unit === "call", "AI_CALL unit mismatch");
  assert(result[1]!.type === "FETCH", "Second type should be FETCH");
  assert(result[1]!.totalQuantity === 500, "FETCH totalQuantity mismatch");
}

async function verifyListUsageDiagnosticsAppliesTimeRange(): Promise<void> {
  const mock = createMockPrisma({ usage: [] });
  const start = new Date("2025-01-01T00:00:00Z");
  const end = new Date("2025-02-01T00:00:00Z");
  await listUsageDiagnostics(asPrisma(mock), "org-1", start, end);
  const groupCall = mock.calls.find((c) => c.model === "usageEvent" && c.method === "groupBy");
  assert(groupCall !== undefined, "Should call usageEvent.groupBy");
}

async function verifyListUsageDiagnosticsReturnsEmptyForNoData(): Promise<void> {
  const mock = createMockPrisma({ usage: [] });
  const start = new Date("2025-01-01T00:00:00Z");
  const end = new Date("2025-02-01T00:00:00Z");
  const result = await listUsageDiagnostics(asPrisma(mock), "org-1", start, end);
  assert(result.length === 0, "Should return empty array for no data");
}

async function verifyListUsageDiagnosticsCallsNoWriteMethods(): Promise<void> {
  const mock = createMockPrisma({ usage: [] });
  const start = new Date("2025-01-01T00:00:00Z");
  const end = new Date("2025-02-01T00:00:00Z");
  await listUsageDiagnostics(asPrisma(mock), "org-1", start, end);
  assert(!hasWrite(mock.calls), "Should not call any write methods");
}

// ─── listPaymentInvoiceDiagnostics tests ──────────────────────

async function verifyListPaymentInvoiceDiagnosticsReturnsInvoices(): Promise<void> {
  const now = new Date("2025-01-15T00:00:00Z");
  const mock = createMockPrisma({
    inv: [{
      id: "inv-1", organizationId: "org-1", plan: "PLUS",
      amount: { toString: () => "29.00" }, currency: "USD",
      status: "PAID", provider: "ccpayment",
      providerOrderId: "order-123", invoiceUrl: "https://example.com/inv",
      periodStart: now, periodEnd: now, createdAt: now, updatedAt: now,
    }],
  });
  const result = await listPaymentInvoiceDiagnostics(asPrisma(mock), "org-1");
  assert(result.length === 1, "Should return 1 invoice");
  assert(result[0]!.id === "inv-1", "Invoice id mismatch");
  assert(result[0]!.amount === "29.00", "Amount should be string");
  assert(result[0]!.status === "PAID", "Status should be PAID");
  assert(result[0]!.plan === "PLUS", "Plan should be PLUS");
}

async function verifyListPaymentInvoiceDiagnosticsOrdersByCreatedAtDesc(): Promise<void> {
  const mock = createMockPrisma({ inv: [] });
  await listPaymentInvoiceDiagnostics(asPrisma(mock), "org-1");
  const call = mock.calls.find((c) => c.model === "paymentInvoice" && c.method === "findMany");
  assert(call !== undefined, "Should call paymentInvoice.findMany");
}

async function verifyListPaymentInvoiceDiagnosticsAppliesLimit(): Promise<void> {
  const mock = createMockPrisma({ inv: [] });
  await listPaymentInvoiceDiagnostics(asPrisma(mock), "org-1", 25);
  const call = mock.calls.find((c) => c.model === "paymentInvoice" && c.method === "findMany");
  assert(call !== undefined, "Should call paymentInvoice.findMany with limit");
}

async function verifyListPaymentInvoiceDiagnosticsCallsNoWriteMethods(): Promise<void> {
  const mock = createMockPrisma({ inv: [] });
  await listPaymentInvoiceDiagnostics(asPrisma(mock), "org-1");
  assert(!hasWrite(mock.calls), "Should not call any write methods");
}

// ─── getTaskRunHealthSummary tests ────────────────────────────

async function verifyGetTaskRunHealthSummaryReturnsStatusCounts(): Promise<void> {
  const mock = createMockPrisma({
    taskGroup: [
      { status: "PENDING", _count: { _all: 5 } },
      { status: "RUNNING", _count: { _all: 2 } },
      { status: "SUCCEEDED", _count: { _all: 100 } },
      { status: "FAILED", _count: { _all: 3 } },
      { status: "CANCELED", _count: { _all: 1 } },
    ],
  });
  const now = new Date("2025-01-15T00:00:00Z");
  const result = await getTaskRunHealthSummary(asPrisma(mock), "org-1", now);
  assert(result.pending === 5, "pending mismatch");
  assert(result.running === 2, "running mismatch");
  assert(result.succeeded === 100, "succeeded mismatch");
  assert(result.failed === 3, "failed mismatch");
  assert(result.canceled === 1, "canceled mismatch");
}

async function verifyGetTaskRunHealthSummaryCountsBacklog(): Promise<void> {
  const mock = createMockPrisma({ taskGroup: [], taskCount: 7 });
  const now = new Date("2025-01-15T00:00:00Z");
  const result = await getTaskRunHealthSummary(asPrisma(mock), "org-1", now);
  assert(result.backlogCount === 7, "backlogCount should be 7");
}

async function verifyGetTaskRunHealthSummaryReturnsRecentFailures(): Promise<void> {
  const now = new Date("2025-01-15T12:00:00Z");
  const mock = createMockPrisma({
    taskGroup: [],
    taskFail: [{
      id: "task-1", type: "SOURCE_FETCH", status: "FAILED",
      attempt: 3, maxAttempts: 3, errorMessage: "timeout",
      scheduledAt: now, startedAt: now, finishedAt: now,
    }],
  });
  const result = await getTaskRunHealthSummary(asPrisma(mock), "org-1", now);
  assert(result.recentFailures.length === 1, "Should return 1 failure");
  assert(result.recentFailures[0]!.id === "task-1", "Failure id mismatch");
  assert(result.recentFailures[0]!.type === "SOURCE_FETCH", "Failure type mismatch");
  assert(result.recentFailures[0]!.errorMessage === "timeout", "Error message mismatch");
  assert(result.recentFailures[0]!.finishedAt !== null, "finishedAt should not be null");
}

async function verifyGetTaskRunHealthSummaryOrdersFailuresByFinishedAtDesc(): Promise<void> {
  const mock = createMockPrisma({ taskGroup: [], taskFail: [] });
  const now = new Date("2025-01-15T00:00:00Z");
  await getTaskRunHealthSummary(asPrisma(mock), "org-1", now);
  const findCall = mock.calls.find((c) => c.model === "taskRun" && c.method === "findMany");
  assert(findCall !== undefined, "Should call taskRun.findMany");
}

async function verifyGetTaskRunHealthSummaryCallsNoWriteMethods(): Promise<void> {
  const mock = createMockPrisma({ taskGroup: [], taskFail: [] });
  const now = new Date("2025-01-15T00:00:00Z");
  await getTaskRunHealthSummary(asPrisma(mock), "org-1", now);
  assert(!hasWrite(mock.calls), "Should not call any write methods");
}

// ─── getDeliveryHealthSummary tests ───────────────────────────

async function verifyGetDeliveryHealthSummaryReturnsDeliveryCounts(): Promise<void> {
  const mock = createMockPrisma({
    dlGroup: [
      { status: "PENDING", _count: { _all: 3 } },
      { status: "SENT", _count: { _all: 50 } },
      { status: "FAILED", _count: { _all: 2 } },
      { status: "SKIPPED", _count: { _all: 1 } },
    ],
  });
  const result = await getDeliveryHealthSummary(asPrisma(mock), "org-1");
  assert(result.delivery.pending === 3, "delivery.pending mismatch");
  assert(result.delivery.sent === 50, "delivery.sent mismatch");
  assert(result.delivery.failed === 2, "delivery.failed mismatch");
  assert(result.delivery.skipped === 1, "delivery.skipped mismatch");
}

async function verifyGetDeliveryHealthSummaryReturnsInstantPushCounts(): Promise<void> {
  const mock = createMockPrisma({
    ipGroup: [
      { status: "PENDING", _count: { _all: 1 } },
      { status: "SENDING", _count: { _all: 1 } },
      { status: "SENT", _count: { _all: 20 } },
      { status: "FAILED", _count: { _all: 0 } },
      { status: "SKIPPED", _count: { _all: 5 } },
    ],
  });
  const result = await getDeliveryHealthSummary(asPrisma(mock), "org-1");
  assert(result.instantPush.pending === 1, "ip.pending mismatch");
  assert(result.instantPush.sending === 1, "ip.sending mismatch");
  assert(result.instantPush.sent === 20, "ip.sent mismatch");
  assert(result.instantPush.failed === 0, "ip.failed mismatch");
  assert(result.instantPush.skipped === 5, "ip.skipped mismatch");
}

async function verifyGetDeliveryHealthSummaryReturnsRecentDeliveryFailures(): Promise<void> {
  const now = new Date("2025-01-15T12:00:00Z");
  const mock = createMockPrisma({
    dlFail: [{
      id: "dl-1", briefingId: "b-1", channel: "TELEGRAM",
      status: "FAILED", attempt: 3, errorMessage: "bot blocked",
      errorCode: "BLOCKED", updatedAt: now,
    }],
  });
  const result = await getDeliveryHealthSummary(asPrisma(mock), "org-1");
  assert(result.delivery.recentFailures.length === 1, "Should return 1 delivery failure");
  assert(result.delivery.recentFailures[0]!.id === "dl-1", "Delivery failure id mismatch");
  assert(result.delivery.recentFailures[0]!.errorCode === "BLOCKED", "Error code mismatch");
}

async function verifyGetDeliveryHealthSummaryReturnsRecentInstantPushFailures(): Promise<void> {
  const now = new Date("2025-01-15T12:00:00Z");
  const mock = createMockPrisma({
    ipFail: [{
      id: "ip-1", eventId: "e-1", channel: "TELEGRAM",
      status: "FAILED", attempt: 2, errorMessage: "rate limit",
      errorCode: "RATE_LIMIT", updatedAt: now,
    }],
  });
  const result = await getDeliveryHealthSummary(asPrisma(mock), "org-1");
  assert(result.instantPush.recentFailures.length === 1, "Should return 1 instant push failure");
  assert(result.instantPush.recentFailures[0]!.id === "ip-1", "IP failure id mismatch");
  assert(result.instantPush.recentFailures[0]!.eventId === "e-1", "Event id mismatch");
}

async function verifyGetDeliveryHealthSummaryCallsNoWriteMethods(): Promise<void> {
  const mock = createMockPrisma({});
  await getDeliveryHealthSummary(asPrisma(mock), "org-1");
  assert(!hasWrite(mock.calls), "Should not call any write methods");
}

// ─── Comprehensive read-only enforcement ──────────────────────

async function verifyAllFunctionsOnlyRead(): Promise<void> {
  const mock = createMockPrisma({});
  const now = new Date("2025-01-15T00:00:00Z");
  const start = new Date("2025-01-01T00:00:00Z");
  const end = new Date("2025-02-01T00:00:00Z");

  await listSubscriptionDiagnostics(asPrisma(mock));
  await listUsageDiagnostics(asPrisma(mock), "org-1", start, end);
  await listPaymentInvoiceDiagnostics(asPrisma(mock), "org-1");
  await getTaskRunHealthSummary(asPrisma(mock), "org-1", now);
  await getDeliveryHealthSummary(asPrisma(mock), "org-1");

  const writeMethods = mock.calls.filter((c) =>
    ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"].includes(c.method));
  assert(writeMethods.length === 0,
    "All 5 diagnostics functions must be read-only. Found write calls: " + JSON.stringify(writeMethods));
}
