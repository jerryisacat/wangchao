import type { Prisma, PrismaClient } from "@prisma/client";
import {
  actionToEventState,
  extractPreferenceWeight,
  toInputJson,
  toRequiredInputJson,
} from "./util.js";
import { resolveSecondarySources } from "./secondary-sources.js";
import type {
  BriefingEventRecord,
  CreateDailyBriefingInput,
  CreatePeriodBriefingInput,
  DashboardBriefingPage,
  DashboardBriefingRecord,
  DashboardEventPage,
  DashboardEventRecord,
  DashboardEventQueryResult,
  FeedbackSignalRecord,
  IntelligenceEventWriteInput,
  PreferenceMemoryRecord,
  RecordCategoryPreferenceFeedbackInput,
  TenantScope,
  TimelineEventRecord,
  TopicScope,
  UpdateDashboardEventStateInput,
  UpsertPreferenceMemoryInput,
} from "./types.js";

export async function upsertIntelligenceEventFromItem(
  prisma: PrismaClient,
  input: IntelligenceEventWriteInput,
) {
  let existing = await prisma.intelligenceEvent.findUnique({
    where: {
      topicId_eventHash: {
        eventHash: input.eventHash,
        topicId: input.topicId,
      },
    },
    select: { id: true, primaryItemId: true, status: true, summaryStatus: true },
  });

  if (existing?.status === "ARCHIVED") existing = null;

  if (!existing && input.titleHash) {
    const fuzzyWindowStart = new Date(input.occurredAt ?? Date.now());
    fuzzyWindowStart.setHours(fuzzyWindowStart.getHours() - 24);
    const fuzzyWindowEnd = new Date(input.occurredAt ?? Date.now());
    fuzzyWindowEnd.setHours(fuzzyWindowEnd.getHours() + 24);

    const existingByTitle = await prisma.intelligenceEvent.findFirst({
      where: {
        topicId: input.topicId,
        titleHash: input.titleHash,
        status: { not: "ARCHIVED" },
        occurredAt: {
          gte: fuzzyWindowStart,
          lte: fuzzyWindowEnd,
        },
      },
      select: { id: true, primaryItemId: true, status: true, summaryStatus: true },
    });

    if (existingByTitle) {
      input.mergeReason = "标题归一化匹配：来自不同 URL 的同一事件报道";
      existing = existingByTitle;
    }
  }

  const event = await prisma.$transaction(async (tx) => {
    if (
      existing?.summaryStatus === "READY" &&
      (input.summaryStatus ?? "READY") !== "READY"
    ) {
      await tx.eventItem.upsert({
        where: {
          eventId_itemId: {
            eventId: existing.id,
            itemId: input.primaryItemId,
          },
        },
        update: {
          mergeReason: input.mergeReason ?? "已有完整摘要，保留为次要来源",
          role: "SECONDARY",
        },
        create: {
          eventId: existing.id,
          itemId: input.primaryItemId,
          mergeReason: input.mergeReason ?? "已有完整摘要，保留为次要来源",
          role: "SECONDARY",
        },
      });
      await tx.item.update({
        where: { id: input.primaryItemId },
        data: { status: input.itemStatus ?? "ANALYZED" },
      });
      return tx.intelligenceEvent.findUniqueOrThrow({ where: { id: existing.id } });
    }

    const updateData = {
      category: input.category,
      entities: input.entities ?? [],
      eventHash: input.eventHash,
      explanation: input.explanation,
      followUpSuggestion: input.followUpSuggestion,
      gravityScore: input.gravityScore,
      mergeReason: input.mergeReason,
      occurredAt: input.occurredAt,
      primaryItemId: input.primaryItemId,
      rawAiResponse: toInputJson(input.rawAiResponse),
      score: input.score,
      summary: input.summary,
      summaryRequestedAt: input.summaryStatus === "PENDING" ? undefined : null,
      summaryStatus: input.summaryStatus ?? "READY",
      title: input.title,
      titleHash: input.titleHash,
    };
    const upserted = existing
      ? await tx.intelligenceEvent.update({
          where: { id: existing.id },
          data: updateData,
        })
      : await tx.intelligenceEvent.create({
          data: {
            organizationId: input.organizationId,
            topicId: input.topicId,
            primaryItemId: input.primaryItemId,
            status: "UNREAD",
            title: input.title,
            summary: input.summary,
            summaryStatus: input.summaryStatus ?? "READY",
            category: input.category,
            entities: input.entities ?? [],
            score: input.score,
            gravityScore: input.gravityScore,
            eventHash: input.eventHash,
            titleHash: input.titleHash,
            explanation: input.explanation,
            followUpSuggestion: input.followUpSuggestion,
            mergeReason: input.mergeReason,
            occurredAt: input.occurredAt,
            rawAiResponse: toInputJson(input.rawAiResponse),
            eventItems: {
              create: {
                itemId: input.primaryItemId,
                role: "PRIMARY",
              },
            },
          },
        });

    if (existing) {
      const mergeReason =
        input.mergeReason ?? "事件哈希匹配：来自不同条目的同一事件报道";

      await tx.eventItem.updateMany({
        where: {
          eventId: existing.id,
          itemId: { not: input.primaryItemId },
          role: "PRIMARY",
        },
        data: {
          mergeReason,
          role: "SECONDARY",
        },
      });
      await tx.eventItem.upsert({
        where: {
          eventId_itemId: {
            eventId: existing.id,
            itemId: input.primaryItemId,
          },
        },
        update: {
          mergeReason: null,
          role: "PRIMARY",
        },
        create: {
          eventId: existing.id,
          itemId: input.primaryItemId,
          role: "PRIMARY",
        },
      });
    }

    if (
      existing?.primaryItemId &&
      existing.primaryItemId !== input.primaryItemId
    ) {
      await tx.item.update({
        where: { id: existing.primaryItemId },
        data: { status: "DUPLICATE" },
      });
    }

    await tx.item.update({
      where: { id: input.primaryItemId },
      data: { status: input.itemStatus ?? "ANALYZED" },
    });

    return upserted;
  });

  return event;
}

export async function listDashboardEvents(
  prisma: PrismaClient,
  scope: TenantScope & { userId: string },
  limit = 30,
): Promise<DashboardEventRecord[]> {
  const events = await prisma.intelligenceEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      status: {
        in: ["UNREAD", "SAVED"],
      },
    },
    include: {
      topic: {
        select: {
          name: true,
        },
      },
      primaryItem: {
        select: {
          sourceId: true,
          url: true,
          source: {
            select: {
              name: true,
              url: true,
            },
          },
        },
      },
      eventItems: {
        select: { itemId: true, role: true },
      },
      userStates: {
        where: {
          userId: scope.userId,
        },
        take: 1,
      },
    },
    orderBy: [{ gravityScore: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });

  return events.map(mapDashboardEventRecord);
}

export async function listSavedDashboardEvents(
  prisma: PrismaClient,
  scope: TenantScope & { userId: string },
  requestedPage = 1,
  requestedPageSize = 30,
): Promise<DashboardEventPage> {
  const pageSize = Math.max(1, Math.min(100, Math.trunc(requestedPageSize) || 30));
  const savedWhere: Prisma.IntelligenceEventWhereInput = {
    organizationId: scope.organizationId,
    userStates: {
      some: {
        saved: true,
        userId: scope.userId,
      },
    },
  };
  const total = await prisma.intelligenceEvent.count({ where: savedWhere });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(
    pageCount,
    Math.max(1, Math.trunc(requestedPage) || 1),
  );

  const events = await prisma.intelligenceEvent.findMany({
    where: savedWhere,
    include: {
      topic: {
        select: {
          name: true,
        },
      },
      primaryItem: {
        select: {
          sourceId: true,
          url: true,
          source: {
            select: {
              name: true,
              url: true,
            },
          },
        },
      },
      eventItems: {
        select: { itemId: true, role: true },
      },
      userStates: {
        where: {
          userId: scope.userId,
        },
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "desc" }, { gravityScore: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return {
    events: events.map(mapDashboardEventRecord),
    page,
    pageCount,
    pageSize,
    total,
  };
}

export async function getDashboardEventById(
  prisma: PrismaClient,
  scope: TenantScope & { eventId: string; userId: string },
): Promise<DashboardEventRecord | null> {
  const event = await prisma.intelligenceEvent.findFirst({
    where: {
      id: scope.eventId,
      organizationId: scope.organizationId,
    },
    include: {
      topic: {
        select: {
          name: true,
        },
      },
      primaryItem: {
        select: {
          sourceId: true,
          url: true,
          source: {
            select: {
              name: true,
              url: true,
            },
          },
        },
      },
      eventItems: {
        select: { itemId: true, role: true },
      },
      userStates: {
        where: {
          userId: scope.userId,
        },
        take: 1,
      },
    },
  });

  return event ? mapDashboardEventRecord(event) : null;
}

function mapDashboardEventRecord(
  event: DashboardEventQueryResult,
): DashboardEventRecord {
  const userState = event.userStates[0];

  return {
    category: event.category,
    entities: event.entities ?? [],
    eventId: event.id,
    explanation: event.explanation,
    followUpSuggestion: event.followUpSuggestion,
    gravityScore: event.gravityScore,
    mergeReason: event.mergeReason,
    mergedSourceCount: event.eventItems?.length ?? (event.primaryItemId ? 1 : 0),
    occurredAt: event.occurredAt,
    primaryItemUrl: event.primaryItem?.url ?? null,
    score: event.score,
    sourceId: event.primaryItem?.sourceId ?? null,
    sourceName: event.primaryItem?.source.name ?? null,
    sourceUrl: event.primaryItem?.source.url ?? null,
    status: event.status,
    summary: event.summary,
    summaryStatus: event.summaryStatus,
    title: event.title,
    topicId: event.topicId,
    topicName: event.topic.name,
    updatedAt: event.updatedAt,
    userSaved: userState?.saved ?? event.status === "SAVED",
    userStatus: userState?.status ?? null,
  };
}

export async function listPreferenceMemoryForDashboard(
  prisma: PrismaClient,
  scope: TenantScope & { userId: string },
  limit = 30,
): Promise<PreferenceMemoryRecord[]> {
  const memories = await prisma.preferenceMemory.findMany({
    where: {
      organizationId: scope.organizationId,
      userId: scope.userId,
    },
    include: {
      topic: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { confidence: "desc" }],
    take: limit,
  });

  return memories.map((memory) => ({
    confidence: memory.confidence,
    explanation: memory.explanation,
    key: memory.key,
    topicId: memory.topicId,
    topicName: memory.topic.name,
    updatedAt: memory.updatedAt,
    weight: extractPreferenceWeight(memory.value),
  }));
}

export async function listRecentFeedbackSignals(
  prisma: PrismaClient,
  scope: TenantScope & { userId: string },
  limit = 100,
): Promise<FeedbackSignalRecord[]> {
  const feedbackEvents = await prisma.feedbackEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      userId: scope.userId,
      kind: {
        in: [
          "READ",
          "SAVE",
          "DISMISS",
          "EXPORT",
          "CATEGORY_UP",
          "CATEGORY_DOWN",
        ],
      },
    },
    include: {
      event: {
        select: {
          category: true,
          primaryItem: {
            select: {
              sourceId: true,
              source: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return feedbackEvents.map((event) => ({
    category: event.event?.category ?? null,
    kind: event.kind as FeedbackSignalRecord["kind"],
    sourceId: event.event?.primaryItem?.sourceId ?? null,
    sourceName: event.event?.primaryItem?.source.name ?? null,
    topicId: event.topicId,
    value: event.value,
  }));
}

export async function recordCategoryPreferenceFeedback(
  prisma: PrismaClient,
  input: RecordCategoryPreferenceFeedbackInput,
) {
  const event = await prisma.intelligenceEvent.findFirstOrThrow({
    where: {
      id: input.eventId,
      organizationId: input.organizationId,
    },
    select: {
      category: true,
      id: true,
      primaryItemId: true,
      topicId: true,
    },
  });

  if (!event.category) {
    throw new Error("This event has no category to update.");
  }

  return prisma.feedbackEvent.create({
    data: {
      organizationId: input.organizationId,
      topicId: event.topicId,
      userId: input.userId,
      eventId: event.id,
      itemId: event.primaryItemId,
      kind: input.action === "up" ? "CATEGORY_UP" : "CATEGORY_DOWN",
      value: input.action === "up" ? 2 : -2,
      metadata: {
        category: event.category,
        source: "event-detail-category-preference",
      },
    },
  });
}

export async function upsertPreferenceMemory(
  prisma: PrismaClient,
  input: UpsertPreferenceMemoryInput,
) {
  return prisma.preferenceMemory.upsert({
    where: {
      topicId_userId_key: {
        key: input.key,
        topicId: input.topicId,
        userId: input.userId,
      },
    },
    update: {
      confidence: input.confidence,
      explanation: input.explanation,
      value: toRequiredInputJson(input.value),
    },
    create: {
      organizationId: input.organizationId,
      topicId: input.topicId,
      userId: input.userId,
      key: input.key,
      value: toRequiredInputJson(input.value),
      explanation: input.explanation,
      confidence: input.confidence,
    },
  });
}

export async function listEventsForDailyBriefing(
  prisma: PrismaClient,
  scope: TenantScope & { rangeEnd: Date; rangeStart: Date; topicId: string },
  limit = 10,
): Promise<BriefingEventRecord[]> {
  const events = await prisma.intelligenceEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      topicId: scope.topicId,
      summaryStatus: "READY",
      createdAt: {
        gte: scope.rangeStart,
        lt: scope.rangeEnd,
      },
      status: {
        in: ["UNREAD", "READ", "SAVED"],
      },
      primaryItem: {
        source: {
          status: "ACTIVE",
        },
      },
    },
    include: {
      topic: {
        select: {
          name: true,
        },
      },
      eventItems: {
        select: { itemId: true, role: true },
      },
      primaryItem: {
        select: {
          url: true,
          source: {
            select: {
              name: true,
              url: true,
            },
          },
        },
      },
    },
    orderBy: [{ gravityScore: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });

  const secondarySourceMap = await resolveSecondarySources(prisma, events);

  return events.map((event) => {
    const secondarySources: Array<{ sourceName: string; url: string | null }> = [];
    for (const ei of (event.eventItems ?? []).filter((ei) => ei.role === "SECONDARY")) {
      const info = secondarySourceMap.get(ei.itemId);
      if (info) secondarySources.push(info);
    }

    return {
      category: event.category,
      entities: event.entities ?? [],
      eventId: event.id,
      explanation: event.explanation,
      followUpSuggestion: event.followUpSuggestion,
      mergeReason: event.mergeReason,
      occurredAt: event.occurredAt,
      score: event.score,
      secondarySources,
      sourceName: event.primaryItem?.source.name ?? null,
      sourceUrl: event.primaryItem?.source.url ?? null,
      summary: event.summary,
      summaryStatus: event.summaryStatus,
      title: event.title,
      topicId: event.topicId,
      topicName: event.topic.name,
      url: event.primaryItem?.url ?? null,
    };
  });
}

export async function listTimelineEvents(
  prisma: PrismaClient,
  scope: TenantScope & {
    rangeEnd?: Date;
    rangeStart?: Date;
    topicId: string;
  },
  requestedPage = 1,
  requestedPageSize = 50,
): Promise<{ events: TimelineEventRecord[]; page: number; pageCount: number; pageSize: number; total: number }> {
  const pageSize = Math.max(1, Math.min(200, Math.trunc(requestedPageSize) || 50));
  const where: Prisma.IntelligenceEventWhereInput = {
    organizationId: scope.organizationId,
    topicId: scope.topicId,
    summaryStatus: "READY",
    status: { in: ["UNREAD", "READ", "SAVED"] },
    primaryItem: { source: { status: "ACTIVE" } },
  };
  if (scope.rangeStart || scope.rangeEnd) {
    where.occurredAt = {};
    if (scope.rangeStart) where.occurredAt.gte = scope.rangeStart;
    if (scope.rangeEnd) where.occurredAt.lt = scope.rangeEnd;
  }

  const total = await prisma.intelligenceEvent.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.trunc(requestedPage) || 1));

  const events = await prisma.intelligenceEvent.findMany({
    where,
    include: {
      topic: { select: { name: true } },
      eventItems: { select: { itemId: true, role: true } },
      primaryItem: {
        select: {
          url: true,
          source: { select: { name: true, url: true } },
        },
      },
    },
    orderBy: [{ occurredAt: "desc" }, { gravityScore: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const secondarySourceMap = await resolveSecondarySources(prisma, events);

  return {
    events: events.map((event) => {
      const secondarySources: Array<{ sourceName: string; url: string | null }> = [];
      for (const ei of (event.eventItems ?? []).filter((ei) => ei.role === "SECONDARY")) {
        const info = secondarySourceMap.get(ei.itemId);
        if (info) secondarySources.push(info);
      }
      return {
        eventId: event.id,
        title: event.title,
        summary: event.summary,
        summaryStatus: event.summaryStatus,
        category: event.category,
        entities: event.entities ?? [],
        explanation: event.explanation,
        followUpSuggestion: event.followUpSuggestion,
        mergeReason: event.mergeReason,
        occurredAt: event.occurredAt,
        score: event.score,
        secondarySources,
        sourceName: event.primaryItem?.source.name ?? null,
        sourceUrl: event.primaryItem?.source.url ?? null,
        topicId: event.topicId,
        topicName: event.topic.name,
        url: event.primaryItem?.url ?? null,
      };
    }),
    page,
    pageCount,
    pageSize,
    total,
  };
}

export async function createDailyBriefing(
  prisma: PrismaClient,
  input: CreateDailyBriefingInput,
) {
  return createPeriodBriefing(prisma, { ...input, period: "DAILY" });
}

export async function createPeriodBriefing(
  prisma: PrismaClient,
  input: CreatePeriodBriefingInput,
) {
  const eventReferences = input.eventIds.map((id) => ({ id }));

  return prisma.briefing.upsert({
    where: {
      topicId_period_rangeStart: {
        period: input.period,
        rangeStart: input.rangeStart,
        topicId: input.topicId,
      },
    },
    update: {
      title: input.title,
      content: input.content,
      generatedAt: input.generatedAt,
      markdown: input.markdown,
      rangeEnd: input.rangeEnd,
      metadata: toInputJson(input.metadata),
      events: {
        set: eventReferences,
      },
    },
    create: {
      organizationId: input.organizationId,
      topicId: input.topicId,
      period: input.period,
      title: input.title,
      content: input.content,
      generatedAt: input.generatedAt,
      markdown: input.markdown,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      metadata: toInputJson(input.metadata),
      events: {
        connect: eventReferences,
      },
    },
  });
}

export async function listBriefingsPage(
  prisma: PrismaClient,
  scope: TenantScope & { period?: "DAILY" | "WEEKLY" | "MONTHLY" },
  requestedPage = 1,
  requestedPageSize = 20,
): Promise<DashboardBriefingPage> {
  const pageSize = Math.max(1, Math.min(100, Math.trunc(requestedPageSize) || 20));
  const where: Prisma.BriefingWhereInput = {
    organizationId: scope.organizationId,
  };
  if (scope.period) {
    where.period = scope.period;
  }
  const total = await prisma.briefing.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(
    pageCount,
    Math.max(1, Math.trunc(requestedPage) || 1),
  );
  const briefings = await prisma.briefing.findMany({
    where,
    include: {
      topic: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { generatedAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return {
    briefings: briefings.map((briefing) => ({
      briefingId: briefing.id,
      generatedAt: briefing.generatedAt,
      markdown: briefing.markdown,
      period: briefing.period,
      rangeEnd: briefing.rangeEnd,
      rangeStart: briefing.rangeStart,
      title: briefing.title,
      topicName: briefing.topic.name,
    })),
    page,
    pageCount,
    pageSize,
    total,
  };
}

export async function getBriefingMarkdownForDownload(
  prisma: PrismaClient,
  scope: TenantScope & { briefingId: string },
) {
  return prisma.briefing.findFirst({
    where: {
      id: scope.briefingId,
      organizationId: scope.organizationId,
    },
    select: {
      id: true,
      markdown: true,
      title: true,
      topicId: true,
    },
  });
}

export async function getEventMarkdownExportRecord(
  prisma: PrismaClient,
  scope: TenantScope & { eventId: string },
): Promise<BriefingEventRecord | null> {
  const event = await prisma.intelligenceEvent.findFirst({
    where: {
      id: scope.eventId,
      organizationId: scope.organizationId,
    },
    include: {
      topic: {
        select: {
          name: true,
        },
      },
      primaryItem: {
        select: {
          url: true,
          source: {
            select: {
              name: true,
              url: true,
            },
          },
        },
      },
    },
  });

  if (!event) {
    return null;
  }

  return {
    category: event.category,
    entities: event.entities ?? [],
    eventId: event.id,
    explanation: event.explanation,
    followUpSuggestion: event.followUpSuggestion,
    mergeReason: event.mergeReason,
    occurredAt: event.occurredAt,
    score: event.score,
    secondarySources: [],
    sourceName: event.primaryItem?.source.name ?? null,
    sourceUrl: event.primaryItem?.source.url ?? null,
    summary: event.summary,
    summaryStatus: event.summaryStatus,
    title: event.title,
    topicId: event.topicId,
    topicName: event.topic.name,
    url: event.primaryItem?.url ?? null,
  };
}

export async function updateDashboardEventState(
  prisma: PrismaClient,
  input: UpdateDashboardEventStateInput,
) {
  const target = actionToEventState(input.action);
  const event = await prisma.intelligenceEvent.findFirstOrThrow({
    where: {
      id: input.eventId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      organizationId: true,
      topicId: true,
      primaryItemId: true,
      userStates: {
        where: { userId: input.userId },
        select: { readAt: true, saved: true },
        take: 1,
      },
    },
  });

  if (event.organizationId !== input.organizationId) {
    throw new Error(`Event ${input.eventId} does not belong to organization ${input.organizationId}`);
  }

  const now = new Date();

  if (input.action === "unsave") {
    const restoredStatus = event.userStates[0]?.readAt ? "READ" : "UNREAD";

    await prisma.$transaction([
      prisma.intelligenceEvent.update({
        where: { id: event.id },
        data: { status: restoredStatus },
      }),
      prisma.userItemState.upsert({
        where: {
          userId_eventId: {
            eventId: event.id,
            userId: input.userId,
          },
        },
        update: {
          saved: false,
          status: restoredStatus,
        },
        create: {
          eventId: event.id,
          saved: false,
          status: restoredStatus,
          userId: input.userId,
        },
      }),
    ]);
    return;
  }

  const preserveSaved =
    input.action === "read" && event.userStates[0]?.saved === true;
  const nextStatus = preserveSaved ? "SAVED" : target.status;

  await prisma.$transaction([
    prisma.intelligenceEvent.update({
      where: { id: event.id },
      data: {
        status: nextStatus,
      },
    }),
    prisma.userItemState.upsert({
      where: {
        userId_eventId: {
          eventId: event.id,
          userId: input.userId,
        },
      },
      update: {
        readAt: target.status === "READ" ? now : undefined,
        saved: preserveSaved || target.status === "SAVED",
        status: nextStatus,
      },
      create: {
        eventId: event.id,
        readAt: target.status === "READ" ? now : undefined,
        saved: preserveSaved || target.status === "SAVED",
        status: nextStatus,
        userId: input.userId,
      },
    }),
    prisma.feedbackEvent.create({
      data: {
        organizationId: input.organizationId,
        topicId: event.topicId,
        userId: input.userId,
        eventId: event.id,
        itemId: event.primaryItemId,
        kind: target.feedbackKind,
        value: target.value,
        metadata: {
          source: "dashboard-mvp",
        },
      },
    }),
  ]);
}

export async function listUnreadEvents(prisma: PrismaClient, scope: TopicScope) {
  return prisma.intelligenceEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      topicId: scope.topicId,
      summaryStatus: "READY",
      status: "UNREAD",
    },
    orderBy: [{ gravityScore: "desc" }, { createdAt: "desc" }],
  });
}

export async function mergeSemanticEvents(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    keepEventId: string;
    mergeEventIds: string[];
    reason: string;
  },
) {
  const mergeEventIds = [...new Set(input.mergeEventIds)];
  if (mergeEventIds.includes(input.keepEventId)) {
    throw new Error("Semantic merge target must not include the keep event.");
  }
  return prisma.$transaction(async (tx) => {
    const [keepEvent, mergeEvents] = await Promise.all([
      tx.intelligenceEvent.findFirst({
        where: { id: input.keepEventId, organizationId: input.organizationId },
        include: { eventItems: true },
      }),
      tx.intelligenceEvent.findMany({
        where: {
          id: { in: mergeEventIds },
          organizationId: input.organizationId,
        },
        include: { eventItems: true },
      }),
    ]);

    if (!keepEvent) {
      throw new Error(`Keep event ${input.keepEventId} not found.`);
    }

    if (mergeEvents.length !== mergeEventIds.length) {
      throw new Error("One or more semantic merge targets are outside the organization scope.");
    }

    const mergeEventMap = new Map(mergeEvents.map((event) => [event.id, event]));
    const eventItemCreates: Array<{
      eventId: string;
      itemId: string;
      role: "SECONDARY";
      mergeReason: string;
    }> = [];
    const allDuplicateItemIds: string[] = [];

    for (const mergeEventId of mergeEventIds) {
      const mergeEvent = mergeEventMap.get(mergeEventId);
      if (!mergeEvent) continue;

      const mergedItemIds = new Set(
        mergeEvent.eventItems.map((eventItem) => eventItem.itemId),
      );
      if (mergeEvent.primaryItemId) mergedItemIds.add(mergeEvent.primaryItemId);
      if (keepEvent.primaryItemId) mergedItemIds.delete(keepEvent.primaryItemId);

      for (const itemId of mergedItemIds) {
        eventItemCreates.push({
          eventId: keepEvent.id,
          itemId,
          role: "SECONDARY",
          mergeReason: input.reason,
        });
        allDuplicateItemIds.push(itemId);
      }
    }

    if (eventItemCreates.length > 0) {
      await tx.eventItem.createMany({
        data: eventItemCreates,
        skipDuplicates: true,
      });
    }

    if (allDuplicateItemIds.length > 0) {
      await tx.item.updateMany({
        where: {
          id: { in: allDuplicateItemIds },
          organizationId: input.organizationId,
        },
        data: { status: "DUPLICATE" },
      });
    }

    if (mergeEventIds.length > 0) {
      await tx.intelligenceEvent.updateMany({
        where: {
          id: { in: mergeEventIds },
          organizationId: input.organizationId,
        },
        data: {
          eventHash: null,
          status: "ARCHIVED",
          titleHash: null,
          mergeReason: `语义聚类合并到 ${input.keepEventId}: ${input.reason}`,
        },
      });
    }

    return keepEvent;
  });
}
