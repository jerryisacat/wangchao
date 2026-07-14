import { dedupEvent, type SemanticDedupCandidate, type SemanticDedupInput, type SemanticDedupResult } from "@wangchao/ai";
import { getPrismaClient, mergeSemanticEvents } from "@wangchao/db";
import { createAnalysisRuntimeWithPlan } from "./runtime.js";
import { readFloatEnv, readPositiveIntegerEnv } from "./env.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";

export async function runSemanticDedupCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ merged: number; llmCalls: number; skipped: number }> {
  const result = { merged: 0, llmCalls: 0, skipped: 0 };

  const aiRuntime = await createAnalysisRuntimeWithPlan(prisma, organizationId);
  if (!aiRuntime) return result;
  const ai = { adapter: aiRuntime.adapter, model: aiRuntime.model };

  const DEDUP_THRESHOLD = readFloatEnv("WANGCHAO_SEMANTIC_DEDUP_THRESHOLD", 0.7);
  const MAX_DEDUP_COMPARISONS = readPositiveIntegerEnv("WANGCHAO_DEDUP_MAX_COMPARISONS", 20);
  const MAX_CANDIDATES_PER_EVENT = readPositiveIntegerEnv("WANGCHAO_DEDUP_MAX_CANDIDATES", 10);

  const since = new Date();
  since.setHours(since.getHours() - 48);

  const recentEvents = await prisma.intelligenceEvent.findMany({
    where: {
      organizationId,
      status: "UNREAD",
      createdAt: { gte: since },
    },
    include: {
      eventItems: {
        include: {
          item: {
            select: {
              sourceId: true,
              source: { select: { name: true } },
            },
          },
        },
      },
      primaryItem: {
        select: {
          sourceId: true,
          source: { select: { name: true } },
        },
      },
      topic: {
        select: { name: true, description: true },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  if (recentEvents.length < 2) return result;

  const eventsByTopic = new Map<string, typeof recentEvents>();
  for (const event of recentEvents) {
    const list = eventsByTopic.get(event.topicId) ?? [];
    list.push(event);
    eventsByTopic.set(event.topicId, list);
  }

  for (const [, topicEvents] of eventsByTopic) {
    if (topicEvents.length < 2) continue;

    let comparisons = 0;
    for (let i = 1; i < topicEvents.length; i += 1) {
      if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
      if (comparisons >= MAX_DEDUP_COMPARISONS) {
        console.warn(`[dedup] Topic reached max comparisons (${MAX_DEDUP_COMPARISONS}), stopping.`);
        break;
      }

      const currentEvent = topicEvents[i]!;
      const candidates = topicEvents.slice(0, i).filter((candidate) => {
        const newSourceId = currentEvent.primaryItem?.sourceId;
        const candSourceId = candidate.primaryItem?.sourceId;
        if (newSourceId && candSourceId && newSourceId === candSourceId) {
          return false;
        }
        const shareEntity = currentEvent.entities.some((e) =>
          candidate.entities.includes(e),
        );
        return shareEntity || candidate.entities.length === 0;
      }).slice(0, MAX_CANDIDATES_PER_EVENT);

      if (candidates.length === 0) continue;

      try {
        comparisons += 1;
        result.llmCalls += 1;
        const dedupResult = await dedupEvent(
          {
            newEvent: {
              eventId: currentEvent.id,
              title: currentEvent.title,
              summary: currentEvent.summary,
              sourceName: currentEvent.primaryItem?.source.name ?? null,
              occurredAt: currentEvent.occurredAt?.toISOString() ?? null,
            },
            candidateEvents: candidates.map((c) => ({
              eventId: c.id,
              title: c.title,
              summary: c.summary,
              sourceName: c.primaryItem?.source.name ?? null,
              occurredAt: c.occurredAt?.toISOString() ?? null,
            })),
            topicName: currentEvent.topic?.name ?? "",
          },
          {
            adapter: ai.adapter,
            model: ai.model,
          },
        );
        if (dedupResult.duplicateEventId && dedupResult.confidence >= DEDUP_THRESHOLD) {
          await mergeSemanticEvents(prisma, {
            keepEventId: dedupResult.duplicateEventId,
            mergeEventIds: [currentEvent.id],
            reason: `LLM语义聚类 (置信度 ${dedupResult.confidence.toFixed(2)}): ${dedupResult.reason}`,
          });
          result.merged += 1;
        }
      } catch (error) {
        console.warn(`[dedup] LLM dedup failed for event ${currentEvent.id}: ${error instanceof Error ? error.message : String(error)}`);
        result.skipped += 1;
      }
    }
  }

  return result;
}
