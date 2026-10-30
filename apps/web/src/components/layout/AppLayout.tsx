import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { useIntl } from "react-intl";
import { Outlet, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggleButton } from "@/components/layout/ThemeToggleButton";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabStrip } from "@/components/layout/TabStrip";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { TabsProvider, useTabs } from "@/context/TabsContext";

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
  const { activeCompany, leaveCompany } = useCompany();
  const { tabs } = useTabs();
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

  // The company is changed only in the lobby: leaving the company drops its data from the cache
  // and returns to the lobby, where the next one is chosen.
  const exitToLobby = useCallback(() => {
    setShowUnsavedWarning(false);
    leaveCompany();
    queryClient.clear();
    navigate("/select-company", { replace: true });
  }, [leaveCompany, queryClient, navigate]);

  const requestExit = useCallback(() => {
    if (tabs.some((t) => t.dirty)) setShowUnsavedWarning(true);
    else exitToLobby();
  }, [tabs, exitToLobby]);

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
              {activeCompany && (
                <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1" data-testid="active-company">
                  <Building2 className="size-3.5 text-primary" />
                  <span className="text-xs font-semibold text-primary">{activeCompany.name}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggleButton />
              <LanguageSwitcher />
              <AccountMenu
                email={auth?.email}
                companyName={activeCompany?.name}
                onChangeCompany={requestExit}
                onLogout={logout}
              />
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

      {showUnsavedWarning && (
        <UnsavedChangesWarning onDiscard={exitToLobby} onStay={() => setShowUnsavedWarning(false)} />
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
