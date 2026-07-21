import {
  getPrismaClient,
  applyAutomaticSourceGovernance,
  listSourceGovernanceReport,
  recordSourceQualityObservation,
  getSourceQualitySummary,
  listCandidateRssSourcesForObservation,
  listCandidateItemsForObservation,
  computeCandidateQualityMetrics,
  recordSourceFetchSuccess,
  recordSourceFetchFailure,
  setSourceObserveExpiry,
  recommendCandidatePromotion,
  upsertFetchedItems,
  listExpiredCandidateSources,
  type CandidateQualityMetrics,
} from "@wangchao/db";
import { evaluateRelevance } from "@wangchao/core";
import { pLimit, getCandidateObservationLimit } from "./env.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";
import { fetchSourceItemsForKind, mapFetchedSourceItem } from "./fetch.js";

/**
 * 默认观察窗口（SPEC §5.2：14 天）。样本不足时按此天数延长，不缩短。
 */
export const CANDIDATE_DEFAULT_OBSERVATION_DAYS = 14;

/**
 * 抓取失败判据：lastError 非空且 lastErrorAt 在此时窗内视为「近期失败」，
 * 此时不得仅凭空样本拒绝候选源。
 */
const CANDIDATE_RECENT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function runSourceGovernanceObservationCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ autoMuted: number; observed: number }> {
  const report = await listSourceGovernanceReport(prisma, { organizationId });

  // 1. 同事务持久化 qualityScore 到 Source + 写 SourceObservation 历史。
  //    SPEC §5.2/§6.2：trustScore 是 discovery 产物，从 Source 读入传入公式，
  //    observation 不改 trustScore，只回写 qualityScore。
  await Promise.all(
    report.map((source) =>
      recordSourceQualityObservation(prisma, {
        duplicateRate: source.duplicateRate,
        evidence: {
          recommendation: source.recommendation,
          totalItems: source.totalItems,
        },
        hitRate: source.hitRate,
        noiseRate: source.noiseRate,
        organizationId,
        sourceId: source.sourceId,
        topicId: source.topicId,
        trustScore: source.trustScore,
      }),
    ),
  );

  // 2. 自动治理：小样本不误杀，只自动 MUTE，REJECT 保留人工确认。
  const governance = await applyAutomaticSourceGovernance(prisma, {
    organizationId,
    sources: report.map((source) => ({
      recommendation: source.recommendation,
      sourceId: source.sourceId,
      status: source.status,
      topicId: source.topicId,
      totalItems: source.totalItems,
    })),
  });

  return { autoMuted: governance.autoMuted.length, observed: report.length };
}

export async function runCandidateObservationCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ observedCandidates: number; failedCandidates: number; insertedItems: number }> {
  const result = { observedCandidates: 0, failedCandidates: 0, insertedItems: 0 };

  if (process.env.WANGCHAO_CANDIDATE_OBSERVATION_ENABLED !== "true") {
    return result;
  }

  const candidates = await listCandidateRssSourcesForObservation(prisma, { organizationId });
  if (candidates.length === 0) return result;

  const limit = pLimit(getCandidateObservationLimit());

  const candidateResults = await Promise.all(
    candidates.map((source) => limit(async () => {
      if (isCycleShuttingDown() || isCycleTimeExhausted()) return;
      try {
        const items = await fetchSourceItemsForKind(source, {});
        const writtenItems = await upsertFetchedItems(prisma, items.map((item) =>
          mapFetchedSourceItem(source, item, {
            ...item.rawMetadata,
            candidateObservation: true,
          }),
        ));
        await recordSourceFetchSuccess(prisma, source.id);
        result.observedCandidates += 1;
        result.insertedItems += writtenItems.length;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await recordSourceFetchFailure(prisma, source.id, errorMessage);
        result.failedCandidates += 1;
      }
    })),
  );
  void candidateResults;

  return result;
}

/**
 * 隔离的 Candidate 质量评估（Issue #169）。
 *
 * 与正式 analysis pipeline 的关键区别：
 * - 只读取 Candidate 源的 Item（不经过 ACTIVE 过滤），所以即使 Candidate
 *   源的 Item 永远不关联 IntelligenceEvent，也能算出 hit/noise/duplicate。
 * - 用 @wangchao/core 的 evaluateRelevance（确定性规则）做隔离相关性判断，
 *   **不**调 LLM、**不**写 IntelligenceEvent、**不**改 Item.status（除非是
 *   全新的 observation 审计），因此不会污染正式事件链或 briefing。
 * - 指标经 recordSourceQualityObservation 持久化到 Source.qualityScore +
 *   SourceObservation 历史，供 getSourceQualitySummary / 晋升决策复用。
 *
 * 返回本轮评估的源数量（不含无 Item 的源）。
 */
export async function runCandidateQualityObservationCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ observedCandidates: number; persistedObservations: number }> {
  const items = await listCandidateItemsForObservation(prisma, { organizationId });
  if (items.length === 0) {
    return { observedCandidates: 0, persistedObservations: 0 };
  }

  // 隔离的相关性评估：不写库、不调 LLM，纯规则决策。
  // isRelevant = 规则判定通过；isNoise = 规则判定不通过（噪声）；
  // isDuplicate = Item.status 已被标记为 DUPLICATE（由正式 dedup 流程产出，
  //   即使 Candidate Item 不进 analysis，dedup 仍可能在跨源去重时标记）。
  const relevanceResults = items.map((item) => {
    const decision = evaluateRelevance({
      fetchedAt: item.fetchedAt,
      id: item.id,
      publishedAt: item.publishedAt,
      summary: item.summary,
      title: item.title,
      topicProfile: item.topicProfile,
      url: item.url,
    });
    return {
      isDuplicate: item.status === "DUPLICATE",
      isNoise: !decision.isRelevant,
      isRelevant: decision.isRelevant,
      sourceId: item.sourceId,
      topicId: item.topicId,
    };
  });

  const metricsBySource = computeCandidateQualityMetrics(relevanceResults);

  // 逐源持久化：trustScore 从 getSourceQualitySummary 读（已被 discovery 写入），
  // 若该 Candidate 源还没有 summary（理论不应发生，但防御），trustScore 退回 0。
  let persisted = 0;
  for (const [, metrics] of metricsBySource) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
    const summary = await getSourceQualitySummary(prisma, {
      organizationId,
      sourceId: metrics.sourceId,
    });
    await recordSourceQualityObservation(prisma, {
      duplicateRate: metrics.duplicateRate,
      evidence: {
        candidateObservation: true,
        formulaStage: "candidate-isolated",
        totalItems: metrics.totalItems,
      },
      hitRate: metrics.hitRate,
      noiseRate: metrics.noiseRate,
      organizationId,
      sourceId: metrics.sourceId,
      topicId: metrics.topicId,
      trustScore: summary?.trustScore ?? 0,
    });
    persisted += 1;
  }

  return {
    observedCandidates: metricsBySource.size,
    persistedObservations: persisted,
  };
}

/**
 * 观察期到期复审（Issue #169 重建版）。
 *
 * 旧实现的缺陷：用 `item.intelligenceEvents: { some: {} }` 作为批准判据，
 * 但 Candidate 的 Item 永远进不了 analysis（listFetchedItemsForAnalysis
 * 过滤 source.status=ACTIVE），因此 Candidate 永远不会关联 IntelligenceEvent，
 * 导致所有到期 Candidate 被误 REJECTED。
 *
 * 新逻辑：
 * 1. getSourceQualitySummary 读持久化 qualityScore + 最新 observation 指标。
 * 2. recommendCandidatePromotion 按 hit/noise/duplicate/trust/totalItems 给建议。
 * 3. APPROVE 且 decideAutomaticGovernance 允许 → 自动晋升 ACTIVE。
 * 4. MUTE → 自动降权 MUTED（复用 applyAutomaticSourceGovernance 的安全约束）。
 * 5. INSUFFICIENT_SAMPLE / OBSERVE → 延长观察期（默认 +14 天），**不拒绝**。
 * 6. REJECT → **仅写审计 observation**，不自动落到 REJECTED，保留人工确认。
 * 7. 抓取失败（lastError 近期非空）→ 强制走 INSUFFICIENT_SAMPLE 分支，不拒绝。
 *
 * 返回各分支计数，用于 UsageEvent 审计。
 */
export async function runExpiredCandidateReviewCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<ExpiredCandidateReviewResult> {
  const result: ExpiredCandidateReviewResult = {
    reviewed: 0,
    autoApproved: 0,
    autoMuted: 0,
    autoRejected: 0,
    extended: 0,
    pendingManual: 0,
  };

  const expired = await listExpiredCandidateSources(prisma, { organizationId });
  if (expired.length === 0) return result;

  const sourcesForGovernance: Array<{
    recommendation: "APPROVE" | "OBSERVE" | "MUTE" | "REJECT";
    sourceId: string;
    status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED";
    topicId: string;
    totalItems: number;
  }> = [];

  for (const candidate of expired) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
    result.reviewed += 1;

    const summary = await getSourceQualitySummary(prisma, {
      organizationId,
      sourceId: candidate.sourceId,
    });

    // Candidate 期间抓取的 Item 总数：summary 只有指标比例，这里用 Item count
    // 取真实样本量。listExpiredCandidateSources 不返回 item 关系，单独 count。
    const totalItems = await prisma.item.count({
      where: { sourceId: candidate.sourceId },
    });

    const hasRecentFetchFailure = await detectRecentFetchFailure(
      prisma,
      candidate.sourceId,
    );

    // 无 summary = 该源从未跑过 observation（异常路径，但需防御）。
    // 视为样本不足，延长观察，不拒绝。
    if (!summary) {
      await setSourceObserveExpiry(prisma, {
        days: CANDIDATE_DEFAULT_OBSERVATION_DAYS,
        organizationId,
        sourceId: candidate.sourceId,
      });
      await writeReviewAuditObservation(prisma, {
        action: "extend-insufficient-sample",
        organizationId,
        reason: "no-quality-summary",
        sourceId: candidate.sourceId,
        topicId: candidate.topicId,
      });
      result.extended += 1;
      continue;
    }

    const recommendation = recommendCandidatePromotion({
      hasRecentFetchFailure,
      hitRate: summary.latestHitRate,
      noiseRate: summary.latestNoiseRate,
      duplicateRate: summary.latestDuplicateRate,
      qualityScore: summary.qualityScore,
      stale: summary.stale,
      status: summary.status,
      totalItems,
      trustScore: summary.trustScore,
    });

    if (recommendation === "INSUFFICIENT_SAMPLE") {
      await setSourceObserveExpiry(prisma, {
        days: CANDIDATE_DEFAULT_OBSERVATION_DAYS,
        organizationId,
        sourceId: candidate.sourceId,
      });
      await writeReviewAuditObservation(prisma, {
        action: "extend-insufficient-sample",
        organizationId,
        reason: hasRecentFetchFailure
          ? "recent-fetch-failure"
          : totalItems < 8
            ? "below-min-sample"
            : "missing-observation-metrics",
        sourceId: candidate.sourceId,
        topicId: candidate.topicId,
      });
      result.extended += 1;
      continue;
    }

    if (recommendation === "OBSERVE") {
      // 指标模糊：延长一轮观察，不自动变更状态。
      await setSourceObserveExpiry(prisma, {
        days: CANDIDATE_DEFAULT_OBSERVATION_DAYS,
        organizationId,
        sourceId: candidate.sourceId,
      });
      await writeReviewAuditObservation(prisma, {
        action: "extend-observe",
        organizationId,
        reason: "ambiguous-metrics",
        sourceId: candidate.sourceId,
        topicId: candidate.topicId,
      });
      result.extended += 1;
      continue;
    }

    if (recommendation === "REJECT") {
      // REJECT 仅写审计，不自动落到 REJECTED，保留人工确认。
      await writeReviewAuditObservation(prisma, {
        action: "recommend-reject-manual",
        organizationId,
        reason: "low-hit-high-noise",
        sourceId: candidate.sourceId,
        topicId: candidate.topicId,
      });
      // 清除 observeExpiresAt，避免反复进入到期复审；状态保持 CANDIDATE，
      // 人工 REJECT 后才落到 REJECTED。
      await prisma.source.update({
        data: { observeExpiresAt: null },
        where: { id: candidate.sourceId },
      });
      result.pendingManual += 1;
      continue;
    }

    // APPROVE / MUTE 交给 applyAutomaticSourceGovernance 处理：
    // - APPROVE：decideAutomaticGovernance 不直接处理 APPROVE（它只自动 MUTE），
    //   所以 APPROVE 在这里显式落到 ACTIVE。
    // - MUTE：交给 applyAutomaticSourceGovernance（它内置小样本保护 + REJECTED 保护）。
    if (recommendation === "APPROVE") {
      await prisma.$transaction(async (transaction) => {
        await transaction.source.update({
          data: { observeExpiresAt: null, status: "ACTIVE" },
          where: { id: candidate.sourceId },
        });
        await transaction.sourceObservation.create({
          data: {
            organizationId,
            sourceId: candidate.sourceId,
            topicId: candidate.topicId,
            evidence: {
              action: "auto-approve-candidate",
              hitRate: summary.latestHitRate,
              noiseRate: summary.latestNoiseRate,
              qualityScore: summary.qualityScore,
              reason: "candidate-promotion-approved",
              source: "expired-candidate-review",
              totalItems,
            },
          },
        });
      });
      result.autoApproved += 1;
      continue;
    }

    // MUTE：收集起来批量交给 applyAutomaticSourceGovernance。
    sourcesForGovernance.push({
      recommendation,
      sourceId: candidate.sourceId,
      status: summary.status,
      topicId: candidate.topicId,
      totalItems,
    });
  }

  if (sourcesForGovernance.length > 0) {
    const governance = await applyAutomaticSourceGovernance(prisma, {
      organizationId,
      sources: sourcesForGovernance,
    });
    result.autoMuted = governance.autoMuted.length;
    // 被 auto-mute 的源清除 observeExpiresAt。
    for (const sourceId of governance.autoMuted) {
      await prisma.source.update({
        data: { observeExpiresAt: null },
        where: { id: sourceId },
      }).catch(() => {
        // 更新失败不阻塞循环，审计已落库。
      });
    }
  }

  return result;
}

export interface ExpiredCandidateReviewResult {
  reviewed: number;
  autoApproved: number;
  autoMuted: number;
  autoRejected: number;
  extended: number;
  pendingManual: number;
}

/**
 * 检测 Candidate 源近期是否有抓取失败（lastError 非空且 lastErrorAt 在窗口内）。
 * 抓取失败时不得仅凭空样本拒绝。
 */
async function detectRecentFetchFailure(
  prisma: ReturnType<typeof getPrismaClient>,
  sourceId: string,
): Promise<boolean> {
  const source = await prisma.source.findFirst({
    select: { lastError: true, lastErrorAt: true },
    where: { id: sourceId },
  });
  if (!source || !source.lastError || !source.lastErrorAt) {
    return false;
  }
  const now = Date.now();
  const failureTime = source.lastErrorAt.getTime();
  return now - failureTime < CANDIDATE_RECENT_FAILURE_WINDOW_MS;
}

async function writeReviewAuditObservation(
  prisma: ReturnType<typeof getPrismaClient>,
  input: {
    action: string;
    organizationId: string;
    reason: string;
    sourceId: string;
    topicId: string;
  },
): Promise<void> {
  await prisma.sourceObservation.create({
    data: {
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      topicId: input.topicId,
      evidence: {
        action: input.action,
        reason: input.reason,
        source: "expired-candidate-review",
      },
    },
  });
}
