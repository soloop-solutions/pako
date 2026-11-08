import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

function EmptyState({ icon: Icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn("flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-10 text-center", className)}>
      <span className="flex size-12 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export { EmptyState };
