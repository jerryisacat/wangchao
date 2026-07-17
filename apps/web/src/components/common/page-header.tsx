import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  children?: ReactNode;
  className?: string;
  eyebrow?: string;
  meta?: ReactNode;
  title: string;
}

export function PageHeader({
  children,
  className,
  eyebrow,
  meta,
  title,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "mb-1 flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-start md:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-xs font-medium tracking-[0.01em] text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="mt-1 [overflow-wrap:anywhere] text-[clamp(1.75rem,4vw,3rem)] leading-[1.1]">
          {title}
        </h1>
        {meta ? (
          <div className="mt-1.5 text-sm text-muted-foreground">{meta}</div>
        ) : null}
      </div>
      {children ? (
        <div className="flex w-full shrink-0 gap-2 md:w-auto">{children}</div>
      ) : null}
    </header>
  );
}
