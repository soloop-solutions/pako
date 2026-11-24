import { Fragment, type ReactNode } from "react";
import { ChevronRight, Info, Plus } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { useBreadcrumbs } from "@/components/layout/Breadcrumbs";
import { useRegisterPageHeader } from "@/components/list/pageHeaderPresence";
import { Button } from "@/components/ui/button";
import { navItemForPath } from "@/config/nav";
import { useHotkey } from "@/hooks/useHotkey";

/**
 * A list page's grid card without its box, so the header, filters and grid read as one view
 * (user request 2026-11-24).
 */
export const LIST_SURFACE = "gap-3 rounded-none border-0 bg-transparent py-0 shadow-none [&>[data-slot=card-content]]:px-0";

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
  const PageIcon = navItemForPath(useLocation().pathname)?.icon;

  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b pb-2.5" data-testid="page-header">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* User request 2026-11-24: "New …" opens the row, as in Odoo's control panel — a compact
            button that reads as part of the page, then where you are. */}
        {newAction && (
          <Button
            size="sm"
            className="h-7 shrink-0 gap-1 rounded-md px-2.5 text-xs font-semibold shadow-none"
            onClick={newAction.onClick}
            disabled={newAction.disabled}
            title={`${newAction.label} (N)`}
          >
            <Plus className="size-3.5" />
            {newAction.label}
          </Button>
        )}
        <div className="flex min-w-0 items-center gap-1.5">
          {PageIcon && (
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground" aria-hidden>
              <PageIcon className="size-3.5" />
            </span>
          )}
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
            <span className="inline-flex shrink-0 text-muted-foreground" data-tip={description}>
              <Info className="size-3.5" aria-hidden />
              <span className="sr-only">{description}</span>
            </span>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 [&_button]:h-7 [&_button]:text-xs">{actions}</div>}
    </div>
  );
}

/**
 * The same control-panel row for one section of a page that holds several lists (e.g. stores,
 * registers and barcode rules on POS setup): compact New first, then the section title (and its
 * description behind an info icon), secondary buttons on the right. No breadcrumb, no N hotkey.
 */
export function SectionHeader({
  title,
  description,
  newAction,
  actions,
}: {
  title: string;
  description?: string;
  newAction?: PageHeaderAction;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-2" data-testid="section-header">
      <div className="flex min-w-0 items-center gap-2.5">
        {newAction && (
          <Button
            size="sm"
            className="h-7 shrink-0 gap-1 rounded-md px-2.5 text-xs font-semibold shadow-none"
            onClick={newAction.onClick}
            disabled={newAction.disabled}
          >
            <Plus className="size-3.5" />
            {newAction.label}
          </Button>
        )}
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        {description && (
          <span className="inline-flex shrink-0 text-muted-foreground" data-tip={description}>
            <Info className="size-3.5" aria-hidden />
            <span className="sr-only">{description}</span>
          </span>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 [&_button]:h-7 [&_button]:text-xs">{actions}</div>}
    </div>
  );
}
