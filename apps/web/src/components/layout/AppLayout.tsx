import { Moon, Sun } from "lucide-react";
import { useIntl } from "react-intl";
import { Outlet } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabStrip } from "@/components/layout/TabStrip";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { TabsProvider } from "@/context/TabsContext";
import { useTheme } from "@/context/ThemeContext";

export function AppLayout() {
  const intl = useIntl();
  const { auth, logout } = useAuth();
  const { companies, activeCompanyId, setActiveCompanyId } = useCompany();
  const { theme, toggle } = useTheme();

  return (
    <TabsProvider>
      {/* h-screen, not min-h-screen: the sidebar's own overflow-y-auto (SHELL_SPEC §3, "scrolls
          independently") only works if this wrapper is capped at the viewport height. min-h-screen
          lets the wrapper grow past it when a page is long, which hands scrolling to the whole
          document instead — dragging the sidebar and top bar along with it. */}
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-12 shrink-0 items-center justify-between border-b px-6">
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
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={intl.formatMessage({ id: theme === "dark" ? "common.theme.light" : "common.theme.dark" })}
                onClick={toggle}
              >
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </Button>
              <LanguageSwitcher />
              <span className="text-sm text-muted-foreground">{auth?.email}</span>
              <Button variant="outline" size="sm" onClick={logout}>
                {intl.formatMessage({ id: "common.logOut" })}
              </Button>
            </div>
          </header>
          <TabStrip />
          <main className="flex-1 overflow-y-auto p-0">
            <Outlet />
          </main>
        </div>
      </div>
    </TabsProvider>
  );
}
