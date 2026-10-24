import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Moon, Sun } from "lucide-react";
import { useIntl } from "react-intl";
import { Outlet, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { CompanySwitchDialog } from "@/components/layout/CompanySwitchDialog";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabStrip } from "@/components/layout/TabStrip";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { TabsProvider, useTabs } from "@/context/TabsContext";
import { useTheme } from "@/context/ThemeContext";

function UnsavedChangesWarning({
  onDiscard,
  onStay,
}: {
  onDiscard: () => void;
  onStay: () => void;
}) {
  const intl = useIntl();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onStay}>
      <div
        className="mx-4 w-full max-w-sm rounded-lg border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <p className="mb-4 text-sm">{intl.formatMessage({ id: "companySwitch.unsavedWarning" })}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onStay}>
            {intl.formatMessage({ id: "companySwitch.stayHere" })}
          </Button>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            {intl.formatMessage({ id: "companySwitch.discardAndSwitch" })}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { auth, logout } = useAuth();
  const { companies, activeCompanyId, activeCompany, setActiveCompanyId } = useCompany();
  const { theme, toggle } = useTheme();
  const { tabs } = useTabs();

  const [switchTarget, setSwitchTarget] = useState<{ id: string; name: string } | null>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);

  const hasDirtyTabs = tabs.some((t) => t.dirty);

  const handleCompanySelectorChange = useCallback(
    (targetId: string) => {
      if (targetId === activeCompanyId) return;

      // For single-company users or first company selection, switch directly
      if (!activeCompanyId) {
        setActiveCompanyId(targetId);
        navigate("/dashboard", { replace: true });
        return;
      }

      const target = companies.find((c) => c.id === targetId);
      if (!target) return;

      // Check for unsaved changes first
      if (hasDirtyTabs) {
        setPendingTargetId(targetId);
        setShowUnsavedWarning(true);
        return;
      }

      // Show password confirmation
      setSwitchTarget({ id: targetId, name: target.name });
    },
    [activeCompanyId, companies, hasDirtyTabs, setActiveCompanyId, navigate],
  );

  const handleUnsavedDiscard = useCallback(() => {
    setShowUnsavedWarning(false);
    if (!pendingTargetId) return;
    const target = companies.find((c) => c.id === pendingTargetId);
    if (!target) return;
    setSwitchTarget({ id: pendingTargetId, name: target.name });
    setPendingTargetId(null);
  }, [pendingTargetId, companies]);

  const handleUnsavedStay = useCallback(() => {
    setShowUnsavedWarning(false);
    setPendingTargetId(null);
  }, []);

  const handleSwitchConfirm = useCallback(() => {
    if (!switchTarget) return;
    setActiveCompanyId(switchTarget.id);
    setSwitchTarget(null);
    // Invalidate all queries to force fresh data for the new company
    queryClient.clear();
    navigate("/dashboard", { replace: true });
  }, [switchTarget, setActiveCompanyId, queryClient, navigate]);

  const handleSwitchCancel = useCallback(() => {
    setSwitchTarget(null);
  }, []);

  return (
    <>
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
                <SearchableSelect
                  aria-label={intl.formatMessage({ id: "common.selectCompany" })}
                  className="h-8 w-48"
                  value={activeCompanyId ?? ""}
                  onChange={handleCompanySelectorChange}
                  placeholder={intl.formatMessage({ id: "common.selectCompany" })}
                  searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                  noResultsText={intl.formatMessage({ id: "common.noResults" })}
                  options={companies
                    .filter((company) => !company.isArchived)
                    .map((company) => ({
                      value: company.id,
                      label: company.name,
                    }))}
                />
              )}
              {activeCompany && (
                <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1">
                  <Building2 className="size-3.5 text-primary" />
                  <span className="text-xs font-semibold text-primary">{activeCompany.name}</span>
                </div>
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
          <main className="flex-1 overflow-y-auto p-6">
            <Breadcrumbs />
            <Outlet />
          </main>
        </div>
      </div>
      <GlobalSearch />
      <Toaster />

      {showUnsavedWarning && (
        <UnsavedChangesWarning onDiscard={handleUnsavedDiscard} onStay={handleUnsavedStay} />
      )}

      {switchTarget && activeCompany && (
        <CompanySwitchDialog
          currentCompanyName={activeCompany.name}
          targetCompanyName={switchTarget.name}
          onConfirm={handleSwitchConfirm}
          onCancel={handleSwitchCancel}
        />
      )}
    </>
  );
}

export function AppLayout() {
  return (
    <TabsProvider>
      <AppShell />
    </TabsProvider>
  );
}
