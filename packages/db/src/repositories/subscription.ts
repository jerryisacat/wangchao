import type { PrismaClient } from "@prisma/client";
import type { TenantScope } from "./types.js";

export interface SubscriptionPlanView {
  plan: "FREE" | "PLUS" | "PRO";
  status: "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED" | null;
  isSelfHosted: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export async function getSubscriptionPlanView(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<SubscriptionPlanView> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: {
      plan: true,
      status: true,
      isSelfHosted: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
    },
  });

  if (!subscription) {
    return {
      plan: "FREE",
      status: null,
      isSelfHosted: false,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };
  }

  return {
    plan: subscription.plan,
    status: subscription.status,
    isSelfHosted: subscription.isSelfHosted,
    currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
  };
}

export async function updateSubscriptionPlan(
  prisma: PrismaClient,
  scope: TenantScope,
  plan: "FREE" | "PLUS" | "PRO",
  periodStart?: Date | null,
  periodEnd?: Date | null,
): Promise<void> {
  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      plan,
      currentPeriodStart: periodStart ?? undefined,
      currentPeriodEnd: periodEnd ?? undefined,
    },
    create: {
      organizationId: scope.organizationId,
      plan,
      currentPeriodStart: periodStart ?? null,
      currentPeriodEnd: periodEnd ?? null,
    },
  });
}

export async function setSelfHostedMode(
  prisma: PrismaClient,
  scope: TenantScope,
  enabled: boolean,
): Promise<{ previousValue: boolean | null; newValue: boolean }> {
  const existing = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: { isSelfHosted: true },
  });

  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: { isSelfHosted: enabled },
    create: { organizationId: scope.organizationId, isSelfHosted: enabled },
  });

  return { previousValue: existing?.isSelfHosted ?? null, newValue: enabled };
}

export async function getTodayAiCallCount(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<number> {
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const result = await prisma.usageEvent.aggregate({
    where: {
      organizationId: scope.organizationId,
      type: "AI_CALL",
      createdAt: { gte: startOfToday },
    },
    _sum: { quantity: true },
  });

  return result._sum.quantity ?? 0;
}

export async function getMonthAiCallCount(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  const result = await prisma.usageEvent.aggregate({
    where: {
      organizationId: scope.organizationId,
      type: "AI_CALL",
      createdAt: { gte: startOfMonth },
    },
    _sum: { quantity: true },
  });

  return result._sum.quantity ?? 0;
}

export async function getMonthExportCount(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  return prisma.exportEvent.count({
    where: {
      organizationId: scope.organizationId,
      createdAt: { gte: startOfMonth },
    },
  });
}

export async function getTopicCount(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<number> {
  return prisma.topic.count({
    where: {
      organizationId: scope.organizationId,
      status: { not: "ARCHIVED" },
    },
  });
}

export async function getActiveSourceCount(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<number> {
  return prisma.source.count({
    where: {
      organizationId: scope.organizationId,
      status: "ACTIVE",
    },
  });
}
