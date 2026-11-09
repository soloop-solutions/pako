import { Suspense, useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Menu, X } from "lucide-react";
import { useIntl } from "react-intl";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

import { BrandMark } from "@/components/auth/AuthLayout";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggleButton } from "@/components/layout/ThemeToggleButton";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabStrip } from "@/components/layout/TabStrip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { TabsProvider, useTabs } from "@/context/TabsContext";

// Leaving the company with unsaved edits: a real dialog (focus stays inside, Escape or a click
// outside means "stay"), so it works by keyboard and with screen readers.
function UnsavedChangesWarning({
  onDiscard,
  onStay,
}: {
  onDiscard: () => void;
  onStay: () => void;
}) {
  const intl = useIntl();
  return (
    <Dialog open onOpenChange={(open) => !open && onStay()}>
      <DialogContent className="sm:max-w-sm" role="alertdialog">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "lobby.exit" })}</DialogTitle>
          <DialogDescription>{intl.formatMessage({ id: "companySwitch.unsavedWarning" })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onStay} autoFocus>
            {intl.formatMessage({ id: "companySwitch.stayHere" })}
          </Button>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            {intl.formatMessage({ id: "companySwitch.discardAndSwitch" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppShell() {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { auth, logout } = useAuth();
  const { activeCompany, leaveCompany, setHasUnsavedWork } = useCompany();
  const { tabs } = useTabs();
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hasDirtyTabs = tabs.some((t) => t.dirty);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Other windows ask before opening a different company; tell them if edits here would be lost.
  useEffect(() => {
    setHasUnsavedWork(hasDirtyTabs);
    return () => setHasUnsavedWork(false);
  }, [hasDirtyTabs, setHasUnsavedWork]);

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
        {/* Desktop sidebar — always visible on lg+ */}
        <div className="hidden lg:flex">
          <Sidebar />
        </div>

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div className="absolute inset-0 bg-black/40 transition-opacity" onClick={() => setSidebarOpen(false)} />
            <div className="relative z-50 animate-in slide-in-from-left duration-200">
              <Sidebar />
              <button
                type="button"
                className="absolute top-3 right-3 rounded-md bg-card p-1.5 text-muted-foreground shadow-sm hover:text-foreground"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-12 shrink-0 items-center justify-between border-b px-4 lg:px-6">
            <div className="flex items-center gap-3">
              {/* Mobile hamburger + brand */}
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label={intl.formatMessage({ id: "sidebar.openMenu" })}
              >
                <Menu className="size-5" />
              </button>
              <div className="flex items-center gap-2 lg:hidden">
                <BrandMark className="size-5 text-primary" />
                <span className="text-sm font-semibold">PAKO</span>
              </div>
              <span className="hidden text-sm text-muted-foreground lg:inline">{intl.formatMessage({ id: "common.kosovoAccountingPlatform" })}</span>
              {activeCompany && (
                <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1" data-testid="active-company">
                  <Building2 className="size-3.5 text-primary" />
                  <span className="hidden text-xs font-semibold text-primary sm:inline">{activeCompany.name}</span>
                  {!activeCompany.isVatRegistered && (
                    <span className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
                      {intl.formatMessage({ id: "header.vatBadge" })}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 lg:gap-3">
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
          <main className="flex-1 overflow-y-auto scrollbar-brand p-4 lg:p-6">
            <Breadcrumbs />
            <RouteErrorBoundary>
              <Suspense fallback={<div className="flex-1" />}>
                <Outlet />
              </Suspense>
            </RouteErrorBoundary>
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
