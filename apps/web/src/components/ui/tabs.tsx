import * as React from "react";

import { cn } from "@/lib/utils";

type TabButtonProps = Omit<React.ComponentProps<"button">, "role" | "aria-selected"> & {
  selected: boolean;
};

function TabButton({ selected, className, type = "button", ...props }: TabButtonProps) {
  return (
    <button
      type={type}
      role="tab"
      aria-selected={selected}
      data-slot="tab"
      data-state={selected ? "active" : "inactive"}
      className={cn(
        "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-1.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { TabButton };
