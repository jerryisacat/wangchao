import type { Prisma, PrismaClient } from "@prisma/client";
import {
  calculateSourceQualityScore,
  canonicalizeUrl,
  clamp,
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
  CreateCandidateRssSourceInput,
  CreateSourceFetchTaskRunOptions,
  CreateTaskRunInput,
  CreateTopicWithRssSourceInput,
  ExpiredCandidateSourceRecord,
  FetchedSourceRecord,
  NormalizedFetchedItemInput,
  PendingAnalysisItem,
  RecordSourceQualityObservationInput,
  SourceDiscoveryPageRecord,
  SourceGovernanceRecord,
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
    const qualityScore = calculateSourceQualityScore({
      duplicateRate,
      hitRate,
      noiseRate,
      trustScore: source.trustScore,
    });
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
      qualityScore,
      recommendation,
      recommendationReason: source.recommendationReason,
      sourceId: source.id,
      status: source.status,
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
    },
  });
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
  return prisma.sourceObservation.create({
    data: {
      organizationId: input.organizationId,
      topicId: input.topicId,
      sourceId: input.sourceId,
      duplicateRate: input.duplicateRate,
      hitRate: input.hitRate,
      noiseRate: input.noiseRate,
      evidence: {
        ...input.evidence,
        source: "source-quality-report",
      },
    },
  });
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
      errorMessage: error instanceof Error ? error.message : String(error),
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
      rawContent: item.rawContent,
      rawMetadata: toInputJson(item.rawMetadata),
      sourceId: item.sourceId,
      summary: item.summary,
      title: item.title,
      url: item.url,
    };

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

export async function updateItemRawContent(
  prisma: PrismaClient,
  itemId: string,
  rawContent: string,
): Promise<void> {
  await prisma.item.update({
    where: { id: itemId },
    data: { rawContent },
  });
}

export async function listItemsWithoutRawContent(
  prisma: PrismaClient,
  scope: TenantScope,
  limit = 20,
): Promise<Array<{ id: string; url: string }>> {
  const items = await prisma.item.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "FETCHED",
      rawContent: null,
      url: { not: "" },
    },
    select: { id: true, url: true },
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
  itemId: string,
  reason: string,
) {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { rawMetadata: true },
  });
  const rawMetadata = isRecord(item?.rawMetadata) ? item.rawMetadata : {};

  return prisma.item.update({
    where: { id: itemId },
    data: {
      rawMetadata: toInputJson({
        ...rawMetadata,
        filteredReason: reason,
      }),
      status: "FILTERED",
    },
  });
}
