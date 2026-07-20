import type { Prisma, PrismaClient } from "@prisma/client";
import { classifyTaskRunError } from "./task-run.js";
import {
  SOURCE_QUALITY_FORMULA_VERSION,
  SOURCE_QUALITY_MIN_SAMPLE,
  calculateSourceQualityScore,
  canonicalizeUrl,
  clamp,
  decideAutomaticGovernance,
  isRecord,
  ratio,
  readObservationReason,
  recommendSourceStatus,
  sourceActionToStatus,
  toInputJson,
} from "./util.js";
import type {
  AttachRssSourceInput,
  BatchSourceGovernanceInput,
  BatchSourceGovernanceResult,
  CountFilteredItemsInput,
  CreateCandidateRssSourceInput,
  CreateSourceFetchTaskRunOptions,
  CreateTaskRunInput,
  CreateTopicWithRssSourceInput,
  ExpiredCandidateSourceRecord,
  FetchedSourceRecord,
  FilteredItemsCountResult,
  NormalizedFetchedItemInput,
  PendingAnalysisItem,
  RecordSourceQualityObservationInput,
  SourceDiscoveryPageRecord,
  SourceGovernanceRecord,
  SourceQualitySummary,
  TenantScope,
  TopicScope,
  UpdateSourceGovernanceStatusInput,
} from "./types.js";

export async function attachActiveRssSource(
  prisma: PrismaClient,
  input: AttachRssSourceInput,
) {
  const topic = await prisma.topic.findFirst({
    where: { id: input.topicId, organizationId: input.organizationId },
  });
  if (!topic) {
    throw new Error(`Topic ${input.topicId} not found in organization ${input.organizationId}`);
  }

  const canonicalUrl = canonicalizeUrl(input.url);

  return prisma.source.upsert({
    where: {
      topicId_canonicalUrl: {
        topicId: input.topicId,
        canonicalUrl,
      },
    },
    update: {
      description: input.description,
      name: input.name,
      status: "ACTIVE",
      url: input.url,
    },
    create: {
      organizationId: input.organizationId,
      topicId: input.topicId,
      kind: "RSS",
      status: "ACTIVE",
      name: input.name,
      url: input.url,
      canonicalUrl,
      description: input.description,
    },
  });
}

export async function createCandidateRssSource(
  prisma: PrismaClient,
  input: CreateCandidateRssSourceInput,
) {
  const canonicalUrl = canonicalizeUrl(input.url);
  const recommendationReason =
    input.recommendationReason ?? input.description ?? undefined;
  const trustScore =
    typeof input.relevanceScore === "number"
      ? clamp(input.relevanceScore, 0, 1)
      : undefined;
  const existingSource = await prisma.source.findUnique({
    where: {
      topicId_canonicalUrl: {
        topicId: input.topicId,
        canonicalUrl,
      },
    },
  });

  if (existingSource && existingSource.status !== "CANDIDATE") {
    await prisma.sourceObservation.create({
      data: {
        organizationId: input.organizationId,
        topicId: input.topicId,
        sourceId: existingSource.id,
        candidateUrl: input.url,
        evidence: {
          ...input.evidence,
          discoveryChannel: input.discoveryChannel,
          relevanceScore: trustScore,
          reason: "candidate-discovery-existing-source",
        },
      },
    });

    return existingSource;
  }

  const source = await prisma.source.upsert({
    where: {
      topicId_canonicalUrl: {
        topicId: input.topicId,
        canonicalUrl,
      },
    },
    update: {
      description: input.description,
      discoveryChannel: input.discoveryChannel,
      name: input.name,
      recommendationReason,
      trustScore,
      url: input.url,
    },
    create: {
      organizationId: input.organizationId,
      topicId: input.topicId,
      kind: "RSS",
      status: "CANDIDATE",
      name: input.name,
      url: input.url,
      canonicalUrl,
      description: input.description,
      discoveryChannel: input.discoveryChannel,
      recommendationReason,
      trustScore,
    },
  });

  await prisma.sourceObservation.create({
    data: {
      organizationId: input.organizationId,
      topicId: input.topicId,
      sourceId: source.id,
      candidateUrl: input.url,
      evidence: {
        ...input.evidence,
        discoveryChannel: input.discoveryChannel,
        relevanceScore: trustScore,
        reason: "candidate-created",
      },
    },
  });

  return source;
}

export async function createTopicWithActiveRssSource(
  prisma: PrismaClient,
  input: CreateTopicWithRssSourceInput,
) {
  return prisma.$transaction(async (transaction) => {
    const topic = await transaction.topic.create({
      data: {
        organizationId: input.organizationId,
        ownerUserId: input.ownerUserId,
        name: input.topic.name,
        description: input.topic.description,
        profile: toInputJson(input.topic.profile),
        status: "ACTIVE",
      },
    });
    const canonicalUrl = canonicalizeUrl(input.source.url);

    const source = await transaction.source.upsert({
      where: {
        topicId_canonicalUrl: {
          topicId: topic.id,
          canonicalUrl,
        },
      },
      update: {
        description: input.source.description,
        name: input.source.name,
        status: "ACTIVE",
        url: input.source.url,
      },
      create: {
        organizationId: input.organizationId,
        topicId: topic.id,
        kind: "RSS",
        status: "ACTIVE",
        name: input.source.name,
        url: input.source.url,
        canonicalUrl,
        description: input.source.description,
      },
    });

    return { topic, source };
  });
}

export async function listSourceGovernanceReport(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<SourceGovernanceRecord[]> {
  const sources = await prisma.source.findMany({
    where: {
      organizationId: scope.organizationId,
    },
    include: {
      topic: {
        select: {
          name: true,
        },
      },
      items: {
        select: {
          status: true,
          intelligenceEvents: {
            select: {
              id: true,
              status: true,
            },
          },
          eventItems: {
            select: {
              role: true,
              event: {
                select: {
                  id: true,
                  status: true,
                },
              },
            },
          },
        },
      },
      sourceObservations: {
        orderBy: { observedAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  return sources.map((source) => {
    const totalItems = source.items.length;
    const filteredItems = source.items.filter(
      (item) => item.status === "FILTERED",
    ).length;
    const activeEventIds = new Set<string>();
    let hitItems = 0;
    let duplicateItems = 0;

    for (const item of source.items) {
      const activePrimaryEvents = item.intelligenceEvents.filter(
        (event) => event.status !== "ARCHIVED",
      );
      const activeEventItems = item.eventItems.filter(
        (eventItem) => eventItem.event.status !== "ARCHIVED",
      );
      const hasActivePrimary = activePrimaryEvents.length > 0;
      const hasActiveSecondary = activeEventItems.some(
        (eventItem) => eventItem.role === "SECONDARY",
      );

      for (const event of activePrimaryEvents) activeEventIds.add(event.id);
      for (const eventItem of activeEventItems) {
        activeEventIds.add(eventItem.event.id);
      }

      if (hasActivePrimary || activeEventItems.length > 0) hitItems += 1;
      if (
        item.status === "DUPLICATE" ||
        (!hasActivePrimary && hasActiveSecondary)
      ) {
        duplicateItems += 1;
      }
    }

    const eventCount = activeEventIds.size;
    const hitRate = ratio(hitItems, totalItems);
    const noiseRate = ratio(filteredItems, totalItems);
    const duplicateRate = ratio(duplicateItems, totalItems);
    const derivedQualityScore = calculateSourceQualityScore({
      duplicateRate,
      hitRate,
      noiseRate,
      trustScore: source.trustScore,
    });
    // 持久化值优先；为 0（从未跑过 observation）时回退到派生值，保证 UI 不空白。
    const persistedQualityScore = source.qualityScore;
    const stale = persistedQualityScore === 0;
    const qualityScore = stale ? derivedQualityScore : persistedQualityScore;
    const recommendation = recommendSourceStatus(
      source.status,
      qualityScore,
      totalItems,
      noiseRate,
    );
    const observation = source.sourceObservations[0];

    return {
      discoveryChannel: source.discoveryChannel,
      duplicateRate,
      derivedQualityScore,
      eventCount,
      filteredItems,
      hitRate,
      lastFetchedAt: source.lastFetchedAt,
      lastError: source.lastError,
      lastErrorAt: source.lastErrorAt,
      consecutiveFailures: source.consecutiveFailures,
      mutedReason: readObservationReason(observation?.evidence),
      name: source.name,
      noiseRate,
      persistedQualityScore,
      qualityScore,
      recommendation,
      recommendationReason: source.recommendationReason,
      sourceId: source.id,
      status: source.status,
      stale,
      topicId: source.topicId,
      topicName: source.topic.name,
      totalItems,
      trustScore: source.trustScore,
      url: source.url,
    };
  });
}

export async function updateSourceGovernanceStatus(
  prisma: PrismaClient,
  input: UpdateSourceGovernanceStatusInput,
) {
  const targetStatus = sourceActionToStatus(input.action);
  const source = await prisma.source.findFirst({
    where: {
      id: input.sourceId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      topicId: true,
    },
  });
  if (!source) {
    throw new Error(`Source ${input.sourceId} not found in organization ${input.organizationId}`);
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.source.update({
      where: { id: source.id },
      data: {
        status: targetStatus,
      },
    });
    await transaction.sourceObservation.create({
      data: {
        organizationId: input.organizationId,
        topicId: source.topicId,
        sourceId: source.id,
        evidence: {
          action: input.action,
          reason: input.reason,
          source: "source-governance-mvp",
        },
      },
    });

    if (input.userId) {
      await transaction.feedbackEvent.create({
        data: {
          organizationId: input.organizationId,
          topicId: source.topicId,
          userId: input.userId,
          sourceId: source.id,
          kind: input.action === "approve" ? "SOURCE_APPROVE" : "SOURCE_REJECT",
          value: input.action === "approve" ? 2 : -1,
          reason: input.reason,
          metadata: {
            action: input.action,
            source: "source-governance-mvp",
          },
        },
      });
    }
  });
}

export async function batchUpdateSourceGovernanceStatus(
  prisma: PrismaClient,
  input: BatchSourceGovernanceInput,
): Promise<BatchSourceGovernanceResult> {
  const targetStatus = sourceActionToStatus(input.action);
  const errors: Array<{ error: string; sourceId: string }> = [];
  let updated = 0;

  for (const sourceId of input.sourceIds) {
    try {
      const source = await prisma.source.findFirst({
        where: {
          id: sourceId,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
          topicId: true,
        },
      });
      if (!source) {
        errors.push({
          error: `Source ${sourceId} not found in organization ${input.organizationId}`,
          sourceId,
        });
        continue;
      }

      await prisma.$transaction(async (transaction) => {
        const updateData: Prisma.SourceUpdateInput = {
          status: targetStatus,
        };
        if (targetStatus === "CANDIDATE" && input.action === "observe") {
          updateData.observeExpiresAt = new Date(
            Date.now() + 14 * 24 * 60 * 60 * 1000,
          );
        }

        await transaction.source.update({
          data: updateData,
          where: { id: source.id },
        });
        await transaction.sourceObservation.create({
          data: {
            organizationId: input.organizationId,
            topicId: source.topicId,
            sourceId: source.id,
            evidence: {
              action: input.action,
              batch: true,
              reason: input.reason,
              source: "batch-source-governance",
            },
          },
        });

        if (input.userId) {
          await transaction.feedbackEvent.create({
            data: {
              organizationId: input.organizationId,
              topicId: source.topicId,
              userId: input.userId,
              sourceId: source.id,
              kind: input.action === "approve" ? "SOURCE_APPROVE" : "SOURCE_REJECT",
              value: input.action === "approve" ? 2 : -1,
              reason: input.reason,
              metadata: {
                action: input.action,
                batch: true,
                source: "batch-source-governance",
              },
            },
          });
        }
      });

      updated += 1;
    } catch (error) {
      errors.push({
        error: error instanceof Error ? error.message : String(error),
        sourceId,
      });
    }
  }

  return { errors, updated };
}

export async function listExpiredCandidateSources(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<ExpiredCandidateSourceRecord[]> {
  const sources = await prisma.source.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "CANDIDATE",
      observeExpiresAt: {
        lt: new Date(),
      },
    },
    include: {
      topic: {
        select: { name: true },
      },
    },
    orderBy: { observeExpiresAt: "asc" },
  });

  return sources.map((source) => ({
    candidateUrl: source.canonicalUrl,
    lastError: source.lastError,
    name: source.name,
    recommendationReason: source.recommendationReason,
    sourceId: source.id,
    status: source.status,
    topicId: source.topicId,
    topicName: source.topic.name,
    url: source.url,
    observeExpiresAt: source.observeExpiresAt,
  }));
}

export async function setSourceObserveExpiry(
  prisma: PrismaClient,
  input: { days: number; organizationId: string; sourceId: string },
): Promise<void> {
  await prisma.source.update({
    data: {
      observeExpiresAt: new Date(Date.now() + input.days * 24 * 60 * 60 * 1000),
      status: "CANDIDATE",
    },
    where: {
      id: input.sourceId,
      organizationId: input.organizationId,
    },
  });
}

export async function listCandidateRssSourcesForObservation(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<FetchedSourceRecord[]> {
  return prisma.source.findMany({
    where: {
      organizationId: scope.organizationId,
      kind: "RSS",
      status: "CANDIDATE",
      topic: {
        status: "ACTIVE",
      },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      organizationId: true,
      topicId: true,
      name: true,
      url: true,
      kind: true,
    },
  });
}

/**
 * 列出 Candidate 源下用于隔离观察评估的 Item（Issue #169）。
 *
 * 与 {@link listFetchedItemsForAnalysis} 的关键区别：本查询**不**要求
 * `source.status === "ACTIVE"`，因此 Candidate 源的 Item 能被读到。
 * 这些 Item 只用于隔离的相关性/质量评估，**不会**进入正式 analysis pipeline
 * （后者仍受 ACTIVE 过滤约束），也不会进入 briefing/dashboard/instant-push
 * （这些查询都强制 `primaryItem.source.status === "ACTIVE"`）。
 *
 * 返回字段刻意精简：只包含规则 relevance 评估需要的输入，避免泄漏
 * topic profile 之外的信息到观察路径。
 */
export async function listCandidateItemsForObservation(
  prisma: PrismaClient,
  scope: TenantScope,
  limit = 200,
): Promise<
  Array<{
    id: string;
    sourceId: string;
    topicId: string;
    title: string;
    summary: string | null;
    url: string;
    contentStatus: "PENDING" | "READY" | "INSUFFICIENT" | "FETCH_FAILED" | "UNSUPPORTED";
    status: "FETCHED" | "FILTERED" | "ANALYZED" | "DUPLICATE" | "ERROR";
    publishedAt: Date | null;
    fetchedAt: Date;
    topicProfile: unknown;
  }>
> {
  const items = await prisma.item.findMany({
    where: {
      organizationId: scope.organizationId,
      source: {
        status: "CANDIDATE",
        topic: { status: "ACTIVE" },
      },
    },
    select: {
      id: true,
      sourceId: true,
      topicId: true,
      title: true,
      summary: true,
      url: true,
      contentStatus: true,
      status: true,
      publishedAt: true,
      fetchedAt: true,
      topic: { select: { profile: true } },
    },
    orderBy: [{ fetchedAt: "desc" }],
    take: limit,
  });

  return items.map((item) => ({
    contentStatus: item.contentStatus,
    fetchedAt: item.fetchedAt,
    id: item.id,
    publishedAt: item.publishedAt,
    sourceId: item.sourceId,
    status: item.status,
    summary: item.summary,
    title: item.title,
    topicId: item.topicId,
    topicProfile: item.topic.profile,
    url: item.url,
  }));
}

export interface CandidateQualityMetrics {
  topicId: string;
  sourceId: string;
  totalItems: number;
  hitItems: number;
  filteredItems: number;
  duplicateItems: number;
  hitRate: number;
  noiseRate: number;
  duplicateRate: number;
}

/**
 * 为 Candidate 源计算隔离的质量指标（Issue #169）。
 *
 * 复用 {@link getSourceQualitySummary} 已经持久化的 qualityScore/trustScore，
 * 但 hit/noise/duplicate 在这里**独立重算**：Candidate 的 Item 永远不会关联
 * IntelligenceEvent（analysis pipeline 受 ACTIVE 过滤约束），所以不能用正式
 * hitRate 定义（"关联未归档事件的比例"）。这里用隔离的规则 relevance 决策
 * 作为 hit 判据——@wangchao/core 的 evaluateRelevance 是确定性规则 fallback，
 * 与正式 analysis 的 LLM 决策分离，不污染正式事件链。
 *
 * 返回按 sourceId 分组的指标聚合，供 recordSourceQualityObservation 持久化。
 */
export function computeCandidateQualityMetrics(
  relevanceResults: Array<{
    sourceId: string;
    topicId: string;
    isRelevant: boolean;
    isNoise: boolean;
    isDuplicate: boolean;
  }>,
): Map<string, CandidateQualityMetrics> {
  const bySource = new Map<string, {
    topicId: string;
    totalItems: number;
    hitItems: number;
    filteredItems: number;
    duplicateItems: number;
  }>();

  for (const result of relevanceResults) {
    let bucket = bySource.get(result.sourceId);
    if (!bucket) {
      bucket = {
        topicId: result.topicId,
        totalItems: 0,
        hitItems: 0,
        filteredItems: 0,
        duplicateItems: 0,
      };
      bySource.set(result.sourceId, bucket);
    }
    bucket.totalItems += 1;
    if (result.isDuplicate) {
      bucket.duplicateItems += 1;
    }
    if (result.isNoise) {
      bucket.filteredItems += 1;
    }
    if (result.isRelevant && !result.isDuplicate) {
      bucket.hitItems += 1;
    }
  }

  const out = new Map<string, CandidateQualityMetrics>();
  for (const [sourceId, bucket] of bySource) {
    out.set(sourceId, {
      topicId: bucket.topicId,
      sourceId,
      totalItems: bucket.totalItems,
      hitItems: bucket.hitItems,
      filteredItems: bucket.filteredItems,
      duplicateItems: bucket.duplicateItems,
      hitRate: ratio(bucket.hitItems, bucket.totalItems),
      noiseRate: ratio(bucket.filteredItems, bucket.totalItems),
      duplicateRate: ratio(bucket.duplicateItems, bucket.totalItems),
    });
  }
  return out;
}

export async function recordSourceFetchFailure(
  prisma: PrismaClient,
  sourceId: string,
  errorMessage: string,
): Promise<void> {
  await prisma.source.update({
    data: {
      consecutiveFailures: { increment: 1 },
      lastError: errorMessage.slice(0, 500),
      lastErrorAt: new Date(),
    },
    where: { id: sourceId },
  });
}

export async function recordSourceFetchSuccess(
  prisma: PrismaClient,
  sourceId: string,
): Promise<void> {
  await prisma.source.update({
    data: {
      consecutiveFailures: 0,
      lastError: null,
      lastErrorAt: null,
      lastFetchedAt: new Date(),
    },
    where: { id: sourceId },
  });
}

export async function autoMuteFailingSources(
  prisma: PrismaClient,
  scope: TenantScope,
  threshold: number,
): Promise<string[]> {
  const failing = await prisma.source.findMany({
    select: { id: true },
    where: {
      consecutiveFailures: { gte: threshold },
      organizationId: scope.organizationId,
      status: "ACTIVE",
    },
  });

  if (failing.length === 0) return [];

  const ids = failing.map((s) => s.id);
  await prisma.source.updateMany({
    data: { status: "MUTED" },
    where: {
      id: { in: ids },
      organizationId: scope.organizationId,
    },
  });

  return ids;
}

export async function recordSourceQualityObservation(
  prisma: PrismaClient,
  input: RecordSourceQualityObservationInput,
) {
  // SPEC §5.2 / §6.2：qualityScore 持久化在 Source 上，trustScore 不被
  // observation 自动改（trustScore 是 discovery/relevance 产物）。
  // 同事务写 SourceObservation 历史 + 更新 Source.qualityScore，保证报告、
  // 评分、调度读到的都是同一份当前质量视图。
  const persistedQualityScore = calculateSourceQualityScore({
    duplicateRate: input.duplicateRate,
    hitRate: input.hitRate,
    noiseRate: input.noiseRate,
    trustScore: input.trustScore,
  });

  return prisma.$transaction(async (transaction) => {
    const [observation, updatedSource] = await Promise.all([
      transaction.sourceObservation.create({
        data: {
          organizationId: input.organizationId,
          topicId: input.topicId,
          sourceId: input.sourceId,
          duplicateRate: input.duplicateRate,
          hitRate: input.hitRate,
          noiseRate: input.noiseRate,
          evidence: {
            ...input.evidence,
            formulaVersion: SOURCE_QUALITY_FORMULA_VERSION,
            persistedQualityScore,
            source: "source-quality-report",
          },
        },
      }),
      transaction.source.update({
        data: {
          qualityScore: persistedQualityScore,
        },
        where: { id: input.sourceId },
        select: { id: true, status: true, qualityScore: true, trustScore: true },
      }),
    ]);

    return {
      observation,
      persistedQualityScore,
      source: updatedSource,
    };
  });
}

/**
 * 统一读取接口：给事件评分、候选晋升、信源调度提供单一入口。
 *
 * 读 Source.qualityScore（持久化值，SPEC §6.2），不在此处重算或写库——
 * 避免读路径副作用。如果 qualityScore 仍是 schema 默认 0 且有历史 observation，
 * 返回 stale=true 让调用方决定是否触发刷新。
 */
export async function getSourceQualitySummary(
  prisma: PrismaClient,
  scope: TenantScope & { sourceId: string },
): Promise<SourceQualitySummary | null> {
  const source = await prisma.source.findFirst({
    where: {
      id: scope.sourceId,
      organizationId: scope.organizationId,
    },
    select: {
      id: true,
      qualityScore: true,
      trustScore: true,
      status: true,
    },
  });

  if (!source) {
    return null;
  }

  const latestObservation = await prisma.sourceObservation.findFirst({
    where: { sourceId: scope.sourceId },
    orderBy: { observedAt: "desc" },
    take: 1,
    select: {
      hitRate: true,
      noiseRate: true,
      duplicateRate: true,
      observedAt: true,
    },
  });

  // stale = 持久化 qualityScore 还是 schema 默认 0，但有 observation 历史，
  // 说明 recordSourceQualityObservation 还没跑过（或 source 是旧数据）。
  const stale =
    source.qualityScore === 0 &&
    latestObservation !== null;

  return {
    sourceId: source.id,
    qualityScore: source.qualityScore,
    trustScore: source.trustScore,
    status: source.status,
    latestHitRate: latestObservation?.hitRate ?? null,
    latestNoiseRate: latestObservation?.noiseRate ?? null,
    latestDuplicateRate: latestObservation?.duplicateRate ?? null,
    latestObservedAt: latestObservation?.observedAt ?? null,
    stale,
  };
}

/**
 * 自动治理：在 observation 写入后，按 recommendation 决定是否自动降权/静默。
 *
 * SPEC §5.2「自动发现不等于自动信任」+ Issue #176 约束：
 * - 小样本（< SOURCE_QUALITY_MIN_SAMPLE）不自动降权。
 * - 只自动 MUTE，不自动 REJECT（高风险保留人工确认）。
 * - REJECTED 受保护，不自动变更；MUTED 不重复降权。
 * - 写一条 source-governance-auto observation 作为审计轨迹，不写 FeedbackEvent
 *   （避免污染偏好信号——自动动作不是用户反馈）。
 *
 * 返回被自动变更的 sourceId 列表（空表示本轮无人被降权）。
 */
export async function applyAutomaticSourceGovernance(
  prisma: PrismaClient,
  input: TenantScope & {
    sources: Array<{
      recommendation: "APPROVE" | "OBSERVE" | "MUTE" | "REJECT";
      sourceId: string;
      status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED";
      topicId: string;
      totalItems: number;
    }>;
  },
): Promise<{ autoMuted: string[] }> {
  const autoMuted: string[] = [];

  for (const source of input.sources) {
    const decision = decideAutomaticGovernance(
      source.status,
      source.recommendation,
      source.totalItems,
    );

    if (!decision) continue;

    await prisma.$transaction(async (transaction) => {
      await transaction.source.update({
        data: { status: decision.status },
        where: { id: source.sourceId },
      });
      await transaction.sourceObservation.create({
        data: {
          organizationId: input.organizationId,
          topicId: source.topicId,
          sourceId: source.sourceId,
          evidence: {
            action: "auto-mute",
            formulaVersion: SOURCE_QUALITY_FORMULA_VERSION,
            minSample: SOURCE_QUALITY_MIN_SAMPLE,
            reason: decision.reason,
            source: "source-governance-auto",
            totalItems: source.totalItems,
          },
        },
      });
    });

    autoMuted.push(source.sourceId);
  }

  return { autoMuted };
}

export async function listActiveRssSourcesForFetch(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<FetchedSourceRecord[]> {
  return prisma.source.findMany({
    where: {
      organizationId: scope.organizationId,
      kind: "RSS",
      status: "ACTIVE",
      topic: {
        status: "ACTIVE",
      },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      organizationId: true,
      topicId: true,
      name: true,
      url: true,
      kind: true,
    },
  });
}

/**
 * Unified fetch-scheduling query for Issue #168: returns ACTIVE sources of
 * every supported kind (RSS, WEB) whose parent Topic is ACTIVE. The worker
 * dispatches each record to its adapter by `record.kind`. Replaces the
 * RSS-only `listActiveRssSourcesForFetch` for the main fetch cycle; the RSS
 * variant is retained for candidate observation which is still RSS-only.
 */
export async function listActiveSourcesForFetch(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<FetchedSourceRecord[]> {
  return prisma.source.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "ACTIVE",
      topic: {
        status: "ACTIVE",
      },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      organizationId: true,
      topicId: true,
      name: true,
      url: true,
      kind: true,
    },
  });
}

export async function createSourceFetchTaskRun(
  prisma: PrismaClient,
  source: FetchedSourceRecord,
  options: CreateSourceFetchTaskRunOptions,
) {
  return createTaskRun(prisma, {
    attempt: options.attempt,
    input: {
      sourceName: source.name,
      sourceUrl: source.url,
    },
    maxAttempts: options.maxAttempts,
    organizationId: source.organizationId,
    sourceId: source.id,
    topicId: source.topicId,
    type: "SOURCE_FETCH",
  });
}

export async function createSourceDiscoveryTaskRun(
  prisma: PrismaClient,
  input: TenantScope & { input?: Record<string, unknown>; userId?: string },
) {
  return createTaskRun(prisma, {
    input: {
      ...(input.input ?? {}),
      ...(input.userId ? { userId: input.userId } : {}),
    },
    maxAttempts: 1,
    organizationId: input.organizationId,
    type: "SOURCE_DISCOVERY",
  });
}

export async function createTaskRun(
  prisma: PrismaClient,
  input: CreateTaskRunInput,
) {
  const startedAt = new Date();

  return prisma.taskRun.create({
    data: {
      organizationId: input.organizationId,
      topicId: input.topicId,
      sourceId: input.sourceId,
      itemId: input.itemId,
      eventId: input.eventId,
      type: input.type,
      status: "RUNNING",
      attempt: input.attempt ?? 1,
      maxAttempts: input.maxAttempts ?? 1,
      scheduledAt: startedAt,
      startedAt,
      input: toInputJson(input.input),
    },
  });
}

export async function completeTaskRun(
  prisma: PrismaClient,
  taskRunId: string,
  output: Record<string, unknown>,
) {
  return prisma.taskRun.update({
    where: { id: taskRunId },
    data: {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      output: toInputJson(output),
    },
  });
}

export async function failTaskRun(
  prisma: PrismaClient,
  taskRunId: string,
  error: unknown,
) {
  return prisma.taskRun.update({
    where: { id: taskRunId },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorMessage: classifyTaskRunError(error),
    },
  });
}

export async function upsertFetchedItems(
  prisma: PrismaClient,
  items: NormalizedFetchedItemInput[],
) {
  if (items.length === 0) {
    return [];
  }

  const existingItems = await prisma.item.findMany({
    where: {
      OR: items.map((item) => ({
        topicId: item.topicId,
        canonicalUrl: item.canonicalUrl,
      })),
    },
    select: {
      id: true,
      topicId: true,
      canonicalUrl: true,
    },
  });

  const existingKeys = new Set(
    existingItems.map((item) => `${item.topicId}::${item.canonicalUrl}`),
  );

  const toCreate: Prisma.ItemCreateManyInput[] = [];
  const toUpdate: Array<{ topicId: string; canonicalUrl: string; data: Prisma.ItemUncheckedUpdateManyInput }> = [];

  for (const item of items) {
    const key = `${item.topicId}::${item.canonicalUrl}`;
    const updateData: Prisma.ItemUncheckedUpdateManyInput = {
      author: item.author,
      contentHash: item.contentHash,
      fetchedAt: new Date(),
      publishedAt: item.publishedAt,
      rawMetadata: toInputJson(item.rawMetadata),
      sourceId: item.sourceId,
      summary: item.summary,
      title: item.title,
      url: item.url,
    };
    if (item.rawContent !== undefined || item.contentStatus !== undefined) {
      if (item.rawContent !== undefined) updateData.rawContent = item.rawContent;
      else if (item.contentStatus === "INSUFFICIENT") updateData.rawContent = null;
      updateData.contentStatus = item.contentStatus ?? "READY";
      updateData.contentSource = item.contentSource;
      updateData.contentFetchedAt = item.contentFetchedAt ?? new Date();
      updateData.contentErrorCode = item.contentErrorCode ?? null;
    }

    if (existingKeys.has(key)) {
      toUpdate.push({ topicId: item.topicId, canonicalUrl: item.canonicalUrl, data: updateData });
    } else {
      toCreate.push({
        organizationId: item.organizationId,
        topicId: item.topicId,
        sourceId: item.sourceId,
        status: "FETCHED",
        title: item.title,
        url: item.url,
        canonicalUrl: item.canonicalUrl,
        summary: item.summary,
        author: item.author,
        publishedAt: item.publishedAt,
        contentHash: item.contentHash,
        rawContent: item.rawContent,
        contentStatus: item.contentStatus ?? (item.rawContent ? "READY" : "PENDING"),
        contentSource: item.contentSource,
        contentFetchedAt:
          item.contentFetchedAt ??
          (item.contentStatus !== undefined || item.rawContent ? new Date() : undefined),
        contentErrorCode: item.contentErrorCode,
        rawMetadata: toInputJson(item.rawMetadata),
      });
    }
  }

  return prisma.$transaction(async (tx) => {
    if (toCreate.length > 0) {
      await tx.item.createMany({ data: toCreate });
    }

    for (const update of toUpdate) {
      await tx.item.updateMany({
        where: {
          topicId: update.topicId,
          canonicalUrl: update.canonicalUrl,
        },
        data: update.data,
      });
    }

    const allItems = await tx.item.findMany({
      where: {
        OR: items.map((item) => ({
          topicId: item.topicId,
          canonicalUrl: item.canonicalUrl,
        })),
      },
    });

    return allItems;
  });
}

export async function listFetchedItemsForAnalysis(
  prisma: PrismaClient,
  scope: TenantScope,
  limit = 50,
): Promise<PendingAnalysisItem[]> {
  const items = await prisma.item.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "FETCHED",
      topic: {
        status: "ACTIVE",
      },
      source: {
        status: "ACTIVE",
      },
    },
    include: {
      source: {
        select: {
          name: true,
        },
      },
      topic: {
        select: {
          description: true,
          name: true,
          profile: true,
        },
      },
    },
    orderBy: [{ fetchedAt: "asc" }],
    take: limit,
  });

  return items.map((item) => ({
    fetchedAt: item.fetchedAt,
    id: item.id,
    organizationId: item.organizationId,
    publishedAt: item.publishedAt,
    rawContent: item.rawContent,
    contentStatus: item.contentStatus,
    contentErrorCode: item.contentErrorCode,
    sourceId: item.sourceId,
    sourceName: item.source.name,
    summary: item.summary,
    title: item.title,
    topicId: item.topicId,
    topicDescription: item.topic.description,
    topicName: item.topic.name,
    topicProfile: item.topic.profile,
    url: item.url,
  }));
}

export async function updateItemContentCapture(
  prisma: PrismaClient,
  itemId: string,
  input: {
    contentErrorCode?: string | null;
    contentSource?: "RSS_EMBEDDED" | "ARTICLE_HTML" | "LEGACY_TEXT" | null;
    contentStatus: "PENDING" | "READY" | "INSUFFICIENT" | "FETCH_FAILED" | "UNSUPPORTED";
    rawContent?: string | null;
  },
): Promise<void> {
  await prisma.item.update({
    where: { id: itemId },
    data: {
      contentErrorCode: input.contentErrorCode ?? null,
      contentFetchedAt: input.contentStatus === "PENDING" ? null : new Date(),
      contentSource: input.contentSource ?? null,
      contentStatus: input.contentStatus,
      ...(input.rawContent !== undefined ? { rawContent: input.rawContent } : {}),
    },
  });
}

export async function listItemsPendingContentCapture(
  prisma: PrismaClient,
  scope: TenantScope,
  limit = 20,
): Promise<Array<{ id: string; topicId: string; url: string }>> {
  const items = await prisma.item.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "FETCHED",
      contentStatus: "PENDING",
      url: { not: "" },
    },
    select: { id: true, topicId: true, url: true },
    orderBy: { fetchedAt: "desc" },
    take: limit,
  });

  return items;
}

export async function listHighScoreEventPagesForDiscovery(
  prisma: PrismaClient,
  scope: TenantScope & { days: number; threshold: number },
  limit = 50,
): Promise<SourceDiscoveryPageRecord[]> {
  const since = new Date();
  since.setDate(since.getDate() - scope.days);
  const events = await prisma.intelligenceEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      summaryStatus: "READY",
      OR: [
        { score: { gte: scope.threshold } },
        { gravityScore: { gte: scope.threshold } },
      ],
      updatedAt: {
        gte: since,
      },
      primaryItem: {
        is: {
          url: {
            not: "",
          },
        },
      },
    },
    orderBy: [{ gravityScore: "desc" }, { updatedAt: "desc" }],
    select: {
      topicId: true,
      primaryItem: {
        select: {
          url: true,
        },
      },
    },
    take: limit,
  });

  return events.flatMap((event) =>
    event.primaryItem?.url
      ? [{ topicId: event.topicId, url: event.primaryItem.url }]
      : [],
  );
}

export async function listRecentActiveSourcePagesForDiscovery(
  prisma: PrismaClient,
  scope: TenantScope,
  limit = 100,
): Promise<SourceDiscoveryPageRecord[]> {
  const items = await prisma.item.findMany({
    where: {
      organizationId: scope.organizationId,
      source: {
        status: "ACTIVE",
      },
      url: {
        not: "",
      },
    },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    select: {
      sourceId: true,
      topicId: true,
      url: true,
    },
    take: limit,
  });

  return items;
}

export async function markItemFiltered(
  prisma: PrismaClient,
  scope: TenantScope,
  itemId: string,
  reason: string,
) {
  const item = await prisma.item.findFirst({
    where: { id: itemId, organizationId: scope.organizationId },
    select: { rawMetadata: true },
  });
  const rawMetadata = isRecord(item?.rawMetadata) ? item.rawMetadata : {};

  return prisma.item.update({
    where: { id: itemId, organizationId: scope.organizationId },
    data: {
      rawMetadata: toInputJson({
        ...rawMetadata,
        filteredReason: reason,
      }),
      status: "FILTERED",
    },
  });
}

// Issue #184 (Plan Task 4.5) - SPEC §4.2/§5.8 低价值过滤统计。
// 聚合指定业务窗口内 status='FILTERED' 的 Item，按 rawMetadata.filteredReason 分组。
// 窗口用 [rangeStart, rangeEnd) 半开区间，与 listEventsForDailyBriefing 一致。
// reason 缺失/空归入 "unspecified"（与 core 层 summarizeFilteredStats 语义一致，
// 这里在 DB 侧预先归一，避免调用方重复处理）。
const FILTERED_REASON_UNSPECIFIED = "unspecified";

export async function countFilteredItemsInRange(
  prisma: PrismaClient,
  input: CountFilteredItemsInput,
): Promise<FilteredItemsCountResult> {
  const items = await prisma.item.findMany({
    select: { rawMetadata: true },
    where: {
      organizationId: input.organizationId,
      topicId: input.topicId,
      status: "FILTERED",
      // SPEC §4.2：窗口按 Item.fetchedAt 落在 [rangeStart, rangeEnd) 内。
      // 用 fetchedAt 而非 createdAt，因为 filteredReason 由 analysis 写入、
      // fetchedAt 更贴近「该窗口内抓取并判定为低价值」的语义。
      fetchedAt: { gte: input.rangeStart, lt: input.rangeEnd },
    },
  });

  const byReason: Record<string, number> = {};
  let count = 0;
  for (const item of items) {
    count += 1;
    const meta = isRecord(item.rawMetadata) ? item.rawMetadata : {};
    const rawReason = meta["filteredReason"];
    const reason =
      typeof rawReason === "string" && rawReason.trim() !== ""
        ? rawReason
        : FILTERED_REASON_UNSPECIFIED;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return { byReason, count };
}
