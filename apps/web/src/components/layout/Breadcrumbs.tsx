import { ChevronRight } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useLocation, useParams } from "react-router-dom";

import { navCategories } from "@/config/nav";
import { usePageHeaderMounted } from "@/components/list/pageHeaderPresence";
import { useActiveTabTitle } from "@/context/TabsContext";

export interface Crumb {
  label: string;
  path?: string;
}

/** The crumbs for the current route (section › page › document › edit). */
// eslint-disable-next-line react-refresh/only-export-components
export function useBreadcrumbs(): Crumb[] {
  const intl = useIntl();
  const { pathname } = useLocation();
  const { id } = useParams();
  const documentTitle = useActiveTabTitle();
  return buildCrumbs(pathname, id, documentTitle, (key: string) => intl.formatMessage({ id: key }));
}

// User request 2026-11-24: a page with the shared one-line PageHeader shows its section there, so
// this row is left out; elsewhere it is a single compact line.
export function Breadcrumbs() {
  const crumbs = useBreadcrumbs();
  const pageHeader = usePageHeaderMounted();

  if (crumbs.length <= 1 || pageHeader) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 pb-2 text-xs text-muted-foreground">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3" />}
            {isLast || !crumb.path ? (
              <span className={isLast ? "text-foreground font-medium" : ""}>{crumb.label}</span>
            ) : (
              <Link to={crumb.path} className="hover:text-foreground transition-colors">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// UI/UX round 2026-11-24: a document's crumb is its number (the title the page reports through
// useTabMeta), never a UUID fragment; `/<list>/<id>/edit` gets crumbs too.
function buildCrumbs(pathname: string, id: string | undefined, documentTitle: string | null, t: (key: string) => string): Crumb[] {
  // Strip trailing slash
  const path = pathname.replace(/\/$/, "") || "/";

  for (const category of navCategories) {
    for (const item of category.items) {
      // Exact match: /invoicing → Sales > Sales Invoices
      if (path === item.path) {
        return [
          { label: t(category.labelKey), path: undefined },
          { label: t(item.titleKey) },
        ];
      }

      // Instance match: /invoicing/abc-123 → Sales > Sales Invoices > INV-0001
      if (id && path === `${item.path}/${id}`) {
        return [
          { label: t(category.labelKey), path: undefined },
          { label: t(item.titleKey), path: item.path },
          ...(documentTitle ? [{ label: documentTitle }] : []),
        ];
      }

      if (id && path === `${item.path}/${id}/edit`) {
        return [
          { label: t(category.labelKey), path: undefined },
          { label: t(item.titleKey), path: item.path },
          ...(documentTitle ? [{ label: documentTitle, path: `${item.path}/${id}` }] : []),
          { label: t("common.edit") },
        ];
      }
    }
  }

  return [];
}
