import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, ClipboardList, History, LayoutDashboard, LogOut, ShieldCheck, Users } from "lucide-react";
import { useIntl } from "react-intl";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { apiClient } from "@/api/client";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggleButton } from "@/components/layout/ThemeToggleButton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useAccount } from "@/hooks/useAccount";
import { cn } from "@/lib/utils";
import { AccountRequestsTab } from "@/pages/platform/AccountRequestsTab";
import { PlatformActivityTab } from "@/pages/platform/PlatformActivityTab";
import { PlatformCompaniesTab } from "@/pages/platform/PlatformCompaniesTab";
import { PlatformOverviewTab } from "@/pages/platform/PlatformOverviewTab";
import { PlatformUsersTab } from "@/pages/platform/PlatformUsersTab";

const tabs = [
  { key: "overview", icon: LayoutDashboard },
  { key: "users", icon: Users },
  { key: "requests", icon: ClipboardList },
  { key: "companies", icon: Building2 },
  { key: "activity", icon: History },
] as const;
type Tab = (typeof tabs)[number]["key"];

// docs/PLATFORM_ADMIN.md: the PAKO administration panel, above every company — usage per
// accountant, users and their company limits, account requests, and each company's modules.
// Opened from the company list; only platform administrators get in (the API checks too).
export function PlatformAdmin() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const { auth, logout } = useAuth();
  const account = useAccount();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (tabs.map((x) => x.key) as string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "overview";
  const pendingQuery = useQuery({
    queryKey: ["platform", "requests", "pending"],
    queryFn: () => apiClient.countPendingAccountRequests(),
    enabled: account.data?.isPlatformAdmin === true,
  });

  // Each tab starts clean: its own filters and paging don't follow you to the next tab.
  const select = (key: Tab) => setParams(key === "overview" ? {} : { tab: key }, { replace: true });

  if (account.isPending) return null;
  if (!account.data?.isPlatformAdmin) return <Navigate to="/select-company" replace />;

  const pending = pendingQuery.data ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/select-company")}>
            <ArrowLeft className="size-4" />
            {t("platform.backToCompanies")}
          </Button>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <ShieldCheck className="size-4" />
            {t("platform.title")}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggleButton />
          <LanguageSwitcher />
          <span className="text-sm text-muted-foreground">{auth?.email}</span>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut className="size-4" />
            {t("common.logOut")}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold">{t("platform.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("platform.subtitle")}</p>
        </div>
        {/* WAI-ARIA tabs: arrow keys (and Home/End) move between tabs, only the selected tab is in the
            Tab order, and each tab controls its panel. */}
        <div
          className="mb-5 flex flex-wrap gap-1 border-b"
          role="tablist"
          aria-label={t("platform.title")}
          onKeyDown={(e) => {
            const keys = tabs.map((x) => x.key);
            const index = keys.indexOf(tab);
            const next =
              e.key === "ArrowRight" ? keys[(index + 1) % keys.length]
              : e.key === "ArrowLeft" ? keys[(index - 1 + keys.length) % keys.length]
              : e.key === "Home" ? keys[0]
              : e.key === "End" ? keys[keys.length - 1]
              : null;
            if (!next) return;
            e.preventDefault();
            select(next);
            document.getElementById(`platform-tab-${next}`)?.focus();
          }}
        >
          {tabs.map(({ key, icon: Icon }) => (
            <button
              key={key}
              id={`platform-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls={`platform-panel-${key}`}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => select(key)}
              className={cn(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {t(`platform.tab.${key}`)}
              {key === "requests" && pending > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{pending}</span>
              )}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`platform-panel-${tab}`} aria-labelledby={`platform-tab-${tab}`}>
          {tab === "overview" && <PlatformOverviewTab onOpenRequests={() => select("requests")} />}
          {tab === "users" && <PlatformUsersTab />}
          {tab === "requests" && <AccountRequestsTab />}
          {tab === "companies" && <PlatformCompaniesTab />}
          {tab === "activity" && <PlatformActivityTab />}
        </div>
      </main>
    </div>
  );
}
