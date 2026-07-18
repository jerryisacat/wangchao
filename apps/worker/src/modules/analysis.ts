import {
  extractEvent,
  type EventExtractionAdapter,
  type EventExtractionResult,
} from "@wangchao/ai";
import {
  buildTopicProfileContext,
  evaluateRelevance,
  createIntelligenceEventDraft,
  createIntelligenceEventDraftFromExtraction,
  type AiEventExtraction,
  type RelevanceDecision,
} from "@wangchao/core";
import {
  createTaskRun,
  completeTaskRun,
  failTaskRun,
  getPrismaClient,
  getSourceQualitySummary,
  listFetchedItemsForAnalysis,
  markItemFiltered,
  upsertIntelligenceEventFromItem,
  recordUsageEvent,
} from "@wangchao/db";
import { createAnalysisRuntimeWithPlan } from "./runtime.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";
import type { WorkerFetchCycleResult } from "./types.js";

export function resolveFilteredNoiseReason(input: {
  llmNoiseReason?: string;
  ruleDecision?: RelevanceDecision | null;
  usedFallback: boolean;
}): string {
  return (
    input.ruleDecision?.noiseReason ??
    input.llmNoiseReason ??
    (input.usedFallback
      ? "AI 分析失败且规则判定为噪声。"
      : "Item did not pass relevance threshold.")
  );
}

function buildExtractionInput(
  item: {
    id: string;
    title: string;
    summary?: string | null;
    url: string;
    publishedAt?: Date | null;
    rawContent?: string | null;
    contentStatus: "PENDING" | "READY" | "INSUFFICIENT" | "FETCH_FAILED" | "UNSUPPORTED";
    sourceId?: string | null;
    sourceName?: string | null;
    topicDescription?: string | null;
    topicName: string;
  },
  topicProfile: unknown,
): {
  item: {
    id: string;
    title: string;
    summary?: string | null;
    url: string;
    publishedAt?: string | null;
    sourceName?: string | null;
    rawContent?: string | null;
  };
  topic: {
    description?: string | null;
    entities?: string[];
    excludeScope?: string[];
    importanceRules?: string[];
    includeScope?: string[];
    keywords: string[];
    name: string;
    languagePreferences?: {
      outputLanguage: string;
      terminologyRules?: string[];
    };
  };
} {
  const context = buildTopicProfileContext(topicProfile, {
    description: item.topicDescription,
    name: item.topicName,
  });

  return {
    item: {
      id: item.id,
      publishedAt: item.publishedAt?.toISOString() ?? null,
      sourceName: item.sourceName ?? null,
      summary: item.summary,
      title: item.title,
      url: item.url,
      rawContent: item.rawContent ?? null,
    },
    topic: {
      ...context,
      languagePreferences: context.languagePreferences,
    },
  };
}

export function canUseCapturedContentForLlm(
  contentStatus: "PENDING" | "READY" | "INSUFFICIENT" | "FETCH_FAILED" | "UNSUPPORTED",
  rawContent?: string | null,
): boolean {
  return contentStatus === "READY" && Boolean(rawContent?.trim());
}

function summaryStatusForContent(
  contentStatus: "PENDING" | "READY" | "INSUFFICIENT" | "FETCH_FAILED" | "UNSUPPORTED",
): "PENDING" | "CONTENT_FETCH_FAILED" | "CONTENT_INSUFFICIENT" | "CONTENT_UNSUPPORTED" | "AI_FAILED" {
  switch (contentStatus) {
    case "PENDING":
      return "PENDING";
    case "INSUFFICIENT":
      return "CONTENT_INSUFFICIENT";
    case "UNSUPPORTED":
      return "CONTENT_UNSUPPORTED";
    case "FETCH_FAILED":
      return "CONTENT_FETCH_FAILED";
    case "READY":
      return "AI_FAILED";
  }
}

function extractionToAiEventExtraction(
  extraction: EventExtractionResult,
): AiEventExtraction {
  return {
    category: extraction.category,
    entities: extraction.entities ?? [],
    followUpSuggestion: extraction.followUpSuggestion ?? "",
    importanceExplanation: extraction.importanceExplanation,
    importanceScore: extraction.importanceScore,
    isRelevant: extraction.isRelevant,
    matchedKeywords: extraction.matchedKeywords,
    noiseReason: extraction.noiseReason,
    relevanceScore: extraction.relevanceScore,
    summary: extraction.summary,
    title: extraction.title,
  };
}

export async function runAnalysisCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  userId: string,
): Promise<Pick<
  WorkerFetchCycleResult,
  "analyzedItems" | "createdOrUpdatedEvents" | "filteredItems"
>> {
  const items = await listFetchedItemsForAnalysis(prisma, { organizationId });
  const aiRuntime = await createAnalysisRuntimeWithPlan(prisma, organizationId);
  const ai = aiRuntime
    ? { adapter: aiRuntime.adapter as EventExtractionAdapter, model: aiRuntime.model }
    : null;
  const aiSource = aiRuntime?.source ?? "official";
  const result = {
    analyzedItems: 0,
    createdOrUpdatedEvents: 0,
    filteredItems: 0,
    llmAttempts: 0,
    llmItems: 0,
    llmFallbackItems: 0,
  };

  for (const item of items) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
    const relevanceTask = await createTaskRun(prisma, {
      input: {
        mode: ai ? "llm-with-rules-fallback" : "explainable-rules",
      },
      itemId: item.id,
      organizationId,
      topicId: item.topicId,
      type: "AI_RELEVANCE",
    });

    try {
      let draft = null;
      let rawAiResponse: Record<string, unknown> = {
        mode: "uninitialized",
      };
      let ruleDecision: RelevanceDecision | null = null;
      let llmNoiseReason: string | undefined;
      let usedLlm = false;
      let usedFallback = false;
      let summaryStatus: "PENDING" | "READY" | "CONTENT_FETCH_FAILED" | "CONTENT_INSUFFICIENT" | "CONTENT_UNSUPPORTED" | "AI_FAILED" = summaryStatusForContent(item.contentStatus);
      const hasReadyContent = canUseCapturedContentForLlm(item.contentStatus, item.rawContent);

      if (ai && hasReadyContent) {
        result.llmAttempts += 1;
        const extractionTask = await createTaskRun(prisma, {
          input: { model: ai.model },
          itemId: item.id,
          organizationId,
          topicId: item.topicId,
          type: "AI_EVENT_EXTRACTION",
        });

        try {
          const extractionInput = buildExtractionInput(item, item.topicProfile);
          const extraction = await extractEvent(extractionInput, {
            adapter: ai.adapter,
            model: ai.model,
          });
          // Issue #170: 接入 #176 的 Source 质量数据作为独立维度。
          const sourceQualityFactor = await resolveSourceQualityFactor(
            prisma,
            item.organizationId,
            item.sourceId,
          );
          draft = createIntelligenceEventDraftFromExtraction(
            {
              fetchedAt: item.fetchedAt,
              id: item.id,
              publishedAt: item.publishedAt,
              summary: item.summary,
              title: item.title,
              topicProfile: item.topicProfile,
              url: item.url,
            },
            extractionToAiEventExtraction(extraction),
            { sourceQualityFactor },
          );
          rawAiResponse = {
            mode: "llm",
            extraction,
            scoring: draft?.scoringBreakdown,
          };
          llmNoiseReason = extraction.noiseReason;
          usedLlm = true;
          summaryStatus = "READY";
          await completeTaskRun(prisma, extractionTask.id, {
            isRelevant: extraction.isRelevant,
            model: ai.model,
            noiseReason: extraction.noiseReason,
            outcome: draft ? "draft-created" : "filtered",
          });
        } catch (error) {
          usedFallback = true;
          await failTaskRun(prisma, extractionTask.id, error);
          process.stderr.write(
            `[analysis-cycle] LLM extraction failed for item ${item.id} (topic ${item.topicId}): ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }

      if (!usedLlm) {
        ruleDecision = evaluateRelevance({
          fetchedAt: item.fetchedAt,
          id: item.id,
          publishedAt: item.publishedAt,
          summary: item.summary,
          title: item.title,
          topicProfile: item.topicProfile,
          url: item.url,
        });
        draft = createIntelligenceEventDraft(
          {
            fetchedAt: item.fetchedAt,
            id: item.id,
            publishedAt: item.publishedAt,
            summary: item.summary,
            title: item.title,
            topicProfile: item.topicProfile,
            url: item.url,
          },
          ruleDecision,
        );
        rawAiResponse = {
          mode: hasReadyContent ? "explainable-rules-ai-failed" : "explainable-rules-content-gate",
          relevance: ruleDecision,
          contentStatus: item.contentStatus,
          scoring: draft?.scoringBreakdown,
          ...(usedFallback ? { llmFallback: true } : {}),
        };
        summaryStatus = hasReadyContent ? "AI_FAILED" : summaryStatusForContent(item.contentStatus);
        if (draft) {
          draft = { ...draft, summary: "" };
        }
      }

      result.analyzedItems += 1;
      if (usedLlm) result.llmItems += 1;
      if (usedFallback) result.llmFallbackItems += 1;

      if (!draft) {
        const noiseReason = resolveFilteredNoiseReason({
          llmNoiseReason,
          ruleDecision,
          usedFallback,
        });
        await markItemFiltered(prisma, { organizationId }, item.id, noiseReason);
        result.filteredItems += 1;
        await completeTaskRun(prisma, relevanceTask.id, {
          llmFallback: usedFallback,
          mode: usedLlm ? "llm" : "explainable-rules",
          noiseReason,
          outcome: "filtered",
        });
        continue;
      }

      const event = await upsertIntelligenceEventFromItem(prisma, {
        organizationId: item.organizationId,
        topicId: item.topicId,
        primaryItemId: item.id,
        title: draft.title,
        summary: draft.summary,
        summaryStatus,
        itemStatus: summaryStatus === "PENDING" ? "FETCHED" : "ANALYZED",
        category: draft.category,
        entities: draft.entities,
        score: draft.score,
        gravityScore: draft.gravityScore,
        eventHash: draft.eventHash,
        titleHash: draft.titleHash,
        explanation: draft.explanation,
        followUpSuggestion: draft.followUpSuggestion,
        mergeReason: draft.mergeReason,
        occurredAt: draft.occurredAt,
        rawAiResponse,
      });
      result.createdOrUpdatedEvents += 1;
      await completeTaskRun(prisma, relevanceTask.id, {
        eventId: event.id,
        llmFallback: usedFallback,
        mode: usedLlm ? "llm" : "explainable-rules",
        summaryStatus,
        outcome: "event-upserted",
      });
    } catch (error) {
      await failTaskRun(prisma, relevanceTask.id, error);
      throw error;
    }
  }

  if (ai && result.llmAttempts > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        aiSource,
        attemptedItems: result.llmAttempts,
        filteredItems: result.filteredItems,
        fallbackItems: result.llmFallbackItems,
        source: "worker-analysis-cycle",
        successfulItems: result.llmItems,
      },
      organizationId,
      quantity: result.llmAttempts,
      subjectType: "analysis-cycle",
      type: "AI_CALL",
      unit: "item",
      userId,
    });
  }

  return result;
}

/**
 * Issue #170: 从 #176 持久化的 Source.qualityScore 派生 sourceQualityFactor。
 *
 * qualityScore 是 0-1 区间的命中率/噪声率综合分（见 getSourceQualitySummary）。
 * 映射策略：
 *   - qualityScore >= 0.6（高命中）→ factor 1.0（中性偏正，不过度奖励）
 *   - qualityScore 0.3-0.6 → factor 0.7（轻度降权）
 *   - qualityScore < 0.3 或 CANDIDATE/MUTED/REJECTED 状态 → factor 0.5（显著降权）
 *   - 无数据 / 查询失败 → factor 1.0（中性，不惩罚未知来源）
 *
 * 计算 fallback 安全：任何异常返回 1.0，不阻塞分析主流程。
 */
async function resolveSourceQualityFactor(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  sourceId: string,
): Promise<number> {
  try {
    const summary = await getSourceQualitySummary(prisma, {
      organizationId,
      sourceId,
    });
    if (!summary) {
      return 1;
    }
    // MUTED/REJECTED 来源的内容理论上不应进入分析，但防御性降权。
    if (summary.status === "MUTED" || summary.status === "REJECTED") {
      return 0.5;
    }
    const q = summary.qualityScore;
    if (!Number.isFinite(q) || q === 0) {
      // qualityScore=0 且 stale=true 表示数据未就绪，按中性处理。
      return 1;
    }
    if (q >= 0.6) return 1;
    if (q >= 0.3) return 0.7;
    return 0.5;
  } catch (error) {
    process.stderr.write(
      `[analysis-cycle] getSourceQualitySummary failed for source ${sourceId}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
