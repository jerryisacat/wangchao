"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  type ActionRedirectType,
  actionRedirectHref,
  logActionError,
  readRequiredField,
  toUserActionError,
} from "./_shared";

/**
 * Issue #157 - Platform admin actions: account suspension & reactivation.
 *
 * Unified authorization gate:
 *   1. The actor must be authenticated (valid session).
 *   2. The actor must have PlatformAdmin role with sufficient privilege
 *      (PLATFORM_ADMIN or higher for suspend/reactivate).
 *   3. Every action writes an immutable AuditLog entry with before/after state.
 *   4. Suspension immediately revokes all sessions for the target user.
 *
 * These actions operate on user accounts globally - they are NOT workspace-scoped.
 */

// ─── Unified authorization gate ───────────────────────────────

export class PlatformAuthorizationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PlatformAuthorizationError";
    this.code = code;
  }
}

interface AuthenticatedActor {
  userId: string;
  email: string;
}

/**
 * Authenticate the current request and verify the actor has the required
 * platform admin role.
 *
 * Throws PlatformAuthorizationError with stable codes:
 *   - UNAUTHENTICATED: no valid session.
 *   - PLATFORM_ADMIN_REQUIRED: user is not a platform admin.
 *   - INSUFFICIENT_PLATFORM_ROLE: user's role is below the required level.
 */
export async function requirePlatformAdmin(
  requiredRole: "PLATFORM_OWNER" | "PLATFORM_ADMIN" | "PLATFORM_AUDITOR",
): Promise<AuthenticatedActor> {
  const { isAuthEnabled, getAuth } = await import("@/lib/auth");
  if (!isAuthEnabled()) {
    throw new PlatformAuthorizationError("UNAUTHENTICATED", "Authentication is not enabled.");
  }

  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    throw new PlatformAuthorizationError("UNAUTHENTICATED", "No valid session.");
  }

  const { getPrismaClient, hasPlatformRole } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const authorized = await hasPlatformRole(prisma, session.user.id, requiredRole);

  if (!authorized) {
    const { isPlatformAdmin } = await import("@wangchao/db");
    const isAdmin = await isPlatformAdmin(prisma, session.user.id);
    if (!isAdmin) {
      throw new PlatformAuthorizationError(
        "PLATFORM_ADMIN_REQUIRED",
        "Platform admin access required.",
      );
    }
    throw new PlatformAuthorizationError(
      "INSUFFICIENT_PLATFORM_ROLE",
      `This action requires ${requiredRole} or higher.`,
    );
  }

  return { userId: session.user.id, email: session.user.email };
}

// ─── Suspend user action ──────────────────────────────────────

export async function suspendUserAction(formData: FormData): Promise<void> {
  const targetUserId = readRequiredField(formData, "userId");
  const reason = readRequiredField(formData, "reason");
  let message = "用户已暂停。";
  let type: ActionRedirectType = "notice";

  try {
    const actor = await requirePlatformAdmin("PLATFORM_ADMIN");

    const {
      getPrismaClient,
      getUserLifecycleStatus,
      suspendUser,
      revokeUserSessions,
      createAuditLog,
    } = await import("@wangchao/db");

    const prisma = getPrismaClient();

    const before = await getUserLifecycleStatus(prisma, targetUserId);
    if (!before) {
      throw new Error("USER_NOT_FOUND");
    }

    await suspendUser(prisma, { userId: targetUserId, reason });

    const revoked = await revokeUserSessions(prisma, targetUserId);

    const after = await getUserLifecycleStatus(prisma, targetUserId);

    await createAuditLog(prisma, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.userId,
      action: "USER_SUSPENDED",
      targetType: "User",
      targetId: targetUserId,
      reason,
      before: { accountStatus: before.accountStatus },
      after: { accountStatus: after?.accountStatus ?? "SUSPENDED" },
    });

    message = `用户已暂停，已吊销 ${revoked.revokedCount} 个会话。`;
  } catch (error) {
    logActionError("suspendUserAction", error);
    type = "error";
    message = toPlatformActionError(error);
  }

  revalidatePath("/admin/users");
  redirect(actionRedirectHref("/admin/users", type, message));
}

// ─── Reactivate user action ───────────────────────────────────

export async function reactivateUserAction(formData: FormData): Promise<void> {
  const targetUserId = readRequiredField(formData, "userId");
  let message = "用户已恢复。";
  let type: ActionRedirectType = "notice";

  try {
    const actor = await requirePlatformAdmin("PLATFORM_ADMIN");

    const {
      getPrismaClient,
      getUserLifecycleStatus,
      reactivateUser,
      createAuditLog,
    } = await import("@wangchao/db");

    const prisma = getPrismaClient();

    const before = await getUserLifecycleStatus(prisma, targetUserId);
    if (!before) {
      throw new Error("USER_NOT_FOUND");
    }

    await reactivateUser(prisma, targetUserId);

    const after = await getUserLifecycleStatus(prisma, targetUserId);

    await createAuditLog(prisma, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.userId,
      action: "USER_REACTIVATED",
      targetType: "User",
      targetId: targetUserId,
      before: { accountStatus: before.accountStatus },
      after: { accountStatus: after?.accountStatus ?? "ACTIVE" },
    });

    message = "用户已恢复，可重新登录。";
  } catch (error) {
    logActionError("reactivateUserAction", error);
    type = "error";
    message = toPlatformActionError(error);
  }

  revalidatePath("/admin/users");
  redirect(actionRedirectHref("/admin/users", type, message));
}

// ─── Revoke sessions action ───────────────────────────────────

export async function revokeUserSessionsAction(formData: FormData): Promise<void> {
  const targetUserId = readRequiredField(formData, "userId");
  const reason = readRequiredField(formData, "reason");
  let message = "会话已吊销。";
  let type: ActionRedirectType = "notice";

  try {
    const actor = await requirePlatformAdmin("PLATFORM_ADMIN");

    const { getPrismaClient, revokeUserSessions, createAuditLog } = await import("@wangchao/db");
    const prisma = getPrismaClient();

    const result = await revokeUserSessions(prisma, targetUserId);

    await createAuditLog(prisma, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.userId,
      action: "USER_SESSIONS_REVOKED",
      targetType: "User",
      targetId: targetUserId,
      reason,
      after: { revokedCount: result.revokedCount },
    });

    message = `已吊销 ${result.revokedCount} 个会话。`;
  } catch (error) {
    logActionError("revokeUserSessionsAction", error);
    type = "error";
    message = toPlatformActionError(error);
  }

  revalidatePath("/admin/users");
  redirect(actionRedirectHref("/admin/users", type, message));
}

// ─── Helpers ──────────────────────────────────────────────────

function toPlatformActionError(error: unknown): string {
  if (error instanceof PlatformAuthorizationError) {
    switch (error.code) {
      case "UNAUTHENTICATED":
        return "登录状态已失效，请刷新页面重新登录后再操作。";
      case "PLATFORM_ADMIN_REQUIRED":
        return "需要平台管理员权限。";
      case "INSUFFICIENT_PLATFORM_ROLE":
        return "当前平台角色不足以执行此操作。";
    }
  }

  if (error instanceof Error) {
    const msg = error.message;
    if (msg === "USER_NOT_FOUND") {
      return "目标用户不存在。";
    }
  }

  return toUserActionError(error);
}
