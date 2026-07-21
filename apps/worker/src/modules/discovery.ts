import {
  buildTopicSearchQueries,
  discoverFeedCandidatesFromPage,
  discoverFeedCandidatesFromSearchResult,
  extractExternalLinksFromPage,
  extractTopicKeywords,
  type FeedCandidate,
  type SearchProvider,
} from "@wangchao/sources";
import {
  createCandidateRssSource,
  createSourceDiscoveryTaskRun,
  completeTaskRun,
  failTaskRun,
  getPrismaClient,
  getSubscriptionPlanView,
  getQuotaSubjectSourceCount,
  listHighScoreEventPagesForDiscovery,
  listRecentActiveSourcePagesForDiscovery,
  listTopicsForSourceDiscovery,
  recordUsageEvent,
  ensureDefaultWorkspace,
  type FetchedSourceRecord,
  type SourceDiscoveryTopicRecord,
} from "@wangchao/db";
import { createSearchProvider, createSourceRecommendationRuntime, getSourceRecommendation } from "./runtime.js";
import { readPositiveIntegerEnv, readFloatEnv } from "./env.js";
import { PLAN_LIMITS, resolveEffectivePlanFromView } from "@wangchao/core";
import type { DiscoveryChannel, SourceDiscoveryCycleOptions, SourceDiscoveryCycleResult, WorkspaceScope } from "./types.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";

type PrismaClient = ReturnType<typeof getPrismaClient>;

interface DiscoveryCandidate {
  channel: DiscoveryChannel;
  evidence: Record<string, unknown>;
  feedUrl: string;
  name: string;
  pageUrl: string;
  topic: SourceDiscoveryTopicRecord;
}

function feedCandidateToDiscoveryCandidate(
  feed: FeedCandidate,
  topic: SourceDiscoveryTopicRecord,
  channel: DiscoveryChannel,
  evidence: Record<string, unknown>,
): DiscoveryCandidate {
  return {
    channel,
    evidence: {
      ...feed.evidence,
      ...evidence,
      pageUrl: feed.pageUrl,
    },
    feedUrl: feed.feedUrl,
    name: feed.name,
    pageUrl: feed.pageUrl,
    topic,
  };
}

function dedupeDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  const seen = new Set<string>();
  const unique: DiscoveryCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.topic.id}:${canonicalFeedKey(candidate.feedUrl)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

function limitCandidatesPerTopic(
  candidates: DiscoveryCandidate[],
  limit: number,
): DiscoveryCandidate[] {
  const counts = new Map<string, number>();
  const limited: DiscoveryCandidate[] = [];

  for (const candidate of candidates) {
    const count = counts.get(candidate.topic.id) ?? 0;
    if (count >= limit) {
      continue;
    }
    counts.set(candidate.topic.id, count + 1);
    limited.push(candidate);
  }

  return limited;
}

function mapTopicsById(
  topics: SourceDiscoveryTopicRecord[],
): Map<string, SourceDiscoveryTopicRecord> {
  return new Map(topics.map((topic) => [topic.id, topic]));
}

function canonicalFeedKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

async function discoverFromKeywordSearch(
  topics: SourceDiscoveryTopicRecord[],
  searchProvider: SearchProvider,
): Promise<DiscoveryCandidate[]> {
  const candidates: DiscoveryCandidate[] = [];

  for (const topic of topics) {
    const queries = buildTopicSearchQueries({
      keywords: extractTopicKeywords(topic.profile),
      topicName: topic.name,
    });

    for (const query of queries) {
      try {
        const results = await searchProvider.searchSources(query, { count: 5 });
        for (const result of results) {
          const feeds = await discoverFeedCandidatesFromSearchResult(result, {
            maxCandidates: 4,
          });
          candidates.push(
            ...feeds.map((feed) =>
              feedCandidateToDiscoveryCandidate(feed, topic, "keyword-search", {
                query,
                snippet: result.snippet,
              }),
            ),
          );
        }
      } catch {
        continue;
      }
    }
  }

  return candidates;
}

async function discoverFromHighScoreBacklinks(
  prisma: PrismaClient,
  organizationId: string,
  topics: SourceDiscoveryTopicRecord[],
): Promise<DiscoveryCandidate[]> {
  const topicById = mapTopicsById(topics);
  const pages = await listHighScoreEventPagesForDiscovery(prisma, {
    days: readPositiveIntegerEnv("WANGCHAO_DISCOVERY_LOOKBACK_DAYS", 14),
    organizationId,
    threshold: readFloatEnv("WANGCHAO_DISCOVERY_HIGHSCORE_THRESHOLD", 0.7),
  }, readPositiveIntegerEnv("WANGCHAO_DISCOVERY_HIGHSCORE_PAGE_LIMIT", 10));
  const candidates: DiscoveryCandidate[] = [];

  for (const page of pages) {
    const topic = topicById.get(page.topicId);
    if (!topic) {
      continue;
    }

    try {
      const feeds = await discoverFeedCandidatesFromPage(page.url, {
        maxCandidates: 4,
        timeoutMs: readPositiveIntegerEnv("WANGCHAO_DISCOVERY_FETCH_TIMEOUT_MS", 5_000),
      });
      candidates.push(
        ...feeds.map((feed) =>
          feedCandidateToDiscoveryCandidate(feed, topic, "backlink-from-highscore", {
            primaryItemUrl: page.url,
          }),
        ),
      );
    } catch {
      continue;
    }
  }

  return candidates;
}

async function discoverFromActiveSourceOutlinks(
  prisma: PrismaClient,
  organizationId: string,
  topics: SourceDiscoveryTopicRecord[],
): Promise<DiscoveryCandidate[]> {
  const topicById = mapTopicsById(topics);
  const pages = await listRecentActiveSourcePagesForDiscovery(prisma, {
    organizationId,
  }, readPositiveIntegerEnv("WANGCHAO_DISCOVERY_ACTIVE_PAGE_LIMIT", 12));
  const candidates: DiscoveryCandidate[] = [];

  for (const page of pages) {
    const topic = topicById.get(page.topicId);
    if (!topic) {
      continue;
    }

    try {
      const outlinks = await extractExternalLinksFromPage(page.url, {
        timeoutMs: readPositiveIntegerEnv("WANGCHAO_DISCOVERY_FETCH_TIMEOUT_MS", 5_000),
      });
      for (const outlink of outlinks.slice(
        0,
        readPositiveIntegerEnv("WANGCHAO_DISCOVERY_OUTLINKS_PER_PAGE", 3),
      )) {
        try {
          const feeds = await discoverFeedCandidatesFromPage(outlink, {
            maxCandidates: 3,
            timeoutMs: readPositiveIntegerEnv(
              "WANGCHAO_DISCOVERY_FETCH_TIMEOUT_MS",
              5_000,
            ),
          });
          candidates.push(
            ...feeds.map((feed) =>
              feedCandidateToDiscoveryCandidate(feed, topic, "outlink-network", {
                sourceItemUrl: page.url,
                sourceId: page.sourceId,
              }),
            ),
          );
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return candidates;
}

/**
 * Public wrapper: resolves the default workspace, creates a legacy
 * `SourceDiscovery` TaskRun, delegates to `runSourceDiscoveryForWorkspace`,
 * then completes/fails the TaskRun. Preserves the standalone entry-point
 * behavior.
 *
 * Lane 2B durable consumers that have already claimed a TaskRun should call
 * `runSourceDiscoveryForWorkspace` directly with the claimed taskRunId and
 * the resolved workspace scope — that function never creates, completes, or
 * fails a TaskRun.
 */
export async function runSourceDiscoveryCycle(
  options: SourceDiscoveryCycleOptions = {},
): Promise<SourceDiscoveryCycleResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to run source discovery.");
  }

  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  const taskRun = await createSourceDiscoveryTaskRun(prisma, {
    input: {
      mode: options.mode ?? "worker",
    },
    organizationId: workspace.organizationId,
    userId: options.userId ?? workspace.userId,
  });

  try {
    const result = await runSourceDiscoveryForWorkspace(
      prisma,
      workspace,
      taskRun.id,
      options,
    );
    await completeTaskRun(prisma, taskRun.id, { ...result });
    return result;
  } catch (error) {
    await failTaskRun(prisma, taskRun.id, error);
    throw error;
  }
}

/**
 * Execute the source-discovery business logic strictly scoped to `workspace`
 * and bound to `taskRunId`. Performs all discovery channels, candidate
 * writes, AI recommendation, and usage recording — but does NOT create,
 * complete, or fail any TaskRun. The caller (durable consumer) owns the
 * TaskRun lifecycle.
 *
 * `result.taskRunId` is set to the passed-in `taskRunId`.
 *
 * `workspace.userId` is used for usage attribution. `options.userId`, when
 * present, overrides the usage userId for backward compatibility with the
 * legacy standalone wrapper, but must never span organizations: the
 * organizationId is always `workspace.organizationId`.
 */
export async function runSourceDiscoveryForWorkspace(
  prisma: PrismaClient,
  workspace: WorkspaceScope,
  taskRunId: string,
  options: SourceDiscoveryCycleOptions = {},
): Promise<SourceDiscoveryCycleResult> {
  const usageUserId = options.userId ?? workspace.userId;
  const result: SourceDiscoveryCycleResult = {
    aiRecommendationAttempts: 0,
    aiRecommendationFallbacks: 0,
    aiRecommendations: 0,
    backlinkedCandidates: 0,
    candidateSourcesWritten: 0,
    existingSourcesObserved: 0,
    failedCandidates: 0,
    keywordCandidates: 0,
    outlinkCandidates: 0,
    skippedKeywordSearch: false,
    taskRunId,
    topicsScanned: 0,
    quotaExhaustedCandidatesSkipped: 0,
  };

  const topics = await listTopicsForSourceDiscovery(prisma, {
    organizationId: workspace.organizationId,
  });
  result.topicsScanned = topics.length;
  const searchProvider = await createSearchProvider(prisma, workspace.organizationId);
  const ai = await createSourceRecommendationRuntime(prisma, workspace.organizationId);
  const candidates: DiscoveryCandidate[] = [];

  if (searchProvider) {
    candidates.push(...(await discoverFromKeywordSearch(topics, searchProvider)));
  } else {
    result.skippedKeywordSearch = true;
  }

  candidates.push(
    ...(await discoverFromHighScoreBacklinks(prisma, workspace.organizationId, topics)),
    ...(await discoverFromActiveSourceOutlinks(prisma, workspace.organizationId, topics)),
  );

  const limitedCandidates = limitCandidatesPerTopic(
    dedupeDiscoveryCandidates(candidates),
    readPositiveIntegerEnv("WANGCHAO_DISCOVERY_WEEKLY_LIMIT", 5),
  );

  // Issue #181: Discovery must use the same quota count as manual creation.
  // CANDIDATE sources now count toward the quota. Self-hosted orgs bypass.
  const subscription = await getSubscriptionPlanView(prisma, {
    organizationId: workspace.organizationId,
  });
  const effectivePlan = resolveEffectivePlanFromView(subscription);
  const sourceLimit = subscription.isSelfHosted ? null : PLAN_LIMITS[effectivePlan].maxSources;
  let quotaSlotsRemaining = sourceLimit === null
    ? Number.POSITIVE_INFINITY
    : Math.max(
        0,
        sourceLimit - await getQuotaSubjectSourceCount(prisma, { organizationId: workspace.organizationId }),
      );

  for (const candidate of limitedCandidates) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;

    // Issue #181: Stop creating candidates when the quota is exhausted.
    if (quotaSlotsRemaining <= 0) {
      result.quotaExhaustedCandidatesSkipped += 1;
      continue;
    }

    const recommendation = await getSourceRecommendation(candidate, ai);
    result.aiRecommendationAttempts += recommendation.attemptedAi ? 1 : 0;
    result.aiRecommendationFallbacks +=
      recommendation.attemptedAi && !recommendation.usedAi ? 1 : 0;
    result.aiRecommendations += recommendation.usedAi ? 1 : 0;

    try {
      const source = await createCandidateRssSource(prisma, {
        description: candidate.evidence.snippet
          ? String(candidate.evidence.snippet).slice(0, 240)
          : undefined,
        discoveryChannel: candidate.channel,
        evidence: {
          ...candidate.evidence,
          recommendationMode: recommendation.usedAi ? "llm" : "fallback",
          source: "source-discovery-cycle",
        },
        name: candidate.name,
        organizationId: candidate.topic.organizationId,
        recommendationReason: recommendation.value.reason,
        relevanceScore: recommendation.value.relevanceScore,
        topicId: candidate.topic.id,
        url: candidate.feedUrl,
      });

      if (source.status === "CANDIDATE") {
        result.candidateSourcesWritten += 1;
        quotaSlotsRemaining -= 1;
        if (candidate.channel === "keyword-search") result.keywordCandidates += 1;
        if (candidate.channel === "backlink-from-highscore") {
          result.backlinkedCandidates += 1;
        }
        if (candidate.channel === "outlink-network") result.outlinkCandidates += 1;
      } else {
        result.existingSourcesObserved += 1;
      }
    } catch {
      result.failedCandidates += 1;
    }
  }

  if (result.aiRecommendationAttempts > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        fallbackCalls: result.aiRecommendationFallbacks,
        source: "worker-source-recommendation",
        successfulCalls: result.aiRecommendations,
        taskRunId,
      },
      organizationId: workspace.organizationId,
      quantity: result.aiRecommendationAttempts,
      subjectId: taskRunId,
      subjectType: "task-run",
      type: "AI_CALL",
      unit: "call",
      userId: usageUserId,
    });
  }

  await recordUsageEvent(prisma, {
    metadata: { mode: options.mode ?? "worker", taskRunId },
    organizationId: workspace.organizationId,
    quantity: result.candidateSourcesWritten,
    subjectId: taskRunId,
    subjectType: "task-run",
    type: "SOURCE_DISCOVERY",
    unit: "candidate",
    userId: usageUserId,
  });

  return result;
}
