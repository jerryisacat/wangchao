import {
  getPrismaClient,
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

export async function runSourceGovernanceObservationCycle(
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
        const writtenItems = await upsertFetchedItems(prisma, items.map((item) => ({
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
          rawMetadata: { ...item.rawMetadata, candidateObservation: true },
        })));
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
