import {
  completeTaskRun,
  createTaskRun,
  createSourceFetchTaskRun,
  failTaskRun,
  getPrismaClient,
  recordSourceFetchFailure,
  recordSourceFetchSuccess,
  upsertFetchedItems,
  listItemsPendingContentCapture,
  updateItemContentCapture,
  type FetchedSourceRecord,
  type NormalizedFetchedItemInput,
} from "@wangchao/db";
import {
  fetchRssFeed,
  isFetchRssRetryable,
  fetchArticleMarkdown,
  fetchSource,
  isFetchRetryable,
  type NormalizedSourceItem,
} from "@wangchao/sources";
import { getMaxFetchAttempts, getFetchConcurrency, getBackoffBaseMs, sleep, pLimit } from "./env.js";
import type { WorkerFetchCycleResult } from "./types.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";

export function mapFetchedSourceItem(
  source: FetchedSourceRecord,
  item: NormalizedSourceItem,
  rawMetadata?: Record<string, unknown>,
): NormalizedFetchedItemInput {
  return {
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
    rawContent: item.rawContent,
    contentStatus: item.contentStatus,
    contentSource: item.contentSource,
    rawMetadata: rawMetadata ?? item.rawMetadata,
  };
}

export async function runArticleFetchCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ fetched: number; failed: number }> {
  const result = { fetched: 0, failed: 0 };
  const items = await listItemsPendingContentCapture(prisma, { organizationId });

  if (items.length === 0) return result;

  const limit = pLimit(getFetchConcurrency());
  const articleResults = await Promise.all(
    items.map((item) =>
      limit(async () => {
        if (isCycleShuttingDown() || isCycleTimeExhausted()) return;
        const taskRun = await createTaskRun(prisma, {
          input: { mode: "article-markdown" },
          itemId: item.id,
          organizationId,
          topicId: item.topicId,
          type: "CONTENT_FETCH",
        });
        try {
          const capture = await fetchArticleMarkdown(item.url);
          await updateItemContentCapture(prisma, item.id, {
            contentErrorCode: capture.errorCode,
            contentSource: capture.contentSource,
            contentStatus: capture.status,
            rawContent: capture.markdown ?? null,
          });
          if (capture.status === "READY") {
            result.fetched += 1;
          } else {
            result.failed += 1;
          }
          await completeTaskRun(prisma, taskRun.id, {
            contentStatus: capture.status,
            errorCode: capture.errorCode ?? null,
          });
        } catch (error) {
          await updateItemContentCapture(prisma, item.id, {
            contentErrorCode: "CONTENT_CAPTURE_ERROR",
            contentSource: "ARTICLE_HTML",
            contentStatus: "FETCH_FAILED",
            rawContent: null,
          });
          await failTaskRun(prisma, taskRun.id, error);
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

    if (!isFetchRetryable(lastError)) {
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
    failedSubCycles: [],
    fetchedSources: 0,
    filteredItems: 0,
    generatedBriefings: 0,
    generatedMonthlyBriefings: 0,
    generatedWeeklyBriefings: 0,
    insertedOrUpdatedItems: 0,
    lastError,
    autoMutedSources: 0,
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
    // Issue #168: dispatch by Source.kind. RSS goes through fetchRssFeed
    // (existing behaviour); WEB and any future kind go through the adapter
    // registry in @wangchao/sources. Unknown kinds throw a typed
    // UnknownSourceKindError which is non-retryable - the retry loop above
    // will stop and the TaskRun records the failure class.
    const items = await fetchSourceItemsForKind(source, {});
    const writtenItems = await upsertFetchedItems(
      prisma,
      items.map((item) => mapFetchedSourceItem(source, item)),
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
      failedSubCycles: [],
      fetchedSources: 1,
      filteredItems: 0,
      generatedBriefings: 0,
      generatedMonthlyBriefings: 0,
      generatedWeeklyBriefings: 0,
      insertedOrUpdatedItems: writtenItems.length,
      autoMutedSources: 0,
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
      failedSubCycles: [],
      fetchedSources: 0,
      filteredItems: 0,
      generatedBriefings: 0,
      generatedMonthlyBriefings: 0,
      generatedWeeklyBriefings: 0,
      insertedOrUpdatedItems: 0,
      lastError: error,
      autoMutedSources: 0,
      recordedSourceObservations: 0,
      updatedPreferenceMemories: 0,
    };
  }
}

/**
 * Dispatch a fetch-scheduling record to the correct adapter by `source.kind`.
 *
 * `source.kind` is populated by `listActiveSourcesForFetch` /
 * `listCandidateRssSourcesForObservation` (both select the `kind` column).
 * Legacy callers that omit `kind` default to RSS so existing RSS sources keep
 * their pre-#168 behaviour even if a stale code path does not select `kind`.
 *
 * Exposed as a standalone function so unit fixtures can exercise the dispatch
 * contract without standing up a Prisma client.
 */
export async function fetchSourceItemsForKind(
  source: FetchedSourceRecord,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<NormalizedSourceItem[]> {
  const kind = source.kind ?? "RSS";
  if (kind === "RSS") {
    return fetchRssFeed(source.url, options);
  }
  return fetchSource({
    id: source.id,
    kind,
    name: source.name,
    url: source.url,
    rawMetadata: undefined,
  }, options);
}
