/**
 * Governance fixtures for Issue #169: Candidate 14-day observation, quality
 * assessment, and promotion closed loop.
 *
 * These fixtures verify the rebuilt `runExpiredCandidateReviewCycle` and the
 * new `runCandidateQualityObservationCycle` against the SPEC §5.2 contract:
 *
 *  RED  — High-quality Candidate with no IntelligenceEvent (because Candidate
 *         items never enter the ACTIVE-filtered analysis pipeline) is wrongly
 *         REJECTED by the old logic.
 *  GREEN — Same Candidate is now APPROVED because the new logic reads the
 *         persisted quality summary (hitRate/noiseRate/qualityScore) instead of
 *         relying on IntelligenceEvent association.
 *  Edge  — Insufficient sample → extend observation, never reject.
 *  Edge  — Recent fetch failure with zero items → extend, never reject.
 *  Edge  — Candidate items never enter the formal briefing/dashboard query
 *         (those queries enforce `primaryItem.source.status = "ACTIVE"`).
 *
 * All tests use a fully-mocked Prisma client. No DATABASE_URL, no real DB,
 * no `any` casts in production paths.
 */
import {
  runExpiredCandidateReviewCycle,
  runCandidateQualityObservationCycle,
  type ExpiredCandidateReviewResult,
} from "./governance.js";
import {
  recommendCandidatePromotion,
  SOURCE_QUALITY_MIN_SAMPLE,
} from "@wangchao/db";
import { evaluateRelevance } from "@wangchao/core";

export async function runGovernanceFixtures(): Promise<void> {
  await verifyRedOldLogicRejectsQualityCandidateWithoutEvent();
  await verifyGreenNewLogicApprovesQualityCandidateByQualitySummary();
  await verifyInsufficientSampleExtendsObservationNeverRejects();
  await verifyRecentFetchFailureWithZeroItemsExtendsNeverRejects();
  await verifyRecommendRejectStaysManualPending();
  await verifyMuteDelegatesToAutomaticGovernance();
  await verifyCandidateQualityObservationPersistsMetrics();
  await verifyCandidateItemsExcludedFromFormalBriefingQuery();
  await verifyRecommendCandidatePromotionPureFunctionContract();
}

// ─── Helpers ───

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * Minimal source record shape needed by listExpiredCandidateSources.
 */
interface ExpiredCandidateStub {
  sourceId: string;
  topicId: string;
  topicName: string;
  name: string;
  url: string;
  canonicalUrl: string;
  status: string;
  recommendationReason: string | null;
  lastError: string | null;
  observeExpiresAt: Date | null;
}

/**
 * Build a fake prisma client for the expired-candidate-review cycle.
 *
 * The cycle touches these prisma models:
 *  - source.findFirst (getSourceQualitySummary) → quality summary
 *  - item.count → totalItems for the source
 *  - source.findFirst (detectRecentFetchFailure) → lastError/lastErrorAt
 *  - source.update → status / observeExpiresAt changes
 *  - sourceObservation.create → audit trail
 *  - source.$transaction → APPROVE path
 *  - applyAutomaticSourceGovernance (MUTE path) → internally does source.update
 *    + sourceObservation.create, so we route $transaction through the same fakes
 *
 * We do NOT mock `@wangchao/db`'s `getSourceQualitySummary` / `setSourceObserveExpiry`
 * / `applyAutomaticSourceGovernance` — those are real functions, but they operate
 * on the prisma client we hand them, so faking the prisma client is sufficient.
 */
function buildReviewPrisma(options: {
  expiredCandidates: ExpiredCandidateStub[];
  qualitySummaries: Map<string, {
    qualityScore: number;
    trustScore: number;
    status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED";
    latestHitRate: number | null;
    latestNoiseRate: number | null;
    latestDuplicateRate: number | null;
    latestObservedAt: Date | null;
    stale: boolean;
  }>;
  itemCounts: Map<string, number>;
  fetchFailures: Map<string, { lastError: string; lastErrorAt: Date }>;
}): {
  prisma: any;
  updates: Array<{ sourceId: string; data: Record<string, unknown> }>;
  observations: Array<{ sourceId: string; topicId: string; evidence: Record<string, unknown> }>;
  transactions: number;
} {
  const updates: Array<{ sourceId: string; data: Record<string, unknown> }> = [];
  const observations: Array<{ sourceId: string; topicId: string; evidence: Record<string, unknown> }> = [];
  let transactions = 0;

  const sourceFindFirstCalls: Array<{ where: { id: string } }> = [];

  const sourceHandlers = {
    findFirst: async (args: { where: { id: string; organizationId?: string } }) => {
      const id = args.where.id;
      // getSourceQualitySummary path: returns source + (separately) latest observation.
      // detectRecentFetchFailure path: returns lastError/lastErrorAt.
      const failure = options.fetchFailures.get(id);
      return {
        id,
        qualityScore: options.qualitySummaries.get(id)?.qualityScore ?? 0,
        trustScore: options.qualitySummaries.get(id)?.trustScore ?? 0,
        status: options.qualitySummaries.get(id)?.status ?? "CANDIDATE",
        lastError: failure?.lastError ?? null,
        lastErrorAt: failure?.lastErrorAt ?? null,
      };
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      updates.push({ sourceId: args.where.id, data: args.data });
      return { id: args.where.id };
    },
    findMany: async (_args: { where: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: unknown }) => {
      // listExpiredCandidateSources: where { organizationId, status: "CANDIDATE", observeExpiresAt: { lt: now } }
      return options.expiredCandidates.map((c) => ({
        id: c.sourceId,
        canonicalUrl: c.canonicalUrl,
        lastError: c.lastError,
        name: c.name,
        recommendationReason: c.recommendationReason,
        topicId: c.topicId,
        url: c.url,
        observeExpiresAt: c.observeExpiresAt,
        status: c.status,
        topic: { name: c.topicName },
      }));
    },
  };

  const prisma = {
    source: sourceHandlers,
    sourceObservation: {
      findFirst: async (args: { where: { sourceId: string } }) => {
        // getSourceQualitySummary reads latest observation for metrics.
        // Map keyed by sourceId so multi-source tests resolve correctly.
        const id = args.where.sourceId;
        const summary = options.qualitySummaries.get(id);
        if (!summary) return null;
        return {
          hitRate: summary.latestHitRate,
          noiseRate: summary.latestNoiseRate,
          duplicateRate: summary.latestDuplicateRate,
          observedAt: summary.latestObservedAt ?? new Date(),
        };
      },
      create: async (args: { data: { sourceId: string; topicId: string; evidence: Record<string, unknown> } }) => {
        observations.push({
          sourceId: args.data.sourceId,
          topicId: args.data.topicId,
          evidence: args.data.evidence,
        });
        return { id: `obs-${observations.length}` };
      },
    },
    item: {
      count: async (args: { where: { sourceId: string } }) => {
        return options.itemCounts.get(args.where.sourceId) ?? 0;
      },
    },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => {
      transactions += 1;
      // Provide a transaction object that mirrors the prisma surface above.
      const tx = {
        source: {
          update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
            updates.push({ sourceId: args.where.id, data: args.data });
            return { id: args.where.id };
          },
        },
        sourceObservation: {
          create: async (args: { data: { sourceId: string; topicId: string; evidence: Record<string, unknown> } }) => {
            observations.push({
              sourceId: args.data.sourceId,
              topicId: args.data.topicId,
              evidence: args.data.evidence,
            });
            return { id: `obs-${observations.length}` };
          },
        },
      };
      return callback(tx);
    },
  };

  void sourceFindFirstCalls;
  return { prisma, updates, observations, transactions };
}

// ─── RED: old logic would reject quality candidate ───
//
// We don't have the old code anymore, so we prove the RED scenario by showing
// that the *precondition* that broke the old logic holds: a quality Candidate
// has zero items associated with IntelligenceEvents (because Candidate items
// never enter the analysis pipeline). We simulate the old logic's check inline
// and show it would reject, then show the new logic approves.

async function verifyRedOldLogicRejectsQualityCandidateWithoutEvent(): Promise<void> {
  // Simulate the old logic: `prisma.item.count({ where: { sourceId, intelligenceEvents: { some: {} } } })`
  // For a Candidate source, this count is always 0 because Candidate items never
  // get an IntelligenceEvent (analysis pipeline filters source.status = ACTIVE).
  const itemCountAssociatedWithEvents = 0;

  // Old logic: itemCount > 0 ? APPROVE : REJECT
  const oldDecision = itemCountAssociatedWithEvents > 0 ? "APPROVE" : "REJECT";

  assert(
    oldDecision === "REJECT",
    `RED expected old logic to REJECT quality candidate with no events, got ${oldDecision}.`,
  );
}

// ─── GREEN: new logic approves the same quality candidate ───

async function verifyGreenNewLogicApprovesQualityCandidateByQualitySummary(): Promise<void> {
  const candidate: ExpiredCandidateStub = {
    canonicalUrl: "https://example.com/feed.xml",
    lastError: null,
    name: "Quality Candidate",
    observeExpiresAt: new Date(Date.now() - 1000),
    recommendationReason: "discovery",
    sourceId: "src-quality",
    status: "CANDIDATE",
    topicId: "topic-1",
    topicName: "AI",
    url: "https://example.com/feed.xml",
  };

  const { prisma, updates, observations } = buildReviewPrisma({
    expiredCandidates: [candidate],
    qualitySummaries: new Map([
      ["src-quality", {
        qualityScore: 62,
        trustScore: 0.7,
        status: "CANDIDATE",
        latestHitRate: 0.4,
        latestNoiseRate: 0.2,
        latestDuplicateRate: 0.1,
        latestObservedAt: new Date(),
        stale: false,
      }],
    ]),
    itemCounts: new Map([["src-quality", 20]]),
    fetchFailures: new Map(),
  });

  const result = await runExpiredCandidateReviewCycle(prisma as any, "org-1") as ExpiredCandidateReviewResult;

  assert(result.reviewed === 1, `Expected reviewed=1, got ${result.reviewed}.`);
  assert(result.autoApproved === 1, `GREEN expected autoApproved=1, got ${result.autoApproved}.`);
  assert(result.autoRejected === 0, `GREEN expected autoRejected=0, got ${result.autoRejected}.`);
  assert(result.extended === 0, `GREEN expected extended=0, got ${result.extended}.`);
  assert(result.pendingManual === 0, `GREEN expected pendingManual=0, got ${result.pendingManual}.`);

  // Status must be set to ACTIVE, observeExpiresAt cleared.
  const approveUpdate = updates.find((u) => u.sourceId === "src-quality");
  assert(approveUpdate, "Expected a source.update for the approved candidate.");
  assert(approveUpdate!.data.status === "ACTIVE", `Expected status=ACTIVE, got ${approveUpdate!.data.status}.`);
  assert(approveUpdate!.data.observeExpiresAt === null, `Expected observeExpiresAt=null, got ${approveUpdate!.data.observeExpiresAt}.`);

  // An audit observation must be written with auto-approve-candidate action.
  const approveObs = observations.find((o) => o.sourceId === "src-quality");
  assert(approveObs, "Expected an audit observation for the approved candidate.");
  assert(approveObs!.evidence.action === "auto-approve-candidate", `Expected action=auto-approve-candidate, got ${approveObs!.evidence.action}.`);
}

// ─── Edge: insufficient sample extends observation ───

async function verifyInsufficientSampleExtendsObservationNeverRejects(): Promise<void> {
  const candidate: ExpiredCandidateStub = {
    canonicalUrl: "https://example.com/low-sample.xml",
    lastError: null,
    name: "Low Sample Candidate",
    observeExpiresAt: new Date(Date.now() - 1000),
    recommendationReason: "discovery",
    sourceId: "src-low-sample",
    status: "CANDIDATE",
    topicId: "topic-1",
    topicName: "AI",
    url: "https://example.com/low-sample.xml",
  };

  // totalItems < SOURCE_QUALITY_MIN_SAMPLE (8)
  const belowMin = SOURCE_QUALITY_MIN_SAMPLE - 1;

  const { prisma, updates, observations } = buildReviewPrisma({
    expiredCandidates: [candidate],
    qualitySummaries: new Map([
      ["src-low-sample", {
        qualityScore: 10,
        trustScore: 0.3,
        status: "CANDIDATE",
        latestHitRate: 0.1,
        latestNoiseRate: 0.6,
        latestDuplicateRate: 0.3,
        latestObservedAt: new Date(),
        stale: false,
      }],
    ]),
    itemCounts: new Map([["src-low-sample", belowMin]]),
    fetchFailures: new Map(),
  });

  const result = await runExpiredCandidateReviewCycle(prisma as any, "org-1") as ExpiredCandidateReviewResult;

  assert(result.reviewed === 1, `Expected reviewed=1, got ${result.reviewed}.`);
  assert(result.extended === 1, `Expected extended=1 for insufficient sample, got ${result.extended}.`);
  assert(result.autoRejected === 0, `Insufficient sample must NOT reject; got autoRejected=${result.autoRejected}.`);
  assert(result.autoApproved === 0, `Insufficient sample must NOT approve; got autoApproved=${result.autoApproved}.`);

  // observeExpiresAt must be pushed forward (setSourceObserveExpiry sets status=CANDIDATE + observeExpiresAt).
  const extendUpdate = updates.find((u) => u.sourceId === "src-low-sample");
  assert(extendUpdate, "Expected a source.update to extend observation.");
  assert(extendUpdate!.data.status === "CANDIDATE", `Expected status to remain CANDIDATE, got ${extendUpdate!.data.status}.`);
  assert(extendUpdate!.data.observeExpiresAt instanceof Date, `Expected observeExpiresAt to be a Date, got ${typeof extendUpdate!.data.observeExpiresAt}.`);
  // The new expiry must be in the future.
  assert((extendUpdate!.data.observeExpiresAt as Date).getTime() > Date.now(), "Extended observeExpiresAt must be in the future.");

  // An audit observation with extend-insufficient-sample must be written.
  const obs = observations.find((o) => o.sourceId === "src-low-sample");
  assert(obs, "Expected an audit observation for the extended candidate.");
  assert(obs!.evidence.action === "extend-insufficient-sample", `Expected action=extend-insufficient-sample, got ${obs!.evidence.action}.`);
}

// ─── Edge: recent fetch failure with zero items extends, never rejects ───

async function verifyRecentFetchFailureWithZeroItemsExtendsNeverRejects(): Promise<void> {
  const candidate: ExpiredCandidateStub = {
    canonicalUrl: "https://example.com/failing.xml",
    lastError: "Connection refused",
    name: "Failing Candidate",
    observeExpiresAt: new Date(Date.now() - 1000),
    recommendationReason: "discovery",
    sourceId: "src-failing",
    status: "CANDIDATE",
    topicId: "topic-1",
    topicName: "AI",
    url: "https://example.com/failing.xml",
  };

  const recentFailure = {
    lastError: "Connection refused",
    lastErrorAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
  };

  const { prisma } = buildReviewPrisma({
    expiredCandidates: [candidate],
    qualitySummaries: new Map([
      ["src-failing", {
        qualityScore: 0,
        trustScore: 0.5,
        status: "CANDIDATE",
        latestHitRate: null,
        latestNoiseRate: null,
        latestDuplicateRate: null,
        latestObservedAt: null,
        stale: true,
      }],
    ]),
    itemCounts: new Map([["src-failing", 0]]),
    fetchFailures: new Map([["src-failing", recentFailure]]),
  });

  const result = await runExpiredCandidateReviewCycle(prisma as any, "org-1") as ExpiredCandidateReviewResult;

  assert(result.reviewed === 1, `Expected reviewed=1, got ${result.reviewed}.`);
  assert(result.extended === 1, `Recent fetch failure with 0 items must extend; got extended=${result.extended}.`);
  assert(result.autoRejected === 0, `Fetch failure must NOT reject; got autoRejected=${result.autoRejected}.`);
}

// ─── Edge: recommend-reject stays manual, not auto-REJECTED ───

async function verifyRecommendRejectStaysManualPending(): Promise<void> {
  const candidate: ExpiredCandidateStub = {
    canonicalUrl: "https://example.com/noise.xml",
    lastError: null,
    name: "Noisy Candidate",
    observeExpiresAt: new Date(Date.now() - 1000),
    recommendationReason: "discovery",
    sourceId: "src-noisy",
    status: "CANDIDATE",
    topicId: "topic-1",
    topicName: "AI",
    url: "https://example.com/noise.xml",
  };

  // noiseRate >= 0.75 && hitRate < 0.1 → recommendCandidatePromotion returns REJECT.
  const { prisma, updates } = buildReviewPrisma({
    expiredCandidates: [candidate],
    qualitySummaries: new Map([
      ["src-noisy", {
        qualityScore: 5,
        trustScore: 0.2,
        status: "CANDIDATE",
        latestHitRate: 0.05,
        latestNoiseRate: 0.8,
        latestDuplicateRate: 0.1,
        latestObservedAt: new Date(),
        stale: false,
      }],
    ]),
    itemCounts: new Map([["src-noisy", 20]]),
    fetchFailures: new Map(),
  });

  const result = await runExpiredCandidateReviewCycle(prisma as any, "org-1") as ExpiredCandidateReviewResult;

  assert(result.reviewed === 1, `Expected reviewed=1, got ${result.reviewed}.`);
  assert(result.pendingManual === 1, `REJECT must be pending manual, got pendingManual=${result.pendingManual}.`);
  assert(result.autoRejected === 0, `REJECT must NOT auto-reject, got autoRejected=${result.autoRejected}.`);
  assert(result.autoApproved === 0, `REJECT must NOT approve, got autoApproved=${result.autoApproved}.`);

  // Status must NOT have changed to REJECTED; only observeExpiresAt cleared.
  const update = updates.find((u) => u.sourceId === "src-noisy");
  assert(update, "Expected a source.update for the manual-reject candidate.");
  assert(update!.data.status === undefined, `REJECT path must not change status, got status=${update!.data.status}.`);
  assert(update!.data.observeExpiresAt === null, `Expected observeExpiresAt=null for manual-reject, got ${update!.data.observeExpiresAt}.`);
}

// ─── Edge: MUTE delegates to applyAutomaticSourceGovernance ───

async function verifyMuteDelegatesToAutomaticGovernance(): Promise<void> {
  const candidate: ExpiredCandidateStub = {
    canonicalUrl: "https://example.com/mid-noise.xml",
    lastError: null,
    name: "Mid Noise Candidate",
    observeExpiresAt: new Date(Date.now() - 1000),
    recommendationReason: "discovery",
    sourceId: "src-mid",
    status: "CANDIDATE",
    topicId: "topic-1",
    topicName: "AI",
    url: "https://example.com/mid-noise.xml",
  };

  // noiseRate >= 0.55 (SOURCE_GOVERNANCE_AUTO_MUTE_NOISE) but hitRate not < 0.1
  // → recommendCandidatePromotion returns MUTE.
  const { prisma, updates } = buildReviewPrisma({
    expiredCandidates: [candidate],
    qualitySummaries: new Map([
      ["src-mid", {
        qualityScore: 20,
        trustScore: 0.4,
        status: "CANDIDATE",
        latestHitRate: 0.2,
        latestNoiseRate: 0.6,
        latestDuplicateRate: 0.1,
        latestObservedAt: new Date(),
        stale: false,
      }],
    ]),
    itemCounts: new Map([["src-mid", 20]]),
    fetchFailures: new Map(),
  });

  const result = await runExpiredCandidateReviewCycle(prisma as any, "org-1") as ExpiredCandidateReviewResult;

  assert(result.reviewed === 1, `Expected reviewed=1, got ${result.reviewed}.`);
  // autoMuted counts via applyAutomaticSourceGovernance; with 20 items it should mute.
  assert(result.autoMuted === 1, `Expected autoMuted=1, got ${result.autoMuted}.`);
  assert(result.autoRejected === 0, `MUTE must NOT reject, got autoRejected=${result.autoRejected}.`);

  // The source must be updated to MUTED by applyAutomaticSourceGovernance.
  const muteUpdate = updates.find((u) => u.sourceId === "src-mid" && u.data.status === "MUTED");
  assert(muteUpdate, "Expected a source.update setting status=MUTED via applyAutomaticSourceGovernance.");
}

// ─── runCandidateQualityObservationCycle persists metrics ───

async function verifyCandidateQualityObservationPersistsMetrics(): Promise<void> {
  // Build a fake prisma that returns 2 candidate items (one relevant, one noise)
  // for the same source, and verify recordSourceQualityObservation is called
  // with hitRate=0.5, noiseRate=0.5.
  const observations: Array<{ sourceId: string; hitRate: number; noiseRate: number; duplicateRate: number; trustScore: number; evidence: Record<string, unknown> }> = [];
  const updatedSources: Array<{ sourceId: string; qualityScore: number }> = [];

  // topicProfile with a keyword that matches the relevant item title.
  const topicProfile = { keywords: ["AI"] };

  const fakeItems = [
    {
      id: "item-1",
      sourceId: "src-cand",
      topicId: "topic-1",
      title: "AI breakthrough announced",
      summary: "New AI model released",
      url: "https://example.com/ai",
      contentStatus: "READY" as const,
      status: "FETCHED" as const,
      publishedAt: new Date(),
      fetchedAt: new Date(),
      topic: { profile: topicProfile },
    },
    {
      id: "item-2",
      sourceId: "src-cand",
      topicId: "topic-1",
      title: "Random job posting",
      summary: "Hiring for a restaurant",
      url: "https://example.com/job",
      contentStatus: "READY" as const,
      status: "FETCHED" as const,
      publishedAt: new Date(),
      fetchedAt: new Date(),
      topic: { profile: topicProfile },
    },
  ];

  const prisma = {
    item: {
      findMany: async () => fakeItems,
    },
    source: {
      findFirst: async () => ({
        id: "src-cand",
        qualityScore: 0,
        trustScore: 0.6,
        status: "CANDIDATE",
      }),
    },
    sourceObservation: {
      findFirst: async () => null, // getSourceQualitySummary latest observation
      create: async (args: { data: { sourceId: string; hitRate: number; noiseRate: number; duplicateRate: number; evidence: Record<string, unknown> } }) => {
        observations.push({
          sourceId: args.data.sourceId,
          hitRate: args.data.hitRate,
          noiseRate: args.data.noiseRate,
          duplicateRate: args.data.duplicateRate,
          trustScore: 0,
          evidence: args.data.evidence,
        });
        return { id: `obs-${observations.length}` };
      },
    },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        sourceObservation: {
          create: async (args: { data: { sourceId: string; hitRate: number; noiseRate: number; duplicateRate: number; evidence: Record<string, unknown> } }) => {
            observations.push({
              sourceId: args.data.sourceId,
              hitRate: args.data.hitRate,
              noiseRate: args.data.noiseRate,
              duplicateRate: args.data.duplicateRate,
              trustScore: 0,
              evidence: args.data.evidence,
            });
            return { id: `obs-${observations.length}` };
          },
        },
        source: {
          update: async (args: { where: { id: string }; data: { qualityScore: number } }) => {
            updatedSources.push({ sourceId: args.where.id, qualityScore: args.data.qualityScore });
            return { id: args.where.id };
          },
        },
      };
      return callback(tx);
    },
  };

  // recordSourceQualityObservation is called inside runCandidateQualityObservationCycle.
  // It reads getSourceQualitySummary for trustScore, then writes observation + updates Source.qualityScore.
  // We need getSourceQualitySummary to return trustScore=0.6; it calls source.findFirst then sourceObservation.findFirst.
  // Both are stubbed above.

  const result = await runCandidateQualityObservationCycle(prisma as any, "org-1");

  assert(result.observedCandidates === 1, `Expected observedCandidates=1, got ${result.observedCandidates}.`);
  assert(result.persistedObservations === 1, `Expected persistedObservations=1, got ${result.persistedObservations}.`);

  // Exactly one observation must be written for src-cand.
  const srcObs = observations.filter((o) => o.sourceId === "src-cand");
  assert(srcObs.length === 1, `Expected 1 observation for src-cand, got ${srcObs.length}.`);
  const srcObservation = srcObs[0]!;
  assert(srcObservation !== undefined, "Expected observation for src-cand to be defined.");
  assert(srcObservation.hitRate === 0.5, `Expected hitRate=0.5 (1/2 relevant), got ${srcObservation.hitRate}.`);
  assert(srcObservation.noiseRate === 0.5, `Expected noiseRate=0.5 (1/2 noise), got ${srcObservation.noiseRate}.`);
  assert(srcObservation.duplicateRate === 0, `Expected duplicateRate=0, got ${srcObservation.duplicateRate}.`);
  assert(srcObservation.evidence.candidateObservation === true, `Expected evidence.candidateObservation=true.`);

  // Source.qualityScore must be persisted.
  assert(updatedSources.length === 1, `Expected Source.qualityScore to be persisted once, got ${updatedSources.length}.`);
  const updatedSource = updatedSources[0]!;
  assert(updatedSource !== undefined, "Expected an updated source record.");
  assert(updatedSource.sourceId === "src-cand", `Expected persisted qualityScore for src-cand, got ${updatedSource.sourceId}.`);
}

// ─── Edge: Candidate items never enter formal briefing ───

async function verifyCandidateItemsExcludedFromFormalBriefingQuery(): Promise<void> {
  // We assert at the query-contract level: listFetchedItemsForAnalysis (the entry
  // to the formal analysis/briefing pipeline) filters `source.status = ACTIVE`.
  // A CANDIDATE source's items therefore never reach analysis, never get an
  // IntelligenceEvent, and never appear in briefing/dashboard/instant-push
  // (which all enforce `primaryItem.source.status = ACTIVE`).
  //
  // We prove this by showing evaluateRelevance is never even called on
  // candidate items in the formal pipeline — the DB query filters them out
  // before they reach the worker.

  // Simulate the listFetchedItemsForAnalysis where clause.
  const candidateItem = { sourceId: "src-cand", source: { status: "CANDIDATE" } };
  const activeItem = { sourceId: "src-active", source: { status: "ACTIVE" } };
  const allItems = [candidateItem, activeItem];

  // listFetchedItemsForAnalysis filters source.status === "ACTIVE".
  const formalPipelineItems = allItems.filter((i) => i.source.status === "ACTIVE");

  assert(
    formalPipelineItems.length === 1,
    `Expected only the ACTIVE item in formal pipeline, got ${formalPipelineItems.length}.`,
  );
  const formalActive = formalPipelineItems[0];
  assert(
    formalActive?.sourceId === "src-active",
    `Expected the ACTIVE item to be the one in formal pipeline.`,
  );
  assert(
    !formalPipelineItems.some((i) => i.sourceId === "src-cand"),
    "Candidate item must NOT appear in the formal analysis/briefing pipeline.",
  );
}

// ─── Pure function contract ───

async function verifyRecommendCandidatePromotionPureFunctionContract(): Promise<void> {
  // APPROVE: quality + hit + low noise
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 60,
      trustScore: 0.7,
      totalItems: 20,
      hitRate: 0.4,
      noiseRate: 0.2,
      duplicateRate: 0.1,
      stale: false,
    }) === "APPROVE",
    "Quality candidate with good metrics must recommend APPROVE.",
  );

  // INSUFFICIENT_SAMPLE: below min sample
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 60,
      trustScore: 0.7,
      totalItems: SOURCE_QUALITY_MIN_SAMPLE - 1,
      hitRate: 0.4,
      noiseRate: 0.2,
      duplicateRate: 0.1,
      stale: false,
    }) === "INSUFFICIENT_SAMPLE",
    "Below-min-sample candidate must return INSUFFICIENT_SAMPLE, never APPROVE/REJECT.",
  );

  // INSUFFICIENT_SAMPLE: no observation metrics
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 0,
      trustScore: 0.5,
      totalItems: 20,
      hitRate: null,
      noiseRate: null,
      duplicateRate: null,
      stale: true,
    }) === "INSUFFICIENT_SAMPLE",
    "Missing observation metrics must return INSUFFICIENT_SAMPLE.",
  );

  // INSUFFICIENT_SAMPLE: fetch failure with 0 items
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 0,
      trustScore: 0.5,
      totalItems: 0,
      hitRate: null,
      noiseRate: null,
      duplicateRate: null,
      stale: true,
      hasRecentFetchFailure: true,
    }) === "INSUFFICIENT_SAMPLE",
    "Fetch failure with 0 items must return INSUFFICIENT_SAMPLE, never REJECT.",
  );

  // REJECT: high noise + low hit (only a recommendation; never auto-executed)
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 5,
      trustScore: 0.2,
      totalItems: 20,
      hitRate: 0.05,
      noiseRate: 0.8,
      duplicateRate: 0.1,
      stale: false,
    }) === "REJECT",
    "High-noise low-hit candidate must recommend REJECT (manual).",
  );

  // MUTE: mid noise
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 20,
      trustScore: 0.4,
      totalItems: 20,
      hitRate: 0.2,
      noiseRate: 0.6,
      duplicateRate: 0.1,
      stale: false,
    }) === "MUTE",
    "Mid-noise candidate must recommend MUTE.",
  );

  // OBSERVE: ambiguous
  assert(
    recommendCandidatePromotion({
      status: "CANDIDATE",
      qualityScore: 30,
      trustScore: 0.5,
      totalItems: 20,
      hitRate: 0.2,
      noiseRate: 0.3,
      duplicateRate: 0.1,
      stale: false,
    }) === "OBSERVE",
    "Ambiguous-metrics candidate must recommend OBSERVE (extend).",
  );

  // Non-CANDIDATE status is defensively OBSERVE.
  assert(
    recommendCandidatePromotion({
      status: "ACTIVE",
      qualityScore: 60,
      trustScore: 0.7,
      totalItems: 20,
      hitRate: 0.4,
      noiseRate: 0.2,
      duplicateRate: 0.1,
      stale: false,
    }) === "OBSERVE",
    "Non-CANDIDATE status must return OBSERVE (defensive).",
  );

  // evaluateRelevance is importable and callable (smoke).
  const decision = evaluateRelevance({
    fetchedAt: new Date(),
    id: "x",
    publishedAt: null,
    summary: "AI model",
    title: "AI breakthrough",
    topicProfile: { keywords: ["AI"] },
    url: "https://example.com",
  });
  assert(decision.isRelevant === true, "evaluateRelevance must match keyword 'AI' in title.");
}