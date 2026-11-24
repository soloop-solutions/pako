import { useIntl } from "react-intl";
import { PageHeader } from "@/components/list/PageHeader";
import { useSearchParams } from "react-router-dom";

import { TabButton } from "@/components/ui/tabs";
import { useCompany } from "@/context/CompanyContext";
import { AssetCategoriesTab } from "@/pages/assets/AssetCategoriesTab";
import { AssetRegisterTab } from "@/pages/assets/AssetRegisterTab";
import { AssetScheduleTab } from "@/pages/assets/AssetScheduleTab";
import { DepreciationRunsTab } from "@/pages/assets/DepreciationRunsTab";

const TABS = ["register", "depreciation", "schedule", "categories"] as const;
type Tab = (typeof TABS)[number];

// Client feedback 2026-11 (fixed assets v1): the register, monthly depreciation runs, the
// year-end depreciation schedule and the asset categories. Every figure comes from the API.
export function FixedAssets() {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "register";

  if (!activeCompanyId) {
    return <p className="text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={intl.formatMessage({ id: "nav.fixedAssets" })} description={intl.formatMessage({ id: "nav.fixedAssets.description" })} />
      <div role="tablist" aria-label={intl.formatMessage({ id: "nav.fixedAssets" })} className="flex gap-1 border-b">
        {TABS.map((id) => (
          <TabButton key={id} selected={tab === id} onClick={() => setSearchParams(id === "register" ? {} : { tab: id }, { replace: true })}>
            {intl.formatMessage({ id: `assets.tab.${id}` })}
          </TabButton>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "register" && <AssetRegisterTab companyId={activeCompanyId} />}
        {tab === "depreciation" && <DepreciationRunsTab companyId={activeCompanyId} />}
        {tab === "schedule" && <AssetScheduleTab companyId={activeCompanyId} />}
        {tab === "categories" && <AssetCategoriesTab companyId={activeCompanyId} />}
      </div>
    </div>
  );
}
