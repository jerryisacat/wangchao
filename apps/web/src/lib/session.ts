import { cookies, headers } from "next/headers";
import type { WorkspaceSeed } from "@wangchao/db";
import { UNAUTHENTICATED_ERROR } from "@/lib/auth-access";
import { isAuthEnabled } from "@/lib/auth";
import {
  ACTIVE_WORKSPACE_COOKIE,
  readActiveWorkspaceCookie,
} from "@/lib/workspace-switch";

export async function getSessionWorkspace(): Promise<WorkspaceSeed> {
  const authEnabled = isAuthEnabled();

  if (!authEnabled) {
    const { ensureDefaultWorkspace, getPrismaClient } = await import(
      "@wangchao/db"
    );
    const prisma = getPrismaClient();
    return ensureDefaultWorkspace(prisma);
  }

  const { getAuth } = await import("@/lib/auth");
  const {
    ensureUserWorkspace,
    getPrismaClient,
    resolveActiveWorkspace,
  } = await import("@wangchao/db");

  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error(UNAUTHENTICATED_ERROR);
  }

  const prisma = getPrismaClient();

  // Issue #155: auth 模式下读 cookie 决定 active workspace
  const cookieStore = await cookies();
  const preferredOrgId = readActiveWorkspaceCookie(
    cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value,
  );

  const resolved = await resolveActiveWorkspace(prisma, {
    userId: session.user.id,
    preferredOrganizationId: preferredOrgId,
  });

  if (resolved) {
    return {
      organizationId: resolved.organizationId,
      organizationName: resolved.organizationName,
      organizationSlug: resolved.organizationSlug,
      role: resolved.role,
      userEmail: session.user.email,
      userId: session.user.id,
    };
  }

  // 无 Membership → ensure workspace（保持原有行为）
  return ensureUserWorkspace(prisma, {
    email: session.user.email,
    name: session.user.name,
    userId: session.user.id,
  });
}

/**
 * Issue #155 — 返回当前用户可切换的所有工作区列表。
 * 仅 auth 模式下有意义；无 auth 返回空数组。
 */
export async function getSwitchableWorkspaces() {
  const authEnabled = isAuthEnabled();
  if (!authEnabled) {
    return [];
  }

  const { getAuth } = await import("@/lib/auth");
  const { getPrismaClient, listUserMemberships } = await import("@wangchao/db");

  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return [];
  }

  const prisma = getPrismaClient();
  return listUserMemberships(prisma, { userId: session.user.id });
}
