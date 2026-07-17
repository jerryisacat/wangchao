import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      ref={ref}
      data-slot="input"
      className={cn(
        "h-14 w-full min-w-0 rounded-t-[12px] border-0 border-b-2 border-outline bg-muted px-4 text-base text-foreground transition-[border-color] duration-200 outline-none placeholder:text-muted-foreground focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-base",
        className
      )}
      {...props}
    />
  );
});

Input.displayName = "Input";

export { Input };
