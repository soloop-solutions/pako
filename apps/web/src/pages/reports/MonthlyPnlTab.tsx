import { useMemo } from "react";
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

  const monthHeaders = useMemo(
    () => Array.from({ length: 12 }, (_, index) => intl.formatDate(new Date(2026, index, 1), { month: "short" })),
    [intl],
  );
  const valueHeaders = useMemo(() => [...monthHeaders, intl.formatMessage({ id: "common.total" })], [monthHeaders, intl]);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    const section = (key: string, titleId: string, lines: MonthlyReportLine[]): ReportRow[] => [
      { key, kind: "section", label: intl.formatMessage({ id: titleId }), values: [] },
      ...lines.map((line): ReportRow => ({
        key: `${key}-${line.accountId}`,
        kind: "line",
        code: line.accountCode,
        label: line.accountName,
        values: [...line.months, line.total],
      })),
    ];
    return [
      ...section("income", "reports.income", data.income),
      ...section("cost", "reports.costOfRevenue", data.costOfRevenue),
      { key: "gross", kind: "summary", label: intl.formatMessage({ id: "reports.grossProfit" }), values: [...data.grossProfitByMonth, data.grossProfit] },
      ...section("expenses", "reports.expenses", data.expenses),
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
          <Input id="monthly-pnl-year" type="number" min={2000} max={2100} value={period.year} onChange={(event) => period.setYear(event.target.value)} />
        </div>
      }
    >
      {data && <ReportGrid gridId="monthlyPnl" rows={rows} valueHeaders={valueHeaders} />}
    </ReportShell>
  );
}
