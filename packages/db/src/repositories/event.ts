import type { Prisma, PrismaClient } from "@prisma/client";
import {
  actionToEventState,
  extractPreferenceWeight,
  toInputJson,
  toRequiredInputJson,
} from "./util.js";
import { resolveSecondarySources } from "./secondary-sources.js";
import type {
  BriefingDetailRecord,
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
  MarkBriefingEventsReadInput,
  MarkBriefingEventsReadResult,
  PreferenceMemoryRecord,
  RecordCategoryPreferenceFeedbackInput,
  TenantScope,
  TimelineEventRecord,
  TopicScope,
  UpdateDashboardEventStateInput,
  UpsertPreferenceMemoryInput,
  UserHistoryPage,
  UserHistoryScope,
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
  // SPEC §5.5: 主信息流按当前用户 UserItemState 派生。
  // 默认显示组织内未归档事件中，当前用户未 READ/DISMISSED 的（即没有 UserItemState，
  // 或 UserItemState.status 为 UNREAD/SAVED 的事件）。
  // 不再用全局 IntelligenceEvent.status in [UNREAD,SAVED] 过滤——那是隔离泄漏的根因。
  const events = await prisma.intelligenceEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      // 组织级归档（语义合并/组织级 ARCHIVED）仍排除。
      status: { notIn: ["ARCHIVED"] },
      // 排除当前用户已 READ / DISMISSED / 个人 ARCHIVED 的事件。
      // #172 follow-up (#174)：引入个人 ARCHIVED 后必须一并排除，
      // 否则归档事件会继续出现在当前用户 feed（回归）。
      NOT: {
        userStates: {
          some: {
            userId: scope.userId,
            status: { in: ["READ", "DISMISSED", "ARCHIVED"] },
          },
        },
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

export async function listUserHistoryEvents(
  prisma: PrismaClient,
  scope: UserHistoryScope,
  requestedPage = 1,
  requestedPageSize = 30,
): Promise<UserHistoryPage> {
  // SPEC §5.5 / Plan Task 3.3 (#174): 个人阅读历史与归档视图。
  // 按当前用户 UserItemState.status 分页筛选，组织级 ARCHIVED 不混入个人视图。
  // 与 listSavedDashboardEvents 区别：
  //   - saved 视图固定 saved=true 筛选；
  //   - history 视图按 status 参数筛选（READ/DISMISSED/SAVED/ARCHIVED），
  //     供前端"已读/忽略/收藏/归档"分页切换。
  // 非法 status 回退到空结果（不抛、不泄漏）。
  const validStatuses: UserHistoryScope["status"][] = [
    "READ",
    "DISMISSED",
    "SAVED",
    "ARCHIVED",
  ];
  if (!validStatuses.includes(scope.status)) {
    return { events: [], page: 1, pageCount: 1, pageSize: requestedPageSize, total: 0 };
  }

  const pageSize = Math.max(1, Math.min(100, Math.trunc(requestedPageSize) || 30));
  const where: Prisma.IntelligenceEventWhereInput = {
    organizationId: scope.organizationId,
    // 组织级 ARCHIVED 排除（语义合并/组织级归档不进入个人历史视图）。
    status: { notIn: ["ARCHIVED"] },
    userStates: {
      some: {
        saved: scope.status === "SAVED" ? true : undefined,
        status: scope.status,
        userId: scope.userId,
      },
    },
  };

  const total = await prisma.intelligenceEvent.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(
    pageCount,
    Math.max(1, Math.trunc(requestedPage) || 1),
  );

  const events = await prisma.intelligenceEvent.findMany({
    where,
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
    // SPEC §5.5: status 派生自当前用户 UserItemState，无则默认 UNREAD。
    // 不再回传全局 IntelligenceEvent.status 当个人状态（那是事件生命周期）。
    status: userState?.status ?? "UNREAD",
    summary: event.summary,
    summaryStatus: event.summaryStatus,
    title: event.title,
    topicId: event.topicId,
    topicName: event.topic.name,
    updatedAt: event.updatedAt,
    // SPEC §5.5: userSaved 只来自当前用户 UserItemState.saved，
    // 不得 fallback 到全局 IntelligenceEvent.status === "SAVED"。
    userSaved: userState?.saved ?? false,
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
        // SPEC §5.6: every feedback kind except SOURCE_APPROVE/SOURCE_REJECT
        // (governance audit only, must not enter personal preference learning).
        in: [
          "READ",
          "SAVE",
          "DISMISS",
          "EXPORT",
          "CATEGORY_UP",
          "CATEGORY_DOWN",
          "MORE_LIKE_THIS",
          "LESS_LIKE_THIS",
          "SOURCE_QUALITY_UP",
          "SOURCE_QUALITY_DOWN",
          "SCORE_UP",
          "SCORE_DOWN",
        ],
      },
    },
    include: {
      // IntelligenceEvent is optional for enhanced feedback (SOURCE_QUALITY_UP/DOWN,
      // MORE/LESS_LIKE_THIS may carry no eventId). When present, it provides
      // category + primary item source; when absent, fall back to FeedbackEvent.source.
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
      source: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return feedbackEvents.map((feedbackEvent) => {
    const eventSourceId = feedbackEvent.event?.primaryItem?.sourceId ?? null;
    const eventSourceName = feedbackEvent.event?.primaryItem?.source.name ?? null;
    return {
      category: feedbackEvent.event?.category ?? null,
      createdAt: feedbackEvent.createdAt,
      eventId: feedbackEvent.eventId,
      feedbackEventId: feedbackEvent.id,
      kind: feedbackEvent.kind as FeedbackSignalRecord["kind"],
      sourceId: eventSourceId ?? feedbackEvent.sourceId ?? null,
      sourceName: eventSourceName ?? feedbackEvent.source?.name ?? null,
      topicId: feedbackEvent.topicId,
      value: feedbackEvent.value,
    };
  });
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
      // SPEC §5.5: 简报是组织级产物，不按个人阅读状态过滤候选。
      // 只排除组织级 ARCHIVED（语义合并/归档）。旧实现用 status in [UNREAD,READ,SAVED]
      // 全局过滤会因用户 A read 后把事件移出 READ 状态而影响简报内容——隔离泄漏。
      status: { notIn: ["ARCHIVED"] },
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
    // SPEC §5.5: 历史时间线是组织级视图，不按个人阅读状态过滤。
    // 只排除组织级 ARCHIVED。
    status: { notIn: ["ARCHIVED"] },
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

// Issue #182 (Plan Task 4.6) - 浏览器简报详情。
// 返回 briefing 完整元数据 + 正文（markdown 优先，content fallback）+ 关联 events 列表。
// 关联 events 来自 Briefing.events 关系表（createPeriodBriefing 用 events.set 写入的 snapshot），
// 供页面提供 Event 跳转入口。严格 organization fenced：跨租户返回 null。
// 查询形状：1 次 briefing.findFirst（带出 topic.name + events），无 N+1。
export async function getBriefingDetail(
  prisma: PrismaClient,
  scope: TenantScope & { briefingId: string },
): Promise<BriefingDetailRecord | null> {
  const briefing = await prisma.briefing.findFirst({
    where: {
      id: scope.briefingId,
      organizationId: scope.organizationId,
    },
    select: {
      id: true,
      content: true,
      generatedAt: true,
      markdown: true,
      period: true,
      rangeEnd: true,
      rangeStart: true,
      title: true,
      topicId: true,
      topic: {
        select: {
          name: true,
        },
      },
      events: {
        select: {
          id: true,
          title: true,
          occurredAt: true,
          topicId: true,
        },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      },
    },
  });

  if (!briefing) {
    return null;
  }

  const markdown = briefing.markdown;
  const content = briefing.content ?? "";
  const body = markdown ?? content;

  return {
    briefingId: briefing.id,
    body,
    content,
    events: briefing.events.map((event) => ({
      eventId: event.id,
      title: event.title,
      occurredAt: event.occurredAt,
      topicId: event.topicId,
    })),
    generatedAt: briefing.generatedAt,
    markdown,
    period: briefing.period,
    rangeEnd: briefing.rangeEnd,
    rangeStart: briefing.rangeStart,
    title: briefing.title,
    topicId: briefing.topicId,
    topicName: briefing.topic.name,
  };
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
  // SPEC §5.5: 个人阅读状态完全由 UserItemState 承载。
  // read/save/dismiss/unsave/archive/restore 只写 UserItemState（+ 对应 FeedbackEvent），
  // 不再写 IntelligenceEvent.status（那是事件生命周期，组织级）。
  // 旧实现同时双写 IntelligenceEvent.status 导致用户 A 的状态泄漏到用户 B。
  //
  // archive/restore 语义（Plan Task 3.3 / #174）：
  //   - archive：UserItemState.status = ARCHIVED，无 FeedbackEvent（整理动作，无偏好语义）。
  //   - restore：从 ARCHIVED 回退到按 readAt/saved 派生的等价状态（READ/SAVED/UNREAD），
  //     无 FeedbackEvent（撤销归档不是新的偏好信号）。
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
        select: { readAt: true, saved: true, status: true },
        take: 1,
      },
    },
  });

  if (event.organizationId !== input.organizationId) {
    throw new Error(`Event ${input.eventId} does not belong to organization ${input.organizationId}`);
  }

  const now = new Date();
  const current = event.userStates[0];

  if (input.action === "unsave") {
    // unsave 只清除 saved 标记；个人阅读状态（READ/UNREAD）由是否曾 readAt 决定，
    // 不回退到 UNREAD——已读事件取消收藏后仍保持 READ（SPEC §5.5 双轨：saved 与 status 独立）。
    const restoredStatus = current?.status ?? (current?.readAt ? "READ" : "UNREAD");

    await prisma.$transaction([
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

  if (input.action === "archive") {
    // archive 只置 ARCHIVED，保留 saved（双轨：归档不清收藏标记）。
    // 不产生 FeedbackEvent（整理动作，无偏好语义）。
    await prisma.$transaction([
      prisma.userItemState.upsert({
        where: {
          userId_eventId: {
            eventId: event.id,
            userId: input.userId,
          },
        },
        update: {
          saved: current?.saved ?? false,
          status: "ARCHIVED",
        },
        create: {
          eventId: event.id,
          saved: current?.saved ?? false,
          status: "ARCHIVED",
          userId: input.userId,
        },
      }),
    ]);
    return;
  }

  if (input.action === "restore") {
    // restore：按 readAt/saved 派生回退后的状态。
    //   - saved=true → SAVED（双轨保留收藏）。
    //   - 否则曾 readAt → READ。
    //   - 否则 UNREAD。
    const restoredStatus =
      current?.saved === true
        ? "SAVED"
        : current?.readAt
          ? "READ"
          : "UNREAD";

    await prisma.$transaction([
      prisma.userItemState.upsert({
        where: {
          userId_eventId: {
            eventId: event.id,
            userId: input.userId,
          },
        },
        update: {
          saved: current?.saved ?? false,
          status: restoredStatus,
        },
        create: {
          eventId: event.id,
          saved: current?.saved ?? false,
          status: restoredStatus,
          userId: input.userId,
        },
      }),
    ]);
    return;
  }

  // read/save/dismiss：保留已收藏标记（SPEC §5.5：对已收藏事件执行 read 保留 saved=true，
  // 只有显式 unsave 才移出收藏）。
  const preserveSaved =
    input.action === "read" && event.userStates[0]?.saved === true;
  const nextStatus = preserveSaved ? "SAVED" : target.status;

  const operations: Prisma.PrismaPromise<unknown>[] = [
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
  ];

  // read/save/dismiss 产生对应 FeedbackEvent（偏好信号）。
  // archive/restore 不产生（已在上面提前 return）。
  if (target.feedbackKind !== null) {
    operations.push(
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
    );
  }

  await prisma.$transaction(operations);
}

export async function markBriefingEventsRead(
  prisma: PrismaClient,
  input: MarkBriefingEventsReadInput,
): Promise<MarkBriefingEventsReadResult> {
  // SPEC §5.5 / Plan Task 3.2 (#173): 按 briefing snapshot 批量标记当前用户已读。
  // 复用 #172 UserItemState 隔离：只写 UserItemState + FeedbackEvent(READ)，
  // 不写 IntelligenceEvent.status。
  //
  // briefing snapshot = Briefing.events 关系表当时固定的 event IDs 集合
  // （createPeriodBriefing 用 events.set 写入，重新生成时整体替换）。
  //
  // 查询形状（避免 N+1）：
  //   1. briefing.findFirst — 1 次，带出 events 关系（id/topicId/primaryItemId）+ topicId。
  //   2. userItemState.findMany — 1 次，eventId.in [...] 批量取当前用户现有状态。
  //   3. $transaction([upsert..., feedbackEvent.create...]) — 单事务批量提交。
  //
  // 幂等：status ∈ {READ, SAVED} 视为已读终态，skip；
  // UNREAD/DISMISSED/ARCHIVED/无记录 → changed。
  // 保留 saved（双轨，对齐 updateDashboardEventState）：
  //   - 已 saved → status=SAVED, saved=true（read 写 readAt 但保留收藏）。
  //   - 未 saved → status=READ, saved=false。
  const briefing = await prisma.briefing.findFirst({
    where: {
      id: input.briefingId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      topicId: true,
      events: {
        select: {
          id: true,
          topicId: true,
          primaryItemId: true,
        },
      },
    },
  });

  if (!briefing || briefing.events.length === 0) {
    return { changed: 0, skipped: 0 };
  }

  const eventIds = briefing.events.map((event) => event.id);
  const eventById = new Map(briefing.events.map((event) => [event.id, event]));

  const existingStates = await prisma.userItemState.findMany({
    where: {
      userId: input.userId,
      eventId: { in: eventIds },
    },
    select: {
      eventId: true,
      status: true,
      saved: true,
      readAt: true,
    },
  });
  const stateByEventId = new Map(existingStates.map((state) => [state.eventId, state]));

  const now = new Date();
  type Plan = {
    eventId: string;
    topicId: string;
    primaryItemId: string | null;
    nextStatus: "READ" | "SAVED";
    preserveSaved: boolean;
  };
  const plan: Plan[] = [];
  let skipped = 0;

  for (const eventId of eventIds) {
    const event = eventById.get(eventId);
    if (!event) continue;

    const current = stateByEventId.get(eventId);
    const isReadTerminal =
      current?.status === "READ" || current?.status === "SAVED";
    if (isReadTerminal) {
      skipped += 1;
      continue;
    }

    const preserveSaved = current?.saved === true;
    plan.push({
      eventId,
      topicId: event.topicId,
      primaryItemId: event.primaryItemId,
      nextStatus: preserveSaved ? "SAVED" : "READ",
      preserveSaved,
    });
  }

  if (plan.length === 0) {
    return { changed: 0, skipped };
  }

  const operations: Prisma.PrismaPromise<unknown>[] = plan.map((entry) =>
    prisma.userItemState.upsert({
      where: {
        userId_eventId: {
          eventId: entry.eventId,
          userId: input.userId,
        },
      },
      update: {
        readAt: now,
        saved: entry.preserveSaved,
        status: entry.nextStatus,
      },
      create: {
        eventId: entry.eventId,
        readAt: now,
        saved: entry.preserveSaved,
        status: entry.nextStatus,
        userId: input.userId,
      },
    }),
  );

  // 每条 changed 事件 create 一条 READ 反馈（轻量正反馈，对齐单条 read 路径）。
  // 只对 changed 写，避免对已读事件重复产生 READ 信号污染偏好学习。
  for (const entry of plan) {
    operations.push(
      prisma.feedbackEvent.create({
        data: {
          organizationId: input.organizationId,
          topicId: entry.topicId,
          userId: input.userId,
          eventId: entry.eventId,
          itemId: entry.primaryItemId,
          kind: "READ",
          value: 1,
          metadata: {
            source: "briefing-bulk-read",
            briefingId: input.briefingId,
          },
        },
      }),
    );
  }

  await prisma.$transaction(operations);

  return { changed: plan.length, skipped };
}

export async function listUnreadEvents(prisma: PrismaClient, scope: TopicScope) {
  // SPEC §5.5: IntelligenceEvent.status 回归事件生命周期，个人阅读状态不在全局 status。
  // 此查询语义从"个人未读"修正为"组织级未归档"，供 worker/instant push 使用。
  return prisma.intelligenceEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      topicId: scope.topicId,
      summaryStatus: "READY",
      status: { notIn: ["ARCHIVED"] },
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
