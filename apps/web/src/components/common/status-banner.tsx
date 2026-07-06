import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

type BannerTone = "info" | "notice" | "error" | "warning";

interface StatusBannerProps extends ComponentPropsWithoutRef<"div"> {
  icon: ReactNode;
  message: string;
  tone?: BannerTone;
}

export function StatusBanner({
  className,
  icon,
  message,
  tone = "info",
  ...props
}: StatusBannerProps) {
  return (
    <div
      className={cn("status-banner", `status-banner-${tone}`, className)}
      role={tone === "error" ? "alert" : "status"}
      {...props}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{message}</span>
    </div>
  );
}
