"use client";

import { Plus, Rss, Settings, Sparkles, List } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const mainLinks = [
  { href: "/", label: "未读情报" },
  { href: "/briefings", label: "今日简报" },
  { href: "/saved", label: "已保存" },
];

interface TopNavProps {
  className?: string;
}

export function TopNav({ className }: TopNavProps) {
  const pathname = usePathname();

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
            <Link href="/topics/new">
              <Plus aria-hidden="true" size={14} />
              <span>新增主题</span>
            </Link>
          </Button>
          <Button asChild className="top-nav-action" size="sm" variant="secondary">
            <Link href="/sources">
              <Rss aria-hidden="true" size={14} />
              <span>信源管理</span>
            </Link>
          </Button>
          <Button asChild className="top-nav-action" size="sm" variant="ghost" aria-label="主题管理">
            <Link href="/topics">
              <List aria-hidden="true" size={14} />
            </Link>
          </Button>
          <Button asChild className="top-nav-action" size="sm" variant="ghost" aria-label="管理设置">
            <Link href="/admin/settings">
              <Settings aria-hidden="true" size={14} />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
