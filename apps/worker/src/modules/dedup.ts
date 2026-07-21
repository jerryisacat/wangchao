import { dedupEvent, type SemanticDedupCandidate, type SemanticDedupInput } from "@wangchao/ai";
import {
  canonicalizeTitle,
  deterministicDedupDecision,
  recallDedupCandidates,
  selectDedupCandidatesForLlm,
  type DedupEventLite,
  type DedupEventForDecision,
} from "@wangchao/core";
import { classifyTaskRunError, getPrismaClient, mergeSemanticEvents } from "@wangchao/db";
import { createAnalysisRuntimeWithPlan } from "./runtime.js";
import { readFloatEnv, readPositiveIntegerEnv } from "./env.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";

// Issue #171：跨源语义去重覆盖。
//
// 关键变更（对应 SPEC §5.4 Deduplication）：
//   1. 候选召回脱离用户阅读状态（不再 filter status=UNREAD）。
//   2. canonical title/entity alias + bounded lookback + budgeted LLM compare。
//   3. 无 AI 时使用安全 deterministic fallback，不按 URL 隔绝跨源候选。
//   4. 不同 Topic 不误合并（召回层 topicId 隔离）。
//   5. 来源完整保留（合并走 mergeSemanticEvents，保留 EventItem + Item.status=DUPLICATE）。
//
// 纯逻辑在 @wangchao/core/dedup.ts，本文件只做编排：查 DB -> 召回 -> (LLM 或 deterministic) -> 合并。

type PrismaClientLike = ReturnType<typeof getPrismaClient>;

export async function runSemanticDedupCycle(
  prisma: PrismaClientLike,
  organizationId: string,
  deps?: { resolveAiRuntime?: () => Promise<{ adapter: import("@wangchao/ai").SemanticDedupAdapter; model: string } | null> },
): Promise<{ merged: number; llmCalls: number; skipped: number }> {
  const result = { merged: 0, llmCalls: 0, skipped: 0 };

  const DEDUP_THRESHOLD = readFloatEnv("WANGCHAO_SEMANTIC_DEDUP_THRESHOLD", 0.7);
  const MAX_DEDUP_COMPARISONS = readPositiveIntegerEnv("WANGCHAO_DEDUP_MAX_COMPARISONS", 20);
  const MAX_CANDIDATES_PER_EVENT = readPositiveIntegerEnv("WANGCHAO_DEDUP_MAX_CANDIDATES", 10);
  const MAX_LLM_CANDIDATES_PER_EVENT = readPositiveIntegerEnv("WANGCHAO_DEDUP_LLM_MAX_CANDIDATES", 5);
  // bounded lookback：召回窗口（小时），默认 48h，覆盖晚到报道
  const LOOKBACK_HOURS = readPositiveIntegerEnv("WANGCHAO_DEDUP_LOOKBACK_HOURS", 48);

  const aiRuntime = deps?.resolveAiRuntime
    ? await deps.resolveAiRuntime()
    : await createAnalysisRuntimeWithPlan(prisma, organizationId);
  // 无 AI 时不再直接 return——继续走 deterministic fallback（见下方）。
  const ai = aiRuntime ? { adapter: aiRuntime.adapter, model: aiRuntime.model } : null;

  const since = new Date();
  since.setHours(since.getHours() - LOOKBACK_HOURS);

  // 候选召回脱离用户阅读状态：去掉 status=UNREAD 过滤。
  // 只保留 organizationId + summaryStatus=READY + createdAt >= since。
  // status=ARCHIVED 由 recallDedupCandidates 再过滤一次（防御）。
  const recentEvents = await prisma.intelligenceEvent.findMany({
    where: {
      organizationId,
      summaryStatus: "READY",
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

  // 转换为 DedupEventLite，供纯函数使用。
  const toLite = (e: (typeof recentEvents)[number]): DedupEventLite => ({
    eventId: e.id,
    title: e.title,
    summary: e.summary ?? "",
    entities: Array.isArray(e.entities) ? (e.entities as string[]) : [],
    sourceId: e.primaryItem?.sourceId ?? null,
    sourceName: e.primaryItem?.source.name ?? null,
    occurredAt: e.occurredAt ? e.occurredAt.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
    status: e.status as DedupEventLite["status"],
    summaryStatus: e.summaryStatus as DedupEventLite["summaryStatus"],
    topicId: e.topicId,
  });

  const eventsByTopic = new Map<string, DedupEventLite[]>();
  for (const raw of recentEvents) {
    const lite = toLite(raw);
    const list = eventsByTopic.get(lite.topicId) ?? [];
    list.push(lite);
    eventsByTopic.set(lite.topicId, list);
  }

  const nowIso = new Date().toISOString();
  const lookbackMs = LOOKBACK_HOURS * 60 * 60 * 1000;

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
      const currentRaw = recentEvents.find((e) => e.id === currentEvent.eventId)!;

      // 召回候选：脱离阅读状态、不按 URL 隔绝、bounded lookback、Topic 隔离。
      const recalled = recallDedupCandidates({
        newEvent: currentEvent,
        sameTopicEvents: topicEvents,
        now: nowIso,
        lookbackMs,
        maxCandidates: MAX_CANDIDATES_PER_EVENT,
      });

      if (recalled.length === 0) continue;

      // 阶段 A：deterministic 强召回（不耗 LLM 预算）。
      // canonical title 完全相同 或 共享 canonical entity + 时间窗 -> 直接合并。
      let mergedViaDeterministic = false;
      for (const candidate of recalled) {
        const decision = deterministicDedupDecision(
          toDecisionInput(currentEvent),
          toDecisionInput(candidate),
        );
        if (decision.isDuplicate && decision.confidence >= DEDUP_THRESHOLD) {
          try {
            comparisons += 1;
            await mergeSemanticEvents(prisma, {
              organizationId,
              keepEventId: candidate.eventId,
              mergeEventIds: [currentEvent.eventId],
              reason: `确定性去重 (置信度 ${decision.confidence.toFixed(2)}): ${decision.reason}`,
            });
            result.merged += 1;
            mergedViaDeterministic = true;
            break; // 已合并到第一个命中候选，跳出
          } catch (error) {
            console.warn(`[dedup] Deterministic merge failed for event ${currentEvent.eventId}: ${classifyTaskRunError(error)}`);
            result.skipped += 1;
          }
        }
      }
      if (mergedViaDeterministic) continue;

      // 阶段 B：无 AI 时跳过 LLM 比较（已经有 deterministic 兜底，未命中说明信号不足，不强行合并）。
      if (!ai) continue;

      // 阶段 C：有 AI 时，budgeted LLM 比较。
      // 从召回集中挑选优先级最高的子集送 LLM（canonical 命中优先）。
      const llmCandidates = selectDedupCandidatesForLlm(
        toDecisionInput(currentEvent),
        recalled,
        MAX_LLM_CANDIDATES_PER_EVENT,
      );

      if (llmCandidates.length === 0) continue;

      const candidateForLlm: SemanticDedupCandidate[] = llmCandidates.map((c) => {
        const raw = recentEvents.find((e) => e.id === c.eventId);
        return {
          eventId: c.eventId,
          title: c.title,
          summary: c.summary,
          sourceName: raw?.primaryItem?.source.name ?? c.sourceName ?? null,
          occurredAt: c.occurredAt,
        };
      });

      try {
        comparisons += 1;
        result.llmCalls += 1;
        const dedupInput: SemanticDedupInput = {
          newEvent: {
            eventId: currentEvent.eventId,
            title: currentEvent.title,
            summary: currentEvent.summary,
            sourceName: currentRaw.primaryItem?.source.name ?? null,
            occurredAt: currentEvent.occurredAt,
          },
          candidateEvents: candidateForLlm,
          topicName: currentRaw.topic?.name ?? "",
          topicDescription: currentRaw.topic?.description ?? null,
        };
        const dedupResult = await dedupEvent(dedupInput, {
          adapter: ai.adapter,
          model: ai.model,
        });
        if (dedupResult.duplicateEventId && dedupResult.confidence >= DEDUP_THRESHOLD) {
          await mergeSemanticEvents(prisma, {
            organizationId,
            keepEventId: dedupResult.duplicateEventId,
            mergeEventIds: [currentEvent.eventId],
            reason: `LLM语义聚类 (置信度 ${dedupResult.confidence.toFixed(2)}): ${dedupResult.reason}`,
          });
          result.merged += 1;
        }
      } catch (error) {
        console.warn(`[dedup] LLM dedup failed for event ${currentEvent.eventId}: ${classifyTaskRunError(error)}`);
        result.skipped += 1;
      }
    }
  }

  return result;
}

function toDecisionInput(lite: DedupEventLite): DedupEventForDecision {
  return {
    title: lite.title,
    summary: lite.summary,
    entities: lite.entities,
    sourceId: lite.sourceId,
    occurredAt: lite.occurredAt,
  };
}
