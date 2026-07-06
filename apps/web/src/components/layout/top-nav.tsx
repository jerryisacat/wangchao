import { Plus, Rss, Sparkles } from "lucide-react";
import Link from "next/link";
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
  return (
    <header className={cn("top-nav", className)}>
      <div className="top-nav-inner">
        <Link aria-label="望潮首页" className="top-nav-brand" href="/">
          <span className="top-nav-brand-mark">
            <Sparkles aria-hidden="true" size={18} />
          </span>
          <span className="top-nav-brand-name">望潮</span>
          <span className="top-nav-brand-meta">Wangchao</span>
        </Link>

        <nav aria-label="主导航" className="top-nav-links">
          {mainLinks.map((link) => (
            <Link className="top-nav-link" href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="top-nav-actions">
          <Link className="ui-button ui-button-primary ui-button-sm" href="/topics/new">
            <Plus aria-hidden="true" size={14} />
            新增主题
          </Link>
          <Link className="ui-button ui-button-secondary ui-button-sm" href="/sources">
            <Rss aria-hidden="true" size={14} />
            信源管理
          </Link>
        </div>
      </div>
    </header>
  );
}
