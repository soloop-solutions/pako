import { ChevronRight } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useLocation, useParams } from "react-router-dom";

import { navCategories } from "@/config/nav";

interface Crumb {
  label: string;
  path?: string;
}

export function Breadcrumbs() {
  const intl = useIntl();
  const { pathname } = useLocation();
  const { id } = useParams();

  const crumbs = buildCrumbs(pathname, id, (key: string) => intl.formatMessage({ id: key }));

  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 pb-4 text-xs text-muted-foreground">
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

function buildCrumbs(pathname: string, id: string | undefined, t: (key: string) => string): Crumb[] {
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
          { label: id.substring(0, 8) + "…" },
        ];
      }
    }
  }

  return [];
}
