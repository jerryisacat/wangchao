import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { TopNav } from "@/components/layout/top-nav";
import { isAuthEnabled } from "@/lib/auth";
import { getSwitchableWorkspaces } from "@/lib/session";
import {
  ACTIVE_WORKSPACE_COOKIE,
  readActiveWorkspaceCookie,
} from "@/lib/workspace-switch";

interface AppShellProps {
  children: ReactNode;
}

export async function AppShell({ children }: AppShellProps) {
  const authEnabled = isAuthEnabled();
  const memberships = authEnabled ? await getSwitchableWorkspaces() : [];

  // Issue #155: 读 cookie 确定 active workspace 高亮
  const cookieStore = await cookies();
  const cookieOrgId = readActiveWorkspaceCookie(
    cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value,
  );
  const activeOrganizationId =
    cookieOrgId ?? memberships[0]?.organizationId ?? "";

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav
        authEnabled={authEnabled}
        memberships={memberships}
        activeOrganizationId={activeOrganizationId}
      />
      <main className="mx-auto flex w-full max-w-[920px] flex-1 flex-col gap-4 px-[max(16px,env(safe-area-inset-left))] pb-[calc(72px+env(safe-area-inset-bottom))] pt-4 pr-[max(16px,env(safe-area-inset-right))] sm:px-6 sm:pb-8 sm:pt-7">
        {children}
      </main>
    </div>
  );
}
