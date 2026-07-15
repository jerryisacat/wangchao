"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import seedSourcePack from "../../../../packages/db/seed-sources.json";
import { defaultAiBaseUrl } from "./admin/settings/providers";

type DatabaseClient = ReturnType<
  (typeof import("@wangchao/db"))["getPrismaClient"]
>;

export async function createTopicAction(formData: FormData): Promise<void> {
  let message = "主题已创建。";
  let type: ActionRedirectType = "notice";

  try {
    const result = await createTopicWithCandidateDiscovery(formData);
    message =
      result.candidateCount > 0
        ? `主题已创建，自动匹配到 ${result.candidateCount} 个候选信源。`
        : "主题已创建，暂未发现可验证候选信源。你可以在信源管理页继续发现新源。";
  } catch (error) {
    logActionError("createTopicAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/");
  revalidatePath("/sources");
  redirect(actionRedirectHref("/sources", type, message));
}

async function createTopicWithCandidateDiscovery(formData: FormData) {
  const name = readRequiredField(formData, "topicName");
  const description = readOptionalField(formData, "topicDescription");

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to create topics.");
  }

  const {
    assertMembershipRole,
    createCandidateRssSource,
    createTopic,
    getPrismaClient,
    getSubscriptionPlanView,
    getTopicCount,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
  const { buildTopicProfile, checkTopicQuota } = await import("@wangchao/core");
  const { validateRssFeedUrl } = await import("@wangchao/sources");
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

  const subscription = await getSubscriptionPlanView(prisma, { organizationId: workspace.organizationId });
  const topicCount = await getTopicCount(prisma, { organizationId: workspace.organizationId });
  const quota = checkTopicQuota(subscription.plan, topicCount, subscription.isSelfHosted);
  if (!quota.allowed) throw new Error(quota.reason ?? "Topic limit reached.");

  const profile = buildTopicProfile({ description, name });
  const topic = await createTopic(
    prisma,
    { organizationId: workspace.organizationId },
    {
      description,
      name,
      ownerUserId: workspace.userId,
      profile: { ...profile },
    },
  );
  const candidates = matchSourcePackCandidates({
    description,
    limit: readPositiveIntegerEnv("WANGCHAO_TOPIC_CREATE_SOURCE_LIMIT", 3),
    name,
    profileKeywords: profile.keywords,
    sourcePack: seedSourcePack,
  });
  const feedTimeoutMs = readPositiveIntegerEnv(
    "WANGCHAO_TOPIC_CREATE_FEED_TIMEOUT_MS",
    2_000,
  );
  const candidateResults = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const validation = await withTimeout(
          validateRssFeedUrl(candidate.url, {
            timeoutMs: feedTimeoutMs,
          }),
          feedTimeoutMs + 500,
          "RSS validation timed out.",
        );
        const source = await createCandidateRssSource(prisma, {
          description: `来自内置信源包：${candidate.topicName}`,
          discoveryChannel: "topic-create-source-pack",
          evidence: {
            feedItemCount: validation.itemCount,
            feedTitle: validation.title,
            matchedKeywords: candidate.matchedKeywords,
            matchedTopic: candidate.topicName,
            source: "topic-create-source-pack",
            validationUrl: validation.url,
          },
          name: validation.title || candidate.name,
          organizationId: workspace.organizationId,
          recommendationReason: `内置信源包匹配「${candidate.topicName}」，RSS 验证通过，建议先作为候选源观察。`,
          relevanceScore: candidate.relevanceScore,
          topicId: topic.id,
          url: validation.url,
        });

        if (source.status === "CANDIDATE") {
          return 1;
        }
      } catch {
        return 0;
      }

      return 0;
    }),
  );
  const candidateCount = candidateResults.filter(Boolean).length;

  await recordUsageEvent(prisma, {
    metadata: {
      action: "create-topic",
      candidateCount,
      profileKeywords: profile.keywords,
      topicName: name,
    },
    organizationId: workspace.organizationId,
    quantity: 1,
    subjectId: topic.id,
    subjectType: "topic",
    type: "WEB_ACTION",
    unit: "action",
    userId: workspace.userId,
  });

  if (candidateCount > 0) {
    await recordUsageEvent(prisma, {
      metadata: {
        action: "topic-create-source-pack",
        topicName: name,
      },
      organizationId: workspace.organizationId,
      quantity: candidateCount,
      subjectId: topic.id,
      subjectType: "topic",
      type: "SOURCE_DISCOVERY",
      unit: "candidate",
      userId: workspace.userId,
    });
  }

  return { candidateCount, topicId: topic.id };
}

export async function createTopicWithSourceAction(
  formData: FormData,
): Promise<void> {
  let message = "主题已创建，已绑定 RSS 信源。";
  let type: ActionRedirectType = "notice";

  try {
    await createTopicWithSource(formData);
  } catch (error) {
    logActionError("createTopicWithSourceAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/");
  redirect(actionRedirectHref("/", type, message));
}

async function createTopicWithSource(formData: FormData) {
  const name = readRequiredField(formData, "topicName");
  const description = readOptionalField(formData, "topicDescription");
  const keywords = readOptionalField(formData, "topicKeywords");
  const sourceName = readRequiredField(formData, "sourceName");
  const sourceUrl = readRequiredUrl(formData, "sourceUrl");
  const sourceDescription = readOptionalField(formData, "sourceDescription");

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to create topics.");
  }

  const {
    assertMembershipRole,
    createTopicWithActiveRssSource,
    getActiveSourceCount,
    getPrismaClient,
    getSubscriptionPlanView,
    getTopicCount,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
  const { checkSourceQuota, checkTopicQuota } = await import("@wangchao/core");
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

  const subscription = await getSubscriptionPlanView(prisma, { organizationId: workspace.organizationId });
  const topicCount = await getTopicCount(prisma, { organizationId: workspace.organizationId });
  const topicQuota = checkTopicQuota(subscription.plan, topicCount, subscription.isSelfHosted);
  if (!topicQuota.allowed) throw new Error(topicQuota.reason ?? "Topic limit reached.");

  const sourceCount = await getActiveSourceCount(prisma, { organizationId: workspace.organizationId });
  const sourceQuota = checkSourceQuota(subscription.plan, sourceCount, subscription.isSelfHosted);
  if (!sourceQuota.allowed) throw new Error(sourceQuota.reason ?? "Source limit reached.");

  const { source, topic } = await createTopicWithActiveRssSource(prisma, {
    organizationId: workspace.organizationId,
    ownerUserId: workspace.userId,
    topic: {
      name,
      description,
      profile: {
        keywords: keywords
          .split(",")
          .map((keyword) => keyword.trim())
          .filter(Boolean),
      },
    },
    source: {
      name: sourceName,
      url: sourceUrl,
      description: sourceDescription,
    },
  });
  await recordUsageEvent(prisma, {
    metadata: {
      action: "create-topic-with-source",
      sourceName,
      topicName: name,
    },
    organizationId: workspace.organizationId,
    quantity: 1,
    subjectId: topic.id,
    subjectType: "topic",
    type: "WEB_ACTION",
    unit: "action",
    userId: workspace.userId,
  });
  await recordUsageEvent(prisma, {
    metadata: {
      action: "attach-active-rss-source",
      sourceName,
    },
    organizationId: workspace.organizationId,
    quantity: 1,
    subjectId: source.id,
    subjectType: "source",
    type: "SOURCE_GOVERNANCE",
    unit: "action",
    userId: workspace.userId,
  });
}

export async function updateDashboardEventStateAction(
  formData: FormData,
): Promise<void> {
  let message = "情报状态已更新。";
  let type: ActionRedirectType = "notice";
  const returnTo = readSafeReturnPath(formData, "returnTo") ?? "/";

  try {
    await updateDashboardEventStateFromForm(formData);
  } catch (error) {
    logActionError("updateDashboardEventStateAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/");
  revalidatePath(returnTo);
  redirect(actionRedirectHref(returnTo, type, message));
}

async function updateDashboardEventStateFromForm(formData: FormData) {
  const eventId = readRequiredField(formData, "eventId");
  const action = readDashboardEventAction(formData, "action");

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to update event state.");
  }

  const {
    assertMembershipRole,
    getPrismaClient,
    recordUsageEvent,
    updateDashboardEventState,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();

  await assertMembershipRole(
    prisma,
    {
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    },
    ["OWNER", "ADMIN", "MEMBER"],
  );
  await updateDashboardEventState(prisma, {
    action,
    eventId,
    organizationId: workspace.organizationId,
    userId: workspace.userId,
  });
  await refreshPreferenceMemory(prisma, workspace);
  await recordUsageEvent(prisma, {
    metadata: {
      action,
      source: "dashboard-event-state",
    },
    organizationId: workspace.organizationId,
    quantity: 1,
    subjectId: eventId,
    subjectType: "intelligence-event",
    type: "WEB_ACTION",
    unit: "action",
    userId: workspace.userId,
  });
}

export async function updateCategoryPreferenceAction(
  formData: FormData,
): Promise<void> {
  const returnTo = readSafeReturnPath(formData, "returnTo") ?? "/";
  let message = "类别偏好已更新。";
  let type: ActionRedirectType = "notice";

  try {
    const action = readCategoryPreferenceAction(formData, "action");
    await updateCategoryPreferenceFromForm(formData, action);
    message =
      action === "up"
        ? "已增加这类情报的偏好权重。"
        : "已降低这类情报的偏好权重。";
  } catch (error) {
    logActionError("updateCategoryPreferenceAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/");
  revalidatePath("/preferences");
  revalidatePath(returnTo);
  redirect(actionRedirectHref(returnTo, type, message));
}

async function updateCategoryPreferenceFromForm(
  formData: FormData,
  action: "up" | "down",
) {
  const eventId = readRequiredField(formData, "eventId");

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to update preferences.");
  }

  const {
    assertMembershipRole,
    getPrismaClient,
    recordCategoryPreferenceFeedback,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();

  await assertMembershipRole(
    prisma,
    {
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    },
    ["OWNER", "ADMIN", "MEMBER"],
  );
  await recordCategoryPreferenceFeedback(prisma, {
    action,
    eventId,
    organizationId: workspace.organizationId,
    userId: workspace.userId,
  });
  await refreshPreferenceMemory(prisma, workspace);
  await recordUsageEvent(prisma, {
    metadata: {
      action: `category-${action}`,
      source: "event-detail-category-preference",
    },
    organizationId: workspace.organizationId,
    quantity: 1,
    subjectId: eventId,
    subjectType: "intelligence-event",
    type: "WEB_ACTION",
    unit: "action",
    userId: workspace.userId,
  });
}

async function refreshPreferenceMemory(
  prisma: DatabaseClient,
  workspace: { organizationId: string; userId: string },
) {
  const { listRecentFeedbackSignals, upsertPreferenceMemory } = await import(
    "@wangchao/db"
  );
  const { generatePreferenceDeltas } = await import("@wangchao/core");
  const signals = await listRecentFeedbackSignals(prisma, workspace);
  const deltas = generatePreferenceDeltas(signals);

  await Promise.all(
    deltas.map((delta) =>
      upsertPreferenceMemory(prisma, {
        confidence: delta.confidence,
        explanation: delta.explanation,
        key: delta.key,
        organizationId: workspace.organizationId,
        topicId: delta.topicId,
        userId: workspace.userId,
        value: delta.value,
      }),
    ),
  );
}

export async function createCandidateSourceAction(
  formData: FormData,
): Promise<void> {
  let message = "候选信源已加入观察列表。";
  let type: ActionRedirectType = "notice";

  try {
    await createCandidateSource(formData);
  } catch (error) {
    logActionError("createCandidateSourceAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/sources");
  redirect(actionRedirectHref("/sources", type, message));
}

async function createCandidateSource(formData: FormData) {
  const topicId = readRequiredField(formData, "topicId");
  const name = readRequiredField(formData, "candidateSourceName");
  const url = readRequiredUrl(formData, "candidateSourceUrl");
  const description = readOptionalField(formData, "candidateSourceDescription");

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to create candidate sources.");
  }

  const {
    assertMembershipRole,
    createCandidateRssSource,
    getActiveSourceCount,
    getPrismaClient,
    getSubscriptionPlanView,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
  const { checkSourceQuota } = await import("@wangchao/core");
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

  const subscription = await getSubscriptionPlanView(prisma, { organizationId: workspace.organizationId });
  const sourceCount = await getActiveSourceCount(prisma, { organizationId: workspace.organizationId });
  const sourceQuota = checkSourceQuota(subscription.plan, sourceCount, subscription.isSelfHosted);
  if (!sourceQuota.allowed) throw new Error(sourceQuota.reason ?? "Source limit reached.");

  const source = await createCandidateRssSource(prisma, {
    description,
    evidence: {
      source: "dashboard-governance-form",
    },
    name,
    organizationId: workspace.organizationId,
    topicId,
    url,
  });
  await recordUsageEvent(prisma, {
    metadata: {
      action: "create-candidate-source",
      sourceName: name,
    },
    organizationId: workspace.organizationId,
    quantity: 1,
    subjectId: source.id,
    subjectType: "source",
    type: "SOURCE_GOVERNANCE",
    unit: "action",
    userId: workspace.userId,
  });
}

export async function runSourceDiscoveryAction(): Promise<void> {
  let message = "信源发现任务已提交，将在后台执行。";
  let type: ActionRedirectType = "notice";

  try {
    await runSourceDiscoveryFromDashboard();
  } catch (error) {
    logActionError("runSourceDiscoveryAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/sources");
  redirect(actionRedirectHref("/sources", type, message));
}

async function runSourceDiscoveryFromDashboard() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to run source discovery.");
  }

  const {
    assertMembershipRole,
    createTaskRun,
    getPrismaClient,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
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

  await createTaskRun(prisma, {
    organizationId: workspace.organizationId,
    type: "SOURCE_DISCOVERY",
    input: { mode: "manual", userId: workspace.userId },
  });

  return { candidateSourcesWritten: 0, existingSourcesObserved: 0, enqueued: true };
}

export async function runFetchCycleAction(): Promise<void> {
  let message = "信源发现任务已提交，将在后台执行。";
  let type: ActionRedirectType = "notice";

  try {
    await runFetchCycleFromDashboard();
    message = "手动抓取任务已提交，将在后台执行。";
  } catch (error) {
    logActionError("runFetchCycleAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/");
  redirect(actionRedirectHref("/", type, message));
}

async function runFetchCycleFromDashboard() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to run fetch cycle.");
  }

  const {
    assertMembershipRole,
    createTaskRun,
    getPrismaClient,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();

  await assertMembershipRole(
    prisma,
    {
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    },
    ["OWNER", "ADMIN", "MEMBER"],
  );

  await createTaskRun(prisma, {
    organizationId: workspace.organizationId,
    type: "SOURCE_FETCH",
    input: { mode: "manual", userId: workspace.userId },
  });
}

export async function updateSourceGovernanceAction(
  formData: FormData,
): Promise<void> {
  let message = "信源状态已更新。";
  let type: ActionRedirectType = "notice";

  try {
    await updateSourceGovernance(formData);
  } catch (error) {
    logActionError("updateSourceGovernanceAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/sources");
  redirect(actionRedirectHref("/sources", type, message));
}

async function updateSourceGovernance(formData: FormData) {
  const sourceId = readRequiredField(formData, "sourceId");
  const action = readSourceGovernanceAction(formData, "action");
  const reason = readOptionalField(formData, "reason");

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to update source governance.");
  }

  const {
    assertMembershipRole,
    getPrismaClient,
    recordUsageEvent,
    updateSourceGovernanceStatus,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
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
  await updateSourceGovernanceStatus(prisma, {
    action,
    organizationId: workspace.organizationId,
    reason,
    sourceId,
    userId: workspace.userId,
  });
  await recordUsageEvent(prisma, {
    metadata: {
      action,
      reason,
      source: "dashboard-source-governance",
    },
    organizationId: workspace.organizationId,
    quantity: 1,
    subjectId: sourceId,
    subjectType: "source",
    type: "SOURCE_GOVERNANCE",
    unit: "action",
    userId: workspace.userId,
  });
}

export async function batchUpdateSourceGovernanceAction(
  formData: FormData,
): Promise<void> {
  let message = "批量信源治理已完成。";
  let type: ActionRedirectType = "notice";

  try {
    await batchUpdateSourceGovernance(formData);
  } catch (error) {
    logActionError("batchUpdateSourceGovernanceAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/sources");
  redirect(actionRedirectHref("/sources", type, message));
}

async function batchUpdateSourceGovernance(formData: FormData) {
  const action = readSourceGovernanceAction(formData, "action");
  const reason = readOptionalField(formData, "reason");
  const sourceIdsRaw = readRequiredField(formData, "sourceIds");
  const sourceIds = sourceIdsRaw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (sourceIds.length === 0) {
    throw new Error("未选择信源。");
  }

  if (sourceIds.length > 50) {
    throw new Error("单次最多操作 50 个信源。");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required for batch source governance.");
  }

  const {
    assertMembershipRole,
    batchUpdateSourceGovernanceStatus,
    getPrismaClient,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
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

  const result = await batchUpdateSourceGovernanceStatus(prisma, {
    action,
    organizationId: workspace.organizationId,
    reason,
    sourceIds,
    userId: workspace.userId,
  });

  await recordUsageEvent(prisma, {
    metadata: {
      action,
      batch: true,
      errors: result.errors.length,
      reason,
      source: "dashboard-batch-source-governance",
      updated: result.updated,
    },
    organizationId: workspace.organizationId,
    quantity: result.updated,
    subjectType: "source",
    type: "SOURCE_GOVERNANCE",
    unit: "action",
    userId: workspace.userId,
  });
}

interface SeedSourcePack {
  topics?: Array<{
    description?: string;
    keywords?: string[];
    name: string;
    sources?: Array<{
      name: string;
      url: string;
    }>;
  }>;
  version?: number;
}

interface MatchedSourcePackCandidate {
  matchedKeywords: string[];
  name: string;
  relevanceScore: number;
  topicName: string;
  url: string;
}

function matchSourcePackCandidates(input: {
  description: string;
  limit: number;
  name: string;
  profileKeywords: string[];
  sourcePack: SeedSourcePack;
}): MatchedSourcePackCandidate[] {
  const topicTerms = uniqueStrings([
    ...tokenizeText(input.name),
    ...tokenizeText(input.description),
    ...input.profileKeywords.flatMap(tokenizeText),
  ]);
  const candidates = (input.sourcePack.topics ?? []).flatMap((topic) => {
    const sourcePackTerms = uniqueStrings([
      ...tokenizeText(topic.name),
      ...tokenizeText(topic.description ?? ""),
      ...(topic.keywords ?? []).flatMap(tokenizeText),
    ]);
    const matchedKeywords = topicTerms.filter((term) =>
      sourcePackTerms.some((sourceTerm) => termsMatch(term, sourceTerm)),
    );

    if (matchedKeywords.length === 0) {
      return [];
    }

    const relevanceScore = Number(
      Math.min(1, 0.45 + matchedKeywords.length * 0.12).toFixed(2),
    );

    return (topic.sources ?? [])
      .filter((source) => isHttpUrl(source.url))
      .map((source) => ({
        matchedKeywords,
        name: source.name,
        relevanceScore,
        topicName: topic.name,
        url: source.url,
      }));
  });

  return dedupeMatchedSources(candidates).slice(0, input.limit);
}

function dedupeMatchedSources(
  candidates: MatchedSourcePackCandidate[],
): MatchedSourcePackCandidate[] {
  const seen = new Set<string>();
  const unique: MatchedSourcePackCandidate[] = [];

  for (const candidate of candidates.sort(
    (left, right) => right.relevanceScore - left.relevanceScore,
  )) {
    const key = candidate.url.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

function tokenizeText(value: string): string[] {
  return value
    .split(/[\s,，、;；:：/|()\[\]{}"'“”‘’<>《》.!?！？\n\r\t]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .flatMap((term) => [term, ...extractCjkTerms(term)])
    .map((term) => term.toLowerCase())
    .filter((term) => !TOPIC_CREATE_STOP_WORDS.has(term));
}

function extractCjkTerms(value: string): string[] {
  return [...value.matchAll(/[\u4e00-\u9fff]{2,8}/g)].map((match) => match[0]);
}

function termsMatch(left: string, right: string): boolean {
  return left === right || left.includes(right) || right.includes(left);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function readPositiveIntegerEnv(key: string, fallback: number): number {
  const value = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

const TOPIC_CREATE_STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "关注",
  "跟踪",
  "观察",
  "相关",
]);

function logActionError(action: string, error: unknown): void {
  process.stderr.write(
    `[${action}] ${error instanceof Error ? error.message : String(error)}\n`,
  );
}

type ActionRedirectType = "error" | "notice";

function actionRedirectHref(
  path: string,
  type: ActionRedirectType,
  message: string,
): string {
  const params = new URLSearchParams({ [type]: message });
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${params.toString()}`;
}

function toUserActionError(error: unknown): string {
  if (error instanceof Error && error.message === "AI_API_KEY_MISSING") {
    return "AI API Key 未随保存请求提交，请重新输入后测试并保存。";
  }

  if (error instanceof Error && error.message === "SEARCH_API_KEY_MISSING") {
    return "搜索 API Key 未随保存请求提交，请重新输入后测试并保存。";
  }

  if (error instanceof Error && error.message === "TELEGRAM_BOT_TOKEN_MISSING") {
    return "请输入 Telegram Bot Token。";
  }

  if (error instanceof Error && error.message === "TELEGRAM_CHAT_ID_MISSING") {
    return "请输入 Telegram Chat ID。";
  }
  if (error instanceof Error && error.message === "INSTANT_PUSH_PLAN_BLOCKED") {
    return "即时推送仅对 Plus、Pro 或自用模式开放。";
  }
  if (error instanceof Error && error.message.startsWith("INSTANT_PUSH_TELEGRAM_MISSING")) {
    return "请先前往「管理 → Telegram」配置机器人凭据后再开启即时推送。";
  }

  if (error instanceof Error && error.message === "BYOK_API_KEY_MISSING") {
    return "请输入 BYOK API Key。";
  }

  if (error instanceof Error && error.message === "BYOK_BASE_URL_MISSING") {
    return "请填写 BYOK Base URL。";
  }

  if (error instanceof Error && error.message === "CCPAYMENT_APP_ID_MISSING") {
    return "请输入 CCPayment App ID。";
  }

  if (error instanceof Error && error.message === "CCPAYMENT_APP_SECRET_MISSING") {
    return "请输入 CCPayment App Secret。";
  }

  if (error instanceof Error && error.message === "CCPAYMENT_APP_ID_MISSING") {
    return "请输入 CCPayment App ID。";
  }

  if (
    error instanceof Error &&
    error.message === "CCPAYMENT_APP_SECRET_MISSING"
  ) {
    return "请输入 CCPayment App Secret。";
  }

  if (error instanceof Error && error.message === "AI_BASE_URL_INVALID") {
    return "AI Base URL 必须是有效的 HTTP 或 HTTPS 地址。";
  }

  if (error instanceof Error && /HTTP or HTTPS URL/.test(error.message)) {
    return "请输入有效的 HTTP 或 HTTPS RSS 地址。";
  }

  if (error instanceof Error && /ENCRYPTION_KEY is required/.test(error.message)) {
    return "加密密钥未配置，请设置 ENCRYPTION_KEY 环境变量后重启服务。";
  }

  if (error instanceof Error && /DATABASE_URL is required/.test(error.message)) {
    return "数据库连接未配置，请设置 DATABASE_URL 环境变量后重启服务。";
  }

  if (error instanceof Error && /required/.test(error.message)) {
    return "请补全必填内容后再提交。";
  }

  return "操作未完成，请检查输入或稍后重试。";
}

function readRequiredField(formData: FormData, key: string): string {
  const value = readOptionalField(formData, key);
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function readOptionalField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readProfileListField(
  formData: FormData,
  key: string,
  required = false,
): string[] {
  const rawValue = readOptionalField(formData, key);

  if (rawValue.length > 5_000) {
    throw new Error(`${key} is too long.`);
  }

  const values = Array.from(
    new Set(
      rawValue
        .split(/[\n,，]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  if (required && values.length === 0) {
    throw new Error(`${key} is required.`);
  }
  if (values.length > 50 || values.some((value) => value.length > 160)) {
    throw new Error(`${key} contains too many or overly long values.`);
  }

  return values;
}

function readPositiveInteger(
  formData: FormData,
  key: string,
  fallback: number,
): number {
  const raw = readOptionalField(formData, key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function validateEnumValue<T extends string>(
  value: string,
  allowed: readonly T[],
): T {
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : (allowed[0] as T);
}

function readJsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function readSafeReturnPath(formData: FormData, key: string): string | null {
  const value = readOptionalField(formData, key);
  return value.startsWith("/") && !value.startsWith("//") ? value : null;
}

function readRequiredUrl(formData: FormData, key: string): string {
  const value = readRequiredField(formData, key);
  const parsed = new URL(value);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${key} must be an HTTP or HTTPS URL.`);
  }

  return parsed.toString();
}

function readDashboardEventAction(
  formData: FormData,
  key: string,
): "read" | "save" | "unsave" | "dismiss" {
  const value = readRequiredField(formData, key);

  if (
    value === "read" ||
    value === "save" ||
    value === "unsave" ||
    value === "dismiss"
  ) {
    return value;
  }

  throw new Error(`${key} must be read, save, unsave, or dismiss.`);
}

function readCategoryPreferenceAction(
  formData: FormData,
  key: string,
): "up" | "down" {
  const value = readRequiredField(formData, key);

  if (value === "up" || value === "down") {
    return value;
  }

  throw new Error(`${key} must be up or down.`);
}

function readSourceGovernanceAction(
  formData: FormData,
  key: string,
): "approve" | "mute" | "reject" | "observe" {
  const value = readRequiredField(formData, key);

  if (
    value === "approve" ||
    value === "mute" ||
    value === "reject" ||
    value === "observe"
  ) {
    return value;
  }

  throw new Error(`${key} must be approve, mute, reject, or observe.`);
}

export async function updateTopicAction(formData: FormData): Promise<void> {
  let message = "主题已更新。";
  let type: ActionRedirectType = "notice";
  const topicId = readOptionalField(formData, "topicId");
  const returnTo =
    readSafeReturnPath(formData, "returnTo") ??
    (topicId ? `/topics/${topicId}` : "/topics");

  try {
    if (!topicId) {
      throw new Error("topicId is required.");
    }
    await updateTopicFromForm(formData);
  } catch (error) {
    logActionError("updateTopicAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/topics");
  if (topicId) {
    revalidatePath(`/topics/${topicId}`);
  }
  revalidatePath("/");
  redirect(actionRedirectHref(returnTo, type, message));
}

async function updateTopicFromForm(formData: FormData) {
  const topicId = readRequiredField(formData, "topicId");
  const name = readRequiredField(formData, "topicName");
  const description = readOptionalField(formData, "topicDescription");
  const keywords = readProfileListField(formData, "topicKeywords", true);
  const entities = readProfileListField(formData, "topicEntities");
  const includeScope = readProfileListField(formData, "topicIncludeScope");
  const excludeScope = readProfileListField(formData, "topicExcludeScope");
  const importanceRules = readProfileListField(
    formData,
    "topicImportanceRules",
  );
  const outputLanguage = readOptionalField(formData, "topicOutputLanguage") || "zh-CN";
  const terminologyRules = readProfileListField(formData, "topicTerminologyRules");
  const digestStructure = readOptionalField(formData, "topicDigestStructure") || "standard";
  const digestDetailLevel = readOptionalField(formData, "topicDigestDetailLevel") || "standard";
  const digestMaxEvents = readPositiveInteger(formData, "topicDigestMaxEvents", 10);

  if (name.length > 120 || description.length > 2_000) {
    throw new Error("Topic name or description is too long.");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to update topics.");
  }

  const {
    assertMembershipRole,
    getTopicById,
    getPrismaClient,
    recordUsageEvent,
    updateTopic,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
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
  const topic = await getTopicById(prisma, {
    organizationId: workspace.organizationId,
    topicId,
  });

  if (!topic) {
    throw new Error("Topic not found in this workspace.");
  }
  const currentProfile = readJsonRecord(topic.profile);

  await updateTopic(
    prisma,
    {
      organizationId: workspace.organizationId,
      topicId,
    },
    {
      description,
      name,
      profile: {
        ...currentProfile,
        entities,
        excludeScope,
        importanceRules,
        includeScope,
        keywords,
        languagePreferences: {
          outputLanguage: outputLanguage.trim().slice(0, 20),
          terminologyRules,
        },
        digestStyle: {
          structure: validateEnumValue(digestStructure, ["standard", "detailed", "compact"]),
          detailLevel: validateEnumValue(digestDetailLevel, ["brief", "standard", "comprehensive"]),
          maxEvents: Math.max(1, Math.min(digestMaxEvents, 50)),
        },
        source: "topic-profile-editor",
      },
    },
  );

  await recordUsageEvent(prisma, {
    metadata: {
      action: "update-topic",
      topicId,
    },
    organizationId: workspace.organizationId,
    quantity: 1,
    subjectId: topicId,
    subjectType: "topic",
    type: "WEB_ACTION",
    unit: "action",
    userId: workspace.userId,
  });
}

export async function updateTopicStatusAction(
  formData: FormData,
): Promise<void> {
  const topicId = readRequiredField(formData, "topicId");
  const action = readRequiredField(formData, "statusAction");
  let message = "主题状态已更新。";
  let type: ActionRedirectType = "notice";

  try {
    await updateTopicStatusFromForm(formData);
  } catch (error) {
    logActionError("updateTopicStatusAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/topics");
  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/");
  redirect(actionRedirectHref(`/topics/${topicId}`, type, message));
}

async function updateTopicStatusFromForm(formData: FormData) {
  const topicId = readRequiredField(formData, "topicId");
  const action = readRequiredField(formData, "statusAction");

  const validActions = ["pause", "resume", "archive", "restore"] as const;
  if (!validActions.includes(action as (typeof validActions)[number])) {
    throw new Error("statusAction must be pause, resume, archive, or restore.");
  }

  const statusActionMap: Record<string, "ACTIVE" | "PAUSED" | "ARCHIVED"> = {
    pause: "PAUSED",
    resume: "ACTIVE",
    archive: "ARCHIVED",
    restore: "ACTIVE",
  };

  const targetStatus = statusActionMap[action];
  if (!targetStatus) {
    throw new Error(`Invalid status action: ${action}`);
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to update topic status.");
  }

  const {
    assertMembershipRole,
    getPrismaClient,
    recordUsageEvent,
    updateTopicStatus,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
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

  await updateTopicStatus(
    prisma,
    {
      organizationId: workspace.organizationId,
      topicId,
    },
    targetStatus,
  );

  await recordUsageEvent(prisma, {
    metadata: {
      action: `topic-${action}`,
      topicId,
    },
    organizationId: workspace.organizationId,
    quantity: 1,
    subjectId: topicId,
    subjectType: "topic",
    type: "WEB_ACTION",
    unit: "action",
    userId: workspace.userId,
  });
}

export async function deleteTopicAction(formData: FormData): Promise<void> {
  let message = "主题已删除。";
  let type: ActionRedirectType = "notice";

  try {
    await deleteTopicFromForm(formData);
  } catch (error) {
    logActionError("deleteTopicAction", error);
    message = toUserActionError(error);
    type = "error";
    redirect(actionRedirectHref("/topics", type, message));
    return;
  }

  revalidatePath("/topics");
  revalidatePath("/");
  redirect(actionRedirectHref("/topics", type, message));
}

async function deleteTopicFromForm(formData: FormData) {
  const topicId = readRequiredField(formData, "topicId");

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to delete topics.");
  }

  const {
    assertMembershipRole,
    deleteTopic,
    getPrismaClient,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
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

  await deleteTopic(prisma, {
    organizationId: workspace.organizationId,
    topicId,
  });

  await recordUsageEvent(prisma, {
    metadata: {
      action: "delete-topic",
      topicId,
    },
    organizationId: workspace.organizationId,
    quantity: 1,
    subjectId: topicId,
    subjectType: "topic",
    type: "WEB_ACTION",
    unit: "action",
    userId: workspace.userId,
  });
}

export async function regenerateEventSummaryAction(
  formData: FormData,
): Promise<void> {
  const eventId = readRequiredField(formData, "eventId");
  const returnTo =
    readSafeReturnPath(formData, "returnTo") ?? `/events/${eventId}`;
  let message = "摘要已重新生成。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to regenerate summary.");
    }

    const {
      assertMembershipRole,
      getDecryptedCredentials,
      getMonthAiCallCount,
      getPrismaClient,
      getSubscriptionPlanView,
      getTodayAiCallCount,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const { checkAiCallQuota } = await import("@wangchao/core");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      { organizationId: workspace.organizationId, userId: workspace.userId },
      ["OWNER", "ADMIN", "MEMBER"],
    );

    const subscription = await getSubscriptionPlanView(prisma, { organizationId: workspace.organizationId });
    const todayAiCalls = await getTodayAiCallCount(prisma, { organizationId: workspace.organizationId });
    const monthAiCalls = await getMonthAiCallCount(prisma, { organizationId: workspace.organizationId });
    const aiQuota = checkAiCallQuota(subscription.plan, todayAiCalls, monthAiCalls, subscription.isSelfHosted);
    if (!aiQuota.allowed) throw new Error(aiQuota.reason ?? "AI call limit reached.");

    const event = await prisma.intelligenceEvent.findUnique({
      where: { id: eventId, organizationId: workspace.organizationId },
      include: {
        primaryItem: { include: { source: { select: { name: true } } } },
        topic: { select: { name: true, description: true, profile: true } },
      },
    });

    if (!event) {
      throw new Error("Event not found in this workspace.");
    }
    if (!event.primaryItem) {
      throw new Error("No primary item associated with this event.");
    }

    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    if (event.updatedAt > sixtySecondsAgo) {
      message = "刚刚已更新摘要，请稍后再试。";
      type = "notice";
      revalidatePath(returnTo);
      redirect(actionRedirectHref(returnTo, type, message));
      return;
    }

    const creds = await getDecryptedCredentials(prisma, {
      organizationId: workspace.organizationId,
    });
    if (!creds?.ai?.apiKey || !creds.ai.baseUrl) {
      const envKey = process.env.AI_API_KEY;
      const envUrl = process.env.AI_BASE_URL;
      if (!envKey || !envUrl) {
        throw new Error("AI_API_KEY_MISSING");
      }
    }

    const { createOpenAiCompatibleAdapter, buildEventExtractionMessages, parseEventExtractionResponse } =
      await import("@wangchao/ai");
    const { buildTopicProfileContext } = await import("@wangchao/core");
    const model = creds?.ai?.model ?? process.env.AI_MODEL ?? "gpt-4o-mini";

    let adapter;
    if (creds?.ai?.apiKey && creds.ai.baseUrl) {
      adapter = createOpenAiCompatibleAdapter({
        apiKey: creds.ai.apiKey,
        baseUrl: creds.ai.baseUrl,
      });
    } else {
      adapter = createOpenAiCompatibleAdapter({
        apiKey: process.env.AI_API_KEY!,
        baseUrl: process.env.AI_BASE_URL!,
      });
    }

    const context = buildTopicProfileContext(
      event.topic.profile,
      { description: event.topic.description, name: event.topic.name },
    );
    const extractionInput = {
      item: {
        id: event.primaryItem.id,
        title: event.primaryItem.title,
        summary: event.primaryItem.summary,
        url: event.primaryItem.url,
        publishedAt: event.primaryItem.publishedAt?.toISOString() ?? null,
        sourceName: event.primaryItem.source.name,
        rawContent: event.primaryItem.rawContent ?? null,
      },
      topic: {
        description: context.description,
        entities: context.entities,
        excludeScope: context.excludeScope,
        importanceRules: context.importanceRules,
        includeScope: context.includeScope,
        keywords: context.keywords,
        name: context.name,
        languagePreferences: context.languagePreferences,
      },
    };
    const messages = buildEventExtractionMessages(extractionInput);
    const response = await adapter.chat({
      jsonMode: true,
      maxTokens: 600,
      messages,
      model,
      temperature: 0.2,
    });
    const result = parseEventExtractionResponse(response.content, {
      itemSummary: event.primaryItem.summary ?? "",
      itemTitle: event.primaryItem.title,
    });

    if (result.isRelevant && result.summary) {
      await prisma.intelligenceEvent.update({
        where: { id: event.id, organizationId: workspace.organizationId },
        data: { summary: result.summary },
      });
      message = "摘要已基于 AI 重新生成。";
    } else {
      message = "AI 判定该条目为不相关内容，未更新摘要。";
    }

    await recordUsageEvent(prisma, {
      metadata: {
        action: "regenerate-event-summary",
        isRelevant: result.isRelevant,
        source: "event-detail-page",
      },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectId: eventId,
      subjectType: "intelligence-event",
      type: "AI_CALL",
      unit: "call",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("regenerateEventSummaryAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath(returnTo);
  revalidatePath("/");
  redirect(actionRedirectHref(returnTo, type, message));
}

export async function upsertAiCredentialAction(formData: FormData): Promise<void> {
  let message = "AI 凭证已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to configure credentials.");
    }

    const apiKey = readOptionalField(formData, "aiApiKey");
    if (!apiKey) {
      throw new Error("AI_API_KEY_MISSING");
    }
    const baseUrl = readOptionalField(formData, "aiBaseUrl");
    const provider = readOptionalField(formData, "aiProvider");
    const model = readOptionalField(formData, "aiModel");

    if (baseUrl) {
      const parsed = new URL(baseUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("AI_BASE_URL_INVALID");
      }
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      recordUsageEvent,
      upsertAiCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    await upsertAiCredential(prisma, { organizationId: workspace.organizationId }, {
      apiKey,
      baseUrl: baseUrl || undefined,
      provider: provider || undefined,
      model: model || undefined,
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-update",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("upsertAiCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function upsertSearchCredentialAction(formData: FormData): Promise<void> {
  let message = "搜索凭证已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to configure credentials.");
    }

    const apiKey = readOptionalField(formData, "searchApiKey");
    if (!apiKey) {
      throw new Error("SEARCH_API_KEY_MISSING");
    }
    const provider = readOptionalField(formData, "searchProvider");

    const {
      assertMembershipRole,
      getPrismaClient,
      recordUsageEvent,
      upsertSearchCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    await upsertSearchCredential(prisma, { organizationId: workspace.organizationId }, {
      apiKey,
      provider: provider || "brave",
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-update",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("upsertSearchCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function deleteAiCredentialAction(formData: FormData): Promise<void> {
  let message = "AI 凭证已清除。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to manage credentials.");
    }

    const {
      assertMembershipRole,
      deleteAiCredential,
      getPrismaClient,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    await deleteAiCredential(prisma, { organizationId: workspace.organizationId });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-delete",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("deleteAiCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function deleteSearchCredentialAction(formData: FormData): Promise<void> {
  let message = "搜索凭证已清除。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to manage credentials.");
    }

    const {
      assertMembershipRole,
      deleteSearchCredential,
      getPrismaClient,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    await deleteSearchCredential(prisma, { organizationId: workspace.organizationId });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-delete",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("deleteSearchCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function testAiCredentialAction(
  formData: FormData,
): Promise<{ message: string; ok: boolean }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to test credentials.");
    }

    const apiKey = readOptionalField(formData, "aiApiKey");
    if (!apiKey) {
      return { message: "请输入 AI API Key 后再测试。", ok: false };
    }
    const provider = readOptionalField(formData, "aiProvider");
    const baseUrl = readOptionalField(formData, "aiBaseUrl") || defaultAiBaseUrl(provider);
    if (!baseUrl) {
      return { message: "请填写 AI Provider 的 Base URL 后再测试。", ok: false };
    }
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { message: "请输入有效的 HTTP 或 HTTPS Base URL。", ok: false };
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      testAiCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    return testAiCredential({ apiKey, baseUrl });
  } catch (error) {
    logActionError("testAiCredentialAction", error);
    return { message: toUserActionError(error), ok: false };
  }
}

export async function listAiModelsAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string; models: Array<{ id: string; ownedBy?: string }> }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to list models.");
    }

    const apiKey = readOptionalField(formData, "aiApiKey");
    if (!apiKey) {
      return { ok: false, message: "请输入 AI API Key 后再获取模型列表。", models: [] };
    }
    const provider = readOptionalField(formData, "aiProvider");
    const baseUrl = readOptionalField(formData, "aiBaseUrl") || defaultAiBaseUrl(provider);
    if (!baseUrl) {
      return { ok: false, message: "请填写 AI Provider 的 Base URL 后再获取模型列表。", models: [] };
    }
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, message: "请输入有效的 HTTP 或 HTTPS Base URL。", models: [] };
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      listAiModels,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    return listAiModels({ apiKey, baseUrl });
  } catch (error) {
    logActionError("listAiModelsAction", error);
    return { ok: false, message: toUserActionError(error), models: [] };
  }
}

export async function testSearchCredentialAction(
  formData: FormData,
): Promise<{ message: string; ok: boolean }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to test credentials.");
    }

    const apiKey = readOptionalField(formData, "searchApiKey");
    if (!apiKey) {
      return { message: "请输入搜索 API Key 后再测试。", ok: false };
    }
    const provider = readOptionalField(formData, "searchProvider") || "brave";

    const {
      assertMembershipRole,
      getPrismaClient,
      testSearchCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    return testSearchCredential({ apiKey, provider });
  } catch (error) {
    logActionError("testSearchCredentialAction", error);
    return { message: toUserActionError(error), ok: false };
  }
}

export async function upsertTelegramCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "Telegram 投递凭证已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to configure credentials.");
    }

    const botToken = readOptionalField(formData, "telegramBotToken");
    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
    }
    const chatId = readOptionalField(formData, "telegramChatId");
    if (!chatId) {
      throw new Error("TELEGRAM_CHAT_ID_MISSING");
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      recordUsageEvent,
      upsertTelegramCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    await upsertTelegramCredential(
      prisma,
      { organizationId: workspace.organizationId },
      { botToken, chatId, enabled: true },
    );

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-telegram" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-update",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("upsertTelegramCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function deleteTelegramCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "Telegram 投递凭证已清除。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to manage credentials.");
    }

    const {
      assertMembershipRole,
      deleteTelegramCredential,
      getPrismaClient,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    await deleteTelegramCredential(prisma, {
      organizationId: workspace.organizationId,
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-telegram" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-delete",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("deleteTelegramCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function testTelegramCredentialAction(
  formData: FormData,
): Promise<{ message: string; ok: boolean }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to test credentials.");
    }

    const botToken = readOptionalField(formData, "telegramBotToken");
    if (!botToken) {
      return { message: "请输入 Bot Token 后再测试。", ok: false };
    }
    const chatId = readOptionalField(formData, "telegramChatId");
    if (!chatId) {
      return { message: "请输入 Chat ID 后再测试。", ok: false };
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      testTelegramCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    return testTelegramCredential({ botToken, chatId });
  } catch (error) {
    logActionError("testTelegramCredentialAction", error);
    return { message: toUserActionError(error), ok: false };
  }
}

export async function upsertCcpaymentCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "CCPayment 凭证已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to configure credentials.");
    }

    const appId = readOptionalField(formData, "ccpaymentAppId");
    if (!appId) {
      throw new Error("CCPAYMENT_APP_ID_MISSING");
    }
    const appSecret = readOptionalField(formData, "ccpaymentAppSecret");
    if (!appSecret) {
      throw new Error("CCPAYMENT_APP_SECRET_MISSING");
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      recordUsageEvent,
      upsertCcpaymentCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    await upsertCcpaymentCredential(
      prisma,
      { organizationId: workspace.organizationId },
      { appId, appSecret },
    );

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-ccpayment" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-update",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("upsertCcpaymentCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function deleteCcpaymentCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "CCPayment 凭证已清除。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to manage credentials.");
    }

    const {
      assertMembershipRole,
      deleteCcpaymentCredential,
      getPrismaClient,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    await deleteCcpaymentCredential(prisma, {
      organizationId: workspace.organizationId,
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-ccpayment" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-delete",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("deleteCcpaymentCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function testCcpaymentCredentialAction(
  formData: FormData,
): Promise<{ message: string; ok: boolean }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to test credentials.");
    }

    const appId = readOptionalField(formData, "ccpaymentAppId");
    if (!appId) {
      return { message: "请输入 CCPayment App ID 后再测试。", ok: false };
    }
    const appSecret = readOptionalField(formData, "ccpaymentAppSecret");
    if (!appSecret) {
      return { message: "请输入 CCPayment App Secret 后再测试。", ok: false };
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      testCcpaymentCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    return testCcpaymentCredential({ appId, appSecret });
  } catch (error) {
    logActionError("testCcpaymentCredentialAction", error);
    return { message: toUserActionError(error), ok: false };
  }
}

export async function createReportAction(formData: FormData): Promise<void> {
  const question = readRequiredField(formData, "reportQuestion");
  let message = "专题报告生成请求已提交。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to create reports.");
    }

    if (question.length > 500) {
      throw new Error("问题过长，请限制在 500 字以内。");
    }

    const {
      assertMembershipRole,
      createReport,
      getMonthAiCallCount,
      getPrismaClient,
      getSubscriptionPlanView,
      getTodayAiCallCount,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const { checkAiCallQuota } = await import("@wangchao/core");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN", "MEMBER"],
    );

    const subscription = await getSubscriptionPlanView(prisma, { organizationId: workspace.organizationId });
    const todayAiCalls = await getTodayAiCallCount(prisma, { organizationId: workspace.organizationId });
    const monthAiCalls = await getMonthAiCallCount(prisma, { organizationId: workspace.organizationId });
    const aiQuota = checkAiCallQuota(subscription.plan, todayAiCalls, monthAiCalls, subscription.isSelfHosted);
    if (!aiQuota.allowed) throw new Error(aiQuota.reason ?? "AI call limit reached.");

    const report = await createReport(
      prisma,
      { organizationId: workspace.organizationId },
      { question },
    );

    await recordUsageEvent(prisma, {
      metadata: { action: "create-report", question: question.slice(0, 100) },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectId: report.id,
      subjectType: "report",
      type: "WEB_ACTION",
      unit: "action",
      userId: workspace.userId,
    });

    // Report status is PENDING — the dedicated report-cron Railway service
    // will pick it up and generate it, fully decoupled from the Web process.
  } catch (error) {
    logActionError("createReportAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/reports");
  redirect(actionRedirectHref("/reports", type, message));
}

export async function deletePreferenceAction(formData: FormData): Promise<void> {
  const topicId = readRequiredField(formData, "topicId");
  const key = readRequiredField(formData, "preferenceKey");
  let message = "偏好已删除。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to delete preferences.");
    }

    const {
      assertMembershipRole,
      deletePreferenceMemory,
      getPrismaClient,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN", "MEMBER"],
    );

    await deletePreferenceMemory(
      prisma,
      { organizationId: workspace.organizationId },
      { key, topicId },
    );
  } catch (error) {
    logActionError("deletePreferenceAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/preferences");
  redirect(actionRedirectHref("/preferences", type, message));
}

export async function updatePreferenceWeightAction(
  formData: FormData,
): Promise<void> {
  const topicId = readRequiredField(formData, "topicId");
  const key = readRequiredField(formData, "preferenceKey");
  const weightRaw = readOptionalField(formData, "weight");
  const weight = Number.parseFloat(weightRaw);
  let message = "偏好权重已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to update preferences.");
    }

    if (!Number.isFinite(weight)) {
      throw new Error("Invalid weight value.");
    }

    if (weight < -4 || weight > 4) {
      throw new Error("Weight must be between -4 and 4.");
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      updatePreferenceMemoryWeight,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN", "MEMBER"],
    );

    await updatePreferenceMemoryWeight(
      prisma,
      { organizationId: workspace.organizationId },
      { key, topicId, weight },
    );
  } catch (error) {
    logActionError("updatePreferenceWeightAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/preferences");
  redirect(actionRedirectHref("/preferences", type, message));
}

export async function recordEnhancedFeedbackAction(
  formData: FormData,
): Promise<void> {
  const topicId = readRequiredField(formData, "topicId");
  const kind = readRequiredField(formData, "feedbackKind") as
    | "MORE_LIKE_THIS"
    | "LESS_LIKE_THIS"
    | "SCORE_UP"
    | "SCORE_DOWN";
  const eventId = readOptionalField(formData, "eventId") || undefined;
  const sourceId = readOptionalField(formData, "sourceId") || undefined;
  const returnTo = readSafeReturnPath(formData, "returnTo") ?? "/";
  let message = "反馈已记录。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required for feedback.");
    }

    if (!["MORE_LIKE_THIS", "LESS_LIKE_THIS", "SCORE_UP", "SCORE_DOWN"].includes(kind)) {
      throw new Error("Invalid feedback kind.");
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      recordCategoryPreferenceFeedback,
      recordEnhancedFeedback,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN", "MEMBER"],
    );

    const valueMap: Record<string, number> = {
      MORE_LIKE_THIS: 2,
      LESS_LIKE_THIS: -2,
      SCORE_UP: 1,
      SCORE_DOWN: -1,
    };

    await recordEnhancedFeedback(
      prisma,
      { organizationId: workspace.organizationId },
      {
        topicId,
        userId: workspace.userId,
        kind,
        eventId,
        sourceId,
        value: valueMap[kind],
      },
    );

    if ((kind === "SCORE_UP" || kind === "SCORE_DOWN") && eventId) {
      await recordCategoryPreferenceFeedback(prisma, {
        action: kind === "SCORE_UP" ? "up" : "down",
        eventId,
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      });
    }
  } catch (error) {
    logActionError("recordEnhancedFeedbackAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath(returnTo);
  revalidatePath("/preferences");
  redirect(actionRedirectHref(returnTo, type, message));
}

export async function upsertByokCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "BYOK 凭证已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to configure credentials.");
    }

    const apiKey = readOptionalField(formData, "byokApiKey");
    if (!apiKey) {
      throw new Error("BYOK_API_KEY_MISSING");
    }
    const baseUrl = readOptionalField(formData, "byokBaseUrl");
    if (!baseUrl) {
      throw new Error("BYOK_BASE_URL_MISSING");
    }
    const provider = readOptionalField(formData, "byokProvider");
    const model = readOptionalField(formData, "byokModel");

    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("AI_BASE_URL_INVALID");
    }

    const {
      assertMembershipRole,
      encryptCredential,
      getPrismaClient,
      maskKeyHint,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    const { upsertByokCredential } = await import("@wangchao/db");
    await upsertByokCredential(prisma, {
      organizationId: workspace.organizationId,
    }, {
      apiKey,
      baseUrl,
      provider: provider || undefined,
      model: model || undefined,
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-byok" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-update",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("upsertByokCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function deleteByokCredentialAction(
  formData: FormData,
): Promise<void> {
  let message = "BYOK 凭证已清除。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to manage credentials.");
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      recordUsageEvent,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    const { deleteByokCredential } = await import("@wangchao/db");
    await deleteByokCredential(prisma, {
      organizationId: workspace.organizationId,
    });

    await recordUsageEvent(prisma, {
      metadata: { source: "admin-settings-byok" },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "credential-delete",
      userId: workspace.userId,
    });
  } catch (error) {
    logActionError("deleteByokCredentialAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function testByokCredentialAction(
  formData: FormData,
): Promise<{ message: string; ok: boolean }> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to test credentials.");
    }

    const apiKey = readOptionalField(formData, "byokApiKey");
    if (!apiKey) {
      return { message: "请输入 BYOK API Key 后再测试。", ok: false };
    }
    const baseUrl = readOptionalField(formData, "byokBaseUrl");
    if (!baseUrl) {
      return { message: "请填写 Base URL 后再测试。", ok: false };
    }

    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { message: "请输入有效的 HTTP 或 HTTPS Base URL。", ok: false };
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      testAiCredential,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    return testAiCredential({ apiKey, baseUrl });
  } catch (error) {
    logActionError("testByokCredentialAction", error);
    return { message: toUserActionError(error), ok: false };
  }
}

export async function toggleSelfHostedModeAction(
  formData: FormData,
): Promise<void> {
  let message = "自用模式已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to toggle self-hosted mode.");
    }

    const enabledValue = readOptionalField(formData, "enabled");
    const enabled = enabledValue === "true";

    const {
      assertMembershipRole,
      getPrismaClient,
      recordUsageEvent,
      setSelfHostedMode,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
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

    const { previousValue, newValue } = await setSelfHostedMode(prisma, { organizationId: workspace.organizationId }, enabled);

    await recordUsageEvent(prisma, {
      metadata: {
        action: "toggle_self_hosted",
        previousValue,
        newValue,
        organizationId: workspace.organizationId,
      },
      organizationId: workspace.organizationId,
      quantity: 1,
      subjectType: "subscription",
      type: "WEB_ACTION",
      unit: "action",
      userId: workspace.userId,
    });

    message = enabled
      ? "已开启自用模式，所有配额检查已跳过。"
      : "已关闭自用模式，恢复正常配额检查。";
  } catch (error) {
    logActionError("toggleSelfHostedModeAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/admin/settings");
  revalidatePath("/pricing");
  revalidatePath("/usage");
  redirect(actionRedirectHref("/admin/settings", type, message));
}

export async function setInstantPushEnabledAction(formData: FormData): Promise<void> {
  let message = "即时推送设置已更新。";
  let type: ActionRedirectType = "notice";
  try {
    if (!process.env.DATABASE_URL) throw new Error("Database connection is required.");
    const enabled = readOptionalField(formData, "enabled") === "true";
    const { assertMembershipRole, getInstantPushSettings, getPrismaClient, recordUsageEvent, setInstantPushEnabled } = await import("@wangchao/db");
    const { checkInstantPushQuota, resolveEffectivePlan } = await import("@wangchao/core");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();
    await assertMembershipRole(prisma, { organizationId: workspace.organizationId, userId: workspace.userId }, ["OWNER", "ADMIN"]);
    const settings = await getInstantPushSettings(prisma, { organizationId: workspace.organizationId });
    const effectivePlan = resolveEffectivePlan(settings);
    if (enabled && !checkInstantPushQuota(effectivePlan, settings.isSelfHosted).allowed) throw new Error("INSTANT_PUSH_PLAN_BLOCKED");
    if (enabled && !settings.hasTelegramCredential) throw new Error("INSTANT_PUSH_TELEGRAM_MISSING: 请先前往「管理 → Telegram」配置机器人凭据后再开启即时推送。");
    await setInstantPushEnabled(prisma, { organizationId: workspace.organizationId }, enabled);
    await recordUsageEvent(prisma, {
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      type: "WEB_ACTION",
      quantity: 1,
      unit: "action",
      subjectType: "subscription",
      metadata: { action: enabled ? "enable-instant-push" : "disable-instant-push", source: "admin-settings-telegram" },
    });
    message = enabled ? "已开启高优先级情报即时推送。" : "已关闭高优先级情报即时推送。";
  } catch (error) {
    logActionError("setInstantPushEnabledAction", error);
    message = toUserActionError(error);
    type = "error";
  }
  revalidatePath("/admin/settings");
  revalidatePath("/usage");
  redirect(actionRedirectHref("/admin/settings", type, message));
}
