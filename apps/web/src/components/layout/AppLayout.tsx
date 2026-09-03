import { useIntl } from "react-intl";
import { NavLink, Outlet } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { navItems } from "@/config/nav";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { cn } from "@/lib/utils";

export function AppLayout() {
  const intl = useIntl();
  const { auth, logout } = useAuth();
  const { companies, activeCompanyId, setActiveCompanyId } = useCompany();

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r bg-card">
        <div className="flex h-14 items-center border-b px-4">
          <span className="text-lg font-semibold">PAKO</span>
        </div>
        <nav className="flex flex-col gap-1 p-2">
          {navItems.map(({ titleKey, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <Icon className="size-4" />
              {intl.formatMessage({ id: titleKey })}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.kosovoAccountingPlatform" })}</span>
            {companies.length > 0 && (
              <Select
                aria-label={intl.formatMessage({ id: "common.selectCompany" })}
                className="h-8 w-48"
                value={activeCompanyId ?? ""}
                onChange={(event) => setActiveCompanyId(event.target.value)}
              >
                <option value="" disabled>
                  {intl.formatMessage({ id: "common.selectCompany" })}
                </option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <span className="text-sm text-muted-foreground">{auth?.email}</span>
            <Button variant="outline" size="sm" onClick={logout}>
              {intl.formatMessage({ id: "common.logOut" })}
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
