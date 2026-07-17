"use client";

import {
  ClipboardList,
  CreditCard,
  Gauge,
  List,
  LogOut,
  MoreHorizontal,
  Plus,
  Rss,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type NavRole = "OWNER" | "ADMIN" | "MEMBER" | null;

const readingLinks = [
  { href: "/", label: "未读情报" },
  { href: "/briefings", label: "简报" },
  { href: "/reports", label: "报告" },
  { href: "/saved", label: "已保存" },
] as const;

const AUTH_ROUTES = ["/login", "/register"];

interface TopNavProps {
  authEnabled?: boolean;
  role?: NavRole;
  className?: string;
}

export function TopNav({ authEnabled = false, role = null, className }: TopNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  const isAdmin = role === "OWNER" || role === "ADMIN";

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await authClient.signOut();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const brand = (
    <Link
      aria-label="望潮首页"
      className="flex min-h-11 items-center gap-2.5 text-foreground"
      href="/"
    >
      <span className="grid size-9 place-items-center rounded-full bg-accent text-accent-foreground">
        <Sparkles aria-hidden="true" size={18} />
      </span>
      <span className="grid gap-0.5">
        <span className="text-base font-bold leading-none">望潮</span>
        <span className="font-mono text-[10px] uppercase leading-none text-muted-foreground">
          Wangchao
        </span>
      </span>
    </Link>
  );

  if (isAuthRoute) {
    return (
      <header
        className={cn(
          "sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md",
          className,
        )}
      >
        <div className="mx-auto flex min-h-14 max-w-[920px] items-center px-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] sm:px-6">
          {brand}
        </div>
      </header>
    );
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md",
        className,
      )}
    >
      <div className="mx-auto flex min-h-14 max-w-[920px] items-center gap-5 px-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] sm:px-6">
        {brand}

        <nav
          aria-label="主导航"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {readingLinks.map((link) => {
            const isActive =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition-colors duration-200",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-primary/5 hover:text-foreground",
                )}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm" variant="primary">
            <Link
              aria-current={pathname === "/topics/new" ? "page" : undefined}
              href="/topics/new"
            >
              <Plus aria-hidden="true" size={14} />
              <span>新增主题</span>
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="更多" size="icon" variant="ghost">
                <MoreHorizontal aria-hidden="true" size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>管理</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/topics">
                  <List aria-hidden="true" size={16} />
                  <span>主题列表</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/sources">
                  <Rss aria-hidden="true" size={16} />
                  <span>信源管理</span>
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuLabel>账户</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/preferences">
                  <Sparkles aria-hidden="true" size={16} />
                  <span>偏好记忆</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/usage">
                  <Gauge aria-hidden="true" size={16} />
                  <span>我的用量</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/pricing">
                  <CreditCard aria-hidden="true" size={16} />
                  <span>方案与定价</span>
                </Link>
              </DropdownMenuItem>

              {isAdmin ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>工作区</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/admin/settings">
                      <Settings aria-hidden="true" size={16} />
                      <span>工作区设置</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/admin/usage">
                      <ClipboardList aria-hidden="true" size={16} />
                      <span>用量审计</span>
                    </Link>
                  </DropdownMenuItem>
                </>
              ) : null}

              {authEnabled ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={loggingOut}
                    onSelect={(event) => {
                      event.preventDefault();
                      void handleLogout();
                    }}
                  >
                    <LogOut aria-hidden="true" size={16} />
                    <span>{loggingOut ? "正在登出" : "登出"}</span>
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
