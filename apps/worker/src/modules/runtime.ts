import { createOpenAiCompatibleAdapter, recommendSourceCandidate, type EventExtractionAdapter, type SourceRecommendation, type SourceRecommendationAdapter } from "@wangchao/ai";
import { checkAiCallQuota, resolveEffectivePlan, shouldUseByok } from "@wangchao/core";
import { getDecryptedByokCredential, getDecryptedCredentials, getMonthAiCallCount, getPrismaClient, getSubscriptionPlanView, getTodayAiCallCount } from "@wangchao/db";
import { createSearchProvider as createSearchProviderFromSources, extractTopicKeywords, type SearchProvider, type SearchProviderType } from "@wangchao/sources";
import type { SourceDiscoveryTopicRecord } from "@wangchao/db";

type PrismaClient = ReturnType<typeof getPrismaClient>;

export interface SourceRecommendationRuntime {
  adapter: SourceRecommendationAdapter;
  model: string;
}

export interface AnalysisRuntimeResult {
  adapter: EventExtractionAdapter;
  model: string;
  source: "official" | "byok" | "official_fallback";
}

export interface OfficialAiRuntime {
  adapter: EventExtractionAdapter;
  model: string;
}

function fallbackSourceRecommendation(input: {
  evidence: Record<string, unknown>;
  sourceName: string;
  sourceUrl: string;
  topicDescription: string | null;
  topicKeywords: string[];
  topicName: string;
}): SourceRecommendation {
  const keywordMatches = input.topicKeywords.filter((kw) =>
    input.sourceName.toLowerCase().includes(kw.toLowerCase()) ||
    input.sourceUrl.toLowerCase().includes(kw.toLowerCase())
  );
  const relevanceScore = keywordMatches.length > 0 ? 0.5 + Math.min(keywordMatches.length * 0.1, 0.3) : 0.3;
  return {
    reason: `基于关键词匹配的兜底推荐: ${keywordMatches.length > 0 ? keywordMatches.join(", ") : "无关键词匹配"}`,
    relevanceScore,
    raw: { keywordMatches, source: "fallback" },
  };
}

export async function createSearchProvider(
  prisma: PrismaClient,
  organizationId: string,
): Promise<SearchProvider | null> {
  const creds = await getDecryptedCredentials(prisma, { organizationId });
  if (creds?.search?.apiKey) {
    const provider = creds.search.provider ?? "brave";
    const providerType = provider as SearchProviderType;
    if (providerType === "searxng") {
      return creds.search.baseUrl
        ? createSearchProviderFromSources("searxng", { baseUrl: creds.search.baseUrl }) as SearchProvider
        : null;
    }
    return createSearchProviderFromSources(providerType, { apiKey: creds.search.apiKey }) as SearchProvider;
  }

  const envProvider = (process.env.WANGCHAO_SEARCH_PROVIDER ?? "brave") as SearchProviderType;

  if (envProvider === "searxng") {
    const baseUrl = process.env.SEARXNG_BASE_URL;
    return baseUrl ? createSearchProviderFromSources("searxng", { baseUrl }) as SearchProvider : null;
  }

  const apiKey =
    envProvider === "tavily" ? process.env.TAVILY_API_KEY :
    envProvider === "serper" ? process.env.SERPER_API_KEY :
    process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) return null;
  return createSearchProviderFromSources(envProvider, { apiKey }) as SearchProvider;
}

export async function createSourceRecommendationRuntime(
  prisma: PrismaClient,
  organizationId: string,
): Promise<SourceRecommendationRuntime | null> {
  const creds = await getDecryptedCredentials(prisma, { organizationId });
  if (creds?.ai?.apiKey && creds.ai.baseUrl) {
    return {
      adapter: createOpenAiCompatibleAdapter({
        apiKey: creds.ai.apiKey,
        baseUrl: creds.ai.baseUrl,
      }),
      model: creds.ai.model,
    };
  }

  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  if (!apiKey || !baseUrl) {
    return null;
  }
  return {
    adapter: createOpenAiCompatibleAdapter({
      apiKey,
      baseUrl,
    }),
    model: process.env.AI_MODEL_L1 ?? "gpt-4o-mini",
  };
}

export async function createAnalysisRuntimeWithPlan(
  prisma: PrismaClient,
  organizationId: string,
): Promise<AnalysisRuntimeResult | null> {
  const planView = await getSubscriptionPlanView(prisma, { organizationId });
  const isSelfHosted = planView.isSelfHosted;
  const plan = resolveEffectivePlan({
    plan: planView.plan,
    status: planView.status ?? "ACTIVE",
    isSelfHosted,
    currentPeriodEnd: planView.currentPeriodEnd,
  });

  const todayCalls = await getTodayAiCallCount(prisma, { organizationId });
  const monthCalls = await getMonthAiCallCount(prisma, { organizationId });

  const quotaCheck = checkAiCallQuota(plan, todayCalls, monthCalls, isSelfHosted);
  if (!quotaCheck.allowed) {
    process.stderr.write(
      `[quota] AI calls blocked for org ${organizationId}: ${quotaCheck.reason}\n`,
    );
    return null;
  }

  const byokCred = await getDecryptedByokCredential(prisma, { organizationId });
  const hasByok =
    byokCred !== null && Boolean(byokCred.apiKey) && Boolean(byokCred.baseUrl);

  const byokStrategy = shouldUseByok(plan, monthCalls, isSelfHosted, hasByok);

  if (byokStrategy.useByok && byokCred) {
    return {
      adapter: createOpenAiCompatibleAdapter({
        apiKey: byokCred.apiKey,
        baseUrl: byokCred.baseUrl,
      }),
      model: byokCred.model,
      source: "byok",
    };
  }

  if (!byokStrategy.fallbackToOfficial) {
    process.stderr.write(
      `[quota] AI calls blocked for org ${organizationId}: ${byokStrategy.reason}\n`,
    );
    return null;
  }

  const officialRuntime = await createOfficialAiRuntime(prisma, organizationId);
  if (!officialRuntime) {
    return null;
  }

  return {
    ...officialRuntime,
    source: "official",
  };
}

async function createOfficialAiRuntime(
  prisma: PrismaClient,
  organizationId: string,
): Promise<OfficialAiRuntime | null> {
  const creds = await getDecryptedCredentials(prisma, { organizationId });
  if (creds?.ai?.apiKey && creds.ai.baseUrl) {
    return {
      adapter: createOpenAiCompatibleAdapter({
        apiKey: creds.ai.apiKey,
        baseUrl: creds.ai.baseUrl,
      }),
      model: creds.ai.model,
    };
  }

  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  if (!apiKey || !baseUrl) {
    return null;
  }
  return {
    adapter: createOpenAiCompatibleAdapter({
      apiKey,
      baseUrl,
    }),
    model: process.env.AI_MODEL_L1 ?? "gpt-4o-mini",
  };
}

export async function getSourceRecommendation(
  candidate: {
    evidence: Record<string, unknown>;
    feedUrl: string;
    name: string;
    topic: SourceDiscoveryTopicRecord;
  },
  ai: SourceRecommendationRuntime | null,
): Promise<{
  attemptedAi: boolean;
  usedAi: boolean;
  value: SourceRecommendation;
}> {
  const input = {
    evidence: candidate.evidence,
    sourceName: candidate.name,
    sourceUrl: candidate.feedUrl,
    topicDescription: candidate.topic.description,
    topicKeywords: extractTopicKeywords(candidate.topic.profile),
    topicName: candidate.topic.name,
  };

  if (!ai) {
    return {
      attemptedAi: false,
      usedAi: false,
      value: fallbackSourceRecommendation(input),
    };
  }

  try {
    return {
      attemptedAi: true,
      usedAi: true,
      value: await recommendSourceCandidate(input, ai),
    };
  } catch {
    return {
      attemptedAi: true,
      usedAi: false,
      value: fallbackSourceRecommendation(input),
    };
  }
}
