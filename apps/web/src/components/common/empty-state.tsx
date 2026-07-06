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
    <div className={cn("empty-state", className)} {...props}>
      <span className="empty-state-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}
