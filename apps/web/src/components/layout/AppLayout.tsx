import { Suspense, useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Menu, PanelLeftOpen, X } from "lucide-react";
import { useIntl } from "react-intl";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

import { BrandMark } from "@/components/auth/AuthLayout";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { DraftsRibbon } from "@/components/layout/DraftsRibbon";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { KeyboardShortcuts } from "@/components/layout/KeyboardShortcuts";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabStrip } from "@/components/layout/TabStrip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { LicenseBanner } from "@/pages/desktop/LicenseBanner";
import { DraftsProvider } from "@/context/DraftsContext";
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
  const { logout } = useAuth();
  const { activeCompany, leaveCompany, setHasUnsavedWork } = useCompany();
  const { tabs } = useTabs();
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try {
      return localStorage.getItem("pako.sidebarHidden") === "true";
    } catch {
      return false;
    }
  });
  function toggleSidebarHidden() {
    setSidebarHidden((prev) => {
      try {
        localStorage.setItem("pako.sidebarHidden", String(!prev));
      } catch {
        return !prev;
      }
      return !prev;
    });
  }
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
        <div className={sidebarHidden ? "hidden" : "hidden lg:flex"}>
          <Sidebar onHide={toggleSidebarHidden} onChangeCompany={requestExit} onLogout={logout} />
        </div>

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div className="absolute inset-0 bg-black/40 transition-opacity" onClick={() => setSidebarOpen(false)} />
            <div className="relative z-50 h-full animate-in slide-in-from-left duration-200">
              <Sidebar onChangeCompany={requestExit} onLogout={logout} />
              <button
                type="button"
                className="absolute top-3 right-3 rounded-md bg-card p-1.5 text-muted-foreground shadow-sm hover:text-foreground"
                aria-label={intl.formatMessage({ id: "common.close" })}
                onClick={() => setSidebarOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          <LicenseBanner />
          {/* User request 2026-11-24: no top bar — search, settings and log out are at the foot of the
              sidebar. Small screens keep a slim row with the menu button. */}
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 lg:hidden">
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setSidebarOpen(true)}
              aria-label={intl.formatMessage({ id: "sidebar.openMenu" })}
            >
              <Menu className="size-5" />
            </button>
            <BrandMark className="size-5 text-primary" />
            <span className="truncate text-sm font-semibold">{activeCompany?.name ?? "PAKO"}</span>
          </div>
          <div className="flex shrink-0">
            {sidebarHidden && (
              <button
                type="button"
                className="hidden h-9 shrink-0 items-center border-r border-b bg-secondary px-2 text-muted-foreground hover:text-foreground lg:inline-flex"
                onClick={toggleSidebarHidden}
                aria-label={intl.formatMessage({ id: "sidebar.showSidebar" })}
                title={intl.formatMessage({ id: "sidebar.showSidebar" })}
              >
                <PanelLeftOpen className="size-4" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <TabStrip />
            </div>
          </div>
          <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable] scrollbar-brand p-3 lg:p-4">
            <Breadcrumbs />
            <RouteErrorBoundary>
              <Suspense fallback={<div className="flex-1" />}>
                <Outlet />
              </Suspense>
            </RouteErrorBoundary>
          </main>
          <DraftsRibbon />
        </div>
      </div>
      <GlobalSearch />
      <KeyboardShortcuts />

      {showUnsavedWarning && (
        <UnsavedChangesWarning onDiscard={exitToLobby} onStay={() => setShowUnsavedWarning(false)} />
      )}
    </>
  );
}

export function AppLayout() {
  return (
    <TabsProvider>
      <DraftsProvider>
        <AppShell />
      </DraftsProvider>
    </TabsProvider>
  );
}
