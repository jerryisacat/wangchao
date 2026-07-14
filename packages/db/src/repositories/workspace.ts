import type { PrismaClient } from "@prisma/client";
import { readRuntimeEnv } from "./util.js";
import type { WorkspaceSeed } from "./types.js";

const DEFAULT_ORGANIZATION_SLUG = "default";
const DEFAULT_OWNER_EMAIL = "admin@wangchao.local";

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
