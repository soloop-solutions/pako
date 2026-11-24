import { Fragment, type ReactNode } from "react";
import { ChevronRight, Info, Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { useBreadcrumbs } from "@/components/layout/Breadcrumbs";
import { useRegisterPageHeader } from "@/components/list/pageHeaderPresence";
import { Button } from "@/components/ui/button";
import { useHotkey } from "@/hooks/useHotkey";

export interface PageHeaderAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

// Client request 2026-11-24: one header for every list page, with the page's buttons on the right
// (secondary actions; the primary "New …", which the N key also triggers, is on the left).
// User request 2026-11-24 (later): one line — the section as a small prefix of the title (in place
// of the breadcrumb row), the description behind an ⓘ.
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
  useRegisterPageHeader();
  // Everything before the page itself: the section, and the list when this is a document.
  const crumbs = useBreadcrumbs().slice(0, -1);

  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2" data-testid="page-header">
      <div className="flex min-w-0 items-center gap-1.5">
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
            {crumbs.map((crumb, index) => (
              <Fragment key={index}>
                {crumb.path ? (
                  <Link to={crumb.path} className="hover:text-foreground">{crumb.label}</Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
                <ChevronRight className="size-3.5" />
              </Fragment>
            ))}
          </nav>
        )}
        <h2 className="truncate text-base font-semibold">{title}</h2>
        {description && (
          <span className="inline-flex shrink-0 text-muted-foreground" title={description}>
            <Info className="size-3.5" aria-hidden />
            <span className="sr-only">{description}</span>
          </span>
        )}
        {/* User request 2026-11-24: the "New …" button sits on the left, right after the title. */}
        {newAction && (
          <Button size="sm" className="ml-2 shrink-0" onClick={newAction.onClick} disabled={newAction.disabled} title={`${newAction.label} (N)`}>
            <Plus className="size-4" />
            {newAction.label}
          </Button>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
