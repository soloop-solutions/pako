import { useQuery } from "@tanstack/react-query";
import { LogOut, ShoppingCart, Store } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { formatAmount } from "@/lib/payroll-enums";
import { cn } from "@/lib/utils";
import { PortalProvider } from "@/pages/portal/PortalContext";
import { usePortal } from "@/pages/portal/portal-context";

// The customer portal shell (client feedback phase 5): outside the company app — a customer's
// contact never sees its navigation, only the catalogue, the cart, their orders and invoices.
export function PortalLayout() {
  return (
    <PortalProvider>
      <PortalShell />
    </PortalProvider>
  );
}

function PortalShell() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { companies, loaded, company, companyId, setCompanyId, cart } = usePortal();
  const summary = useQuery({
    queryKey: ["portal", companyId, "summary"],
    queryFn: () => apiClient.getPortalSummary(companyId as string),
    enabled: !!companyId,
  }).data;

  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }

  if (loaded && !company) {
    return (
      <div className="mx-auto max-w-lg p-10">
        <EmptyState
          icon={Store}
          title={t("portal.noAccess")}
          description={t("portal.noAccessHint")}
          actions={
            <>
              <Button asChild variant="outline"><Link to="/select-company">{t("portal.toCompanies")}</Link></Button>
              <Button variant="ghost" onClick={signOut}>{t("common.logOut")}</Button>
            </>
          }
        />
      </div>
    );
  }
  if (!company) return null;

  const tabs = [
    { to: "/portal", label: t("portal.nav.catalogue"), end: true },
    { to: "/portal/cart", label: `${t("portal.nav.cart")}${cart.length ? ` (${cart.length})` : ""}`, end: false },
    { to: "/portal/orders", label: t("portal.nav.orders"), end: false },
    { to: "/portal/invoices", label: t("portal.nav.invoices"), end: false },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-card print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt="" className="size-9 rounded object-contain" />
            ) : (
              <Store className="size-8 text-muted-foreground" />
            )}
            <div>
              <p className="font-semibold leading-tight">{company.companyName}</p>
              <p className="text-xs text-muted-foreground">
                {intl.formatMessage({ id: "portal.signedInAs" }, { customer: company.partnerName })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {summary && (
              <div className="flex gap-4" data-testid="portal-balance">
                <span>
                  <span className="text-muted-foreground">{t("portal.outstanding")}: </span>
                  <span className="font-medium tabular-nums">{formatAmount(summary.outstanding)}</span>
                </span>
                {summary.overdue > 0 && (
                  <span className="text-destructive">
                    {t("portal.overdue")}: <span className="font-medium tabular-nums">{formatAmount(summary.overdue)}</span>
                  </span>
                )}
                {summary.available != null && (
                  <span>
                    <span className="text-muted-foreground">{t("portal.available")}: </span>
                    <span className="font-medium tabular-nums">{formatAmount(summary.available)}</span>
                  </span>
                )}
              </div>
            )}
            {companies.length > 1 && (
              <div className="flex items-center gap-2">
                <Label htmlFor="portal-company" className="sr-only">{t("portal.company")}</Label>
                <Select
                  id="portal-company"
                  aria-label={t("portal.company")}
                  className="w-56"
                  value={company.companyId}
                  onValueChange={setCompanyId}
                  options={companies.map((c) => ({ value: c.companyId, label: c.companyName }))}
                />
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="size-4" />
              {t("common.logOut")}
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-4" aria-label={t("portal.title")}>
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                  isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )
              }
            >
              {tab.to === "/portal/cart" && <ShoppingCart className="mr-1 inline size-4" />}
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      {summary?.overdueBlocked && (
        <div role="alert" className="border-b border-warning-border bg-warning px-4 py-2 text-center text-sm text-warning-foreground print:hidden">{t("portal.overdueBlocked")}</div>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
