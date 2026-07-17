import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps extends ComponentPropsWithoutRef<"div"> {
  icon: ReactNode;
  title: string;
  description: string;
}

export function EmptyState({
  className,
  description,
  icon,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[22px_minmax(0,1fr)] items-start gap-2 rounded-[16px] bg-muted p-4",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="grid place-items-center text-muted-foreground"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <strong className="text-sm font-medium text-foreground">{title}</strong>
        <p className="mt-1.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {description}
        </p>
      </div>
    </div>
  );
}
