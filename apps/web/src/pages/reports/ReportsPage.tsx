import { useState } from "react";
import { useIntl } from "react-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";

import { BalanceSheetTab } from "./BalanceSheetTab";
import { DebtTab } from "./DebtTab";
import { PnlTab } from "./PnlTab";
import { PurchaseBookTab } from "./PurchaseBookTab";
import { SalesBookTab } from "./SalesBookTab";
import { VatTab } from "./VatTab";
import { useBalanceSheetReport } from "./useBalanceSheetReport";
import { useDebtReport } from "./useDebtReport";
import { usePnlReport } from "./usePnlReport";
import { usePurchaseBookReport } from "./usePurchaseBookReport";
import { useSalesBookReport } from "./useSalesBookReport";
import { useVatReport } from "./useVatReport";

type Tab = "pnl" | "balance-sheet" | "vat" | "debt" | "sales-book" | "purchase-book";

export function Reports() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const TABS: { key: Tab; labelKey: string }[] = [
    { key: "pnl", labelKey: "reports.profitAndLoss" },
    { key: "balance-sheet", labelKey: "reports.balanceSheet" },
    { key: "vat", labelKey: "reports.vatReturn" },
    { key: "debt", labelKey: "reports.debtAging" },
    { key: "sales-book", labelKey: "reports.salesBook" },
    { key: "purchase-book", labelKey: "reports.purchaseBook" },
  ];

  const [tab, setTab] = useState<Tab>("pnl");

  const pnlReport = usePnlReport(companyId);
  const balanceSheetReport = useBalanceSheetReport(companyId);
  const vatReport = useVatReport(companyId);
  const debtReport = useDebtReport(companyId);
  const salesBookReport = useSalesBookReport(companyId);
  const purchaseBookReport = usePurchaseBookReport(companyId);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "reports.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "reports.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
        </CardContent>
      </Card>
    );
  }

  const accountingLockDate = activeCompany.accountingLockDate;
  const taxLockDate = activeCompany.taxLockDate;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            type="button"
            variant={tab === t.key ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(t.key)}
          >
            {intl.formatMessage({ id: t.labelKey })}
          </Button>
        ))}
      </div>

      {tab === "pnl" && <PnlTab report={pnlReport} companyName={activeCompany.name} accountingLockDate={accountingLockDate} />}
      {tab === "balance-sheet" && (
        <BalanceSheetTab report={balanceSheetReport} companyName={activeCompany.name} accountingLockDate={accountingLockDate} />
      )}
      {tab === "vat" && <VatTab report={vatReport} companyName={activeCompany.name} taxLockDate={taxLockDate} />}
      {tab === "debt" && <DebtTab report={debtReport} accountingLockDate={accountingLockDate} />}
      {tab === "sales-book" && <SalesBookTab report={salesBookReport} companyName={activeCompany.name} taxLockDate={taxLockDate} />}
      {tab === "purchase-book" && (
        <PurchaseBookTab report={purchaseBookReport} companyName={activeCompany.name} taxLockDate={taxLockDate} />
      )}
    </div>
  );
}
