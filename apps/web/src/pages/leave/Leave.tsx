import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";

import { useCompany } from "@/context/CompanyContext";
import { cn } from "@/lib/utils";
import { LeaveBalancesTab } from "@/pages/leave/LeaveBalancesTab";
import { LeaveCalendarTab } from "@/pages/leave/LeaveCalendarTab";
import { LeaveRequestsTab } from "@/pages/leave/LeaveRequestsTab";
import { LeaveSettingsTab } from "@/pages/leave/LeaveSettingsTab";

const TABS = ["requests", "balances", "calendar", "settings"] as const;
type LeaveTab = (typeof TABS)[number];

function parseTab(raw: string | null): LeaveTab {
  return (TABS as readonly string[]).includes(raw ?? "") ? (raw as LeaveTab) : "requests";
}

export function Leave() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));

  function selectTab(next: LeaveTab) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "requests") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  }

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "leave.title" })}</h2>
        <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "leave.description" })}</p>
      </div>

      <div role="tablist" aria-label={intl.formatMessage({ id: "leave.title" })} className="flex gap-1 border-b">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => selectTab(id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-[13px] font-medium transition-colors",
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {intl.formatMessage({ id: `leave.tab.${id}` })}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "requests" && <LeaveRequestsTab companyId={activeCompanyId} />}
        {tab === "balances" && <LeaveBalancesTab companyId={activeCompanyId} />}
        {tab === "calendar" && <LeaveCalendarTab companyId={activeCompanyId} />}
        {tab === "settings" && <LeaveSettingsTab companyId={activeCompanyId} />}
      </div>
    </div>
  );
}
