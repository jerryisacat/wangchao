import {
  completeTaskRun,
  createSourceFetchTaskRun,
  failTaskRun,
  getPrismaClient,
  recordSourceFetchFailure,
  recordSourceFetchSuccess,
  upsertFetchedItems,
  listItemsWithoutRawContent,
  updateItemRawContent,
  type FetchedSourceRecord,
} from "@wangchao/db";
import { fetchRssFeed, isFetchRssRetryable, fetchArticleContent } from "@wangchao/sources";
import { getMaxFetchAttempts, getFetchConcurrency, getBackoffBaseMs, sleep, pLimit } from "./env.js";
import type { WorkerFetchCycleResult } from "./types.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";

export async function runArticleFetchCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ fetched: number; failed: number }> {
  const result = { fetched: 0, failed: 0 };
  const items = await listItemsWithoutRawContent(prisma, { organizationId });

  if (items.length === 0) return result;

  const limit = pLimit(getFetchConcurrency());
  const articleResults = await Promise.all(
    items.map((item) =>
      limit(async () => {
        if (isCycleShuttingDown() || isCycleTimeExhausted()) return;
        try {
          const content = await fetchArticleContent(item.url);
          if (content) {
            await updateItemRawContent(prisma, item.id, content);
            result.fetched += 1;
          }
        } catch {
          result.failed += 1;
        }
      }),
    ),
  );
  void articleResults;

  return result;
}

export async function fetchSourceWithRetries(
  prisma: ReturnType<typeof getPrismaClient>,
  source: FetchedSourceRecord,
): Promise<WorkerFetchCycleResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= getMaxFetchAttempts(); attempt += 1) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
    const result = await fetchSourceAttempt(prisma, source, attempt);

    if (result.fetchedSources === 1) {
      return result;
    }

    lastError = result.lastError;

    if (!isFetchRssRetryable(lastError)) {
      break;
    }

    if (attempt < getMaxFetchAttempts()) {
      const backoffMs = getBackoffBaseMs() * 2 ** (attempt - 1);
      const jitterMs = backoffMs * (0.5 + Math.random() * 0.5);
      await sleep(Math.round(jitterMs));
    }
  }

  return {
    analyzedItems: 0,
    createdOrUpdatedEvents: 0,
    failedSources: 1,
    fetchedSources: 0,
    filteredItems: 0,
    generatedBriefings: 0,
    generatedMonthlyBriefings: 0,
    generatedWeeklyBriefings: 0,
    insertedOrUpdatedItems: 0,
    lastError,
    recordedSourceObservations: 0,
    updatedPreferenceMemories: 0,
  };
}

async function fetchSourceAttempt(
  prisma: ReturnType<typeof getPrismaClient>,
  source: FetchedSourceRecord,
  attempt: number,
): Promise<WorkerFetchCycleResult & { lastError?: unknown }> {
  const taskRun = await createSourceFetchTaskRun(prisma, source, {
    attempt,
    maxAttempts: getMaxFetchAttempts(),
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
      generatedMonthlyBriefings: 0,
      generatedWeeklyBriefings: 0,
      insertedOrUpdatedItems: writtenItems.length,
      recordedSourceObservations: 0,
      updatedPreferenceMemories: 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await failTaskRun(prisma, taskRun.id, error);
    await recordSourceFetchFailure(prisma, source.id, errorMessage);

    return {
      analyzedItems: 0,
      createdOrUpdatedEvents: 0,
      failedSources: 0,
      fetchedSources: 0,
      filteredItems: 0,
      generatedBriefings: 0,
      generatedMonthlyBriefings: 0,
      generatedWeeklyBriefings: 0,
      insertedOrUpdatedItems: 0,
      lastError: error,
      recordedSourceObservations: 0,
      updatedPreferenceMemories: 0,
    };
  }
}
