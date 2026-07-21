import { PLAN_REGISTRY } from "./pricing.js";
import type { Plan, PlanLimits } from "./pricing.js";

export type { Plan } from "./pricing.js";
export type { PlanLimits } from "./pricing.js";

const limitsFor = (plan: Plan): PlanLimits => {
  const limits = PLAN_LIMITS[plan];
  if (!limits) throw new Error(`Unknown plan: ${String(plan)}`);
  return limits;
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: PLAN_REGISTRY.FREE.limits,
  PLUS: PLAN_REGISTRY.PLUS.limits,
  PRO: PLAN_REGISTRY.PRO.limits,
};

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  upgradeHint?: string;
  currentUsage?: number;
  limit?: number | null;
}

export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";

export function resolveEffectivePlan(input: {
  plan: Plan;
  status: SubscriptionStatus;
  isSelfHosted: boolean;
  currentPeriodEnd?: string | Date | null;
  /** #159: temporary plan override from platform admin (highest priority). */
  tempPlanOverride?: Plan | null;
  tempPlanExpiresAt?: string | Date | null;
  now?: Date;
}): Plan {
  // #159: temp plan override takes highest priority (platform admin grant).
  if (input.tempPlanOverride) {
    const now = input.now ?? new Date();
    if (!input.tempPlanExpiresAt || new Date(input.tempPlanExpiresAt).getTime() > now.getTime()) {
      return input.tempPlanOverride;
    }
  }
  if (input.isSelfHosted) return input.plan;
  if (input.status === "EXPIRED") return "FREE";
  if (input.status !== "CANCELED") return input.plan;
  if (!input.currentPeriodEnd) return "FREE";
  const periodEnd = new Date(input.currentPeriodEnd);
  if (!Number.isFinite(periodEnd.getTime())) return "FREE";
  return periodEnd.getTime() > (input.now ?? new Date()).getTime()
    ? input.plan
    : "FREE";
}

/**
 * Issue #180 (Plan Task 6.1): Unified entitlement context for all Web/Worker
 * quota checks.
 *
 * Accepts a shape compatible with `SubscriptionPlanView` (as returned by
 * `getSubscriptionPlanView` from `@wangchao/db`), where `status` is nullable
 * (null when no subscription record exists). Normalises null → "ACTIVE" and
 * delegates to `resolveEffectivePlan`.
 *
 * Every Web/Worker entry point that performs a quota check must call this
 * function — never pass the raw stored `plan` directly to a `check*Quota`
 * function.
 */
export function resolveEffectivePlanFromView(
  view: {
    plan: Plan;
    status: SubscriptionStatus | null;
    isSelfHosted: boolean;
    currentPeriodEnd?: string | Date | null;
    tempPlanOverride?: Plan | null;
    tempPlanExpiresAt?: string | Date | null;
  },
  now?: Date,
): Plan {
  return resolveEffectivePlan({
    plan: view.plan,
    status: view.status ?? "ACTIVE",
    isSelfHosted: view.isSelfHosted,
    currentPeriodEnd: view.currentPeriodEnd,
    tempPlanOverride: view.tempPlanOverride,
    tempPlanExpiresAt: view.tempPlanExpiresAt,
    now,
  });
}

/**
 * Issue #188 (Plan Task 6.3): Server-derived ad display policy.
 *
 * Implements docs/business-model.md §14.3 `shouldShowAds`:
 *
 * 1. If isSelfHosted == true -> return showAdsInSelfHosted (default true).
 *    Admins see ads by default to experience the Free user journey.
 *    OWNER/ADMIN can opt out from a deep-fold settings toggle.
 * 2. Otherwise derive the effective plan (stored plan + status) and show ads
 *    only when the effective plan is FREE. PLUS / PRO / EXPIRED-paid -> FREE
 *    degradation still shows ads because degraded == FREE.
 *
 * The function accepts a SubscriptionPlanView-compatible shape so that Web
 * layout / Server Actions can call it after a single DB read without a
 * second query. It is pure (no I/O) so it composes with the existing
 * resolveEffectivePlanFromView pipeline.
 */
export function shouldShowAds(view: {
  plan: Plan;
  status: SubscriptionStatus | null;
  isSelfHosted: boolean;
  showAdsInSelfHosted?: boolean;
  currentPeriodEnd?: string | Date | null;
  now?: Date;
}): boolean {
  if (view.isSelfHosted) {
    return view.showAdsInSelfHosted ?? true;
  }
  const effectivePlan = resolveEffectivePlanFromView(view, view.now);
  return effectivePlan === "FREE";
}

export function checkInstantPushQuota(
  plan: Plan,
  isSelfHosted: boolean,
): QuotaCheckResult {
  if (isSelfHosted || limitsFor(plan).allowsInstantPush) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "Instant push is available on Plus and Pro plans.",
    upgradeHint: PRICING_HINT,
  };
}

const PRICING_HINT = "Visit /pricing to upgrade your plan.";

export function checkTopicQuota(
  plan: Plan,
  currentTopicCount: number,
  isSelfHosted: boolean,
): QuotaCheckResult {
  if (isSelfHosted) {
    return { allowed: true };
  }

  const limits = limitsFor(plan);
  if (limits.maxTopics === null) {
    return { allowed: true, limit: null, currentUsage: currentTopicCount };
  }

  if (currentTopicCount >= limits.maxTopics) {
    return {
      allowed: false,
      reason: `Topic limit reached (${currentTopicCount}/${limits.maxTopics}).`,
      upgradeHint: PRICING_HINT,
      currentUsage: currentTopicCount,
      limit: limits.maxTopics,
    };
  }

  return {
    allowed: true,
    currentUsage: currentTopicCount,
    limit: limits.maxTopics,
  };
}

/**
 * Issue #181 (Plan Task 6.2): Source statuses that occupy a quota slot.
 *
 * SPEC §6.2 defines four Source statuses: CANDIDATE, ACTIVE, MUTED, REJECTED.
 * A source occupies a quota slot in every status EXCEPT REJECTED — REJECTED is
 * the only status that fully releases the slot (the source is no longer
 * contributing to the user's intelligence pipeline in any capacity).
 *
 * This aligns with the usage dashboard, which already counts
 * `status: { not: "REJECTED" }`.
 */
export const QUOTA_SUBJECT_SOURCE_STATUSES = [
  "CANDIDATE",
  "ACTIVE",
  "MUTED",
] as const;

export function checkSourceQuota(
  plan: Plan,
  currentSourceCount: number,
  isSelfHosted: boolean,
): QuotaCheckResult {
  if (isSelfHosted) {
    return { allowed: true };
  }

  const limits = limitsFor(plan);
  if (limits.maxSources === null) {
    return { allowed: true, limit: null, currentUsage: currentSourceCount };
  }

  if (currentSourceCount >= limits.maxSources) {
    return {
      allowed: false,
      reason: `Source limit reached (${currentSourceCount}/${limits.maxSources}).`,
      upgradeHint: PRICING_HINT,
      currentUsage: currentSourceCount,
      limit: limits.maxSources,
    };
  }

  return {
    allowed: true,
    currentUsage: currentSourceCount,
    limit: limits.maxSources,
  };
}

export function checkAiCallQuota(
  plan: Plan,
  todayAiCalls: number,
  monthAiCalls: number,
  isSelfHosted: boolean,
): QuotaCheckResult {
  if (isSelfHosted) {
    return { allowed: true };
  }

  const limits = limitsFor(plan);

  if (limits.maxAiCallsPerDay !== null && todayAiCalls >= limits.maxAiCallsPerDay) {
    return {
      allowed: false,
      reason: `Daily AI call limit reached (${todayAiCalls}/${limits.maxAiCallsPerDay}).`,
      upgradeHint: PRICING_HINT,
      currentUsage: todayAiCalls,
      limit: limits.maxAiCallsPerDay,
    };
  }

  if (
    limits.maxAiCallsPerMonth !== null &&
    monthAiCalls >= limits.maxAiCallsPerMonth
  ) {
    return {
      allowed: false,
      reason: `Monthly AI call limit reached (${monthAiCalls}/${limits.maxAiCallsPerMonth}).`,
      upgradeHint: PRICING_HINT,
      currentUsage: monthAiCalls,
      limit: limits.maxAiCallsPerMonth,
    };
  }

  return {
    allowed: true,
    currentUsage: monthAiCalls,
    limit: limits.maxAiCallsPerMonth ?? limits.maxAiCallsPerDay,
  };
}

export function checkExportQuota(
  plan: Plan,
  monthExportCount: number,
  isSelfHosted: boolean,
): QuotaCheckResult {
  if (isSelfHosted) {
    return { allowed: true };
  }

  const limits = limitsFor(plan);
  if (limits.maxExportsPerMonth === null) {
    return { allowed: true, limit: null, currentUsage: monthExportCount };
  }

  if (monthExportCount >= limits.maxExportsPerMonth) {
    return {
      allowed: false,
      reason: `Monthly export limit reached (${monthExportCount}/${limits.maxExportsPerMonth}).`,
      upgradeHint: PRICING_HINT,
      currentUsage: monthExportCount,
      limit: limits.maxExportsPerMonth,
    };
  }

  return {
    allowed: true,
    currentUsage: monthExportCount,
    limit: limits.maxExportsPerMonth,
  };
}

export function shouldUseByok(
  plan: Plan,
  monthAiCalls: number,
  isSelfHosted: boolean,
  hasByok: boolean,
): { useByok: boolean; fallbackToOfficial: boolean; reason: string } {
  if (isSelfHosted) {
    if (hasByok) {
      return {
        useByok: true,
        fallbackToOfficial: true,
        reason: "Self-hosted mode: using BYOK with official AI fallback.",
      };
    }
    return {
      useByok: false,
      fallbackToOfficial: true,
      reason: "Self-hosted mode: no BYOK configured, using official AI.",
    };
  }

  const limits = limitsFor(plan);

  if (plan === "PLUS") {
    if (!hasByok) {
      return {
        useByok: false,
        fallbackToOfficial: false,
        reason: "Plus plan requires BYOK but none is configured.",
      };
    }
    return {
      useByok: true,
      fallbackToOfficial: false,
      reason: "Plus plan: BYOK is the only allowed AI source.",
    };
  }

  if (plan === "PRO") {
    if (limits.maxAiCallsPerMonth === null) {
      return {
        useByok: hasByok,
        fallbackToOfficial: true,
        reason: hasByok
          ? "Pro plan: using BYOK with official AI fallback."
          : "Pro plan: no BYOK configured, using official AI.",
      };
    }

    const threshold = Math.ceil(limits.maxAiCallsPerMonth * 0.8);
    if (monthAiCalls >= threshold && hasByok) {
      return {
        useByok: true,
        fallbackToOfficial: true,
        reason: `Pro plan: monthly usage ${monthAiCalls} reached 80% of ${limits.maxAiCallsPerMonth}, switching to BYOK.`,
      };
    }
    if (monthAiCalls >= threshold && !hasByok) {
      return {
        useByok: false,
        fallbackToOfficial: true,
        reason: `Pro plan: monthly usage ${monthAiCalls} near ${limits.maxAiCallsPerMonth} limit, using official AI.`,
      };
    }

    return {
      useByok: false,
      fallbackToOfficial: true,
      reason: hasByok
        ? `Pro plan: usage ${monthAiCalls} below 80% threshold, using official AI.`
        : "Pro plan: no BYOK configured, using official AI.",
    };
  }

  return {
    useByok: false,
    fallbackToOfficial: limits.allowsOfficialAi,
    reason: limits.allowsOfficialAi
      ? "Free plan: using official AI."
      : "Free plan: no AI source available.",
  };
}
