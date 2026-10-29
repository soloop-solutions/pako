import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";

import { BalanceSheetTab } from "./BalanceSheetTab";
import { CashFlowTab } from "./CashFlowTab";
import { ChecksPanel } from "./ChecksPanel";
import { DebtTab } from "./DebtTab";
import { EquityTab } from "./EquityTab";
import { ExpenseBookTab } from "./ExpenseBookTab";
import { GeneralLedgerTab } from "./GeneralLedgerTab";
import { MonthlyPnlTab } from "./MonthlyPnlTab";
import { PnlTab } from "./PnlTab";
import { PurchaseBookTab } from "./PurchaseBookTab";
import { SalesBookTab } from "./SalesBookTab";
import { VatTab } from "./VatTab";
import { useBalanceSheetReport } from "./useBalanceSheetReport";
import { useCashFlowReport } from "./useCashFlowReport";
import { useDebtReport } from "./useDebtReport";
import { useEquityStatementReport } from "./useEquityStatementReport";
import { useExpenseBookReport } from "./useExpenseBookReport";
import { useGeneralLedgerReport } from "./useGeneralLedgerReport";
import { useMonthlyPnlReport } from "./useMonthlyPnlReport";
import { usePnlReport } from "./usePnlReport";
import { usePurchaseBookReport } from "./usePurchaseBookReport";
import { useSalesBookReport } from "./useSalesBookReport";
import { useVatReport } from "./useVatReport";

type Tab =
  | "pnl"
  | "balance-sheet"
  | "vat"
  | "debt"
  | "sales-book"
  | "purchase-book"
  | "general-ledger"
  | "monthly-pnl"
  | "cash-flow"
  | "equity"
  | "expense-book";

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
    { key: "general-ledger", labelKey: "reports.generalLedger" },
    { key: "monthly-pnl", labelKey: "reports.monthlyPnl" },
    { key: "cash-flow", labelKey: "reports.cashFlow" },
    { key: "equity", labelKey: "reports.equityStatement" },
    { key: "expense-book", labelKey: "reports.expenseBook" },
  ];

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : "pnl";
  function setTab(next: Tab) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  }

  const pnlReport = usePnlReport(companyId);
  const balanceSheetReport = useBalanceSheetReport(companyId);
  const vatReport = useVatReport(companyId);
  const debtReport = useDebtReport(companyId);
  const salesBookReport = useSalesBookReport(companyId);
  const purchaseBookReport = usePurchaseBookReport(companyId);
  const generalLedgerReport = useGeneralLedgerReport(companyId, tab === "general-ledger");
  const monthlyPnlReport = useMonthlyPnlReport(companyId, tab === "monthly-pnl");
  const cashFlowReport = useCashFlowReport(companyId, tab === "cash-flow");
  const equityReport = useEquityStatementReport(companyId, tab === "equity");
  const expenseBookReport = useExpenseBookReport(companyId, tab === "expense-book");

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
      <ChecksPanel companyId={activeCompany.id} />
      <div className="flex flex-wrap gap-2">
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
      {tab === "general-ledger" && (
        <GeneralLedgerTab report={generalLedgerReport} companyName={activeCompany.name} accountingLockDate={accountingLockDate} />
      )}
      {tab === "monthly-pnl" && (
        <MonthlyPnlTab report={monthlyPnlReport} companyName={activeCompany.name} accountingLockDate={accountingLockDate} />
      )}
      {tab === "cash-flow" && <CashFlowTab report={cashFlowReport} companyName={activeCompany.name} accountingLockDate={accountingLockDate} />}
      {tab === "equity" && <EquityTab report={equityReport} companyName={activeCompany.name} accountingLockDate={accountingLockDate} />}
      {tab === "expense-book" && (
        <ExpenseBookTab report={expenseBookReport} companyName={activeCompany.name} accountingLockDate={accountingLockDate} />
      )}
    </div>
  );
}
