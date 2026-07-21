import { extractEvent } from "@wangchao/ai";
import { buildTopicProfileContext } from "@wangchao/core";
import {
  completeTaskRun,
  createTaskRun,
  failTaskRun,
  getPrismaClient,
  recordUsageEvent,
  updateItemContentCapture,
  type ClaimedTaskRun,
} from "@wangchao/db";
import { fetchArticleMarkdown } from "@wangchao/sources";
import { createAnalysisRuntimeWithPlan } from "./runtime.js";
import type { WorkspaceScope } from "./types.js";

type PrismaClient = ReturnType<typeof getPrismaClient>;
type SummaryStatus =
  | "READY"
  | "CONTENT_FETCH_FAILED"
  | "CONTENT_INSUFFICIENT"
  | "CONTENT_UNSUPPORTED"
  | "AI_FAILED";

export interface SummaryRegenerationDeps {
  fetchArticleMarkdown: typeof fetchArticleMarkdown;
  createAnalysisRuntime: typeof createAnalysisRuntimeWithPlan;
  extractEvent: typeof extractEvent;
}

const defaultDeps: SummaryRegenerationDeps = {
  fetchArticleMarkdown,
  createAnalysisRuntime: createAnalysisRuntimeWithPlan,
  extractEvent,
};

function summaryStatusForCapture(
  status: "PENDING" | "READY" | "INSUFFICIENT" | "FETCH_FAILED" | "UNSUPPORTED",
): SummaryStatus | "PENDING" {
  switch (status) {
    case "READY":
      return "READY";
    case "INSUFFICIENT":
      return "CONTENT_INSUFFICIENT";
    case "FETCH_FAILED":
      return "CONTENT_FETCH_FAILED";
    case "UNSUPPORTED":
      return "CONTENT_UNSUPPORTED";
    case "PENDING":
      return "PENDING";
  }
}

async function finishWithoutSummary(
  prisma: PrismaClient,
  eventId: string,
  itemId: string,
  status: Exclude<SummaryStatus, "READY">,
): Promise<Record<string, unknown>> {
  await prisma.$transaction([
    prisma.item.update({
      where: { id: itemId },
      data: { status: "ANALYZED" },
    }),
    prisma.intelligenceEvent.update({
      where: { id: eventId },
      data: {
        summary: "",
        summaryRequestedAt: null,
        summaryStatus: status,
      },
    }),
  ]);
  return { eventId, itemId, summaryStatus: status };
}

/**
 * Execute exactly one user-requested summary regeneration task.
 *
 * The durable task is the orchestration record. CONTENT_FETCH and
 * AI_EVENT_EXTRACTION state remain visible through the bound Item/Event and
 * the nested extraction audit TaskRun; no workspace-wide fetch cycle runs.
 */
export async function runEventSummaryRegeneration(
  prisma: PrismaClient,
  scope: WorkspaceScope,
  claimed: ClaimedTaskRun,
  deps: SummaryRegenerationDeps = defaultDeps,
): Promise<Record<string, unknown>> {
  if (!claimed.eventId || !claimed.itemId || !claimed.topicId) {
    throw new Error("Event summary task is missing bound subject ids.");
  }

  const event = await prisma.intelligenceEvent.findUnique({
    where: { id: claimed.eventId, organizationId: scope.organizationId },
    include: {
      primaryItem: {
        include: { source: { select: { name: true } } },
      },
      topic: {
        select: { description: true, name: true, profile: true },
      },
    },
  });

  if (
    !event ||
    !event.primaryItem ||
    event.primaryItem.id !== claimed.itemId ||
    event.topicId !== claimed.topicId
  ) {
    throw new Error("Event summary task subject is invalid for this workspace.");
  }

  const item = event.primaryItem;
  const canReuseEmbeddedMarkdown =
    item.contentSource === "RSS_EMBEDDED" && Boolean(item.rawContent?.trim());

  await prisma.$transaction([
    prisma.item.update({
      where: { id: item.id },
      data: canReuseEmbeddedMarkdown
        ? {
            contentErrorCode: null,
            contentStatus: "READY",
            status: "FETCHED",
          }
        : {
            contentErrorCode: null,
            contentFetchedAt: null,
            contentSource: null,
            contentStatus: "PENDING",
            rawContent: null,
            status: "FETCHED",
          },
    }),
    prisma.intelligenceEvent.update({
      where: { id: event.id, organizationId: scope.organizationId },
      data: {
        summary: "",
        summaryStatus: "PENDING",
      },
    }),
  ]);

  let rawContent = canReuseEmbeddedMarkdown ? item.rawContent : null;
  let contentStatus: "PENDING" | "READY" | "INSUFFICIENT" | "FETCH_FAILED" | "UNSUPPORTED" =
    canReuseEmbeddedMarkdown ? "READY" : "PENDING";

  if (!canReuseEmbeddedMarkdown) {
    try {
      const capture = await deps.fetchArticleMarkdown(item.url);
      contentStatus = capture.status;
      rawContent = capture.markdown ?? null;
      await updateItemContentCapture(prisma, item.id, {
        contentErrorCode: capture.errorCode,
        contentSource: capture.contentSource,
        contentStatus: capture.status,
        rawContent,
      });
    } catch (error) {
      await updateItemContentCapture(prisma, item.id, {
        contentErrorCode: "CONTENT_CAPTURE_ERROR",
        contentSource: "ARTICLE_HTML",
        contentStatus: "FETCH_FAILED",
        rawContent: null,
      });
      await finishWithoutSummary(prisma, event.id, item.id, "CONTENT_FETCH_FAILED");
      throw error;
    }
  }

  const captureSummaryStatus = summaryStatusForCapture(contentStatus);
  if (captureSummaryStatus !== "READY") {
    const output = await finishWithoutSummary(
      prisma,
      event.id,
      item.id,
      captureSummaryStatus === "PENDING" ? "CONTENT_FETCH_FAILED" : captureSummaryStatus,
    );
    if (captureSummaryStatus === "CONTENT_FETCH_FAILED" || captureSummaryStatus === "PENDING") {
      throw new Error("Upstream content capture failed.");
    }
    return output;
  }

  const runtime = await deps.createAnalysisRuntime(prisma, scope.organizationId);
  if (!runtime) {
    return finishWithoutSummary(prisma, event.id, item.id, "AI_FAILED");
  }

  const extractionTask = await createTaskRun(prisma, {
    input: { mode: "event-summary-regeneration", model: runtime.model },
    itemId: item.id,
    eventId: event.id,
    organizationId: scope.organizationId,
    topicId: event.topicId,
    type: "AI_EVENT_EXTRACTION",
  });

  let extractionAttempted = false;
  try {
    extractionAttempted = true;
    const context = buildTopicProfileContext(event.topic.profile, {
      description: event.topic.description,
      name: event.topic.name,
    });
    const extraction = await deps.extractEvent(
      {
        item: {
          id: item.id,
          publishedAt: item.publishedAt?.toISOString() ?? null,
          rawContent,
          sourceName: item.source.name,
          summary: item.summary,
          title: item.title,
          url: item.url,
        },
        topic: {
          ...context,
          languagePreferences: context.languagePreferences,
        },
      },
      { adapter: runtime.adapter, model: runtime.model },
    );

    const summary = extraction.isRelevant ? extraction.summary.trim() : "";
    if (!summary) {
      await completeTaskRun(prisma, extractionTask.id, {
        isRelevant: extraction.isRelevant,
        model: runtime.model,
        outcome: "no-usable-summary",
      });
      return finishWithoutSummary(prisma, event.id, item.id, "AI_FAILED");
    }

    await prisma.$transaction([
      prisma.item.update({
        where: { id: item.id },
        data: { status: "ANALYZED" },
      }),
      prisma.intelligenceEvent.update({
        where: { id: event.id, organizationId: scope.organizationId },
        data: {
          summary,
          summaryRequestedAt: null,
          summaryStatus: "READY",
        },
      }),
    ]);
    await completeTaskRun(prisma, extractionTask.id, {
      isRelevant: true,
      model: runtime.model,
      outcome: "summary-regenerated",
    });
    return { eventId: event.id, itemId: item.id, summaryStatus: "READY" };
  } catch (error) {
    await failTaskRun(prisma, extractionTask.id, error);
    await finishWithoutSummary(prisma, event.id, item.id, "AI_FAILED");
    throw error;
  } finally {
    if (extractionAttempted) {
      await recordUsageEvent(prisma, {
        metadata: {
          aiSource: runtime.source,
          source: "event-summary-regeneration",
        },
        organizationId: scope.organizationId,
        quantity: 1,
        subjectId: event.id,
        subjectType: "intelligence-event",
        type: "AI_CALL",
        unit: "item",
        userId: scope.userId,
      });
    }
  }
}
