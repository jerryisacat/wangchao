import type { PrismaClient } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────

export interface SubscriptionDiagnosticsRecord {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  plan: "FREE" | "PLUS" | "PRO";
  status: "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
  billingInterval: "MONTHLY" | "YEARLY";
  isSelfHosted: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageDiagnosticsRecord {
  type: string;
  count: number;
  totalQuantity: number;
  unit: string;
}

export interface PaymentInvoiceDiagnosticsRecord {
  id: string;
  organizationId: string;
  plan: "FREE" | "PLUS" | "PRO";
  amount: string;
  currency: string;
  status: string;
  provider: string;
  providerOrderId: string | null;
  invoiceUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRunFailureRecord {
  id: string;
  type: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  errorMessage: string | null;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TaskRunHealthSummary {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  canceled: number;
  backlogCount: number;
  recentFailures: TaskRunFailureRecord[];
}

export interface DeliveryFailureRecord {
  id: string;
  briefingId: string;
  channel: string;
  status: string;
  attempt: number;
  errorMessage: string | null;
  errorCode: string | null;
  updatedAt: string;
}

export interface InstantPushFailureRecord {
  id: string;
  eventId: string;
  channel: string;
  status: string;
  attempt: number;
  errorMessage: string | null;
  errorCode: string | null;
  updatedAt: string;
}

export interface DeliveryHealthSummary {
  delivery: {
    pending: number;
    sent: number;
    failed: number;
    skipped: number;
    recentFailures: DeliveryFailureRecord[];
  };
  instantPush: {
    pending: number;
    sending: number;
    sent: number;
    failed: number;
    skipped: number;
    recentFailures: InstantPushFailureRecord[];
  };
}

// ─── Repository functions (all read-only) ─────────────────────

export async function listSubscriptionDiagnostics(
  prisma: PrismaClient,
  limit: number = 200,
): Promise<SubscriptionDiagnosticsRecord[]> {
  const rows = await prisma.organization.findMany({
    take: limit,
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, slug: true,
      subscription: {
        select: {
          plan: true, status: true, billingInterval: true, isSelfHosted: true,
          currentPeriodStart: true, currentPeriodEnd: true, canceledAt: true,
          createdAt: true, updatedAt: true,
        },
      },
    },
  });
  return rows.map(toSubscriptionDiagnostics);
}

export async function listUsageDiagnostics(
  prisma: PrismaClient,
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<UsageDiagnosticsRecord[]> {
  const groups = await prisma.usageEvent.groupBy({
    by: ["type", "unit"],
    where: { organizationId, createdAt: { gte: rangeStart, lt: rangeEnd } },
    _count: { _all: true },
    _sum: { quantity: true },
    orderBy: { type: "asc" },
  });
  return groups.map((g) => ({
    type: g.type, count: g._count._all,
    totalQuantity: g._sum.quantity ?? 0, unit: g.unit,
  }));
}

export async function listPaymentInvoiceDiagnostics(
  prisma: PrismaClient,
  organizationId: string,
  limit: number = 50,
): Promise<PaymentInvoiceDiagnosticsRecord[]> {
  const rows = await prisma.paymentInvoice.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toPaymentInvoiceDiagnostics);
}

export async function getTaskRunHealthSummary(
  prisma: PrismaClient,
  organizationId: string,
  now: Date = new Date(),
  failureLimit: number = 20,
): Promise<TaskRunHealthSummary> {
  const statusCounts = await prisma.taskRun.groupBy({
    by: ["status"],
    where: { organizationId },
    _count: { _all: true },
  });

  const statusMap = new Map<string, number>();
  for (const g of statusCounts) {
    statusMap.set(g.status, g._count._all);
  }

  const backlogCount = await prisma.taskRun.count({
    where: {
      organizationId,
      status: "PENDING",
      scheduledAt: { lt: now },
    },
  });

  const recentFailures = await prisma.taskRun.findMany({
    where: { organizationId, status: "FAILED" },
    orderBy: { finishedAt: "desc" },
    take: failureLimit,
    select: {
      id: true, type: true, status: true, attempt: true, maxAttempts: true,
      errorMessage: true, scheduledAt: true, startedAt: true, finishedAt: true,
    },
  });

  return {
    pending: statusMap.get("PENDING") ?? 0,
    running: statusMap.get("RUNNING") ?? 0,
    succeeded: statusMap.get("SUCCEEDED") ?? 0,
    failed: statusMap.get("FAILED") ?? 0,
    canceled: statusMap.get("CANCELED") ?? 0,
    backlogCount,
    recentFailures: recentFailures.map((r) => ({
      id: r.id, type: r.type, status: r.status, attempt: r.attempt,
      maxAttempts: r.maxAttempts, errorMessage: r.errorMessage,
      scheduledAt: r.scheduledAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  };
}

export async function getDeliveryHealthSummary(
  prisma: PrismaClient,
  organizationId: string,
  failureLimit: number = 20,
): Promise<DeliveryHealthSummary> {
  const [dlGroups, ipGroups, dlFailures, ipFailures] = await Promise.all([
    prisma.deliveryLog.groupBy({
      by: ["status"], where: { organizationId }, _count: { _all: true },
    }),
    prisma.instantPushLog.groupBy({
      by: ["status"], where: { organizationId }, _count: { _all: true },
    }),
    prisma.deliveryLog.findMany({
      where: { organizationId, status: "FAILED" },
      orderBy: { updatedAt: "desc" }, take: failureLimit,
      select: {
        id: true, briefingId: true, channel: true, status: true,
        attempt: true, errorMessage: true, errorCode: true, updatedAt: true,
      },
    }),
    prisma.instantPushLog.findMany({
      where: { organizationId, status: "FAILED" },
      orderBy: { updatedAt: "desc" }, take: failureLimit,
      select: {
        id: true, eventId: true, channel: true, status: true,
        attempt: true, errorMessage: true, errorCode: true, updatedAt: true,
      },
    }),
  ]);

  const dlMap = new Map<string, number>();
  for (const g of dlGroups) dlMap.set(g.status, g._count._all);

  const ipMap = new Map<string, number>();
  for (const g of ipGroups) ipMap.set(g.status, g._count._all);

  return {
    delivery: {
      pending: dlMap.get("PENDING") ?? 0,
      sent: dlMap.get("SENT") ?? 0,
      failed: dlMap.get("FAILED") ?? 0,
      skipped: dlMap.get("SKIPPED") ?? 0,
      recentFailures: dlFailures.map((r) => ({
        id: r.id, briefingId: r.briefingId, channel: r.channel,
        status: r.status, attempt: r.attempt, errorMessage: r.errorMessage,
        errorCode: r.errorCode, updatedAt: r.updatedAt.toISOString(),
      })),
    },
    instantPush: {
      pending: ipMap.get("PENDING") ?? 0,
      sending: ipMap.get("SENDING") ?? 0,
      sent: ipMap.get("SENT") ?? 0,
      failed: ipMap.get("FAILED") ?? 0,
      skipped: ipMap.get("SKIPPED") ?? 0,
      recentFailures: ipFailures.map((r) => ({
        id: r.id, eventId: r.eventId, channel: r.channel,
        status: r.status, attempt: r.attempt, errorMessage: r.errorMessage,
        errorCode: r.errorCode, updatedAt: r.updatedAt.toISOString(),
      })),
    },
  };
}

// ─── Internal helpers ─────────────────────────────────────────

function toSubscriptionDiagnostics(row: {
  id: string; name: string; slug: string;
  subscription: Array<{
    plan: "FREE" | "PLUS" | "PRO";
    status: "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
    billingInterval: "MONTHLY" | "YEARLY";
    isSelfHosted: boolean;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    canceledAt: Date | null;
    createdAt: Date; updatedAt: Date;
  }>;
}): SubscriptionDiagnosticsRecord {
  const sub = row.subscription[0] ?? null;
  return {
    organizationId: row.id,
    organizationName: row.name,
    organizationSlug: row.slug,
    plan: sub?.plan ?? "FREE",
    status: sub?.status ?? "ACTIVE",
    billingInterval: sub?.billingInterval ?? "MONTHLY",
    isSelfHosted: sub?.isSelfHosted ?? false,
    currentPeriodStart: sub?.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    canceledAt: sub?.canceledAt?.toISOString() ?? null,
    createdAt: sub?.createdAt.toISOString() ?? new Date(0).toISOString(),
    updatedAt: sub?.updatedAt.toISOString() ?? new Date(0).toISOString(),
  };
}

function toPaymentInvoiceDiagnostics(row: {
  id: string; organizationId: string;
  plan: "FREE" | "PLUS" | "PRO";
  amount: { toString(): string } | number;
  currency: string; status: string; provider: string;
  providerOrderId: string | null; invoiceUrl: string | null;
  periodStart: Date | null; periodEnd: Date | null;
  createdAt: Date; updatedAt: Date;
}): PaymentInvoiceDiagnosticsRecord {
  return {
    id: row.id, organizationId: row.organizationId, plan: row.plan,
    amount: row.amount.toString(),
    currency: row.currency, status: row.status, provider: row.provider,
    providerOrderId: row.providerOrderId, invoiceUrl: row.invoiceUrl,
    periodStart: row.periodStart?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
