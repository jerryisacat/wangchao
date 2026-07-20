"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  type ActionRedirectType,
  actionRedirectHref,
  logActionError,
  readRequiredField,
  toUserActionError,
} from "./_shared";
import {
  ACTIVE_WORKSPACE_COOKIE,
  ACTIVE_WORKSPACE_MAX_AGE,
} from "@/lib/workspace-switch";

/**
 * Issue #155 — 切换 active workspace。
 *
 * 设置 cookie 到用户指定的 organizationId，然后 revalidate 所有 workspace-scoped 页面。
 * 后端 session.ts 读 cookie 时会通过 resolveActiveWorkspace 验证 Membership 归属，
 * 所以即使 cookie 被篡改也不会越权。
 */
export async function setActiveWorkspaceAction(formData: FormData): Promise<void> {
  const organizationId = readRequiredField(formData, "organizationId");
  let message = "工作区已切换。";
  let type: ActionRedirectType = "notice";

  try {
    const { isAuthEnabled } = await import("@/lib/auth");
    if (!isAuthEnabled()) {
      throw new Error("WORKSPACE_SWITCH_REQUIRES_AUTH");
    }

    const { getAuth } = await import("@/lib/auth");
    const { getPrismaClient, listUserMemberships } = await import("@wangchao/db");
    const { headers } = await import("next/headers");

    const auth = await getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      throw new Error("UNAUTHENTICATED");
    }

    // 验证用户确实属于该 organization
    const prisma = getPrismaClient();
    const memberships = await listUserMemberships(prisma, {
      userId: session.user.id,
    });
    const target = memberships.find((m) => m.organizationId === organizationId);

    if (!target) {
      throw new Error("WORKSPACE_NOT_ACCESSIBLE");
    }

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, organizationId, {
      path: "/",
      maxAge: ACTIVE_WORKSPACE_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
    });
  } catch (error) {
    logActionError("setActiveWorkspaceAction", error);
    message = toUserActionError(error);
    type = "error";
  }

  revalidatePath("/", "layout");
  redirect(actionRedirectHref("/", type, message));
}
