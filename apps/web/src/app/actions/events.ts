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
import {
  type EnhancedFeedbackKind,
  ENHANCED_FEEDBACK_KIND_LABEL,
  ENHANCED_FEEDBACK_KIND_ORDER,
  getEnhancedFeedbackValue,
  isValidEnhancedFeedbackKind,
  shouldRecordCategoryPreference,
} from "./enhanced-feedback-kinds";

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

export async function markBriefingAsReadAction(
  formData: FormData,
): Promise<void> {
  // SPEC §5.5 / Plan Task 3.2 (#173): 按当日 Briefing snapshot 批量标记当前用户已读。
  // 复用 #172 UserItemState 隔离；不写 IntelligenceEvent.status；保留 saved；幂等。
  const briefingId = readRequiredField(formData, "briefingId");
  const returnTo = readSafeReturnPath(formData, "returnTo") ?? `/briefings`;
  let message = "简报内的事件已批量标记为已读。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to mark briefing as read.");
    }

    const {
      assertMembershipRole,
      getPrismaClient,
      markBriefingEventsRead,
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

    const result = await markBriefingEventsRead(prisma, {
      briefingId,
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    });

    if (result.changed > 0) {
      await refreshPreferenceMemory(prisma, workspace);
    }

    await recordUsageEvent(prisma, {
      metadata: {
        briefingId,
        changed: result.changed,
        skipped: result.skipped,
        source: "briefing-bulk-read",
      },
      organizationId: workspace.organizationId,
      quantity: result.changed,
      subjectId: briefingId,
      subjectType: "briefing",
      type: "WEB_ACTION",
      unit: "events-marked-read",
      userId: workspace.userId,
    });

    if (result.changed === 0) {
      message = "简报中没有需要标记的新事件。";
    }
  } catch (error) {
    logActionError("markBriefingAsReadAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/");
  revalidatePath(returnTo);
  redirect(actionRedirectHref(returnTo, type, message));
}

export async function regenerateEventSummaryAction(
  formData: FormData,
): Promise<void> {
  const eventId = readRequiredField(formData, "eventId");
  const returnTo =
    readSafeReturnPath(formData, "returnTo") ?? `/events/${eventId}`;
  let message = "已加入重新采集与摘要队列。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required to regenerate summary.");
    }

    const {
      assertMembershipRole,
      getPrismaClient,
    } = await import("@wangchao/db");
    const { getSessionWorkspace } = await import("@/lib/session");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();

    await assertMembershipRole(
      prisma,
      { organizationId: workspace.organizationId, userId: workspace.userId },
      ["OWNER", "ADMIN", "MEMBER"],
    );

    const event = await prisma.intelligenceEvent.findUnique({
      where: { id: eventId, organizationId: workspace.organizationId },
      include: {
        primaryItem: {
          select: {
            contentSource: true,
            id: true,
            rawContent: true,
          },
        },
      },
    });

    if (!event) {
      throw new Error("Event not found in this workspace.");
    }
    if (!event.primaryItem) {
      throw new Error("No primary item associated with this event.");
    }

    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    if (event.summaryRequestedAt && event.summaryRequestedAt > sixtySecondsAgo) {
      message = "刚刚已请求重新采集，请稍后再试。";
      type = "notice";
      revalidatePath(returnTo);
      redirect(actionRedirectHref(returnTo, type, message));
      return;
    }

    const canReuseEmbeddedMarkdown =
      event.primaryItem.contentSource === "RSS_EMBEDDED" &&
      Boolean(event.primaryItem.rawContent?.trim());

    await prisma.$transaction([
      prisma.item.update({
        where: { id: event.primaryItem.id },
        data: canReuseEmbeddedMarkdown
          ? {
              contentErrorCode: null,
              contentStatus: "READY",
              status: "FETCHED",
            }
          : {
              contentErrorCode: null,
              contentFetchedAt: null,
              contentSource: null,
              contentStatus: "PENDING",
              rawContent: null,
              status: "FETCHED",
            },
      }),
      prisma.intelligenceEvent.update({
        where: { id: event.id, organizationId: workspace.organizationId },
        data: {
          summary: "",
          summaryRequestedAt: new Date(),
          summaryStatus: "PENDING",
        },
      }),
    ]);
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
  // Issue #175 / SPEC §5.6: 详情页增强反馈入口（6 种 kind）。
  // 复用 #164 FeedbackKind + recordEnhancedFeedback；kind 白名单/VALUE/撤销语义走纯函数。
  const topicId = readRequiredField(formData, "topicId");
  const rawKind = readRequiredField(formData, "feedbackKind");
  const eventId = readOptionalField(formData, "eventId") || undefined;
  const sourceId = readOptionalField(formData, "sourceId") || undefined;
  const returnTo = readSafeReturnPath(formData, "returnTo") ?? "/";
  let message = "反馈已记录。";
  let type: ActionRedirectType = "notice";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("Database connection is required for feedback.");
    }

    if (!isValidEnhancedFeedbackKind(rawKind)) {
      throw new Error("Invalid feedback kind.");
    }
    const kind: EnhancedFeedbackKind = rawKind;

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

    // 明确绑定 event/source/topic，防双写：FeedbackEvent 主键 = 自增 id，
    // 这里每次提交一条记录，core generatePreferenceDeltas 按 dedupKey(topicId+key+feedbackEventId) 幂等归纳。
    await recordEnhancedFeedback(
      prisma,
      { organizationId: workspace.organizationId },
      {
        topicId,
        userId: workspace.userId,
        kind,
        eventId,
        sourceId,
        value: getEnhancedFeedbackValue(kind),
      },
    );

    // SCORE 类同时写 category preference（沿用 #164 路径，影响 category 权重）。
    if (shouldRecordCategoryPreference(kind) && eventId) {
      await recordCategoryPreferenceFeedback(prisma, {
        action: kind === "SCORE_UP" ? "up" : "down",
        eventId,
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      });
    }

    await refreshPreferenceMemory(prisma, workspace);

    message = `已记录「${ENHANCED_FEEDBACK_KIND_LABEL[kind]}」反馈。`;
  } catch (error) {
    logActionError("recordEnhancedFeedbackAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath(returnTo);
  revalidatePath("/preferences");
  redirect(actionRedirectHref(returnTo, type, message));
}
