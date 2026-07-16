"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  type ActionRedirectType,
  actionRedirectHref,
  logActionError,
  readOptionalField,
  readRequiredField,
  toUserActionError,
} from "./_shared";

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
