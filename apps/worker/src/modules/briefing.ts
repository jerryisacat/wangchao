import {
  buildTopicProfileContext,
  createContentHash,
  createUtcDayRange,
  createUtcMonthRange,
  createUtcWeekRange,
  DEFAULT_DIGEST_STYLE,
  renderDailyBriefingMarkdown,
  renderPeriodBriefingMarkdown,
} from "@wangchao/core";
import {
  createTaskRun,
  completeTaskRun,
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
    const { rangeEnd, rangeStart } = createUtcDayRange(generatedAt);
    const taskRun = await createTaskRun(prisma, {
      input: {
        period: "DAILY",
        rangeEnd: rangeEnd.toISOString(),
        rangeStart: rangeStart.toISOString(),
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
          explanation: event.explanation,
          occurredAt: event.occurredAt,
          score: event.score,
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
          mode: "explainable-rules",
        },
        organizationId,
        rangeEnd,
        rangeStart,
        title: `${topic.name} Daily Briefing`,
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
    const { rangeEnd, rangeStart } =
      period === "WEEKLY"
        ? createUtcWeekRange(generatedAt)
        : createUtcMonthRange(generatedAt);

    const taskRun = await createTaskRun(prisma, {
      input: {
        period,
        rangeEnd: rangeEnd.toISOString(),
        rangeStart: rangeStart.toISOString(),
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
          explanation: event.explanation,
          occurredAt: event.occurredAt,
          score: event.score,
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
      const titleSuffix = period === "WEEKLY" ? "Weekly Briefing" : "Monthly Briefing";
      const briefing = await createPeriodBriefing(prisma, {
        content: markdown,
        eventIds: events.map((event) => event.eventId),
        generatedAt,
        markdown,
        metadata: {
          contentHash: createContentHash(markdown),
          mode: "explainable-rules",
          period,
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
