"use client";

import { LogOut, Plus, Rss, Settings, Sparkles, List, FileSearch } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const mainLinks = [
  { href: "/", label: "未读情报" },
  { href: "/briefings", label: "今日简报" },
  { href: "/reports", label: "专题报告" },
  { href: "/saved", label: "已保存" },
  { href: "/preferences", label: "偏好" },
  { href: "/usage", label: "用量" },
] as const;

interface TopNavProps {
  authEnabled?: boolean;
  className?: string;
}

export function TopNav({ authEnabled = false, className }: TopNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await authClient.signOut();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className={cn("top-nav", className)}>
      <div className="top-nav-inner">
        <Link aria-label="望潮首页" className="top-nav-brand" href="/">
          <span className="top-nav-brand-mark">
            <Sparkles aria-hidden="true" size={18} />
          </span>
          <span className="top-nav-brand-copy">
            <span className="top-nav-brand-name">望潮</span>
            <span className="top-nav-brand-meta">Wangchao</span>
          </span>
        </Link>

        <nav aria-label="主导航" className="top-nav-links">
          {mainLinks.map((link) => {
            const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className="top-nav-link"
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="top-nav-actions">
          <Button asChild className="top-nav-action" size="sm" variant="primary">
            <Link
              aria-current={pathname === "/topics/new" ? "page" : undefined}
              href="/topics/new"
            >
              <Plus aria-hidden="true" size={14} />
              <span>新增主题</span>
            </Link>
          </Button>
          <Button asChild className="top-nav-action" size="sm" variant="secondary">
            <Link
              aria-current={pathname.startsWith("/sources") ? "page" : undefined}
              href="/sources"
            >
              <Rss aria-hidden="true" size={14} />
              <span>信源管理</span>
            </Link>
          </Button>
          <Button asChild className="top-nav-action" size="sm" variant="ghost">
            <Link
              aria-current={
                pathname.startsWith("/topics") && pathname !== "/topics/new"
                  ? "page"
                  : undefined
              }
              href="/topics"
            >
              <List aria-hidden="true" size={14} />
              <span>主题</span>
            </Link>
          </Button>
          <Button asChild className="top-nav-action" size="sm" variant="ghost">
            <Link
              aria-current={pathname.startsWith("/admin") ? "page" : undefined}
              href="/admin/settings"
            >
              <Settings aria-hidden="true" size={14} />
              <span>设置</span>
            </Link>
          </Button>
          {authEnabled ? (
            <Button
              aria-label="登出"
              className="top-nav-action"
              disabled={loggingOut}
              onClick={handleLogout}
              size="sm"
              variant="ghost"
            >
              <LogOut aria-hidden="true" size={14} />
              <span>{loggingOut ? "…" : "登出"}</span>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
