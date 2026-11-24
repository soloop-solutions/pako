import type { ReactNode } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useHotkey } from "@/hooks/useHotkey";

export interface PageHeaderAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

// Client request 2026-11-24: one header for every list page — title and description on the left,
// the page's buttons on the right (secondary actions, then the primary "New …", which the N key
// also triggers). Replaces each page's own CardHeader + button layout.
export function PageHeader({
  title,
  description,
  newAction,
  actions,
}: {
  title: string;
  description?: string;
  /** The primary "New …" button; N opens it too. */
  newAction?: PageHeaderAction;
  /** Secondary buttons (import, export, print list, …), shown before the primary one. */
  actions?: ReactNode;
}) {
  useHotkey("n", () => newAction?.onClick(), !!newAction && !newAction.disabled);

  return (
    <div className="flex flex-wrap items-start justify-between gap-3" data-testid="page-header">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {newAction && (
          <Button onClick={newAction.onClick} disabled={newAction.disabled} title={`${newAction.label} (N)`}>
            <Plus className="size-4" />
            {newAction.label}
          </Button>
        )}
      </div>
    </div>
  );
}
