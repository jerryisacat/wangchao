import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

type CardVariant = "work" | "kinetic";

interface CardProps extends ComponentPropsWithoutRef<"section"> {
  variant?: CardVariant;
}

export function Card({ className, variant = "work", ...props }: CardProps) {
  return (
    <section
      className={cn("ui-card", `ui-card-${variant}`, className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("ui-card-header", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentPropsWithoutRef<"h2">) {
  return <h2 className={cn("ui-card-title", className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("ui-card-description", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("ui-card-content", className)} {...props} />;
}
