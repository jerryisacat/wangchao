import { headers } from "next/headers";
import type { WorkspaceSeed } from "@wangchao/db";
import { isAuthEnabled } from "@/lib/auth";

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
  const { getPrismaClient } = await import("@wangchao/db");

  const session = await getAuth().api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }

  const prisma = getPrismaClient();
  const userId = session.user.id;

  const membership = await prisma.membership.findFirst({
    where: { userId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (membership) {
    return {
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      organizationSlug: membership.organization.slug,
      role: membership.role,
      userEmail: session.user.email,
      userId,
    };
  }

  const slug = userId.slice(-12).toLowerCase();
  const organization = await prisma.organization.create({
    data: {
      name: `${session.user.name ?? session.user.email} 的工作区`,
      slug,
    },
  });
  await prisma.membership.create({
    data: {
      organizationId: organization.id,
      userId,
      role: "OWNER",
    },
  });

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    role: "OWNER" as const,
    userEmail: session.user.email,
    userId,
  };
}
