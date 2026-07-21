import type { Prisma, PrismaClient } from "@prisma/client";
import {
  calculateSourceQualityScore,
  ratio,
} from "./util.js";
import { mapDashboardEventRecord } from "./event.js";
import type {
  TenantScope,
  TopicDashboardSourceHealthRecord,
  TopicDashboardSummary,
  TopicScope,
  TopicTrendSummary,
  TrendDailyBucket,
  TrendRangeDays,
} from "./types.js";

// Issue #185 (Plan Task 4.7) - 每主题一体化 Dashboard 与趋势视图。
// SPEC §5.8 Dashboard：每个主题一个页面，展示未读 Top 情报、已读/收藏、趋势、信源状态。
// 趋势维度：7/30 天事件/类别/实体/来源质量。
// 所有查询严格 organization + topic fenced；DB 聚合用 Prisma groupBy。
// 不改 schema；服务端分页与 DB 聚合。

const UNREAD_TOP_LIMIT = 10;
const SAVED_PAGE_SIZE = 10;
const RECENT_BRIEFING_LIMIT = 5;

/**
 * 每主题一体化 Dashboard 聚合查询。
 * 并发拉取未读 Top、收藏事件、已读计数、最近简报、信源健康、7/30 天趋势。
 * 所有子查询严格 organizationId + topicId fenced。
 */
export async function getTopicDashboard(
  prisma: PrismaClient,
  scope: TenantScope & { topicId: string; userId: string },
): Promise<TopicDashboardSummary | null> {
  const { organizationId, topicId, userId } = scope;

  const topic = await prisma.topic.findFirst({
    where: { id: topicId, organizationId },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          intelligenceEvents: true,
          sources: true,
          briefings: true,
        },
      },
    },
  });

  if (!topic) {
    return null;
  }

  const baseWhere = { organizationId, topicId };

  const [
    unreadEvents,
    savedEvents,
    savedTotal,
    readTotal,
    recentBriefings,
    sourceHealth,
    trend7,
    trend30,
  ] = await Promise.all([
    // 未读 Top：当前用户未 READ/DISMISSED/ARCHIVED 的事件，按 gravityScore 降序。
    prisma.intelligenceEvent.findMany({
      where: {
        ...baseWhere,
        status: { notIn: ["ARCHIVED"] },
        summaryStatus: "READY",
        NOT: {
          userStates: {
            some: {
              userId,
              status: { in: ["READ", "DISMISSED", "ARCHIVED"] },
            },
          },
        },
      },
      include: {
        topic: { select: { name: true } },
        primaryItem: {
          select: {
            sourceId: true,
            url: true,
            source: { select: { name: true, url: true } },
          },
        },
        eventItems: { select: { itemId: true, role: true } },
        userStates: { where: { userId }, take: 1 },
      },
      orderBy: [{ gravityScore: "desc" }, { updatedAt: "desc" }],
      take: UNREAD_TOP_LIMIT,
    }),
    // 收藏事件（第一页）。
    prisma.intelligenceEvent.findMany({
      where: {
        ...baseWhere,
        status: { notIn: ["ARCHIVED"] },
        userStates: { some: { saved: true, userId } },
      },
      include: {
        topic: { select: { name: true } },
        primaryItem: {
          select: {
            sourceId: true,
            url: true,
            source: { select: { name: true, url: true } },
          },
        },
        eventItems: { select: { itemId: true, role: true } },
        userStates: { where: { userId }, take: 1 },
      },
      orderBy: [{ updatedAt: "desc" }, { gravityScore: "desc" }],
      skip: 0,
      take: SAVED_PAGE_SIZE,
    }),
    // 收藏总数。
    prisma.intelligenceEvent.count({
      where: {
        ...baseWhere,
        status: { notIn: ["ARCHIVED"] },
        userStates: { some: { saved: true, userId } },
      },
    }),
    // 已读总数（当前用户 READ 状态，不含组织级 ARCHIVED）。
    prisma.intelligenceEvent.count({
      where: {
        ...baseWhere,
        status: { notIn: ["ARCHIVED"] },
        userStates: { some: { status: "READ", userId } },
      },
    }),
    // 最近简报。
    prisma.briefing.findMany({
      where: baseWhere,
      orderBy: { generatedAt: "desc" },
      take: RECENT_BRIEFING_LIMIT,
      select: {
        id: true,
        generatedAt: true,
        period: true,
        title: true,
        rangeStart: true,
        rangeEnd: true,
      },
    }),
    // 信源健康。
    getSourceHealthForTopic(prisma, { organizationId, topicId }),
    // 趋势 7 天。
    getTopicTrends(prisma, { organizationId, topicId }, 7),
    // 趋势 30 天。
    getTopicTrends(prisma, { organizationId, topicId }, 30),
  ]);

  return {
    topic: {
      id: topic.id,
      name: topic.name,
      description: topic.description,
      status: topic.status,
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
      sourceCount: topic._count.sources,
      eventCount: topic._count.intelligenceEvents,
      briefingCount: topic._count.briefings,
    },
    unreadTop: unreadEvents.map(mapDashboardEventRecord),
    savedEvents: savedEvents.map(mapDashboardEventRecord),
    savedTotal,
    readTotal,
    recentBriefings: recentBriefings.map((b) => ({
      briefingId: b.id,
      generatedAt: b.generatedAt.toISOString(),
      period: b.period,
      title: b.title,
      rangeStart: b.rangeStart.toISOString(),
      rangeEnd: b.rangeEnd.toISOString(),
    })),
    sourceHealth,
    trends: {
      "7": trend7,
      "30": trend30,
    },
  };
}

/**
 * 趋势查询：7/30 天事件/类别/实体/来源质量。
 * 使用 Prisma groupBy 进行 DB 聚合，避免全量拉取到内存。
 * 窗口按 occurredAt 过滤；occurredAt 为 null 的事件不计入趋势。
 */
export async function getTopicTrends(
  prisma: PrismaClient,
  scope: TopicScope,
  rangeDays: TrendRangeDays,
): Promise<TopicTrendSummary> {
  const { organizationId, topicId } = scope;
  const rangeEnd = new Date();
  const rangeStart = new Date();
  rangeStart.setUTCDate(rangeStart.getUTCDate() - rangeDays);

  const where: Prisma.IntelligenceEventWhereInput = {
    organizationId,
    topicId,
    occurredAt: { gte: rangeStart, lt: rangeEnd },
    status: { notIn: ["ARCHIVED"] },
  };

  // 并发：总数 + 按天聚合 + category+entity 聚合 + 来源质量。
  const [totalEvents, dailyRaw, categoryEntityResult, sourceQuality] =
    await Promise.all([
      prisma.intelligenceEvent.count({ where }),

      // 按天聚合事件数：groupBy occurredAt，客户端按天归并。
      prisma.intelligenceEvent
        .groupBy({
          by: ["occurredAt"],
          where,
          _count: { id: true },
          orderBy: { occurredAt: "asc" },
        })
        .then((rows) =>
          rows.map((r) => ({
            rawDate: r.occurredAt
              ? new Date(r.occurredAt).toISOString().slice(0, 10)
              : null,
            count: r._count.id,
          })),
        ),

      // 按 category 聚合 + 实体展开（一次 findMany 拉取 category + entities）。
      prisma.intelligenceEvent
        .findMany({
          where,
          select: { category: true, entities: true },
        })
        .then((rows) => {
          const catMap = new Map<string, number>();
          const entMap = new Map<string, number>();
          for (const row of rows) {
            const cat = row.category ?? "未分类";
            catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
            for (const entity of row.entities ?? []) {
              entMap.set(entity, (entMap.get(entity) ?? 0) + 1);
            }
          }
          return {
            categoryBuckets: Array.from(catMap.entries())
              .map(([category, count]) => ({ category, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 10),
            entityBuckets: Array.from(entMap.entries())
              .map(([entity, count]) => ({ entity, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 10),
          };
        }),

      // 来源质量：该 topic 下 ACTIVE 源的质量指标。
      getSourceHealthForTopic(prisma, { organizationId, topicId }).then((rows) =>
        rows
          .filter((s) => s.status === "ACTIVE")
          .slice(0, 10)
          .map((s) => ({
            sourceId: s.sourceId,
            sourceName: s.name,
            qualityScore: s.qualityScore,
            hitRate: s.hitRate,
            noiseRate: s.noiseRate,
            eventCount: s.eventCount,
          })),
      ),
    ]);

  return {
    rangeDays,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    totalEvents,
    dailyBuckets: collapseDailyBuckets(dailyRaw, rangeStart, rangeDays),
    categoryBuckets: categoryEntityResult.categoryBuckets,
    entityBuckets: categoryEntityResult.entityBuckets,
    sourceQuality,
  };
}

/**
 * 将 groupBy by occurredAt 的结果填补为连续日期序列。
 */
function collapseDailyBuckets(
  buckets: Array<{ rawDate: string | null; count: number }>,
  rangeStart: Date,
  rangeDays: TrendRangeDays,
): TrendDailyBucket[] {
  const dayMap = new Map<string, number>();
  for (const bucket of buckets) {
    if (!bucket.rawDate) continue;
    dayMap.set(bucket.rawDate, (dayMap.get(bucket.rawDate) ?? 0) + bucket.count);
  }

  const result: TrendDailyBucket[] = [];
  const cursor = new Date(rangeStart);
  cursor.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < rangeDays; i++) {
    const dateStr = cursor.toISOString().slice(0, 10);
    result.push({
      date: dateStr,
      count: dayMap.get(dateStr) ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}

/**
 * 信源健康：按 topic 聚合每个 source 的质量指标。
 * 复用 listSourceGovernanceReport 的计算逻辑，但限定到单个 topic。
 */
async function getSourceHealthForTopic(
  prisma: PrismaClient,
  scope: TopicScope,
): Promise<TopicDashboardSourceHealthRecord[]> {
  const sources = await prisma.source.findMany({
    where: {
      organizationId: scope.organizationId,
      topicId: scope.topicId,
    },
    include: {
      items: {
        select: {
          status: true,
          intelligenceEvents: {
            select: { id: true, status: true },
          },
          eventItems: {
            select: { role: true },
          },
        },
      },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  return sources.map((source) => {
    const totalItems = source.items.length;
    const filteredItems = source.items.filter(
      (item) => item.status === "FILTERED",
    ).length;
    let hitItems = 0;
    let duplicateItems = 0;
    const activeEventIds = new Set<string>();

    for (const item of source.items) {
      const activePrimaryEvents = item.intelligenceEvents.filter(
        (event) => event.status !== "ARCHIVED",
      );
      const hasActivePrimary = activePrimaryEvents.length > 0;
      const hasActiveSecondary = item.eventItems.some(
        (eventItem) => eventItem.role === "SECONDARY",
      );

      for (const event of activePrimaryEvents) activeEventIds.add(event.id);
      if (hasActivePrimary || item.eventItems.length > 0) hitItems += 1;
      if (item.status === "DUPLICATE" || (!hasActivePrimary && hasActiveSecondary)) {
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
    const qualityScore = source.qualityScore || derivedQualityScore;

    return {
      sourceId: source.id,
      name: source.name,
      status: source.status,
      qualityScore,
      hitRate,
      noiseRate,
      duplicateRate,
      totalItems,
      eventCount,
      lastFetchedAt: source.lastFetchedAt?.toISOString() ?? null,
      lastError: source.lastError,
      consecutiveFailures: source.consecutiveFailures,
    };
  });
}
