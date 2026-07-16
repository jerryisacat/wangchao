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
