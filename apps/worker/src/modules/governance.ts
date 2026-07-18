import {
  getPrismaClient,
  applyAutomaticSourceGovernance,
  listSourceGovernanceReport,
  recordSourceQualityObservation,
  listCandidateRssSourcesForObservation,
  recordSourceFetchSuccess,
  recordSourceFetchFailure,
  upsertFetchedItems,
  listExpiredCandidateSources,
} from "@wangchao/db";
import { fetchRssFeed } from "@wangchao/sources";
import { getCandidateObservationLimit, sleep, pLimit } from "./env.js";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";
import { mapFetchedSourceItem } from "./fetch.js";

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
        const items = await fetchRssFeed(source.url);
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

export async function runExpiredCandidateReviewCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
): Promise<{ reviewed: number; autoApproved: number; autoRejected: number }> {
  const result = { reviewed: 0, autoApproved: 0, autoRejected: 0 };

  const expired = await listExpiredCandidateSources(prisma, { organizationId });
  if (expired.length === 0) return result;

  for (const candidate of expired) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
    result.reviewed += 1;

    const itemCount = await prisma.item.count({
      where: {
        sourceId: candidate.sourceId,
        intelligenceEvents: { some: {} },
      },
    });

    if (itemCount > 0) {
      await prisma.source.update({
        data: { status: "ACTIVE", observeExpiresAt: null },
        where: { id: candidate.sourceId },
      });
      result.autoApproved += 1;
    } else {
      await prisma.source.update({
        data: { status: "REJECTED", observeExpiresAt: null },
        where: { id: candidate.sourceId },
      });
      result.autoRejected += 1;
    }
  }

  return result;
}
