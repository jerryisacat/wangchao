"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import seedSourcePack from "../../../../packages/db/seed-sources.json";

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
    ensureDefaultWorkspace,
    getPrismaClient,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const { buildTopicProfile } = await import("@wangchao/core");
  const { validateRssFeedUrl } = await import("@wangchao/sources");
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
    ensureDefaultWorkspace,
    getPrismaClient,
    recordUsageEvent,
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
    ensureDefaultWorkspace,
    getPrismaClient,
    listRecentFeedbackSignals,
    recordUsageEvent,
    updateDashboardEventState,
    upsertPreferenceMemory,
  } = await import("@wangchao/db");
  const { generatePreferenceDeltas } = await import("@wangchao/core");
  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);

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
  const signals = await listRecentFeedbackSignals(prisma, {
    organizationId: workspace.organizationId,
    userId: workspace.userId,
  });
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
    ensureDefaultWorkspace,
    getPrismaClient,
    recordUsageEvent,
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
  let message = "信源发现已完成。";
  let type: ActionRedirectType = "notice";

  try {
    const result = await runSourceDiscoveryFromDashboard();
    message = `信源发现已完成，新增或更新 ${result.candidateSourcesWritten} 个候选源，观察到 ${result.existingSourcesObserved} 个已有源。`;
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
    ensureDefaultWorkspace,
    getPrismaClient,
  } = await import("@wangchao/db");
  const { runSourceDiscoveryCycle } = await import("@wangchao/worker");
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

  return runSourceDiscoveryCycle({
    mode: "manual",
    userId: workspace.userId,
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
    ensureDefaultWorkspace,
    getPrismaClient,
    recordUsageEvent,
    updateSourceGovernanceStatus,
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
  if (error instanceof Error && /HTTP or HTTPS URL/.test(error.message)) {
    return "请输入有效的 HTTP 或 HTTPS RSS 地址。";
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
): "read" | "save" | "dismiss" {
  const value = readRequiredField(formData, key);

  if (value === "read" || value === "save" || value === "dismiss") {
    return value;
  }

  throw new Error(`${key} must be read, save, or dismiss.`);
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
  const topicId = readRequiredField(formData, "topicId");
  const returnTo = readSafeReturnPath(formData, "returnTo") ?? `/topics/${topicId}`;

  try {
    await updateTopicFromForm(formData);
  } catch (error) {
    logActionError("updateTopicAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/topics");
  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/");
  redirect(actionRedirectHref(returnTo, type, message));
}

async function updateTopicFromForm(formData: FormData) {
  const topicId = readRequiredField(formData, "topicId");
  const name = readOptionalField(formData, "topicName");
  const description = readOptionalField(formData, "topicDescription");

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is required to update topics.");
  }

  const {
    assertMembershipRole,
    ensureDefaultWorkspace,
    getPrismaClient,
    recordUsageEvent,
    updateTopic,
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

  await updateTopic(
    prisma,
    {
      organizationId: workspace.organizationId,
      topicId,
    },
    {
      ...(name ? { name } : {}),
      ...(description !== "" ? { description } : {}),
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
    ensureDefaultWorkspace,
    getPrismaClient,
    recordUsageEvent,
    updateTopicStatus,
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
    ensureDefaultWorkspace,
    getPrismaClient,
    recordUsageEvent,
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

export async function upsertAiCredentialAction(formData: FormData): Promise<void> {
  let message = "AI 凭证已更新。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to configure credentials.");
    }

    const apiKey = readRequiredField(formData, "aiApiKey");
    const baseUrl = readOptionalField(formData, "aiBaseUrl");
    const provider = readOptionalField(formData, "aiProvider");
    const model = readOptionalField(formData, "aiModel");

    if (baseUrl) {
      const parsed = new URL(baseUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("AI Base URL must be an HTTP or HTTPS URL.");
      }
    }

    const {
      assertMembershipRole,
      ensureDefaultWorkspace,
      getPrismaClient,
      recordUsageEvent,
      upsertAiCredential,
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

    const apiKey = readRequiredField(formData, "searchApiKey");
    const provider = readOptionalField(formData, "searchProvider");

    const {
      assertMembershipRole,
      ensureDefaultWorkspace,
      getPrismaClient,
      recordUsageEvent,
      upsertSearchCredential,
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
