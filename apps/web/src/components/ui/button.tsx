import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium tracking-[0.01em] whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md active:bg-primary/80",
        primary: "bg-accent text-accent-foreground shadow-sm hover:bg-accent/90 hover:shadow-md active:bg-accent/80",
        outline: "border border-outline bg-transparent text-primary hover:bg-primary/10 active:bg-primary/5",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/90 active:bg-secondary/80",
        ghost: "border border-transparent bg-transparent text-primary hover:bg-primary/10 active:bg-primary/5",
        link: "text-primary underline-offset-4 hover:underline",
        danger: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-md active:bg-destructive/80",
      },
      size: {
        default: "px-6 py-2.5 has-[>svg]:px-4",
        sm: "px-4 py-2 text-xs has-[>svg]:px-3",
        lg: "px-8 py-3 text-base has-[>svg]:px-5",
        icon: "p-0",
        "icon-xs": "p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "p-0",
        "icon-lg": "p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
