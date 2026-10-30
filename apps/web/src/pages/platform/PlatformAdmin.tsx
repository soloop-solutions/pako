import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, ClipboardList, LayoutDashboard, LogOut, ShieldCheck, Users } from "lucide-react";
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
import { PlatformCompaniesTab } from "@/pages/platform/PlatformCompaniesTab";
import { PlatformOverviewTab } from "@/pages/platform/PlatformOverviewTab";
import { PlatformUsersTab } from "@/pages/platform/PlatformUsersTab";

const tabs = [
  { key: "overview", icon: LayoutDashboard },
  { key: "users", icon: Users },
  { key: "requests", icon: ClipboardList },
  { key: "companies", icon: Building2 },
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
    queryFn: () => apiClient.listAccountRequests(0),
    enabled: account.data?.isPlatformAdmin === true,
  });

  if (account.isPending) return null;
  if (!account.data?.isPlatformAdmin) return <Navigate to="/select-company" replace />;

  const pending = pendingQuery.data?.length ?? 0;

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
        <nav className="mb-5 flex flex-wrap gap-1 border-b" role="tablist" aria-label={t("platform.title")}>
          {tabs.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setParams(key === "overview" ? {} : { tab: key }, { replace: true })}
              className={cn(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium",
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
        </nav>

        {tab === "overview" && <PlatformOverviewTab onOpenRequests={() => setParams({ tab: "requests" }, { replace: true })} />}
        {tab === "users" && <PlatformUsersTab />}
        {tab === "requests" && <AccountRequestsTab />}
        {tab === "companies" && <PlatformCompaniesTab />}
      </main>
    </div>
  );
}
