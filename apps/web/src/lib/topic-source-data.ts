import { buildEventDisplayFields } from "@/lib/event-display";
import type { DashboardEventRecord } from "@wangchao/db";

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
  period: "DAILY" | "WEEKLY" | "MONTHLY";
  rangeEnd: string;
  rangeStart: string;
  title: string;
  topicName: string;
}

export interface BriefingsPage {
  briefings: BriefingSummary[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}

export interface SavedEventsPage {
  events: DashboardEventSummary[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
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

export interface WorkspaceAudit {
  memberships: MembershipSummary[];
  tenant: TenantSummary;
  usageSince: string;
  usageSummary: UsageSummary[];
}

export interface TopicSourceWorkspace {
  events: DashboardEventSummary[];
  mode: DataMode;
  message: string;
  preferences: PreferenceMemorySummary[];
  sourceGovernance: SourceGovernanceSummary[];
  tenant: TenantSummary;
  topics: TopicSummary[];
}

function emptyWorkspace(errorMessage: string): TopicSourceWorkspace {
  return {
    events: [],
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
      listTopicSourceOverview,
      listSourceGovernanceReport,
    } = await import("@wangchao/db");
    const prisma = getPrismaClient();
    const workspace = await ensureDefaultWorkspace(prisma);
    const [topics, events, preferences, sourceGovernance] = await Promise.all([
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
      listSourceGovernanceReport(prisma, {
        organizationId: workspace.organizationId,
      }),
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
      events: weightedEvents.map(({ event, preferenceScore }) =>
        toDashboardEventSummary(event, preferenceScore),
      ),
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
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "工作区暂时无法读取，请稍后重试。";

    return emptyWorkspace(message);
  }
}

export async function getWorkspaceAudit(): Promise<WorkspaceAudit> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  const {
    assertMembershipRole,
    ensureDefaultWorkspace,
    getPrismaClient,
    listOrganizationMemberships,
    listUsageSummary,
  } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  await assertMembershipRole(
    prisma,
    {
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    },
    ["OWNER", "ADMIN"],
  );
  const usageSince = new Date();
  usageSince.setUTCDate(usageSince.getUTCDate() - 30);
  const [memberships, usageSummary] = await Promise.all([
    listOrganizationMemberships(prisma, {
      organizationId: workspace.organizationId,
    }),
    listUsageSummary(
      prisma,
      { organizationId: workspace.organizationId },
      usageSince,
    ),
  ]);

  return {
    memberships,
    tenant: {
      organizationName: workspace.organizationName,
      organizationSlug: workspace.organizationSlug,
      role: workspace.role,
      userEmail: workspace.userEmail,
    },
    usageSince: usageSince.toISOString(),
    usageSummary,
  };
}

export async function getBriefingsPage(
  requestedPage: number,
  pageSize = 20,
  periodFilter?: "DAILY" | "WEEKLY" | "MONTHLY",
): Promise<BriefingsPage> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  const { ensureDefaultWorkspace, getPrismaClient, listBriefingsPage } =
    await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  const result = await listBriefingsPage(
    prisma,
    { organizationId: workspace.organizationId, period: periodFilter },
    requestedPage,
    pageSize,
  );

  return {
    briefings: result.briefings.map((briefing) => ({
      briefingId: briefing.briefingId,
      generatedAt: briefing.generatedAt.toISOString(),
      period: briefing.period,
      rangeEnd: briefing.rangeEnd.toISOString(),
      rangeStart: briefing.rangeStart.toISOString(),
      title: briefing.title,
      topicName: briefing.topicName,
    })),
    page: result.page,
    pageCount: result.pageCount,
    pageSize: result.pageSize,
    total: result.total,
  };
}

export async function getSavedEventsPage(
  requestedPage: number,
  pageSize = 30,
): Promise<SavedEventsPage> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  const {
    ensureDefaultWorkspace,
    getPrismaClient,
    listSavedDashboardEvents,
  } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  const result = await listSavedDashboardEvents(
    prisma,
    {
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    },
    requestedPage,
    pageSize,
  );

  return {
    events: result.events.map((event) => toDashboardEventSummary(event)),
    page: result.page,
    pageCount: result.pageCount,
    pageSize: result.pageSize,
    total: result.total,
  };
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

    return toDashboardEventSummary(event);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "情报详情暂时无法读取，请稍后重试。";

    throw new Error(message);
  }
}

function toDashboardEventSummary(
  event: DashboardEventRecord,
  gravityScore = event.gravityScore,
): DashboardEventSummary {
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
    gravityScore,
    mergeReason: event.mergeReason ?? null,
    mergedSourceCount: event.mergedSourceCount,
    occurredAt: event.occurredAt?.toISOString() ?? event.updatedAt.toISOString(),
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
}

export interface TimelineEventSummary {
  category: string | null;
  entities: string[];
  eventId: string;
  explanation: string | null;
  followUpSuggestion: string | null;
  mergeReason: string | null;
  occurredAt: string | null;
  score: number;
  secondarySources: Array<{ sourceName: string; url: string | null }>;
  sourceName: string | null;
  sourceUrl: string | null;
  summary: string;
  title: string;
  url: string | null;
}

export interface TimelinePage {
  events: TimelineEventSummary[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}

export async function getTopicTimeline(
  topicId: string,
  requestedPage: number,
  requestedPageSize = 50,
): Promise<TimelinePage> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  const { ensureDefaultWorkspace, getPrismaClient, listTimelineEvents } =
    await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  const result = await listTimelineEvents(
    prisma,
    { organizationId: workspace.organizationId, topicId },
    requestedPage,
    requestedPageSize,
  );

  return {
    events: result.events.map((event) => ({
      category: event.category,
      entities: event.entities,
      eventId: event.eventId,
      explanation: event.explanation,
      followUpSuggestion: event.followUpSuggestion,
      mergeReason: event.mergeReason,
      occurredAt: event.occurredAt?.toISOString() ?? null,
      score: event.score,
      secondarySources: event.secondarySources,
      sourceName: event.sourceName,
      sourceUrl: event.sourceUrl,
      summary: event.summary,
      title: event.title,
      url: event.url,
    })),
    page: result.page,
    pageCount: result.pageCount,
    pageSize: result.pageSize,
    total: result.total,
  };
}
