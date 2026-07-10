import type { Prisma, PrismaClient } from "@prisma/client";
import { decryptCredential, encryptCredential, maskKeyHint } from "./crypto.js";

const DEFAULT_ORGANIZATION_SLUG = "default";
const DEFAULT_OWNER_EMAIL = "admin@wangchao.local";

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

export interface FetchedSourceRecord {
  id: string;
  organizationId: string;
  topicId: string;
  name: string;
  url: string;
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
  rawMetadata?: Record<string, unknown>;
}

export interface PendingAnalysisItem {
  fetchedAt: Date;
  id: string;
  organizationId: string;
  publishedAt: Date | null;
  sourceId: string;
  summary: string | null;
  title: string;
  topicId: string;
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
  title: string;
  topicId: string;
  topicName: string;
  updatedAt: Date;
  userSaved: boolean;
  userStatus: "UNREAD" | "READ" | "SAVED" | "DISMISSED" | "ARCHIVED" | null;
}

type DashboardEventQueryResult = Prisma.IntelligenceEventGetPayload<{
  include: {
    primaryItem: {
      select: {
        source: {
          select: {
            name: true,
            url: true,
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
      select: { itemId: true; role: true };
    };
    userStates: true;
  };
}>;

export interface FeedbackSignalRecord {
  category: string | null;
  kind: "READ" | "SAVE" | "DISMISS" | "EXPORT";
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
  title: string;
  topicId: string;
  topicName: string;
  url: string | null;
  secondarySources: Array<{
    sourceName: string;
    url: string | null;
  }>;
}

export interface DashboardBriefingRecord {
  briefingId: string;
  generatedAt: Date;
  markdown: string | null;
  title: string;
  topicName: string;
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
  qualityScore: number;
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

export type DashboardEventAction = "read" | "save" | "dismiss";

export interface UpdateDashboardEventStateInput {
  action: DashboardEventAction;
  eventId: string;
  organizationId: string;
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
  markdown: string;
  metadata?: Record<string, unknown>;
  rangeEnd: Date;
  rangeStart: Date;
  title: string;
}

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
    | "WEB_ACTION";
  unit: string;
}

export interface CreateSourceFetchTaskRunOptions {
  attempt: number;
  maxAttempts: number;
}

export async function ensureDefaultWorkspace(
  prisma: PrismaClient,
): Promise<WorkspaceSeed> {
  const organizationSlug =
    readRuntimeEnv("WANGCHAO_DEFAULT_ORGANIZATION_SLUG") ??
    DEFAULT_ORGANIZATION_SLUG;
  const organizationName =
    readRuntimeEnv("WANGCHAO_DEFAULT_ORGANIZATION_NAME") ??
    "个人工作区";
  const ownerEmail =
    readRuntimeEnv("WANGCHAO_DEFAULT_USER_EMAIL") ?? DEFAULT_OWNER_EMAIL;
  const ownerName = readRuntimeEnv("WANGCHAO_DEFAULT_USER_NAME") ?? "个人用户";
  const organization = await prisma.organization.upsert({
    where: { slug: organizationSlug },
    update: {},
    create: {
      name: organizationName,
      slug: organizationSlug,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      email: ownerEmail,
      name: ownerName,
    },
  });

  const membership = await prisma.membership.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
    update: { role: "OWNER" },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: "OWNER",
    },
  });

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    role: membership.role,
    userEmail: user.email,
    userId: user.id,
  };
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

export async function createTopic(
  prisma: PrismaClient,
  scope: TenantScope,
  input: CreateTopicInput & { ownerUserId?: string },
) {
  return prisma.topic.create({
    data: {
      organizationId: scope.organizationId,
      ownerUserId: input.ownerUserId,
      name: input.name,
      description: input.description,
      profile: toInputJson(input.profile),
      status: "ACTIVE",
    },
  });
}

export async function listOrganizationMemberships(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<OrganizationMembershipRecord[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: scope.organizationId,
    },
    include: {
      user: {
        select: {
          email: true,
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  return memberships.map((membership) => ({
    email: membership.user.email,
    name: membership.user.name,
    role: membership.role,
    userId: membership.user.id,
  }));
}

export async function assertMembershipRole(
  prisma: PrismaClient,
  scope: TenantScope & { userId: string },
  allowedRoles: Array<"OWNER" | "ADMIN" | "MEMBER">,
) {
  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: scope.organizationId,
        userId: scope.userId,
      },
    },
    select: {
      role: true,
    },
  });

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new Error("User is not authorized for this organization.");
  }

  return membership;
}

export async function attachActiveRssSource(
  prisma: PrismaClient,
  input: AttachRssSourceInput,
) {
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

export async function listActiveTopics(prisma: PrismaClient, scope: TenantScope) {
  return prisma.topic.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listTopicsForSourceDiscovery(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<SourceDiscoveryTopicRecord[]> {
  return prisma.topic.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
    select: {
      description: true,
      id: true,
      name: true,
      organizationId: true,
      profile: true,
    },
  });
}

export async function listTopicSourceOverview(
  prisma: PrismaClient,
  scope: TenantScope,
) {
  return prisma.topic.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "ACTIVE",
    },
    include: {
      sources: {
        orderBy: { updatedAt: "desc" },
      },
      _count: {
        select: {
          intelligenceEvents: true,
          sources: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listActiveSources(prisma: PrismaClient, scope: TopicScope) {
  return prisma.source.findMany({
    where: {
      organizationId: scope.organizationId,
      topicId: scope.topicId,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getTopicById(
  prisma: PrismaClient,
  scope: TenantScope & { topicId: string },
): Promise<TopicDetailRecord | null> {
  const topic = await prisma.topic.findFirst({
    where: {
      id: scope.topicId,
      organizationId: scope.organizationId,
    },
    include: {
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

  return {
    briefingCount: topic._count.briefings,
    createdAt: topic.createdAt,
    description: topic.description,
    eventCount: topic._count.intelligenceEvents,
    id: topic.id,
    name: topic.name,
    organizationId: topic.organizationId,
    ownerUserId: topic.ownerUserId,
    profile: topic.profile,
    sourceCount: topic._count.sources,
    status: topic.status,
    updatedAt: topic.updatedAt,
  };
}

export async function listAllTopics(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<TopicListItem[]> {
  const topics = await prisma.topic.findMany({
    where: {
      organizationId: scope.organizationId,
    },
    include: {
      _count: {
        select: {
          intelligenceEvents: true,
          sources: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  return topics.map((topic) => ({
    createdAt: topic.createdAt,
    description: topic.description,
    eventCount: topic._count.intelligenceEvents,
    id: topic.id,
    name: topic.name,
    sourceCount: topic._count.sources,
    status: topic.status,
    updatedAt: topic.updatedAt,
  }));
}

export async function updateTopic(
  prisma: PrismaClient,
  scope: TenantScope & { topicId: string },
  input: UpdateTopicInput,
) {
  const data: Prisma.TopicUpdateInput = {};
  if (input.name !== undefined) {
    data.name = input.name;
  }
  if (input.description !== undefined) {
    data.description = input.description;
  }
  if (input.profile !== undefined) {
    data.profile = toInputJson(input.profile);
  }

  return prisma.topic.update({
    where: { id: scope.topicId },
    data,
  });
}

export async function updateTopicStatus(
  prisma: PrismaClient,
  scope: TenantScope & { topicId: string },
  status: "ACTIVE" | "PAUSED" | "ARCHIVED",
) {
  return prisma.topic.update({
    where: {
      id: scope.topicId,
      organizationId: scope.organizationId,
    },
    data: { status },
  });
}

export async function deleteTopic(
  prisma: PrismaClient,
  scope: TenantScope & { topicId: string },
) {
  return prisma.topic.delete({
    where: {
      id: scope.topicId,
      organizationId: scope.organizationId,
    },
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
    const duplicateItems = source.items.filter(
      (item) => item.status === "DUPLICATE",
    ).length;
    const eventCount = source.items.reduce(
      (count, item) => count + item.intelligenceEvents.length,
      0,
    );
    const hitRate = ratio(eventCount, totalItems);
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
  const source = await prisma.source.findFirstOrThrow({
    where: {
      id: input.sourceId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      topicId: true,
    },
  });

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
  return prisma.taskRun.create({
    data: {
      organizationId: source.organizationId,
      topicId: source.topicId,
      sourceId: source.id,
      type: "SOURCE_FETCH",
      status: "RUNNING",
      attempt: options.attempt,
      maxAttempts: options.maxAttempts,
      scheduledAt: new Date(),
      startedAt: new Date(),
      input: {
        sourceName: source.name,
        sourceUrl: source.url,
      },
    },
  });
}

export async function createSourceDiscoveryTaskRun(
  prisma: PrismaClient,
  input: TenantScope & { input?: Record<string, unknown>; userId?: string },
) {
  return prisma.taskRun.create({
    data: {
      organizationId: input.organizationId,
      type: "SOURCE_DISCOVERY",
      status: "RUNNING",
      attempt: 1,
      maxAttempts: 1,
      scheduledAt: new Date(),
      startedAt: new Date(),
      input: toInputJson({
        ...(input.input ?? {}),
        userId: input.userId,
      }),
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

export async function recordSourceFetchFailure(
  prisma: PrismaClient,
  sourceId: string,
  errorMessage: string,
) {
  return prisma.source.update({
    where: { id: sourceId },
    data: {
      lastError: errorMessage,
      lastErrorAt: new Date(),
      consecutiveFailures: { increment: 1 },
    },
  });
}

export async function recordSourceFetchSuccess(
  prisma: PrismaClient,
  sourceId: string,
) {
  return prisma.source.update({
    where: { id: sourceId },
    data: {
      lastFetchedAt: new Date(),
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
    },
  });
}

export async function upsertFetchedItems(
  prisma: PrismaClient,
  items: NormalizedFetchedItemInput[],
) {
  const results = [];

  for (const item of items) {
    results.push(
      await prisma.item.upsert({
        where: {
          topicId_canonicalUrl: {
            topicId: item.topicId,
            canonicalUrl: item.canonicalUrl,
          },
        },
        update: {
          author: item.author,
          contentHash: item.contentHash,
          fetchedAt: new Date(),
          publishedAt: item.publishedAt,
          rawMetadata: toInputJson(item.rawMetadata),
          sourceId: item.sourceId,
          summary: item.summary,
          title: item.title,
          url: item.url,
        },
        create: {
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
          rawMetadata: toInputJson(item.rawMetadata),
        },
      }),
    );
  }

  return results;
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
      topic: {
        select: {
          profile: true,
        },
      },
    },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    take: limit,
  });

  return items.map((item) => ({
    fetchedAt: item.fetchedAt,
    id: item.id,
    organizationId: item.organizationId,
    publishedAt: item.publishedAt,
    sourceId: item.sourceId,
    summary: item.summary,
    title: item.title,
    topicId: item.topicId,
    topicProfile: item.topic.profile,
    url: item.url,
  }));
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
    select: { id: true, primaryItemId: true },
  });

  if (!existing && input.titleHash) {
    const fuzzyWindowStart = new Date(input.occurredAt ?? Date.now());
    fuzzyWindowStart.setHours(fuzzyWindowStart.getHours() - 24);
    const fuzzyWindowEnd = new Date(input.occurredAt ?? Date.now());
    fuzzyWindowEnd.setHours(fuzzyWindowEnd.getHours() + 24);

    const existingByTitle = await prisma.intelligenceEvent.findFirst({
      where: {
        topicId: input.topicId,
        titleHash: input.titleHash,
        occurredAt: {
          gte: fuzzyWindowStart,
          lte: fuzzyWindowEnd,
        },
      },
      select: { id: true, primaryItemId: true },
    });

    if (existingByTitle) {
      input.mergeReason = "标题归一化匹配：来自不同 URL 的同一事件报道";
      existing = existingByTitle;
    }
  }

  const event = await prisma.$transaction(async (tx) => {
    const upserted = await tx.intelligenceEvent.upsert({
      where: {
        topicId_eventHash: {
          eventHash: input.eventHash,
          topicId: input.topicId,
        },
      },
      update: {
        category: input.category,
        entities: input.entities ?? [],
        explanation: input.explanation,
        followUpSuggestion: input.followUpSuggestion,
        gravityScore: input.gravityScore,
        mergeReason: input.mergeReason,
        occurredAt: input.occurredAt,
        primaryItemId: input.primaryItemId,
        rawAiResponse: toInputJson(input.rawAiResponse),
        score: input.score,
        summary: input.summary,
        title: input.title,
        titleHash: input.titleHash,
      },
      create: {
        organizationId: input.organizationId,
        topicId: input.topicId,
        primaryItemId: input.primaryItemId,
        secondaryItemIds: [],
        status: "UNREAD",
        title: input.title,
        summary: input.summary,
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

    if (
      existing?.primaryItemId &&
      existing.primaryItemId !== input.primaryItemId
    ) {
      const alreadyLinked = await tx.eventItem.findUnique({
        where: {
          eventId_itemId: {
            eventId: existing.id,
            itemId: existing.primaryItemId,
          },
        },
      });
      if (!alreadyLinked) {
        await tx.eventItem.create({
          data: {
            eventId: existing.id,
            itemId: existing.primaryItemId,
            role: "SECONDARY",
            mergeReason: input.mergeReason ?? "精确 hash 匹配：多来源聚合",
          },
        });
      }
    }

    await tx.item.update({
      where: { id: input.primaryItemId },
      data: { status: "ANALYZED" },
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
        in: ["READ", "SAVE", "DISMISS", "EXPORT"],
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
  scope: TenantScope & { topicId?: string },
  limit = 10,
): Promise<BriefingEventRecord[]> {
  const events = await prisma.intelligenceEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      topicId: scope.topicId,
      status: {
        in: ["UNREAD", "SAVED"],
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

  const allSecondaryIds = events.flatMap(
    (e) => (e.eventItems ?? []).filter((ei) => ei.role === "SECONDARY").map((ei) => ei.itemId),
  );
  const secondaryItems = allSecondaryIds.length > 0
    ? await prisma.item.findMany({
        where: { id: { in: allSecondaryIds } },
        select: {
          id: true,
          source: { select: { name: true, url: true } },
        },
      })
    : [];
  const secondarySourceMap = new Map(
    secondaryItems.map((item) => [
      item.id,
      { sourceName: item.source.name, url: item.source.url },
    ]),
  );

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
      title: event.title,
      topicId: event.topicId,
      topicName: event.topic.name,
      url: event.primaryItem?.url ?? null,
    };
  });
}

export async function createDailyBriefing(
  prisma: PrismaClient,
  input: CreateDailyBriefingInput,
) {
  return prisma.briefing.create({
    data: {
      organizationId: input.organizationId,
      topicId: input.topicId,
      period: "DAILY",
      title: input.title,
      content: input.content,
      markdown: input.markdown,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      metadata: toInputJson(input.metadata),
      events: {
        connect: input.eventIds.map((id) => ({ id })),
      },
    },
  });
}

export async function listLatestBriefingsForDashboard(
  prisma: PrismaClient,
  scope: TenantScope,
  limit = 5,
): Promise<DashboardBriefingRecord[]> {
  const briefings = await prisma.briefing.findMany({
    where: {
      organizationId: scope.organizationId,
    },
    include: {
      topic: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { generatedAt: "desc" },
    take: limit,
  });

  return briefings.map((briefing) => ({
    briefingId: briefing.id,
    generatedAt: briefing.generatedAt,
    markdown: briefing.markdown,
    title: briefing.title,
    topicName: briefing.topic.name,
  }));
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
    title: event.title,
    topicId: event.topicId,
    topicName: event.topic.name,
    url: event.primaryItem?.url ?? null,
  };
}

export async function recordMarkdownExport(
  prisma: PrismaClient,
  input: RecordMarkdownExportInput,
) {
  await prisma.exportEvent.create({
    data: {
      organizationId: input.organizationId,
      topicId: input.topicId,
      userId: input.userId,
      eventId: input.eventId,
      briefingId: input.briefingId,
      format: "MARKDOWN",
      fileName: input.fileName,
      contentHash: input.contentHash,
      metadata: toInputJson(input.metadata),
    },
  });

  if (input.eventId && input.userId) {
    await prisma.feedbackEvent.create({
      data: {
        organizationId: input.organizationId,
        topicId: input.topicId,
        userId: input.userId,
        eventId: input.eventId,
        kind: "EXPORT",
        value: 2,
        metadata: {
          fileName: input.fileName,
          source: "markdown-export",
        },
      },
    });
  }
}

export async function recordUsageEvent(
  prisma: PrismaClient,
  input: RecordUsageEventInput,
) {
  return prisma.usageEvent.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      type: input.type,
      quantity: input.quantity ?? 1,
      unit: input.unit,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      metadata: toInputJson(input.metadata),
    },
  });
}

export async function listUsageSummary(
  prisma: PrismaClient,
  scope: TenantScope,
  since?: Date,
): Promise<UsageSummaryRecord[]> {
  const events = await prisma.usageEvent.findMany({
    where: {
      organizationId: scope.organizationId,
      createdAt: since ? { gte: since } : undefined,
    },
    select: {
      quantity: true,
      type: true,
      unit: true,
    },
  });
  const grouped = new Map<string, UsageSummaryRecord>();

  for (const event of events) {
    const key = `${event.type}:${event.unit}`;
    const existing = grouped.get(key) ?? {
      count: 0,
      quantity: 0,
      type: event.type as UsageSummaryRecord["type"],
      unit: event.unit,
    };
    existing.count += 1;
    existing.quantity += event.quantity;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).sort((left, right) =>
    left.type.localeCompare(right.type),
  );
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
      topicId: true,
      primaryItemId: true,
    },
  });
  const now = new Date();

  await prisma.$transaction([
    prisma.intelligenceEvent.update({
      where: { id: event.id },
      data: {
        status: target.status,
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
        dismissedAt: target.status === "DISMISSED" ? now : null,
        readAt: target.status === "READ" ? now : undefined,
        saved: target.status === "SAVED",
        status: target.status,
      },
      create: {
        dismissedAt: target.status === "DISMISSED" ? now : undefined,
        eventId: event.id,
        readAt: target.status === "READ" ? now : undefined,
        saved: target.status === "SAVED",
        status: target.status,
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
      status: "UNREAD",
    },
    orderBy: [{ gravityScore: "desc" }, { createdAt: "desc" }],
  });
}

export async function listPendingTaskRuns(prisma: PrismaClient, scope: TenantScope) {
  return prisma.taskRun.findMany({
    where: {
      organizationId: scope.organizationId,
      status: "PENDING",
    },
    orderBy: { scheduledAt: "asc" },
    take: 100,
  });
}

export function canonicalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

function actionToEventState(action: DashboardEventAction): {
  feedbackKind: "READ" | "SAVE" | "DISMISS";
  status: "READ" | "SAVED" | "DISMISSED";
  value: number;
} {
  if (action === "read") {
    return { feedbackKind: "READ", status: "READ", value: 1 };
  }

  if (action === "save") {
    return { feedbackKind: "SAVE", status: "SAVED", value: 2 };
  }

  return { feedbackKind: "DISMISS", status: "DISMISSED", value: -2 };
}

function sourceActionToStatus(
  action: SourceGovernanceAction,
): "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED" {
  if (action === "approve") {
    return "ACTIVE";
  }

  if (action === "mute") {
    return "MUTED";
  }

  if (action === "reject") {
    return "REJECTED";
  }

  return "CANDIDATE";
}

function calculateSourceQualityScore(input: {
  duplicateRate: number;
  hitRate: number;
  noiseRate: number;
  trustScore: number;
}): number {
  const score =
    input.hitRate * 70 +
    input.trustScore * 10 -
    input.noiseRate * 30 -
    input.duplicateRate * 15;

  return Number(Math.max(0, Math.min(100, score)).toFixed(2));
}

function recommendSourceStatus(
  status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED",
  qualityScore: number,
  totalItems: number,
  noiseRate: number,
): "APPROVE" | "OBSERVE" | "MUTE" | "REJECT" {
  if (status === "REJECTED") {
    return "REJECT";
  }

  if (totalItems === 0) {
    return status === "CANDIDATE" ? "OBSERVE" : "APPROVE";
  }

  if (qualityScore >= 50 && noiseRate < 0.4) {
    return "APPROVE";
  }

  if (noiseRate >= 0.75) {
    return "REJECT";
  }

  if (noiseRate >= 0.55 || qualityScore < 15) {
    return "MUTE";
  }

  return "OBSERVE";
}

function ratio(value: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Number((value / total).toFixed(4));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readObservationReason(value: unknown): string | null {
  if (!isRecord(value) || typeof value.reason !== "string") {
    return null;
  }

  return value.reason;
}

function readRuntimeEnv(key: string): string | undefined {
  const runtime = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };

  return runtime.process?.env?.[key];
}

function readRequiredRuntimeEnv(key: string): string {
  const value = readRuntimeEnv(key);
  if (!value) {
    throw new Error(`${key} is required but not set.`);
  }
  return value;
}

function toInputJson(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  return value as Prisma.InputJsonValue | undefined;
}

function toRequiredInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function mergeSemanticEvents(
  prisma: PrismaClient,
  input: {
    keepEventId: string;
    mergeEventIds: string[];
    reason: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const keepEvent = await tx.intelligenceEvent.findUnique({
      where: { id: input.keepEventId },
      include: { eventItems: true },
    });

    if (!keepEvent) {
      throw new Error(`Keep event ${input.keepEventId} not found.`);
    }

    for (const mergeEventId of input.mergeEventIds) {
      const mergeEvent = await tx.intelligenceEvent.findUnique({
        where: { id: mergeEventId },
        include: { eventItems: true },
      });

      if (!mergeEvent) continue;

      for (const eventItem of mergeEvent.eventItems) {
        const alreadyLinked = keepEvent.eventItems.some(
          (ei) => ei.itemId === eventItem.itemId,
        );
        if (!alreadyLinked) {
          await tx.eventItem.create({
            data: {
              eventId: keepEvent.id,
              itemId: eventItem.itemId,
              role: "SECONDARY",
              mergeReason: input.reason,
            },
          });
        }
      }

      if (mergeEvent.primaryItemId) {
        const alreadyLinked = keepEvent.eventItems.some(
          (ei) => ei.itemId === mergeEvent.primaryItemId,
        );
        if (!alreadyLinked) {
          await tx.eventItem.create({
            data: {
              eventId: keepEvent.id,
              itemId: mergeEvent.primaryItemId,
              role: "SECONDARY",
              mergeReason: input.reason,
            },
          });
        }
      }

      await tx.intelligenceEvent.update({
        where: { id: mergeEventId },
        data: {
          status: "ARCHIVED",
          mergeReason: `语义聚类合并到 ${input.keepEventId}: ${input.reason}`,
        },
      });
    }

    return keepEvent;
  });
}

function extractPreferenceWeight(value: unknown): number {
  if (!isRecord(value) || typeof value.weight !== "number") {
    return 0;
  }

  return value.weight;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  provider: string;
}

export interface DecryptedCredentials {
  ai: DecryptedAiCredential | null;
  search: DecryptedSearchCredential | null;
}

export async function getSubscriptionCredentialView(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<SubscriptionCredentialView | null> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: {
      aiEncryptedKey: true,
      aiKeyHint: true,
      aiBaseUrl: true,
      aiProvider: true,
      aiModel: true,
      searchEncryptedKey: true,
      searchKeyHint: true,
      searchProvider: true,
      updatedAt: true,
    },
  });

  if (!subscription) {
    return null;
  }

  return {
    ai: {
      hasKey: Boolean(subscription.aiEncryptedKey),
      keyHint: subscription.aiKeyHint,
      baseUrl: subscription.aiBaseUrl,
      provider: subscription.aiProvider,
      model: subscription.aiModel,
    },
    search: {
      hasKey: Boolean(subscription.searchEncryptedKey),
      keyHint: subscription.searchKeyHint,
      provider: subscription.searchProvider,
    },
    updatedAt: subscription.updatedAt,
  };
}

export async function upsertAiCredential(
  prisma: PrismaClient,
  scope: TenantScope,
  input: {
    apiKey: string;
    baseUrl?: string;
    provider?: string;
    model?: string;
  },
): Promise<void> {
  const encryptionKey = readRequiredRuntimeEnv("ENCRYPTION_KEY");
  const encryptedKey = encryptCredential(input.apiKey, encryptionKey);
  const keyHint = maskKeyHint(input.apiKey);

  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      aiEncryptedKey: encryptedKey,
      aiKeyHint: keyHint,
      aiBaseUrl: input.baseUrl ?? null,
      aiProvider: input.provider ?? null,
      aiModel: input.model ?? null,
    },
    create: {
      organizationId: scope.organizationId,
      aiEncryptedKey: encryptedKey,
      aiKeyHint: keyHint,
      aiBaseUrl: input.baseUrl ?? null,
      aiProvider: input.provider ?? null,
      aiModel: input.model ?? null,
    },
  });
}

export async function upsertSearchCredential(
  prisma: PrismaClient,
  scope: TenantScope,
  input: {
    apiKey: string;
    provider?: string;
  },
): Promise<void> {
  const encryptionKey = readRequiredRuntimeEnv("ENCRYPTION_KEY");
  const encryptedKey = encryptCredential(input.apiKey, encryptionKey);
  const keyHint = maskKeyHint(input.apiKey);

  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      searchEncryptedKey: encryptedKey,
      searchKeyHint: keyHint,
      searchProvider: input.provider ?? null,
    },
    create: {
      organizationId: scope.organizationId,
      searchEncryptedKey: encryptedKey,
      searchKeyHint: keyHint,
      searchProvider: input.provider ?? null,
    },
  });
}

export async function deleteAiCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<void> {
  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      aiEncryptedKey: null,
      aiKeyHint: null,
      aiBaseUrl: null,
      aiProvider: null,
      aiModel: null,
    },
    create: {
      organizationId: scope.organizationId,
    },
  });
}

export async function deleteSearchCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<void> {
  await prisma.subscription.upsert({
    where: { organizationId: scope.organizationId },
    update: {
      searchEncryptedKey: null,
      searchKeyHint: null,
      searchProvider: null,
    },
    create: {
      organizationId: scope.organizationId,
    },
  });
}

export interface CredentialTestResult {
  ok: boolean;
  message: string;
}

export async function testAiCredential(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<CredentialTestResult> {
  const credentials = await getDecryptedCredentials(prisma, scope);
  const ai = credentials?.ai;
  if (!ai) {
    return { ok: false, message: "未配置 AI 凭证，请先保存再测试。" };
  }

  const baseUrl = ai.baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${ai.apiKey}` },
      method: "GET",
      signal: controller.signal,
    });

    if (response.ok) {
      return { ok: true, message: "AI 凭证连接测试成功。" };
    }
    return {
      ok: false,
      message: `连接失败：HTTP ${response.status} ${response.statusText}`.trim(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: "连接超时，请检查 Base URL 是否正确。" };
    }
    return {
      ok: false,
      message: `连接错误：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDecryptedCredentials(
  prisma: PrismaClient,
  scope: TenantScope,
): Promise<DecryptedCredentials | null> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: scope.organizationId },
    select: {
      aiEncryptedKey: true,
      aiBaseUrl: true,
      aiModel: true,
      searchEncryptedKey: true,
      searchProvider: true,
    },
  });

  if (!subscription) {
    return { ai: null, search: null };
  }

  const encryptionKey = readRuntimeEnv("ENCRYPTION_KEY");

  let ai: DecryptedAiCredential | null = null;
  if (subscription.aiEncryptedKey && subscription.aiBaseUrl && encryptionKey) {
    try {
      const apiKey = decryptCredential(subscription.aiEncryptedKey, encryptionKey);
      ai = {
        apiKey,
        baseUrl: subscription.aiBaseUrl,
        model: subscription.aiModel ?? "gpt-4o-mini",
      };
    } catch {
      // Decryption failure -> treat as no credential
    }
  }

  let search: DecryptedSearchCredential | null = null;
  if (subscription.searchEncryptedKey && encryptionKey) {
    try {
      const apiKey = decryptCredential(subscription.searchEncryptedKey, encryptionKey);
      search = {
        apiKey,
        provider: subscription.searchProvider ?? "brave",
      };
    } catch {
      // Decryption failure -> treat as no credential
    }
  }

  return { ai, search };
}
