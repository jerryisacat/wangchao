"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  type ActionRedirectType,
  actionRedirectHref,
  logActionError,
  readOptionalField,
  readRequiredField,
  readRequiredUrl,
  readSourceGovernanceAction,
  toUserActionError,
} from "./_shared";

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
  const { checkSourceQuota, resolveEffectivePlanFromView } = await import("@wangchao/core");
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
  const sourceQuota = checkSourceQuota(resolveEffectivePlanFromView(subscription), sourceCount, subscription.isSelfHosted);
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
    enqueueTaskRun,
    getPrismaClient,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
  const { buildManualTaskRunIdempotencyKey } = await import(
    "@/lib/task-run-enqueue"
  );
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

  await enqueueTaskRun(prisma, {
    organizationId: workspace.organizationId,
    type: "SOURCE_DISCOVERY",
    input: { mode: "manual", userId: workspace.userId },
    maxAttempts: 3,
    idempotencyKey: buildManualTaskRunIdempotencyKey({
      type: "SOURCE_DISCOVERY",
      userId: workspace.userId,
    }),
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
    enqueueTaskRun,
    getPrismaClient,
  } = await import("@wangchao/db");
  const { getSessionWorkspace } = await import("@/lib/session");
  const { buildManualTaskRunIdempotencyKey } = await import(
    "@/lib/task-run-enqueue"
  );
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

  await enqueueTaskRun(prisma, {
    organizationId: workspace.organizationId,
    type: "SOURCE_FETCH",
    input: { mode: "manual", userId: workspace.userId },
    maxAttempts: 3,
    idempotencyKey: buildManualTaskRunIdempotencyKey({
      type: "SOURCE_FETCH",
      userId: workspace.userId,
    }),
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
