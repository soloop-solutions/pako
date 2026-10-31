import { useMemo, useState } from "react";
import { useIntl } from "react-intl";

import type { MonthlyReportLine } from "@pako/shared";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ReportGrid, type ReportRow } from "./ReportGrid";
import { ReportShell } from "./ReportShell";
import type { useMonthlyPnlReport } from "./useMonthlyPnlReport";

export function MonthlyPnlTab({ report, companyName, accountingLockDate }: { report: ReturnType<typeof useMonthlyPnlReport>; companyName: string; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const { period, data } = report;
  const [draft, setDraft] = useState(String(period.year));
  const [draftSource, setDraftSource] = useState(period.year);
  if (draftSource !== period.year) {
    setDraftSource(period.year);
    setDraft(String(period.year));
  }

  function changeYear(value: string) {
    setDraft(value);
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100) period.setYear(value);
  }

  const monthHeaders = useMemo(
    () => Array.from({ length: 12 }, (_, index) => intl.formatMessage({ id: `reports.monthShort${index + 1}` })),
    [intl],
  );
  const valueHeaders = useMemo(() => [...monthHeaders, intl.formatMessage({ id: "common.total" })], [monthHeaders, intl]);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    const section = (key: string, titleId: string, lines: MonthlyReportLine[], totalTitleId: string, byMonth: number[], total: number): ReportRow[] => [
      { key, kind: "section", label: intl.formatMessage({ id: titleId }), values: [] },
      ...lines.map((line): ReportRow => ({
        key: `${key}-${line.accountId}`,
        kind: "line",
        code: line.accountCode,
        label: line.accountName,
        values: [...line.months, line.total],
      })),
      { key: `${key}-total`, kind: "summary", label: intl.formatMessage({ id: totalTitleId }), values: [...byMonth, total] },
    ];
    return [
      ...section("income", "reports.income", data.income, "reports.totalIncomeRow", data.incomeByMonth, data.totalIncome),
      ...section("cost", "reports.costOfRevenue", data.costOfRevenue, "reports.totalCostOfRevenueRow", data.costOfRevenueByMonth, data.totalCostOfRevenue),
      { key: "gross", kind: "summary", label: intl.formatMessage({ id: "reports.grossProfit" }), values: [...data.grossProfitByMonth, data.grossProfit] },
      ...section("expenses", "reports.expenses", data.expenses, "reports.totalExpensesRow", data.expensesByMonth, data.totalExpenses),
      { key: "net", kind: "summary", label: intl.formatMessage({ id: "reports.netIncomeLabel" }), values: [...data.netIncomeByMonth, data.netIncome] },
    ];
  }, [data, intl]);

  return (
    <ReportShell
      titleId="reports.monthlyPnl"
      companyName={companyName}
      periodEnd={`${period.year}-12-31`}
      accountingLockDate={accountingLockDate}
      onExport={report.exportFile}
      exporting={report.exporting}
      exportError={report.exportError}
      error={report.error}
      controls={
        <div className="flex flex-col gap-2">
          <Label htmlFor="monthly-pnl-year">{intl.formatMessage({ id: "reports.year" })}</Label>
          <Input id="monthly-pnl-year" type="number" min={2000} max={2100} value={draft} onChange={(event) => changeYear(event.target.value)} />
        </div>
      }
    >
      {data && <ReportGrid gridId="monthlyPnl" rows={rows} valueHeaders={valueHeaders} />}
    </ReportShell>
  );
}
