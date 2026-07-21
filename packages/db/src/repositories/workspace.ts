import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { readRuntimeEnv } from "./util.js";
import type {
  ResolvedWorkspace,
  UserMembershipSummary,
  WorkspaceSeed,
} from "./types.js";

const DEFAULT_ORGANIZATION_SLUG = "default";
const DEFAULT_OWNER_EMAIL = "admin@wangchao.local";

export interface EnsureUserWorkspaceInput {
  email: string;
  name?: string | null;
  userId: string;
}

export async function ensureUserWorkspace(
  prisma: PrismaClient,
  input: EnsureUserWorkspaceInput,
): Promise<WorkspaceSeed> {
  const slug = buildUserWorkspaceSlug(input.userId);
  const displayName = input.name?.trim() || input.email;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.membership.findFirst({
      where: { userId: input.userId },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    if (existing) {
      return toWorkspaceSeed(existing.organization, existing.role, input);
    }

    const organization = await tx.organization.upsert({
      where: { slug },
      update: {},
      create: { name: `${displayName} 的工作区`, slug },
    });
    const membership = await tx.membership.upsert({
      where: {
        organizationId_userId: { organizationId: organization.id, userId: input.userId },
      },
      update: {},
      create: { organizationId: organization.id, userId: input.userId, role: "OWNER" },
    });
    return toWorkspaceSeed(organization, membership.role, input);
  });
}

function buildUserWorkspaceSlug(userId: string): string {
  const digest = createHash("sha256").update(userId).digest("hex").slice(0, 24);
  return `user-${digest}`;
}

function toWorkspaceSeed(
  organization: { id: string; name: string; slug: string },
  role: WorkspaceSeed["role"],
  input: EnsureUserWorkspaceInput,
): WorkspaceSeed {
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    role,
    userEmail: input.email,
    userId: input.userId,
  };
}

export async function ensureDefaultWorkspace(
  prisma: PrismaClient,
): Promise<WorkspaceSeed> {
  const organizationSlug =
    readRuntimeEnv("WANGCHAO_DEFAULT_ORGANIZATION_SLUG") ??
    DEFAULT_ORGANIZATION_SLUG;
  const organizationName =
    readRuntimeEnv("WANGCHAO_DEFAULT_ORGANIZATION_NAME") ??
    "个人工作区";
  const ownerEmail =
    readRuntimeEnv("WANGCHAO_DEFAULT_USER_EMAIL") ?? DEFAULT_OWNER_EMAIL;
  const ownerName = readRuntimeEnv("WANGCHAO_DEFAULT_USER_NAME") ?? "个人用户";

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.upsert({
      where: { slug: organizationSlug },
      update: {},
      create: {
        name: organizationName,
        slug: organizationSlug,
      },
    });

    const user = await tx.user.upsert({
      where: { email: ownerEmail },
      update: {},
      create: {
        email: ownerEmail,
        name: ownerName,
      },
    });

    const membership = await tx.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      update: { role: "OWNER" },
      create: {
        organizationId: organization.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    return {
      organizationId: organization.id,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      role: membership.role,
      userEmail: user.email,
      userId: user.id,
    };
  });
}

export interface WorkerWorkspaceActor {
  organizationId: string;
  userId: string;
}

export async function listEligibleWorkerWorkspaces(
  prisma: PrismaClient,
): Promise<WorkerWorkspaceActor[]> {
  const organizations = await prisma.organization.findMany({
    where: {
      memberships: { some: { user: { accountStatus: "ACTIVE" } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      memberships: {
        where: { user: { accountStatus: "ACTIVE" } },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { userId: true },
        take: 1,
      },
    },
  });
  return organizations.flatMap((organization) => {
    const actor = organization.memberships[0];
    return actor
      ? [{ organizationId: organization.id, userId: actor.userId }]
      : [];
  });
}

// ---------------------------------------------------------------------------
// Issue #155 — 工作区切换与 active workspace 解析
// ---------------------------------------------------------------------------

/**
 * 列出用户的所有 Membership（含 Organization 信息），按 createdAt asc 排序。
 * 用于工作区切换 UI 展示用户可访问的所有工作区。
 */
export async function listUserMemberships(
  prisma: PrismaClient,
  scope: { userId: string },
): Promise<UserMembershipSummary[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId: scope.userId },
    include: {
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return memberships.map((membership) => ({
    organizationId: membership.organization.id,
    organizationName: membership.organization.name,
    organizationSlug: membership.organization.slug,
    role: membership.role,
  }));
}

/**
 * 解析当前用户的 active workspace。
 *
 * 逻辑：
 * 1. 如果 preferredOrganizationId 指向的 org 在用户 Membership 列表中，返回它。
 * 2. 否则 fallback 到第一个 Membership（保持原有行为）。
 * 3. 用户无 Membership → 返回 null（由上层 ensureUserWorkspace 创建）。
 *
 * 不改 schema：active workspace ID 通过 HTTP cookie 传递（见 lib/workspace-switch.ts）。
 */
export async function resolveActiveWorkspace(
  prisma: PrismaClient,
  input: { userId: string; preferredOrganizationId: string | null },
): Promise<ResolvedWorkspace | null> {
  const memberships = await listUserMemberships(prisma, { userId: input.userId });

  if (memberships.length === 0) {
    return null;
  }

  const preferred =
    input.preferredOrganizationId !== null
      ? memberships.find(
          (m) => m.organizationId === input.preferredOrganizationId,
        )
      : undefined;

  const active = preferred ?? memberships[0]!;

  return {
    organizationId: active.organizationId,
    organizationName: active.organizationName,
    organizationSlug: active.organizationSlug,
    role: active.role,
  };
}
