import type { ReactNode } from "react";
import { TopNav } from "@/components/layout/top-nav";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell-v2">
      <TopNav />
      <main className="app-main">{children}</main>
    </div>
  );
}
