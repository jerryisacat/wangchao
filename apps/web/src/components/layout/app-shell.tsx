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
    <div className="app-shell-v2">
      <TopNav
        authEnabled={authEnabled}
        memberships={memberships}
        activeOrganizationId={activeOrganizationId}
      />
      <main className="app-main">{children}</main>
    </div>
  );
}