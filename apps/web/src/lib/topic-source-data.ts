import { buildEventDisplayFields } from "@/lib/event-display";

export type DataMode = "database" | "error";

export interface SourceSummary {
  id: string;
  name: string;
  status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED";
  url: string;
}

export interface SourceGovernanceSummary {
  discoveryChannel: string;
  duplicateRate: number;
  eventCount: number;
  filteredItems: number;
  hitRate: number;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  lastFetchedAt: string;
  name: string;
  noiseRate: number;
  qualityScore: number;
  recommendation: "APPROVE" | "OBSERVE" | "MUTE" | "REJECT";
  recommendationReason: string;
  sourceId: string;
  status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED";
  topicId: string;
  topicName: string;
  totalItems: number;
  url: string;
}

export interface TopicSummary {
  id: string;
  name: string;
  description: string;
  eventCount: number;
  sourceCount: number;
  sources: SourceSummary[];
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  updatedAt: string;
}

export interface DashboardEventSummary {
  category: string;
  entities: string[];
  eventId: string;
  explanation: string;
  followUpSuggestion: string;
  gravityScore: number;
  mergeReason: string | null;
  mergedSourceCount: number;
  occurredAt: string;
  primaryItemUrl: string;
  score: number;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  status: "UNREAD" | "READ" | "SAVED" | "DISMISSED" | "ARCHIVED";
  summary: string;
  title: string;
  topicId: string;
  topicName: string;
  updatedAt: string;
  userSaved: boolean;
}

export interface PreferenceMemorySummary {
  confidence: number;
  explanation: string;
  key: string;
  topicName: string;
  updatedAt: string;
  weight: number;
}

export interface BriefingSummary {
  briefingId: string;
  generatedAt: string;
  title: string;
  topicName: string;
}

export interface TenantSummary {
  organizationName: string;
  organizationSlug: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  userEmail: string;
}

export interface MembershipSummary {
  email: string;
  name: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  userId: string;
}

export interface UsageSummary {
  count: number;
  quantity: number;
  type:
    | "AI_CALL"
    | "FETCH"
    | "EXPORT"
    | "BRIEFING"
    | "SOURCE_GOVERNANCE"
    | "SOURCE_DISCOVERY"
    | "WEB_ACTION";
  unit: string;
}

export interface TopicSourceWorkspace {
  briefings: BriefingSummary[];
  events: DashboardEventSummary[];
  memberships: MembershipSummary[];
  mode: DataMode;
  message: string;
  preferences: PreferenceMemorySummary[];
  sourceGovernance: SourceGovernanceSummary[];
  tenant: TenantSummary;
  topics: TopicSummary[];
  usageSummary: UsageSummary[];
}

function emptyWorkspace(errorMessage: string): TopicSourceWorkspace {
  return {
    briefings: [],
    events: [],
    memberships: [],
    mode: "error",
    message: errorMessage,
    preferences: [],
    sourceGovernance: [],
    tenant: {
      organizationName: "",
      organizationSlug: "",
      role: "OWNER",
      userEmail: "",
    },
    topics: [],
    usageSummary: [],
  };
}

export async function getTopicSourceWorkspace(): Promise<TopicSourceWorkspace> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  try {
    const { applyPreferenceWeights, preferenceKeysForEvent } = await import(
      "@wangchao/core"
    );
    const {
      ensureDefaultWorkspace,
      getPrismaClient,
      listDashboardEvents,
      listPreferenceMemoryForDashboard,
      listLatestBriefingsForDashboard,
      listOrganizationMemberships,
      listTopicSourceOverview,
      listSourceGovernanceReport,
      listUsageSummary,
    } = await import("@wangchao/db");
    const prisma = getPrismaClient();
    const workspace = await ensureDefaultWorkspace(prisma);
    const usageSince = new Date();
    usageSince.setDate(usageSince.getDate() - 30);
    const [
      topics,
      events,
      preferences,
      briefings,
      sourceGovernance,
      memberships,
      usageSummary,
    ] = await Promise.all([
      listTopicSourceOverview(prisma, {
        organizationId: workspace.organizationId,
      }),
      listDashboardEvents(prisma, {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      }),
      listPreferenceMemoryForDashboard(prisma, {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      }),
      listLatestBriefingsForDashboard(prisma, {
        organizationId: workspace.organizationId,
      }),
      listSourceGovernanceReport(prisma, {
        organizationId: workspace.organizationId,
      }),
      listOrganizationMemberships(prisma, {
        organizationId: workspace.organizationId,
      }),
      listUsageSummary(
        prisma,
        {
          organizationId: workspace.organizationId,
        },
        usageSince,
      ),
    ]);
    const preferenceWeights = preferences.map((preference) => ({
      key: preference.key,
      weight: preference.weight,
    }));
    const weightedEvents = events
      .map((event) => {
        const preferenceScore = applyPreferenceWeights(
          event.gravityScore,
          preferenceKeysForEvent({
            category: event.category,
            sourceId: event.sourceId,
            sourceName: event.sourceName,
          }),
          preferenceWeights,
        );

        return { event, preferenceScore };
      })
      .sort(
        (left, right) =>
          right.preferenceScore - left.preferenceScore ||
          right.event.updatedAt.getTime() - left.event.updatedAt.getTime(),
      );

    return {
      briefings: briefings.map((briefing) => ({
        briefingId: briefing.briefingId,
        generatedAt: briefing.generatedAt.toISOString(),
        title: briefing.title,
        topicName: briefing.topicName,
      })),
      events: weightedEvents.map(({ event, preferenceScore }) => {
        const display = buildEventDisplayFields({
          explanation: event.explanation,
          primaryItemUrl: event.primaryItemUrl,
          summary: event.summary,
          title: event.title,
        });

        return {
          category: event.category ?? "general",
          entities: event.entities ?? [],
          eventId: event.eventId,
          explanation: display.explanation,
          followUpSuggestion: event.followUpSuggestion ?? "",
          gravityScore: preferenceScore,
          mergeReason: event.mergeReason ?? null,
          mergedSourceCount: event.mergedSourceCount,
          occurredAt:
            event.occurredAt?.toISOString() ?? event.updatedAt.toISOString(),
          primaryItemUrl: display.primaryItemUrl,
          score: event.score,
          sourceId: event.sourceId ?? "",
          sourceName: event.sourceName ?? "Unknown source",
          sourceUrl: event.sourceUrl ?? "",
          status: event.userStatus ?? event.status,
          summary: display.summary,
          title: event.title,
          topicId: event.topicId,
          topicName: event.topicName,
          updatedAt: event.updatedAt.toISOString(),
          userSaved: event.userSaved,
        };
      }),
      memberships,
      mode: "database",
      message: "工作区已连接，情报排序会结合重要度和你的反馈偏好。",
      preferences: preferences.map((preference) => ({
        confidence: preference.confidence,
        explanation: preference.explanation,
        key: preference.key,
        topicName: preference.topicName,
        updatedAt: preference.updatedAt.toISOString(),
        weight: preference.weight,
      })),
      sourceGovernance: sourceGovernance.map((source) => ({
        duplicateRate: source.duplicateRate,
        discoveryChannel: source.discoveryChannel ?? "",
        eventCount: source.eventCount,
        filteredItems: source.filteredItems,
        hitRate: source.hitRate,
        lastError: source.lastError,
        lastErrorAt: source.lastErrorAt?.toISOString() ?? null,
        consecutiveFailures: source.consecutiveFailures,
        lastFetchedAt: source.lastFetchedAt?.toISOString() ?? "",
        name: source.name,
        noiseRate: source.noiseRate,
        qualityScore: source.qualityScore,
        recommendation: source.recommendation,
        recommendationReason: source.recommendationReason ?? "",
        sourceId: source.sourceId,
        status: source.status,
        topicId: source.topicId,
        topicName: source.topicName,
        totalItems: source.totalItems,
        url: source.url,
      })),
      tenant: {
        organizationName: workspace.organizationName,
        organizationSlug: workspace.organizationSlug,
        role: workspace.role,
        userEmail: workspace.userEmail,
      },
      topics: topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        description: topic.description ?? "",
        eventCount: topic._count.intelligenceEvents,
        sourceCount: topic._count.sources,
        status: topic.status,
        updatedAt: topic.updatedAt.toISOString(),
        sources: topic.sources.map((source) => ({
          id: source.id,
          name: source.name,
          status: source.status,
          url: source.url,
        })),
      })),
      usageSummary,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "工作区暂时无法读取，请稍后重试。";

    return emptyWorkspace(message);
  }
}

export async function getDashboardEventDetail(
  eventId: string,
): Promise<DashboardEventSummary | null> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  try {
    const {
      ensureDefaultWorkspace,
      getDashboardEventById,
      getPrismaClient,
    } = await import("@wangchao/db");
    const prisma = getPrismaClient();
    const workspace = await ensureDefaultWorkspace(prisma);
    const event = await getDashboardEventById(prisma, {
      eventId,
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    });

    if (!event) {
      return null;
    }

    const display = buildEventDisplayFields({
      explanation: event.explanation,
      primaryItemUrl: event.primaryItemUrl,
      summary: event.summary,
    });

    return {
      category: event.category ?? "general",
      entities: event.entities ?? [],
      eventId: event.eventId,
      explanation: display.explanation,
      followUpSuggestion: event.followUpSuggestion ?? "",
      gravityScore: event.gravityScore,
      mergeReason: event.mergeReason ?? null,
      mergedSourceCount: event.mergedSourceCount,
      occurredAt:
        event.occurredAt?.toISOString() ?? event.updatedAt.toISOString(),
      primaryItemUrl: display.primaryItemUrl,
      score: event.score,
      sourceId: event.sourceId ?? "",
      sourceName: event.sourceName ?? "Unknown source",
      sourceUrl: event.sourceUrl ?? "",
      status: event.userStatus ?? event.status,
      summary: display.summary,
      title: event.title,
      topicId: event.topicId,
      topicName: event.topicName,
      updatedAt: event.updatedAt.toISOString(),
      userSaved: event.userSaved,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "情报详情暂时无法读取，请稍后重试。";

    throw new Error(message);
  }
}
