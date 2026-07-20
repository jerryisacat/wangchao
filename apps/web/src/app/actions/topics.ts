"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import seedSourcePack from "../../../../../packages/db/seed-sources.json";
import {
  type ActionRedirectType,
  actionRedirectHref,
  logActionError,
  matchSourcePackCandidates,
  readOptionalField,
  readPositiveInteger,
  readProfileListField,
  readRequiredField,
  readRequiredUrl,
  readSafeReturnPath,
  toUserActionError,
  validateEnumValue,
  readJsonRecord,
  withTimeout,
} from "./_shared";
import { readPositiveIntegerEnv } from "@wangchao/core";

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
    reserveSourceSlot,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
  const { buildTopicProfile, checkTopicQuota, PLAN_LIMITS, resolveEffectivePlanFromView } = await import("@wangchao/core");
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
  const effectivePlan = resolveEffectivePlanFromView(subscription);
  const topicCount = await getTopicCount(prisma, { organizationId: workspace.organizationId });
  const quota = checkTopicQuota(effectivePlan, topicCount, subscription.isSelfHosted);
  if (!quota.allowed) throw new Error(quota.reason ?? "Topic limit reached.");

  // Issue #181: Reserve a source slot for the first candidate this topic will create.
  const sourceLimit = subscription.isSelfHosted ? null : PLAN_LIMITS[effectivePlan].maxSources;
  const reservation = await reserveSourceSlot(
    prisma,
    { organizationId: workspace.organizationId },
    sourceLimit,
  );
  if (!reservation.reserved) {
    throw new Error("Source limit reached — cannot create a new topic with candidate sources.");
  }

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
    getPrismaClient,
    getSubscriptionPlanView,
    getTopicCount,
    reserveSourceSlot,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
  const { checkSourceQuota, checkTopicQuota, PLAN_LIMITS, resolveEffectivePlanFromView } = await import("@wangchao/core");
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
  const effectivePlan = resolveEffectivePlanFromView(subscription);
  const topicCount = await getTopicCount(prisma, { organizationId: workspace.organizationId });
  const topicQuota = checkTopicQuota(effectivePlan, topicCount, subscription.isSelfHosted);
  if (!topicQuota.allowed) throw new Error(topicQuota.reason ?? "Topic limit reached.");

  // Issue #181: Atomic reserve prevents concurrent over-selling.
  // Issue #181: CANDIDATE sources now count toward quota (not just ACTIVE).
  const sourceLimit = subscription.isSelfHosted ? null : PLAN_LIMITS[effectivePlan].maxSources;
  const reservation = await reserveSourceSlot(
    prisma,
    { organizationId: workspace.organizationId },
    sourceLimit,
  );
  if (!reservation.reserved) {
    const sourceQuota = checkSourceQuota(effectivePlan, reservation.currentCount, subscription.isSelfHosted);
    throw new Error(sourceQuota.reason ?? "Source limit reached.");
  }

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
          outputLanguage: "zh-CN",
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

const TOPIC_DRAFT_COOKIE = "wc_topic_draft";
const TOPIC_DRAFT_COOKIE_MAX_AGE_SECONDS = 15 * 60;

/**
 * Step 1 of the topic-creation flow: turn the natural-language goal into a
 * versioned TopicProfileDraft and hand it to the preview page via a short-lived
 * httpOnly cookie. Nothing is persisted until the user confirms.
 *
 * AI is attempted when credentials are configured; on any failure (no creds,
 * quota blocked, upstream error, malformed JSON) we fall back to the
 * deterministic rules-based draft and surface the mode in the payload so the UI
 * can tell the user what they are reviewing.
 */
export async function generateTopicDraftAction(formData: FormData): Promise<void> {
  const name = readRequiredField(formData, "topicName");
  const description = readOptionalField(formData, "topicDescription");

  if (name.length > 120 || description.length > 2_000) {
    redirect(
      actionRedirectHref(
        "/topics/new",
        "error",
        "主题名称或描述过长，请精简后重试。",
      ),
    );
    return;
  }

  const { fallbackTopicProfileDraft, generateTopicProfileDraft } = await import(
    "@wangchao/ai"
  );
  const { cookies } = await import("next/headers");

  let draft;
  const runtime = await resolveTopicDraftAiRuntime();
  if (runtime) {
    try {
      draft = await generateTopicProfileDraft(
        { description, name },
        { adapter: runtime.adapter, model: runtime.model },
      );
    } catch (error) {
      logActionError("generateTopicDraftAction", error);
      draft = fallbackTopicProfileDraft({ description, name });
    }
  } else {
    draft = fallbackTopicProfileDraft({ description, name });
  }

  const cookieStore = await cookies();
  cookieStore.set(
    TOPIC_DRAFT_COOKIE,
    JSON.stringify({ draft, description }),
    {
      httpOnly: true,
      sameSite: "lax",
      maxAge: TOPIC_DRAFT_COOKIE_MAX_AGE_SECONDS,
      path: "/topics/new",
    },
  );

  redirect("/topics/new/preview");
}

/**
 * Step 2 of the topic-creation flow: the user has reviewed and possibly edited
 * the draft. We re-validate the submitted JSON through the same parser (so an
 * edited draft still has to satisfy the schema), then run the real create +
 * candidate-discovery path. Only this action writes Topic/Source rows.
 */
export async function confirmCreateTopicAction(formData: FormData): Promise<void> {
  let message = "主题已创建。";
  let type: ActionRedirectType = "notice";

  try {
    const result = await createTopicFromConfirmedDraft(formData);
    message =
      result.candidateCount > 0
        ? `主题已创建，自动匹配到 ${result.candidateCount} 个候选信源。`
        : "主题已创建，暂未发现可验证候选信源。你可以在信源管理页继续发现新源。";
  } catch (error) {
    logActionError("confirmCreateTopicAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.delete(TOPIC_DRAFT_COOKIE);

  revalidatePath("/");
  revalidatePath("/sources");
  redirect(actionRedirectHref("/sources", type, message));
}

async function createTopicFromConfirmedDraft(formData: FormData) {
  const draftJson = readRequiredField(formData, "topicDraftJson");
  const description = readOptionalField(formData, "topicDescription");

  const { parseTopicProfileDraftResponse } = await import("@wangchao/ai");
  let draft;
  try {
    draft = parseTopicProfileDraftResponse(draftJson);
  } catch {
    throw new Error("主题草案格式不正确，请返回重新生成后再确认。");
  }

  const name = draft.name;

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
    reserveSourceSlot,
    recordUsageEvent,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
  const { checkTopicQuota, PLAN_LIMITS, resolveEffectivePlanFromView } = await import("@wangchao/core");
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

  const subscription = await getSubscriptionPlanView(prisma, {
    organizationId: workspace.organizationId,
  });
  const effectivePlan = resolveEffectivePlanFromView(subscription);
  const topicCount = await getTopicCount(prisma, {
    organizationId: workspace.organizationId,
  });
  const quota = checkTopicQuota(
    effectivePlan,
    topicCount,
    subscription.isSelfHosted,
  );
  if (!quota.allowed) throw new Error(quota.reason ?? "Topic limit reached.");

  // Issue #181: Reserve a source slot for the first candidate this topic will create.
  const sourceLimit = subscription.isSelfHosted ? null : PLAN_LIMITS[effectivePlan].maxSources;
  const reservation = await reserveSourceSlot(
    prisma,
    { organizationId: workspace.organizationId },
    sourceLimit,
  );
  if (!reservation.reserved) {
    throw new Error("Source limit reached — cannot create a new topic with candidate sources.");
  }

  // The persisted profile keeps the sanitised draft fields plus a `source`
  // marker so downstream tooling (worker, observability) can tell a confirmed
  // draft-generated profile apart from a manually edited one. Schema-version
  // and generation metadata stay on the draft, not on the stored profile.
  const profile = {
    keywords: draft.keywords,
    entities: draft.entities,
    includeScope: draft.includeScope,
    excludeScope: draft.excludeScope,
    importanceRules: draft.importanceRules,
    languagePreferences: draft.languagePreferences,
    digestStyle: draft.digestStyle,
    source: "topic-profile-generator" as const,
  };

  const topic = await createTopic(
    prisma,
    { organizationId: workspace.organizationId },
    {
      description,
      name,
      ownerUserId: workspace.userId,
      profile,
    },
  );

  const candidates = matchSourcePackCandidates({
    description,
    limit: readPositiveIntegerFromCore("WANGCHAO_TOPIC_CREATE_SOURCE_LIMIT", 3),
    name,
    profileKeywords: profile.keywords,
    sourcePack: seedSourcePack,
  });
  const feedTimeoutMs = readPositiveIntegerFromCore(
    "WANGCHAO_TOPIC_CREATE_FEED_TIMEOUT_MS",
    2_000,
  );
  const candidateResults = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const validation = await withTimeout(
          validateRssFeedUrl(candidate.url, { timeoutMs: feedTimeoutMs }),
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
      draftGenerationMode: "generationMode" in draft ? draft.generationMode : "unknown",
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

function readPositiveIntegerFromCore(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

interface ResolvedTopicDraftAiRuntime {
  adapter: {
    chat(request: {
      jsonMode?: boolean;
      maxTokens?: number;
      messages: Array<{ role: string; content: string }>;
      model: string;
      temperature?: number;
    }): Promise<{ content: string; raw?: unknown }>;
  };
  model: string;
}

/**
 * Resolve an OpenAI-compatible adapter + model for draft generation, mirroring
 * the worker's credential resolution order: org AI credential → BYOK → env.
 * Returns null when no AI is configured, which the caller turns into a rules
 * fallback. Quota checks are intentionally NOT applied here — draft generation
 * is a single cheap call and the user is actively waiting; the analysis worker
 * remains the authoritative quota gate for batch work.
 */
async function resolveTopicDraftAiRuntime(): Promise<ResolvedTopicDraftAiRuntime | null> {
  const { getSessionWorkspace } = await import("@/lib/session");
  const { getDecryptedCredentials, getDecryptedByokCredential, getPrismaClient } =
    await import("@wangchao/db");
  const { createOpenAiCompatibleAdapter } = await import("@wangchao/ai");

  let organizationId: string | null = null;
  try {
    const workspace = await getSessionWorkspace();
    organizationId = workspace.organizationId;
  } catch {
    // No session (e.g. self-hosted without auth bootstrapped) → fall through to env.
  }

  if (organizationId) {
    const prisma = getPrismaClient();
    const creds = await getDecryptedCredentials(prisma, { organizationId });
    if (creds?.ai?.apiKey && creds.ai.baseUrl) {
      return {
        adapter: createOpenAiCompatibleAdapter({
          apiKey: creds.ai.apiKey,
          baseUrl: creds.ai.baseUrl,
        }),
        model: creds.ai.model,
      };
    }
    const byok = await getDecryptedByokCredential(prisma, { organizationId });
    if (byok?.apiKey && byok.baseUrl) {
      return {
        adapter: createOpenAiCompatibleAdapter({
          apiKey: byok.apiKey,
          baseUrl: byok.baseUrl,
        }),
        model: byok.model,
      };
    }
  }

  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  if (!apiKey || !baseUrl) return null;
  return {
    adapter: createOpenAiCompatibleAdapter({ apiKey, baseUrl }),
    model: process.env.AI_MODEL_L1 ?? "gpt-4o-mini",
  };
}
