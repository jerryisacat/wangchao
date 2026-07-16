"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  type ActionRedirectType,
  actionRedirectHref,
  logActionError,
  readRequiredField,
  toUserActionError,
} from "./_shared";

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

    // Report status is PENDING - the dedicated report-cron Railway service
    // will pick it up and generate it, fully decoupled from the Web process.
  } catch (error) {
    logActionError("createReportAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/reports");
  redirect(actionRedirectHref("/reports", type, message));
}
