import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-t-[12px] border-0 border-b-2 border-outline bg-muted px-4 py-3 text-base text-foreground transition-[border-color] duration-200 outline-none placeholder:text-muted-foreground focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-base",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
