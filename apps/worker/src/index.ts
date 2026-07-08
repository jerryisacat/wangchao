import {
  createOpenAiCompatibleAdapter,
  fallbackSourceRecommendation,
  recommendSourceCandidate,
  type SourceRecommendation,
  type SourceRecommendationAdapter,
} from "@wangchao/ai";
import {
  createIntelligenceEventDraft,
  createContentHash,
  evaluateRelevance,
  generatePreferenceDeltas,
  renderDailyBriefingMarkdown,
} from "@wangchao/core";
import {
  completeTaskRun,
  createCandidateRssSource,
  createDailyBriefing,
  createSourceDiscoveryTaskRun,
  createSourceFetchTaskRun,
  ensureDefaultWorkspace,
  failTaskRun,
  getPrismaClient,
  listActiveRssSourcesForFetch,
  listActiveTopics,
  listEventsForDailyBriefing,
  listFetchedItemsForAnalysis,
  listHighScoreEventPagesForDiscovery,
  listPreferenceMemoryForDashboard,
  listRecentActiveSourcePagesForDiscovery,
  listRecentFeedbackSignals,
  listSourceGovernanceReport,
  listTopicsForSourceDiscovery,
  markItemFiltered,
  recordUsageEvent,
  recordSourceFetchSuccess,
  recordSourceQualityObservation,
  upsertFetchedItems,
  upsertIntelligenceEventFromItem,
  upsertPreferenceMemory,
  type FetchedSourceRecord,
  type SourceDiscoveryTopicRecord,
} from "@wangchao/db";
import {
  BraveSearchProvider,
  buildTopicSearchQueries,
  discoverFeedCandidatesFromPage,
  discoverFeedCandidatesFromSearchResult,
  extractExternalLinksFromPage,
  extractTopicKeywords,
  fetchRssFeed,
  type FeedCandidate,
  type SearchProvider,
} from "@wangchao/sources";

const MAX_FETCH_ATTEMPTS = 3;

export interface WorkerFetchCycleResult {
  analyzedItems: number;
  createdOrUpdatedEvents: number;
  fetchedSources: number;
  failedSources: number;
  filteredItems: number;
  generatedBriefings: number;
  insertedOrUpdatedItems: number;
  recordedSourceObservations: number;
  updatedPreferenceMemories: number;
}

export interface SourceDiscoveryCycleResult {
  aiRecommendations: number;
  backlinkedCandidates: number;
  candidateSourcesWritten: number;
  existingSourcesObserved: number;
  failedCandidates: number;
  keywordCandidates: number;
  outlinkCandidates: number;
  skippedKeywordSearch: boolean;
  taskRunId: string;
  topicsScanned: number;
}

export interface SourceDiscoveryCycleOptions {
  mode?: "manual" | "worker";
  userId?: string;
}

export interface WorkerHealthCheckResult {
  checks: Record<string, { message?: string; status: "ok" | "down" | "skipped" }>;
  generatedAt: string;
  service: "wangchao-worker";
  status: "ok" | "degraded";
}

export function describeWorker(): string {
  return "Wangchao worker";
}

export async function runWorkerHealthCheck(): Promise<WorkerHealthCheckResult> {
  const database = await checkWorkerDatabase();
  const status = database.status === "down" ? "degraded" : "ok";

  return {
    checks: {
      database,
    },
    generatedAt: new Date().toISOString(),
    service: "wangchao-worker",
    status,
  };
}

export async function runFetchCycle(): Promise<WorkerFetchCycleResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to run the worker fetch pipeline.");
  }

  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  const sources = await listActiveRssSourcesForFetch(prisma, {
    organizationId: workspace.organizationId,
  });
  const result: WorkerFetchCycleResult = {
    analyzedItems: 0,
    createdOrUpdatedEvents: 0,
    failedSources: 0,
    fetchedSources: 0,
    filteredItems: 0,
    generatedBriefings: 0,
    insertedOrUpdatedItems: 0,
    recordedSourceObservations: 0,
    updatedPreferenceMemories: 0,
  };

  for (const source of sources) {
    const sourceResult = await fetchSourceWithRetries(prisma, source);
    result.fetchedSources += sourceResult.fetchedSources;
    result.failedSources += sourceResult.failedSources;
    result.insertedOrUpdatedItems += sourceResult.insertedOrUpdatedItems;
  }

  if (result.fetchedSources > 0 || result.insertedOrUpdatedItems > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        failedSources: result.failedSources,
        fetchedSources: result.fetchedSources,
      },
      organizationId: workspace.organizationId,
      quantity: result.insertedOrUpdatedItems,
      subjectType: "worker-fetch-cycle",
      type: "FETCH",
      unit: "item",
      userId: workspace.userId,
    });
  }

  const analysisResult = await runAnalysisCycle(prisma, workspace.organizationId);
  result.analyzedItems = analysisResult.analyzedItems;
  result.createdOrUpdatedEvents = analysisResult.createdOrUpdatedEvents;
  result.filteredItems = analysisResult.filteredItems;
  result.updatedPreferenceMemories = await runPreferenceLearningCycle(
    prisma,
    workspace.organizationId,
    workspace.userId,
  );
  result.generatedBriefings = await runDailyBriefingCycle(
    prisma,
    workspace.organizationId,
    workspace.userId,
  );
  if (result.generatedBriefings > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        source: "worker-daily-briefing-cycle",
      },
      organizationId: workspace.organizationId,
      quantity: result.generatedBriefings,
      subjectType: "daily-briefing-cycle",
      type: "BRIEFING",
      unit: "briefing",
      userId: workspace.userId,
    });
  }
  result.recordedSourceObservations = await runSourceGovernanceObservationCycle(
    prisma,
    workspace.organizationId,
  );
  if (result.recordedSourceObservations > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        source: "worker-source-governance-cycle",
      },
      organizationId: workspace.organizationId,
      quantity: result.recordedSourceObservations,
      subjectType: "source-observation-cycle",
      type: "SOURCE_GOVERNANCE",
      unit: "observation",
      userId: workspace.userId,
    });
  }

  return result;
}

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
  const result: SourceDiscoveryCycleResult = {
    aiRecommendations: 0,
    backlinkedCandidates: 0,
    candidateSourcesWritten: 0,
    existingSourcesObserved: 0,
    failedCandidates: 0,
    keywordCandidates: 0,
    outlinkCandidates: 0,
    skippedKeywordSearch: false,
    taskRunId: taskRun.id,
    topicsScanned: 0,
  };

  try {
    const topics = await listTopicsForSourceDiscovery(prisma, {
      organizationId: workspace.organizationId,
    });
    result.topicsScanned = topics.length;
    const searchProvider = createSearchProvider();
    const ai = createSourceRecommendationRuntime();
    const candidates: DiscoveryCandidate[] = [];

    if (searchProvider) {
      candidates.push(...(await discoverFromKeywordSearch(topics, searchProvider)));
    } else {
      result.skippedKeywordSearch = true;
    }

    candidates.push(
      ...(await discoverFromHighScoreBacklinks(workspace.organizationId, topics)),
      ...(await discoverFromActiveSourceOutlinks(workspace.organizationId, topics)),
    );

    const limitedCandidates = limitCandidatesPerTopic(
      dedupeDiscoveryCandidates(candidates),
      readPositiveIntegerEnv("WANGCHAO_DISCOVERY_WEEKLY_LIMIT", 5),
    );

    for (const candidate of limitedCandidates) {
      const recommendation = await getSourceRecommendation(candidate, ai);
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

    await completeTaskRun(prisma, taskRun.id, { ...result });
    await recordUsageEvent(prisma, {
      metadata: {
        mode: options.mode ?? "worker",
        taskRunId: taskRun.id,
      },
      organizationId: workspace.organizationId,
      quantity: result.candidateSourcesWritten,
      subjectId: taskRun.id,
      subjectType: "task-run",
      type: "SOURCE_DISCOVERY",
      unit: "candidate",
      userId: options.userId ?? workspace.userId,
    });

    return result;
  } catch (error) {
    await failTaskRun(prisma, taskRun.id, error);
    throw error;
  }
}

async function runAnalysisCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<Pick<
  WorkerFetchCycleResult,
  "analyzedItems" | "createdOrUpdatedEvents" | "filteredItems"
>> {
  const items = await listFetchedItemsForAnalysis(prisma, { organizationId });
  const result = {
    analyzedItems: 0,
    createdOrUpdatedEvents: 0,
    filteredItems: 0,
  };

  for (const item of items) {
    const decision = evaluateRelevance({
      fetchedAt: item.fetchedAt,
      id: item.id,
      publishedAt: item.publishedAt,
      summary: item.summary,
      title: item.title,
      topicProfile: item.topicProfile,
      url: item.url,
    });
    const draft = createIntelligenceEventDraft(
      {
        fetchedAt: item.fetchedAt,
        id: item.id,
        publishedAt: item.publishedAt,
        summary: item.summary,
        title: item.title,
        topicProfile: item.topicProfile,
        url: item.url,
      },
      decision,
    );

    result.analyzedItems += 1;

    if (!draft) {
      await markItemFiltered(
        prisma,
        item.id,
        decision.noiseReason ?? "Item did not pass relevance threshold.",
      );
      result.filteredItems += 1;
      continue;
    }

    await upsertIntelligenceEventFromItem(prisma, {
      organizationId: item.organizationId,
      topicId: item.topicId,
      primaryItemId: item.id,
      title: draft.title,
      summary: draft.summary,
      category: draft.category,
      score: draft.score,
      gravityScore: draft.gravityScore,
      eventHash: draft.eventHash,
      explanation: draft.explanation,
      occurredAt: draft.occurredAt,
      rawAiResponse: {
        mode: "explainable-rules",
        relevance: decision,
      },
    });
    result.createdOrUpdatedEvents += 1;
  }

  return result;
}

async function runPreferenceLearningCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  userId: string,
): Promise<number> {
  const signals = await listRecentFeedbackSignals(prisma, {
    organizationId,
    userId,
  });
  const deltas = generatePreferenceDeltas(signals);

  await Promise.all(
    deltas.map((delta) =>
      upsertPreferenceMemory(prisma, {
        confidence: delta.confidence,
        explanation: delta.explanation,
        key: delta.key,
        organizationId,
        topicId: delta.topicId,
        userId,
        value: delta.value,
      }),
    ),
  );

  return deltas.length;
}

async function runDailyBriefingCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  userId: string,
): Promise<number> {
  const topics = await listActiveTopics(prisma, { organizationId });
  let generatedBriefings = 0;

  for (const topic of topics) {
    const [events, preferences] = await Promise.all([
      listEventsForDailyBriefing(prisma, {
        organizationId,
        topicId: topic.id,
      }),
      listPreferenceMemoryForDashboard(prisma, { organizationId, userId }),
    ]);

    if (events.length === 0) {
      continue;
    }

    const generatedAt = new Date();
    const markdown = renderDailyBriefingMarkdown({
      events: events.map((event) => ({
        category: event.category,
        explanation: event.explanation,
        occurredAt: event.occurredAt,
        score: event.score,
        sourceName: event.sourceName,
        sourceUrl: event.sourceUrl,
        summary: event.summary,
        title: event.title,
        url: event.url,
      })),
      generatedAt,
      preferences: preferences
        .filter((preference) => preference.topicId === topic.id)
        .map((preference) => ({
          explanation: preference.explanation,
          key: preference.key,
          weight: preference.weight,
        })),
      topicName: topic.name,
    });
    const rangeEnd = generatedAt;
    const rangeStart = new Date(generatedAt);
    rangeStart.setHours(0, 0, 0, 0);

    await createDailyBriefing(prisma, {
      content: markdown,
      eventIds: events.map((event) => event.eventId),
      markdown,
      metadata: {
        contentHash: createContentHash(markdown),
        mode: "explainable-rules",
      },
      organizationId,
      rangeEnd,
      rangeStart,
      title: `${topic.name} Daily Briefing`,
      topicId: topic.id,
    });
    generatedBriefings += 1;
  }

  return generatedBriefings;
}

async function runSourceGovernanceObservationCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<number> {
  const report = await listSourceGovernanceReport(prisma, { organizationId });

  await Promise.all(
    report.map((source) =>
      recordSourceQualityObservation(prisma, {
        duplicateRate: source.duplicateRate,
        evidence: {
          qualityScore: source.qualityScore,
          recommendation: source.recommendation,
          totalItems: source.totalItems,
        },
        hitRate: source.hitRate,
        noiseRate: source.noiseRate,
        organizationId,
        sourceId: source.sourceId,
        topicId: source.topicId,
      }),
    ),
  );

  return report.length;
}

async function fetchSourceWithRetries(
  prisma: ReturnType<typeof getPrismaClient>,
  source: FetchedSourceRecord,
): Promise<WorkerFetchCycleResult> {
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const result = await fetchSourceAttempt(prisma, source, attempt);

    if (result.fetchedSources === 1) {
      return result;
    }
  }

  return {
    analyzedItems: 0,
    createdOrUpdatedEvents: 0,
    failedSources: 1,
    fetchedSources: 0,
    filteredItems: 0,
    generatedBriefings: 0,
    insertedOrUpdatedItems: 0,
    recordedSourceObservations: 0,
    updatedPreferenceMemories: 0,
  };
}

async function fetchSourceAttempt(
  prisma: ReturnType<typeof getPrismaClient>,
  source: FetchedSourceRecord,
  attempt: number,
): Promise<WorkerFetchCycleResult> {
  const taskRun = await createSourceFetchTaskRun(prisma, source, {
    attempt,
    maxAttempts: MAX_FETCH_ATTEMPTS,
  });

  try {
    const items = await fetchRssFeed(source.url);
    const writtenItems = await upsertFetchedItems(
      prisma,
      items.map((item) => ({
        organizationId: source.organizationId,
        topicId: source.topicId,
        sourceId: source.id,
        title: item.title,
        url: item.url,
        canonicalUrl: item.canonicalUrl,
        summary: item.summary,
        author: item.author,
        publishedAt: item.publishedAt,
        contentHash: item.contentHash,
        rawMetadata: item.rawMetadata,
      })),
    );

    await recordSourceFetchSuccess(prisma, source.id);
    await completeTaskRun(prisma, taskRun.id, {
      fetchedItems: items.length,
      writtenItems: writtenItems.length,
    });

    return {
      analyzedItems: 0,
      createdOrUpdatedEvents: 0,
      failedSources: 0,
      fetchedSources: 1,
      filteredItems: 0,
      generatedBriefings: 0,
      insertedOrUpdatedItems: writtenItems.length,
      recordedSourceObservations: 0,
      updatedPreferenceMemories: 0,
    };
  } catch (error) {
    await failTaskRun(prisma, taskRun.id, error);
    return {
      analyzedItems: 0,
      createdOrUpdatedEvents: 0,
      failedSources: 0,
      fetchedSources: 0,
      filteredItems: 0,
      generatedBriefings: 0,
      insertedOrUpdatedItems: 0,
      recordedSourceObservations: 0,
      updatedPreferenceMemories: 0,
    };
  }
}

type DiscoveryChannel =
  | "backlink-from-highscore"
  | "keyword-search"
  | "outlink-network";

interface DiscoveryCandidate {
  channel: DiscoveryChannel;
  evidence: Record<string, unknown>;
  feedUrl: string;
  name: string;
  pageUrl: string;
  topic: SourceDiscoveryTopicRecord;
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
  organizationId: string,
  topics: SourceDiscoveryTopicRecord[],
): Promise<DiscoveryCandidate[]> {
  const topicById = mapTopicsById(topics);
  const pages = await listHighScoreEventPagesForDiscovery(getPrismaClient(), {
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
  organizationId: string,
  topics: SourceDiscoveryTopicRecord[],
): Promise<DiscoveryCandidate[]> {
  const topicById = mapTopicsById(topics);
  const pages = await listRecentActiveSourcePagesForDiscovery(getPrismaClient(), {
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

async function getSourceRecommendation(
  candidate: DiscoveryCandidate,
  ai: { adapter: SourceRecommendationAdapter; model: string } | null,
): Promise<{ usedAi: boolean; value: SourceRecommendation }> {
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
      usedAi: false,
      value: fallbackSourceRecommendation(input),
    };
  }

  try {
    return {
      usedAi: true,
      value: await recommendSourceCandidate(input, ai),
    };
  } catch {
    return {
      usedAi: false,
      value: fallbackSourceRecommendation(input),
    };
  }
}

function createSearchProvider(): SearchProvider | null {
  const provider = process.env.WANGCHAO_SEARCH_PROVIDER ?? "brave";

  if (provider !== "brave") {
    return null;
  }

  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return null;
  }

  return new BraveSearchProvider({ apiKey });
}

function createSourceRecommendationRuntime(): {
  adapter: SourceRecommendationAdapter;
  model: string;
} | null {
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

function readPositiveIntegerEnv(key: string, fallback: number): number {
  const value = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readFloatEnv(key: string, fallback: number): number {
  const value = Number.parseFloat(process.env[key] ?? "");
  return Number.isFinite(value) ? value : fallback;
}

async function checkWorkerDatabase(): Promise<{
  message?: string;
  status: "ok" | "down" | "skipped";
}> {
  if (!process.env.DATABASE_URL) {
    return {
      message: "Database connection is not configured.",
      status: "skipped",
    };
  }

  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      status: "down",
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv.includes("--health")
    ? runWorkerHealthCheck()
    : process.argv.includes("--source-discovery")
      ? runSourceDiscoveryCycle({ mode: "worker" })
      : runFetchCycle();

  command
    .then((result) => {
      process.stdout.write(`${describeWorker()}\n`);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if ("status" in result && result.status === "degraded") {
        process.exitCode = 1;
      }
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `worker error: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
