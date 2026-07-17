import { headers } from "next/headers";
import type { WorkspaceSeed } from "@wangchao/db";
import { UNAUTHENTICATED_ERROR } from "@/lib/auth-access";
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
  const { ensureUserWorkspace, getPrismaClient } = await import("@wangchao/db");

  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error(UNAUTHENTICATED_ERROR);
  }

  const prisma = getPrismaClient();
  return ensureUserWorkspace(prisma, {
    email: session.user.email,
    name: session.user.name,
    userId: session.user.id,
  });
}
