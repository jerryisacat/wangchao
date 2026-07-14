export type Plan = "FREE" | "PLUS" | "PRO";

export type BillingInterval = "MONTHLY" | "YEARLY";

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

export interface PlanPricing {
  monthlyPriceUsd: number | null;
  yearlyPriceUsd: number | null;
}

export interface PlanFeatures {
  topics: number | null;
  sources: number | null;
  aiCalls: string;
  exports: number | null;
  aiSource: string;
}

export interface PlanRegistryEntry {
  limits: PlanLimits;
  pricing: PlanPricing;
  features: PlanFeatures;
  displayName: string;
}

export type PlanRegistry = Record<Plan, PlanRegistryEntry>;

export const PLAN_REGISTRY: PlanRegistry = {
  FREE: {
    limits: {
      maxTopics: 1,
      maxSources: 3,
      maxAiCallsPerDay: 100,
      maxAiCallsPerMonth: null,
      maxExportsPerMonth: 10,
      requiresByok: false,
      allowsOfficialAi: true,
      allowsInstantPush: false,
    },
    pricing: {
      monthlyPriceUsd: null,
      yearlyPriceUsd: null,
    },
    features: {
      topics: 1,
      sources: 3,
      aiCalls: "每天 100 次官方 AI 调用",
      exports: 10,
      aiSource: "官方 AI 来源",
    },
    displayName: "Free",
  },
  PLUS: {
    limits: {
      maxTopics: 5,
      maxSources: 25,
      maxAiCallsPerDay: null,
      maxAiCallsPerMonth: null,
      maxExportsPerMonth: 50,
      requiresByok: true,
      allowsOfficialAi: false,
      allowsInstantPush: true,
    },
    pricing: {
      monthlyPriceUsd: null,
      yearlyPriceUsd: 9.99,
    },
    features: {
      topics: 5,
      sources: 25,
      aiCalls: "AI 调用不限（自费 BYOK）",
      exports: 50,
      aiSource: "BYOK 必填",
    },
    displayName: "Plus",
  },
  PRO: {
    limits: {
      maxTopics: null,
      maxSources: null,
      maxAiCallsPerDay: null,
      maxAiCallsPerMonth: 20000,
      maxExportsPerMonth: null,
      requiresByok: false,
      allowsOfficialAi: true,
      allowsInstantPush: true,
    },
    pricing: {
      monthlyPriceUsd: 19.99,
      yearlyPriceUsd: null,
    },
    features: {
      topics: null,
      sources: null,
      aiCalls: "每月 20,000 次官方 AI 调用",
      exports: null,
      aiSource: "官方 AI + BYOK 备援",
    },
    displayName: "Pro",
  },
};

export const PLAN_ORDER: Plan[] = ["FREE", "PLUS", "PRO"];

export function getPlanDisplayName(plan: Plan): string {
  return PLAN_REGISTRY[plan].displayName;
}

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_REGISTRY[plan].limits;
}
