import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-sm border px-[7px] py-[2px] text-[10.5px] leading-[1.35] font-medium w-fit whitespace-nowrap shrink-0 gap-1 overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-white",
        outline: "text-foreground",

        // Document state. Colour AND a shape cue, so the register survives greyscale print.
        success: "bg-success text-success-foreground border-success-border font-semibold",
        warning:
          "bg-warning text-warning-foreground border-warning-border border-l-[3px] border-l-warning-foreground font-semibold",
        info: "bg-info text-info-foreground border-info-border border-b-2 border-b-info-foreground",
        draft: "bg-transparent text-muted-foreground border-dashed border-border italic",
        cancelled:
          "bg-neutral-state text-neutral-state-foreground border-neutral-state-border line-through",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants };
