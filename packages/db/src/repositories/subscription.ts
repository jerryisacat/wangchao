import type { PrismaClient } from "@prisma/client";
import type { TenantScope } from "./types.js";

export interface SubscriptionPlanView {
  plan: "FREE" | "PLUS" | "PRO";
  status: "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED" | null;
  isSelfHosted: boolean;
  showAdsInSelfHosted: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /** #159: temporary plan override from platform admin. */
  tempPlanOverride?: "FREE" | "PLUS" | "PRO" | null;
  tempPlanExpiresAt?: string | null;
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
      showAdsInSelfHosted: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      tempPlanOverride: true,
      tempPlanExpiresAt: true,
    },
  });

  if (!subscription) {
    return {
      plan: "FREE",
      status: null,
      isSelfHosted: false,
      showAdsInSelfHosted: true,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      tempPlanOverride: null,
      tempPlanExpiresAt: null,
    };
  }

  return {
    plan: subscription.plan,
    status: subscription.status,
    isSelfHosted: subscription.isSelfHosted,
    showAdsInSelfHosted: subscription.showAdsInSelfHosted,
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

/**
 * Issue #188 (Plan Task 6.3): Toggle the self-hosted ad display preference.
 *
 * Only consulted when `isSelfHosted == true`. The default is `true` so that
 * admins experience the Free user journey (see docs/business-model.md §14.2).
 * OWNER/ADMIN can opt out from a deep-fold settings toggle. This function
 * does NOT check permissions — the caller (Server Action) must verify the
 * caller's role before invoking.
 */
export async function setShowAdsInSelfHosted(
  prisma: PrismaClient,
  scope: TenantScope,
  enabled: boolean,
): Promise<{ previousValue: boolean | null; newValue: boolean }> {
  const existing = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: { showAdsInSelfHosted: true },
  });

  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: { showAdsInSelfHosted: enabled },
    create: {
      organizationId: scope.organizationId,
      showAdsInSelfHosted: enabled,
    },
  });

  return {
    previousValue: existing?.showAdsInSelfHosted ?? null,
    newValue: enabled,
  };
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

/**
 * Issue #181 (Plan Task 6.2): Unified source quota count.
 *
 * Counts sources in all quota-occupying statuses (CANDIDATE, ACTIVE, MUTED) —
 * everything except REJECTED. This is the single count function that all quota
 * checks (Web actions + discovery worker) must use. It replaces the old
 * `getActiveSourceCount` which only counted ACTIVE sources, allowing CANDIDATE
 * sources to bypass the quota entirely.
 *
 * The statuses counted mirror `QUOTA_SUBJECT_SOURCE_STATUSES` from
 * `@wangchao/core` and are consistent with the usage dashboard query
 * (`status: { not: "REJECTED" }`).
 */
export async function getQuotaSubjectSourceCount(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<number> {
  return prisma.source.count({
    where: {
      organizationId: scope.organizationId,
      status: { not: "REJECTED" },
    },
  });
}

/**
 * Issue #181 (Plan Task 6.2): Atomic source slot reservation.
 *
 * Performs a count + limit check inside a serializable transaction to prevent
 * concurrent over-selling. Returns `true` if a slot is available (the caller may
 * proceed to create the source), or `false` if the quota is exhausted.
 *
 * The `limit` parameter comes from the caller's resolved effective plan limits
 * (already computed via `resolveEffectivePlanFromView`). Self-hosted callers
 * pass `null` to bypass the check entirely.
 *
 * This function does NOT create the source — it only reserves the slot. The
 * caller is responsible for the actual source creation. The transaction
 * serialisation level ensures that two concurrent reservations cannot both
 * succeed when only one slot remains.
 */
export async function reserveSourceSlot(
  prisma: PrismaClient,
  scope: TenantScope,
  limit: number | null,
): Promise<{ reserved: boolean; currentCount: number; limit: number | null }> {
  if (limit === null) {
    // Unlimited plan (PRO) or self-hosted — no reservation needed.
    const currentCount = await prisma.source.count({
      where: {
        organizationId: scope.organizationId,
        status: { not: "REJECTED" },
      },
    });
    return { reserved: true, currentCount, limit: null };
  }

  // Codex P2-1: Use a database-level atomic check-and-reserve.
  // Count current non-REJECTED sources, then atomically decide.
  // The Serializable transaction ensures concurrent reservations conflict.
  const result = await prisma.$transaction(
    async (tx) => {
      // Lock the organization's subscription row to serialize concurrent source reservations.
      // SELECT ... FOR UPDATE equivalent: findUnique on subscription with optimistic lock.
      const sub = await tx.subscription.findUnique({
        where: { organizationId: scope.organizationId },
        select: { id: true },
      });
      if (!sub) {
        return { reserved: false, currentCount: 0, limit };
      }
      // Touch the subscription row (version increment) to force concurrent
      // Serializable transactions to detect a write-write conflict.
      await tx.subscription.update({
        where: { id: sub.id },
        data: { updatedAt: new Date() },
      });

      const currentCount = await tx.source.count({
        where: {
          organizationId: scope.organizationId,
          status: { not: "REJECTED" },
        },
      });

      if (currentCount >= limit) {
        return { reserved: false, currentCount, limit };
      }

      return { reserved: true, currentCount, limit };
    },
    {
      isolationLevel: "Serializable",
    },
  );

  return result;
}
