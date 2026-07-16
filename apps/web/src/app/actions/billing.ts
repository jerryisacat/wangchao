"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  type ActionRedirectType,
  actionRedirectHref,
  logActionError,
  readOptionalField,
  toUserActionError,
} from "./_shared";

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
    if (enabled && !settings.hasTelegramCredential) throw new Error("INSTANT_PUSH_TELEGRAM_MISSING: 请先前往「管理 -> Telegram」配置机器人凭据后再开启即时推送。");
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
