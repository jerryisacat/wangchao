"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  type ActionRedirectType,
  type DatabaseClient,
  actionRedirectHref,
  logActionError,
  readCategoryPreferenceAction,
  readDashboardEventAction,
  readOptionalField,
  readRequiredField,
  readSafeReturnPath,
  toUserActionError,
} from "./_shared";

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
  if (action === "save" || action === "dismiss") {
    await refreshPreferenceMemory(prisma, workspace);
  }
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
