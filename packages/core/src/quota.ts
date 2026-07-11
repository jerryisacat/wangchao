export type Plan = "FREE" | "PLUS" | "PRO";

export interface PlanLimits {
  maxTopics: number | null;
  maxSources: number | null;
  maxAiCallsPerDay: number | null;
  maxAiCallsPerMonth: number | null;
  maxExportsPerMonth: number | null;
  requiresByok: boolean;
  allowsOfficialAi: boolean;
  allowsInstantPush: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: {
    maxTopics: 1,
    maxSources: 3,
    maxAiCallsPerDay: 100,
    maxAiCallsPerMonth: null,
    maxExportsPerMonth: 10,
    requiresByok: false,
    allowsOfficialAi: true,
    allowsInstantPush: false,
  },
  PLUS: {
    maxTopics: 5,
    maxSources: 25,
    maxAiCallsPerDay: null,
    maxAiCallsPerMonth: null,
    maxExportsPerMonth: 50,
    requiresByok: true,
    allowsOfficialAi: false,
    allowsInstantPush: true,
  },
  PRO: {
    maxTopics: null,
    maxSources: null,
    maxAiCallsPerDay: null,
    maxAiCallsPerMonth: 20000,
    maxExportsPerMonth: null,
    requiresByok: false,
    allowsOfficialAi: true,
    allowsInstantPush: true,
  },
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
  now?: Date;
}): Plan {
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

export function checkInstantPushQuota(
  plan: Plan,
  isSelfHosted: boolean,
): QuotaCheckResult {
  if (isSelfHosted || PLAN_LIMITS[plan].allowsInstantPush) {
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

  const limits = PLAN_LIMITS[plan];
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

export function checkSourceQuota(
  plan: Plan,
  currentSourceCount: number,
  isSelfHosted: boolean,
): QuotaCheckResult {
  if (isSelfHosted) {
    return { allowed: true };
  }

  const limits = PLAN_LIMITS[plan];
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

  const limits = PLAN_LIMITS[plan];

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

  const limits = PLAN_LIMITS[plan];
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

  const limits = PLAN_LIMITS[plan];

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

    const threshold = limits.maxAiCallsPerMonth * 0.8;
    if (monthAiCalls >= threshold && hasByok) {
      return {
        useByok: true,
        fallbackToOfficial: true,
        reason: `Pro plan: monthly usage ${monthAiCalls} reached 80% of ${limits.maxAiCallsPerMonth}, switching to BYOK.`,
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
