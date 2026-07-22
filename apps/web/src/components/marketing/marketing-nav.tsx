import { ArrowRight, Github, Waves } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface MarketingNavProps {
  hasWorkspaceAccess: boolean;
}

export function MarketingNav({ hasWorkspaceAccess }: MarketingNavProps) {
  const primaryHref = hasWorkspaceAccess ? "/app" : "/register?next=%2Ftopics%2Fnew";
  const primaryLabel = hasWorkspaceAccess ? "进入工作台" : "免费开始";

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/88 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 w-full max-w-[1200px] items-center gap-3 px-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] sm:px-6 lg:px-8">
        <Link
          className="group flex min-h-11 shrink-0 items-center gap-3 text-foreground"
          href="/"
          prefetch={false}
        >
          <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] group-hover:rotate-6">
            <Waves aria-hidden="true" size={19} strokeWidth={2.2} />
          </span>
          <span className="grid gap-0.5">
            <span className="text-[17px] font-bold leading-none tracking-tight">望潮</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
              Wangchao
            </span>
          </span>
        </Link>

        <nav
          aria-label="营销导航"
          className="ml-auto hidden items-center gap-1 md:flex"
        >
          <Link
            className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/5 hover:text-foreground"
            href="/#capabilities"
            prefetch={false}
          >
            产品能力
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/5 hover:text-foreground"
            href="/pricing"
            prefetch={false}
          >
            定价
          </Link>
          <a
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/5 hover:text-foreground"
            href="https://github.com/jerryisacat/wangchao"
            rel="noreferrer"
            target="_blank"
          >
            <Github aria-hidden="true" size={15} />
            GitHub
          </a>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-2">
          {!hasWorkspaceAccess ? (
            <Button asChild className="hidden sm:inline-flex" size="sm" variant="ghost">
              <Link href="/login?next=%2Fapp" prefetch={false}>登录</Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="primary">
            <Link href={primaryHref} prefetch={false}>
              <span>{primaryLabel}</span>
              <ArrowRight aria-hidden="true" size={14} />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
