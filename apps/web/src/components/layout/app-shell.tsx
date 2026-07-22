import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";

import { isAuthEnabled } from "@/lib/auth";
import {
  getSwitchableWorkspaces,
  hasAuthenticatedSession,
} from "@/lib/session";
import {
  REQUEST_PATHNAME_HEADER,
  resolveShellVariant,
} from "@/lib/web-routes";
import {
  ACTIVE_WORKSPACE_COOKIE,
  readActiveWorkspaceCookie,
} from "@/lib/workspace-switch";

interface AppShellProps {
  children: ReactNode;
}

export async function AppShell({ children }: AppShellProps) {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get(REQUEST_PATHNAME_HEADER) ?? "/app";
  const shellVariant = resolveShellVariant(pathname);
  const authEnabled = isAuthEnabled();

  if (shellVariant === "auth") {
    const { TopNav } = await import("@/components/layout/top-nav");
    return (
      <div className="flex min-h-screen flex-col" data-shell="auth">
        <TopNav />
        <main className="mx-auto flex w-full max-w-[920px] flex-1 flex-col gap-4 px-[max(16px,env(safe-area-inset-left))] pb-[calc(72px+env(safe-area-inset-bottom))] pt-4 pr-[max(16px,env(safe-area-inset-right))] sm:px-6 sm:pb-8 sm:pt-7">
          {children}
        </main>
      </div>
    );
  }

  if (shellVariant === "marketing") {
    const [{ MarketingNav }, { MarketingNoScriptFallback }] = await Promise.all([
      import("@/components/marketing/marketing-nav"),
      import("@/components/marketing/marketing-noscript-fallback"),
    ]);
    const hasWorkspaceAccess = await hasAuthenticatedSession();

    return (
      <div className="flex min-h-screen flex-col" data-shell="marketing">
        <MarketingNav hasWorkspaceAccess={hasWorkspaceAccess} />
        <main className="flex w-full flex-1 flex-col">
          {pathname === "/" ? (
            <MarketingNoScriptFallback hasWorkspaceAccess={hasWorkspaceAccess} />
          ) : null}
          {children}
        </main>
      </div>
    );
  }

  const memberships = authEnabled ? await getSwitchableWorkspaces() : [];
  const { TopNav } = await import("@/components/layout/top-nav");
  const cookieStore = await cookies();
  const cookieOrgId = readActiveWorkspaceCookie(
    cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value,
  );
  const activeOrganizationId =
    cookieOrgId ?? memberships[0]?.organizationId ?? "";

  return (
    <div className="flex min-h-screen flex-col" data-shell="product">
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
