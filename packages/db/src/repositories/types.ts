import type { Prisma } from "@prisma/client";

export interface TenantScope {
  organizationId: string;
}

export interface TopicScope extends TenantScope {
  topicId: string;
}

export interface WorkspaceSeed {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  userEmail: string;
  userId: string;
}

export interface OrganizationMembershipRecord {
  email: string;
  name: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  userId: string;
}

export interface CreateTopicInput {
  name: string;
  description?: string;
  profile?: Record<string, unknown>;
}

export interface AttachRssSourceInput extends TopicScope {
  name: string;
  url: string;
  description?: string;
}

export interface CreateCandidateRssSourceInput extends TopicScope {
  description?: string;
  discoveryChannel?: string;
  evidence?: Record<string, unknown>;
  name: string;
  recommendationReason?: string;
  relevanceScore?: number;
  url: string;
}

export interface CreateTopicWithRssSourceInput extends TenantScope {
  ownerUserId?: string;
  topic: CreateTopicInput;
  source: Omit<AttachRssSourceInput, "organizationId" | "topicId">;
}

/**
 * Shape returned by fetch-scheduling queries (listActiveSourcesForFetch and
 * listCandidateRssSourcesForObservation). `kind` drives adapter dispatch in the
 * worker (RSS vs WEB). The field is optional only for legacy callers that
 * never read it; new code must populate it from the `Source.kind` column.
 */
export interface FetchedSourceRecord {
  id: string;
  organizationId: string;
  topicId: string;
  name: string;
  url: string;
  kind?: "RSS" | "WEB";
}

export interface NormalizedFetchedItemInput extends TopicScope {
  sourceId: string;
  title: string;
  url: string;
  canonicalUrl: string;
  summary?: string;
  author?: string;
  publishedAt?: Date;
  contentHash?: string;
  rawContent?: string;
  contentStatus?: "PENDING" | "READY" | "INSUFFICIENT" | "FETCH_FAILED" | "UNSUPPORTED";
  contentSource?: "RSS_EMBEDDED" | "ARTICLE_HTML" | "LEGACY_TEXT";
  contentFetchedAt?: Date;
  contentErrorCode?: string;
  rawMetadata?: Record<string, unknown>;
}

export interface PendingAnalysisItem {
  fetchedAt: Date;
  id: string;
  organizationId: string;
  publishedAt: Date | null;
  rawContent: string | null;
  contentStatus: "PENDING" | "READY" | "INSUFFICIENT" | "FETCH_FAILED" | "UNSUPPORTED";
  contentErrorCode: string | null;
  sourceId: string;
  sourceName: string;
  summary: string | null;
  title: string;
  topicId: string;
  topicDescription: string | null;
  topicName: string;
  topicProfile: unknown;
  url: string;
}

export interface IntelligenceEventWriteInput extends TopicScope {
  category?: string;
  entities?: string[];
  eventHash: string;
  explanation?: string;
  followUpSuggestion?: string;
  gravityScore: number;
  mergeReason?: string;
  occurredAt?: Date;
  primaryItemId: string;
  rawAiResponse?: Record<string, unknown>;
  score: number;
  summary: string;
  summaryStatus?: "PENDING" | "READY" | "CONTENT_FETCH_FAILED" | "CONTENT_INSUFFICIENT" | "CONTENT_UNSUPPORTED" | "AI_FAILED";
  itemStatus?: "FETCHED" | "ANALYZED";
  title: string;
  titleHash: string;
}

export interface DashboardEventRecord {
  category: string | null;
  entities: string[];
  eventId: string;
  explanation: string | null;
  followUpSuggestion: string | null;
  gravityScore: number;
  mergeReason: string | null;
  mergedSourceCount: number;
  occurredAt: Date | null;
  primaryItemUrl: string | null;
  score: number;
  sourceId: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  status: "UNREAD" | "READ" | "SAVED" | "DISMISSED" | "ARCHIVED";
  summary: string;
  summaryStatus: "PENDING" | "READY" | "CONTENT_FETCH_FAILED" | "CONTENT_INSUFFICIENT" | "CONTENT_UNSUPPORTED" | "AI_FAILED";
  title: string;
  topicId: string;
  topicName: string;
  updatedAt: Date;
  userSaved: boolean;
  userStatus: "UNREAD" | "READ" | "SAVED" | "DISMISSED" | "ARCHIVED" | null;
}

export interface DashboardEventPage {
  events: DashboardEventRecord[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}

export interface FeedbackSignalRecord {
  category: string | null;
  createdAt: Date;
  eventId: string | null;
  feedbackEventId: string;
  kind:
    | "READ"
    | "SAVE"
    | "DISMISS"
    | "EXPORT"
    | "CATEGORY_UP"
    | "CATEGORY_DOWN"
    | "MORE_LIKE_THIS"
    | "LESS_LIKE_THIS"
    | "SOURCE_QUALITY_UP"
    | "SOURCE_QUALITY_DOWN"
    | "SCORE_UP"
    | "SCORE_DOWN";
  sourceId: string | null;
  sourceName: string | null;
  topicId: string;
  value: number | null;
}

export interface PreferenceMemoryRecord {
  confidence: number;
  explanation: string;
  key: string;
  topicId: string;
  topicName: string;
  updatedAt: Date;
  weight: number;
}

export interface BriefingEventRecord {
  category: string | null;
  entities: string[];
  eventId: string;
  explanation: string | null;
  followUpSuggestion: string | null;
  mergeReason: string | null;
  occurredAt: Date | null;
  score: number;
  sourceName: string | null;
  sourceUrl: string | null;
  summary: string;
  summaryStatus: "PENDING" | "READY" | "CONTENT_FETCH_FAILED" | "CONTENT_INSUFFICIENT" | "CONTENT_UNSUPPORTED" | "AI_FAILED";
  title: string;
  topicId: string;
  topicName: string;
  url: string | null;
  secondarySources: Array<{
    sourceName: string;
    url: string | null;
  }>;
}

export interface TimelineEventRecord extends BriefingEventRecord {}

export interface DashboardBriefingRecord {
  briefingId: string;
  generatedAt: Date;
  markdown: string | null;
  period: "DAILY" | "WEEKLY" | "MONTHLY";
  rangeEnd: Date;
  rangeStart: Date;
  title: string;
  topicName: string;
}

export interface DashboardBriefingPage {
  briefings: DashboardBriefingRecord[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}

export interface SourceGovernanceRecord {
  discoveryChannel: string | null;
  duplicateRate: number;
  eventCount: number;
  filteredItems: number;
  hitRate: number;
  lastFetchedAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  consecutiveFailures: number;
  mutedReason: string | null;
  noiseRate: number;
  // qualityScore = 展示给用户的当前质量分，优先取 Source 持久化值。
  // 若持久化值为 0（从未跑过 observation），回退到本轮派生值，保证 UI 不空白。
  qualityScore: number;
  // 本轮从 hit/noise/duplicate/trust 重算的派生值，用于和持久化值做漂移诊断。
  derivedQualityScore: number;
  // persistedQualityScore = Source.qualityScore 原值（未做回退）。
  persistedQualityScore: number;
  // stale = 持久化 qualityScore 仍是 schema 默认 0，需要触发 observation 持久化。
  stale: boolean;
  recommendation: "APPROVE" | "OBSERVE" | "MUTE" | "REJECT";
  recommendationReason: string | null;
  sourceId: string;
  status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED";
  topicId: string;
  topicName: string;
  totalItems: number;
  trustScore: number;
  url: string;
  name: string;
}

export interface SourceDiscoveryTopicRecord {
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  profile: unknown;
}

export interface SourceDiscoveryPageRecord {
  sourceId?: string;
  topicId: string;
  url: string;
}

export type SourceGovernanceAction = "approve" | "mute" | "reject" | "observe";

export type DashboardEventAction = "read" | "save" | "unsave" | "dismiss" | "archive" | "restore";

export interface UpdateDashboardEventStateInput {
  action: DashboardEventAction;
  eventId: string;
  organizationId: string;
  userId: string;
}

// SPEC §5.5 / Plan Task 3.3 (#174): 个人阅读历史与归档视图。
// status 筛选作用于当前用户 UserItemState.status（个人阅读状态），
// 与 IntelligenceEvent.status（组织级事件生命周期）明确区分。
// 组织级 ARCHIVED 事件不进入个人历史视图（count/where 双重 fence）。
export type UserHistoryStatus = "READ" | "DISMISSED" | "SAVED" | "ARCHIVED";

export interface UserHistoryScope extends TenantScope {
  status: UserHistoryStatus;
  userId: string;
}

export interface UserHistoryPage {
  events: DashboardEventRecord[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}

// SPEC §5.5 / Plan Task 3.2 (#173): 按 briefing snapshot 批量标记当前用户已读。
// briefing snapshot = Briefing.events 关系表当时固定的 event IDs 集合。
// 复用 #172 UserItemState 隔离：只写 UserItemState + FeedbackEvent(READ)，
// 不写 IntelligenceEvent.status；保留 saved（双轨，对齐 updateDashboardEventState）。
export interface MarkBriefingEventsReadInput {
  briefingId: string;
  organizationId: string;
  userId: string;
}

export interface MarkBriefingEventsReadResult {
  changed: number;
  skipped: number;
}

export interface RecordCategoryPreferenceFeedbackInput extends TenantScope {
  action: "up" | "down";
  eventId: string;
  userId: string;
}

export interface UpsertPreferenceMemoryInput extends TopicScope {
  confidence: number;
  explanation: string;
  key: string;
  userId: string;
  value: Record<string, unknown>;
}

export interface CreateDailyBriefingInput extends TopicScope {
  content: string;
  eventIds: string[];
  generatedAt: Date;
  markdown: string;
  metadata?: Record<string, unknown>;
  rangeEnd: Date;
  rangeStart: Date;
  title: string;
}

export interface CreatePeriodBriefingInput extends CreateDailyBriefingInput {
  period: BriefingPeriod;
}

export type BriefingPeriod = "DAILY" | "WEEKLY" | "MONTHLY";

export interface RecordMarkdownExportInput extends TenantScope {
  briefingId?: string;
  contentHash: string;
  eventId?: string;
  fileName: string;
  metadata?: Record<string, unknown>;
  topicId: string;
  userId?: string;
}

export interface UpdateSourceGovernanceStatusInput extends TenantScope {
  action: SourceGovernanceAction;
  reason?: string;
  sourceId: string;
  userId?: string;
}

export interface RecordSourceQualityObservationInput extends TopicScope {
  duplicateRate: number;
  evidence?: Record<string, unknown>;
  hitRate: number;
  noiseRate: number;
  sourceId: string;
  // SPEC §5.2/§6.2：trustScore 持久化在 Source 上，是 discovery/relevance 产物，
  // observation 不修改它，但持久化 qualityScore 时需要它作为公式输入（参见
  // calculateSourceQualityScore）。调用方从 Source.trustScore 读取传入。
  trustScore: number;
}

/**
 * 统一读取接口的返回形状（SPEC §5.2/§6.2）。
 * 给事件评分、候选晋升、信源调度提供单一入口，避免每个调用方各自重算。
 */
export interface SourceQualitySummary {
  sourceId: string;
  qualityScore: number;
  trustScore: number;
  status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED";
  latestHitRate: number | null;
  latestNoiseRate: number | null;
  latestDuplicateRate: number | null;
  latestObservedAt: Date | null;
  // stale = Source.qualityScore 还是 schema 默认 0 但有 observation 历史，
  // 说明持久化还没跑过；调用方可决定是否触发 recordSourceQualityObservation。
  stale: boolean;
}

export interface RecordUsageEventInput extends TenantScope {
  metadata?: Record<string, unknown>;
  quantity?: number;
  subjectId?: string;
  subjectType?: string;
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
  userId?: string;
}

export interface UsageSummaryRecord {
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

export interface CreateSourceFetchTaskRunOptions {
  attempt: number;
  maxAttempts: number;
}

export type AuditedTaskRunType = Prisma.TaskRunCreateInput["type"];

export interface CreateTaskRunInput extends TenantScope {
  attempt?: number;
  eventId?: string;
  input?: Record<string, unknown>;
  itemId?: string;
  maxAttempts?: number;
  sourceId?: string;
  topicId?: string;
  type: AuditedTaskRunType;
}

export interface BatchSourceGovernanceInput extends TenantScope {
  action: SourceGovernanceAction;
  reason?: string;
  sourceIds: string[];
  userId?: string;
}

export interface BatchSourceGovernanceResult {
  errors: Array<{ error: string; sourceId: string }>;
  updated: number;
}

export interface ExpiredCandidateSourceRecord {
  candidateUrl: string;
  lastError: string | null;
  name: string;
  recommendationReason: string | null;
  sourceId: string;
  status: string;
  topicId: string;
  topicName: string;
  url: string;
  observeExpiresAt: Date | null;
}

export interface UpdateTopicInput {
  description?: string;
  name?: string;
  profile?: Record<string, unknown>;
}

export interface TopicDetailRecord {
  createdAt: Date;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  ownerUserId: string | null;
  profile: unknown;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  updatedAt: Date;
  eventCount: number;
  sourceCount: number;
  briefingCount: number;
}

export interface TopicListItem {
  createdAt: Date;
  description: string | null;
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  updatedAt: Date;
  eventCount: number;
  sourceCount: number;
}

export interface SubscriptionCredentialView {
  ai: {
    hasKey: boolean;
    keyHint: string | null;
    baseUrl: string | null;
    provider: string | null;
    model: string | null;
  };
  search: {
    hasKey: boolean;
    keyHint: string | null;
    provider: string | null;
  };
  updatedAt: Date;
}

export interface DecryptedAiCredential {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface DecryptedSearchCredential {
  apiKey: string;
  baseUrl: string | null;
  provider: string;
}

export interface DecryptedCredentials {
  ai: DecryptedAiCredential | null;
  search: DecryptedSearchCredential | null;
}

export interface CredentialTestResult {
  ok: boolean;
  message: string;
}

export interface AiCredentialTestInput {
  apiKey: string;
  baseUrl: string;
}

export interface SearchCredentialTestInput {
  apiKey: string;
  provider: string;
}

export interface AiModelListResult {
  ok: boolean;
  message: string;
  models: Array<{ id: string; ownedBy?: string }>;
}

export interface AiModelListInput {
  apiKey: string;
  baseUrl: string;
}

type DashboardEventQueryResult = Prisma.IntelligenceEventGetPayload<{
  include: {
    primaryItem: {
      select: {
        source: {
          select: {
            name: true;
            url: true;
          };
        };
        sourceId: true;
        url: true,
      };
    };
    topic: {
      select: {
        name: true,
      };
    };
    eventItems: {
      select: { itemId: true, role: true };
    };
    userStates: true;
  };
}>;

export type { DashboardEventQueryResult };
