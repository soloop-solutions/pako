import * as React from "react";

import { cn } from "@/lib/utils";

// Plain native <select>, not shadcn's Radix-based Select (@radix-ui/react-select isn't a
// dependency here) — styled to match the new-york input/button look. See root CLAUDE.md.
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Select };
