"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
