import type { ReactNode } from "react";
import { TopNav } from "@/components/layout/top-nav";
import { isAuthEnabled } from "@/lib/auth";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell-v2">
      <TopNav authEnabled={isAuthEnabled()} />
      <main className="app-main">{children}</main>
    </div>
  );
}
