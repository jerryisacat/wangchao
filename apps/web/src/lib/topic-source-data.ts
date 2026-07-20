import { buildEventDisplayFields } from "@/lib/event-display";
import { getSummaryDisplay, type EventSummaryStatus } from "@/lib/summary-status";
import type { DashboardEventRecord } from "@wangchao/db";

export type DataMode = "database" | "error";

function clampPage(requestedPage: number): number {
  return Math.max(1, Math.min(10_000, Math.floor(requestedPage)));
}

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
  summaryAvailable: boolean;
  summaryStatus: EventSummaryStatus;
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
    | "INSTANT_PUSH"
    | "WEB_ACTION";
  unit: string;
}

export interface WorkspaceAudit {
  memberships: MembershipSummary[];
  tenant: TenantSummary;
  usageSince: string;
  usageSummary: UsageSummary[];
}

export interface ExpiredCandidateSummary {
  candidateUrl: string;
  lastError: string | null;
  name: string;
  recommendationReason: string | null;
  sourceId: string;
  status: string;
  topicId: string;
  topicName: string;
  url: string;
  observeExpiresAt: string | null;
}

export interface TopicSourceWorkspace {
  events: DashboardEventSummary[];
  expiredCandidates: ExpiredCandidateSummary[];
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
    expiredCandidates: [],
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
    const { getSessionWorkspace } = await import("@/lib/session");
    const {
      getPrismaClient,
      listDashboardEvents,
      listExpiredCandidateSources,
      listPreferenceMemoryForDashboard,
      listTopicSourceOverview,
      listSourceGovernanceReport,
    } = await import("@wangchao/db");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();
    const [topics, events, preferences, sourceGovernance, expiredCandidates] =
      await Promise.all([
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
        listExpiredCandidateSources(prisma, {
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
      expiredCandidates: expiredCandidates.map((candidate) => ({
        candidateUrl: candidate.candidateUrl,
        lastError: candidate.lastError,
        name: candidate.name,
        recommendationReason: candidate.recommendationReason,
        sourceId: candidate.sourceId,
        status: candidate.status,
        topicId: candidate.topicId,
        topicName: candidate.topicName,
        url: candidate.url,
        observeExpiresAt: candidate.observeExpiresAt?.toISOString() ?? null,
      })),
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

  const { getSessionWorkspace } = await import("@/lib/session");
  const {
    assertMembershipRole,
    getPrismaClient,
    listOrganizationMemberships,
    listUsageSummary,
  } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();
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

  const { getSessionWorkspace } = await import("@/lib/session");
  const { getPrismaClient, listBriefingsPage } =
    await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();
  const page = clampPage(requestedPage);
  const result = await listBriefingsPage(
    prisma,
    { organizationId: workspace.organizationId, period: periodFilter },
    page,
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

// Issue #182 (Plan Task 4.6) - 浏览器简报详情。
// web 层封装：session workspace fence + DB getBriefingDetail 调用。
// 跨租户由 DB 层 organizationId fence 保证（返回 null）。
export interface BriefingDetailEventSummary {
  eventId: string;
  title: string;
  occurredAt: string | null;
  topicId: string;
}

export interface BriefingDetailSummary {
  body: string;
  briefingId: string;
  content: string;
  events: BriefingDetailEventSummary[];
  generatedAt: string;
  markdown: string | null;
  period: "DAILY" | "WEEKLY" | "MONTHLY";
  rangeEnd: string;
  rangeStart: string;
  title: string;
  topicId: string;
  topicName: string;
}

export async function getBriefingDetail(
  briefingId: string,
): Promise<BriefingDetailSummary | null> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  const { getSessionWorkspace } = await import("@/lib/session");
  const db = await import("@wangchao/db");
  const prisma = db.getPrismaClient();
  const workspace = await getSessionWorkspace();

  const detail = await db.getBriefingDetail(prisma, {
    briefingId,
    organizationId: workspace.organizationId,
  });

  if (!detail) {
    return null;
  }

  return {
    body: detail.body,
    briefingId: detail.briefingId,
    content: detail.content,
    events: detail.events.map((event) => ({
      eventId: event.eventId,
      title: event.title,
      occurredAt: event.occurredAt?.toISOString() ?? null,
      topicId: event.topicId,
    })),
    generatedAt: detail.generatedAt.toISOString(),
    markdown: detail.markdown,
    period: detail.period,
    rangeEnd: detail.rangeEnd.toISOString(),
    rangeStart: detail.rangeStart.toISOString(),
    title: detail.title,
    topicId: detail.topicId,
    topicName: detail.topicName,
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

  const { getSessionWorkspace } = await import("@/lib/session");
  const {
    getPrismaClient,
    listSavedDashboardEvents,
  } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();
  const page = clampPage(requestedPage);
  const result = await listSavedDashboardEvents(
    prisma,
    {
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    },
    page,
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

// SPEC §5.5 / Plan Task 3.3 (#174): 个人阅读历史与归档视图。
// status 筛选 READ/DISMISSED/SAVED/ARCHIVED 四种个人阅读状态，与收藏视图（saved=true）互补。
// 归档视图可恢复（restore action），恢复不影响其他用户。
export type HistoryStatus = "READ" | "DISMISSED" | "SAVED" | "ARCHIVED";

export interface HistoryEventsPage {
  events: DashboardEventSummary[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}

const HISTORY_STATUSES: readonly HistoryStatus[] = [
  "READ",
  "DISMISSED",
  "SAVED",
  "ARCHIVED",
] as const;

function parseHistoryStatus(value: string | string[] | undefined): HistoryStatus {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "string" && (HISTORY_STATUSES as readonly string[]).includes(raw)) {
    return raw as HistoryStatus;
  }
  return "READ";
}

export async function getHistoryEventsPage(
  status: HistoryStatus,
  requestedPage: number,
  pageSize = 30,
): Promise<HistoryEventsPage> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  const { getSessionWorkspace } = await import("@/lib/session");
  const {
    getPrismaClient,
    listUserHistoryEvents,
  } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();
  const page = clampPage(requestedPage);
  const result = await listUserHistoryEvents(
    prisma,
    {
      organizationId: workspace.organizationId,
      status,
      userId: workspace.userId,
    },
    page,
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

export { parseHistoryStatus };

export async function getDashboardEventDetail(
  eventId: string,
): Promise<DashboardEventSummary | null> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  try {
    const { getSessionWorkspace } = await import("@/lib/session");
    const {
      getDashboardEventById,
      getPrismaClient,
    } = await import("@wangchao/db");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();
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
  const summaryDisplay = getSummaryDisplay(event.summaryStatus, display.summary);

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
    summary: summaryDisplay.text,
    summaryAvailable: summaryDisplay.available,
    summaryStatus: event.summaryStatus,
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

  const { getSessionWorkspace } = await import("@/lib/session");
  const { getPrismaClient, listTimelineEvents } =
    await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();
  const page = clampPage(requestedPage);
  const result = await listTimelineEvents(
    prisma,
    { organizationId: workspace.organizationId, topicId },
    page,
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

// Issue #185 (Plan Task 4.7) — 每主题一体化 Dashboard。
// SPEC §5.8 Dashboard：每主题一个页面，整合未读 Top、已读/收藏、趋势、信源健康、最近简报。
// 服务端聚合，web 层只做 session workspace fence + DTO 序列化。

export interface TopicDashboardData {
  topic: {
    id: string;
    name: string;
    description: string | null;
    status: "ACTIVE" | "PAUSED" | "ARCHIVED";
    createdAt: string;
    updatedAt: string;
    sourceCount: number;
    eventCount: number;
    briefingCount: number;
  };
  unreadTop: DashboardEventSummary[];
  savedEvents: DashboardEventSummary[];
  savedTotal: number;
  readTotal: number;
  recentBriefings: Array<{
    briefingId: string;
    generatedAt: string;
    period: "DAILY" | "WEEKLY" | "MONTHLY";
    title: string;
    rangeStart: string;
    rangeEnd: string;
  }>;
  sourceHealth: Array<{
    sourceId: string;
    name: string;
    status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED";
    qualityScore: number;
    hitRate: number;
    noiseRate: number;
    duplicateRate: number;
    totalItems: number;
    eventCount: number;
    lastFetchedAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
  }>;
  trends: {
    "7": TopicTrendData;
    "30": TopicTrendData;
  };
}

export interface TopicTrendData {
  rangeDays: 7 | 30;
  rangeStart: string;
  rangeEnd: string;
  totalEvents: number;
  dailyBuckets: Array<{ date: string; count: number }>;
  categoryBuckets: Array<{ category: string; count: number }>;
  entityBuckets: Array<{ entity: string; count: number }>;
  sourceQuality: Array<{
    sourceId: string;
    sourceName: string;
    qualityScore: number;
    hitRate: number;
    noiseRate: number;
    eventCount: number;
  }>;
}

export async function getTopicDashboardData(
  topicId: string,
): Promise<TopicDashboardData | null> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set DATABASE_URL to connect to Postgres.",
    );
  }

  const { getSessionWorkspace } = await import("@/lib/session");
  const { getPrismaClient, getTopicDashboard } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();

  const dashboard = await getTopicDashboard(prisma, {
    organizationId: workspace.organizationId,
    topicId,
    userId: workspace.userId,
  });

  if (!dashboard) {
    return null;
  }

  return {
    topic: dashboard.topic,
    unreadTop: dashboard.unreadTop.map((event) => toDashboardEventSummary(event)),
    savedEvents: dashboard.savedEvents.map((event) => toDashboardEventSummary(event)),
    savedTotal: dashboard.savedTotal,
    readTotal: dashboard.readTotal,
    recentBriefings: dashboard.recentBriefings,
    sourceHealth: dashboard.sourceHealth,
    trends: {
      "7": dashboard.trends["7"],
      "30": dashboard.trends["30"],
    },
  };
}
