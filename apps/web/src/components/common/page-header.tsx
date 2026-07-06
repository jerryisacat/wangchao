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
    <header className={cn("page-header", className)}>
      <div className="page-header-main">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {meta ? <div className="page-header-meta">{meta}</div> : null}
      </div>
      {children ? <div className="page-header-actions">{children}</div> : null}
    </header>
  );
}
