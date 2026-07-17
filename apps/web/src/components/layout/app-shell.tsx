import type { ReactNode } from "react";
import { TopNav } from "@/components/layout/top-nav";
import { isAuthEnabled } from "@/lib/auth";
import { getSessionWorkspace } from "@/lib/session";

type NavRole = "OWNER" | "ADMIN" | "MEMBER" | null;

interface AppShellProps {
  children: ReactNode;
}

// Resolve the viewer's role for nav gating. On self-hosted (auth disabled)
// the default workspace is OWNER, so admin entries stay visible. When auth
// is enabled but there is no session (e.g. /login, /register) the call throws
// UNAUTHENTICATED and we surface role=null so the nav renders minimal.
async function resolveRole(authEnabled: boolean): Promise<NavRole> {
  if (!authEnabled) {
    return "OWNER";
  }
  try {
    const workspace = await getSessionWorkspace();
    return workspace.role;
  } catch {
    return null;
  }
}

export async function AppShell({ children }: AppShellProps) {
  const authEnabled = isAuthEnabled();
  const role = await resolveRole(authEnabled);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav authEnabled={authEnabled} role={role} />
      <main className="mx-auto flex w-full max-w-[920px] flex-1 flex-col gap-4 pb-8 pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] pt-7 sm:px-6">
        {children}
      </main>
    </div>
  );
}
