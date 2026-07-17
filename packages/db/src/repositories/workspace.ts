import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { readRuntimeEnv } from "./util.js";
import type { WorkspaceSeed } from "./types.js";

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
