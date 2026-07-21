import {
  buildTopicProfileContext,
  createBusinessWindowRange,
  createContentHash,
  resolveBusinessTimezone,
  renderFilteredStatsSection,
  summarizeFilteredStats,
  DEFAULT_DIGEST_STYLE,
  renderDailyBriefingMarkdown,
  renderPeriodBriefingMarkdown,
} from "@wangchao/core";
import {
  createTaskRun,
  completeTaskRun,
  countFilteredItemsInRange,
  failTaskRun,
  getPrismaClient,
  listActiveTopics,
  listEventsForDailyBriefing,
  listPreferenceMemoryForDashboard,
  createDailyBriefing,
  createPeriodBriefing,
  listTimelineEvents,
} from "@wangchao/db";
import { isCycleShuttingDown, isCycleTimeExhausted } from "./lifecycle.js";

// Issue #184 (Plan Task 4.5) - SPEC §4.2 业务时区。
// 当前无 schema 字段承载时区（约束：本轮不做 migration），所以解析器
// 输入留空 -> 回退 UTC，行为与旧 createUtc*Range 一致。
// 待 Organization/User 增加 timezone 字段后，从 DB 读取传入即可，
// 业务窗口函数已就位。这里集中入口便于后续替换。
function resolveWorkspaceTimezone(): string {
  return resolveBusinessTimezone({});
}

export async function runDailyBriefingCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  userId: string,
): Promise<number> {
  const topics = await listActiveTopics(prisma, { organizationId });
  let generatedBriefings = 0;

  for (const topic of topics) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
    const generatedAt = new Date();
    const timezone = resolveWorkspaceTimezone();
    const { rangeEnd, rangeStart } = createBusinessWindowRange("DAILY", timezone, generatedAt);
    const taskRun = await createTaskRun(prisma, {
      input: {
        period: "DAILY",
        rangeEnd: rangeEnd.toISOString(),
        rangeStart: rangeStart.toISOString(),
        timezone,
      },
      organizationId,
      topicId: topic.id,
      type: "BRIEFING_GENERATION",
    });

    try {
      const [events, preferences] = await Promise.all([
        listEventsForDailyBriefing(prisma, {
          organizationId,
          rangeEnd,
          rangeStart,
          topicId: topic.id,
        }),
        listPreferenceMemoryForDashboard(prisma, { organizationId, userId }),
      ]);

      if (events.length === 0) {
        await completeTaskRun(prisma, taskRun.id, {
          eventCount: 0,
          outcome: "skipped-no-events",
        });
        continue;
      }

      const context = buildTopicProfileContext(topic.profile, {
        description: topic.description,
        name: topic.name,
      });

      const markdown = renderDailyBriefingMarkdown({
        digestStyle: context.digestStyle ?? DEFAULT_DIGEST_STYLE,
        events: events.map((event) => ({
          category: event.category,
          entities: event.entities,
          explanation: event.explanation,
          followUpSuggestion: event.followUpSuggestion ?? undefined,
          occurredAt: event.occurredAt,
          score: event.score,
          secondarySources: event.secondarySources,
          sourceName: event.sourceName,
          sourceUrl: event.sourceUrl,
          summary: event.summary,
          title: event.title,
          url: event.url,
        })),
        generatedAt,
        preferences: preferences
          .filter((preference) => preference.topicId === topic.id)
          .map((preference) => ({
            explanation: preference.explanation,
            key: preference.key,
            weight: preference.weight,
          })),
        topicName: topic.name,
      });
      const briefing = await createDailyBriefing(prisma, {
        content: markdown,
        eventIds: events.map((event) => event.eventId),
        generatedAt,
        markdown,
        metadata: {
          contentHash: createContentHash(markdown),
          filteredStats: await buildFilteredStatsMetadata(prisma, {
            organizationId,
            rangeEnd,
            rangeStart,
            topicId: topic.id,
          }),
          mode: "explainable-rules",
          timezone,
        },
        organizationId,
        rangeEnd,
        rangeStart,
        title: `${topic.name}｜每日简报`,
        topicId: topic.id,
      });
      await completeTaskRun(prisma, taskRun.id, {
        briefingId: briefing.id,
        eventCount: events.length,
        outcome: "upserted",
      });
      generatedBriefings += 1;
    } catch (error) {
      await failTaskRun(prisma, taskRun.id, error);
      throw error;
    }
  }

  return generatedBriefings;
}

export async function runPeriodBriefingCycle(
  prisma: ReturnType<typeof getPrismaClient>,
  organizationId: string,
  userId: string,
  period: "WEEKLY" | "MONTHLY",
): Promise<number> {
  const topics = await listActiveTopics(prisma, { organizationId });
  let generatedBriefings = 0;

  for (const topic of topics) {
    if (isCycleShuttingDown() || isCycleTimeExhausted()) break;
    const generatedAt = new Date();
    const timezone = resolveWorkspaceTimezone();
    const { rangeEnd, rangeStart } = createBusinessWindowRange(period, timezone, generatedAt);

    const taskRun = await createTaskRun(prisma, {
      input: {
        period,
        rangeEnd: rangeEnd.toISOString(),
        rangeStart: rangeStart.toISOString(),
        timezone,
      },
      organizationId,
      topicId: topic.id,
      type: "BRIEFING_GENERATION",
    });

    try {
      const timelineResult = await listTimelineEvents(
        prisma,
        { organizationId, rangeEnd, rangeStart, topicId: topic.id },
        1,
        100,
      );
      const events = timelineResult.events;

      if (events.length === 0) {
        await completeTaskRun(prisma, taskRun.id, {
          eventCount: 0,
          outcome: "skipped-no-events",
          period,
        });
        continue;
      }

      const preferences = (
        await listPreferenceMemoryForDashboard(prisma, { organizationId, userId })
      )
        .filter((preference) => preference.topicId === topic.id)
        .map((preference) => ({
          explanation: preference.explanation,
          key: preference.key,
          weight: preference.weight,
        }));

      const context = buildTopicProfileContext(topic.profile, {
        description: topic.description,
        name: topic.name,
      });

      const markdown = renderPeriodBriefingMarkdown({
        digestStyle: context.digestStyle ?? DEFAULT_DIGEST_STYLE,
        events: events.map((event) => ({
          category: event.category,
          entities: event.entities,
          explanation: event.explanation,
          followUpSuggestion: event.followUpSuggestion ?? undefined,
          occurredAt: event.occurredAt,
          score: event.score,
          secondarySources: event.secondarySources,
          sourceName: event.sourceName,
          sourceUrl: event.sourceUrl,
          summary: event.summary,
          title: event.title,
          url: event.url,
        })),
        generatedAt,
        period,
        preferences,
        rangeEnd,
        rangeStart,
        topicName: topic.name,
      });
      const titleSuffix = period === "WEEKLY" ? "周报" : "月报";
      const briefing = await createPeriodBriefing(prisma, {
        content: markdown,
        eventIds: events.map((event) => event.eventId),
        generatedAt,
        markdown,
        metadata: {
          contentHash: createContentHash(markdown),
          filteredStats: await buildFilteredStatsMetadata(prisma, {
            organizationId,
            rangeEnd,
            rangeStart,
            topicId: topic.id,
          }),
          mode: "explainable-rules",
          period,
          timezone,
        },
        organizationId,
        period,
        rangeEnd,
        rangeStart,
        title: `${topic.name} ${titleSuffix}`,
        topicId: topic.id,
      });
      await completeTaskRun(prisma, taskRun.id, {
        briefingId: briefing.id,
        eventCount: events.length,
        outcome: "upserted",
        period,
      });
      generatedBriefings += 1;
    } catch (error) {
      await failTaskRun(prisma, taskRun.id, error);
      throw error;
    }
  }

  return generatedBriefings;
}

/**
 * 为 Briefing.metadata 构建 filteredStats 字段。
 * 从 DB 查询该业务窗口内 FILTERED item 的按原因统计，
 * 直接写入 metadata 供 UI 和简报渲染使用。
 */
async function buildFilteredStatsMetadata(
  prisma: ReturnType<typeof getPrismaClient>,
  input: {
    organizationId: string;
    rangeEnd: Date;
    rangeStart: Date;
    topicId: string;
  },
): Promise<{ byReason: Record<string, number>; count: number }> {
  const result = await countFilteredItemsInRange(prisma, {
    organizationId: input.organizationId,
    rangeEnd: input.rangeEnd,
    rangeStart: input.rangeStart,
    topicId: input.topicId,
  });
  return {
    byReason: result.byReason,
    count: result.count,
  };
}
