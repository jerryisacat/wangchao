import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export function Tabs({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("ui-tabs", className)} {...props} />;
}

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("ui-tabs-list", className)} role="tablist" {...props} />;
}

export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<"button">) {
  return (
    <button
      className={cn("ui-tabs-trigger", className)}
      role="tab"
      type="button"
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<"section">) {
  return <section className={cn("ui-tabs-content", className)} role="tabpanel" {...props} />;
}
