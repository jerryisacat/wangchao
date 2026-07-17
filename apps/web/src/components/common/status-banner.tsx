import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

type BannerTone = "info" | "notice" | "error" | "warning";

interface StatusBannerProps extends ComponentPropsWithoutRef<"div"> {
  icon: ReactNode;
  message: string;
  tone?: BannerTone;
}

const toneStyles: Record<BannerTone, string> = {
  info: "bg-secondary text-secondary-foreground",
  notice: "bg-accent/15 text-accent",
  warning: "bg-warning/15 text-warning",
  error: "bg-destructive/15 text-destructive",
};

export function StatusBanner({
  className,
  icon,
  message,
  tone = "info",
  ...props
}: StatusBannerProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-2 rounded-[16px] p-3 text-sm leading-normal",
        toneStyles[tone],
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      <span className="min-w-0">{message}</span>
    </div>
  );
}
