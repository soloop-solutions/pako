import { useMemo } from "react";
import { useIntl } from "react-intl";

import type { CashFlowLine } from "@pako/shared";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { accountPath } from "@/lib/entityLinks";

import { formatAmount } from "./helpers";
import { ReportGrid, type ReportRow } from "./ReportGrid";
import { DateRangeFields, ReportShell } from "./ReportShell";
import type { useCashFlowReport } from "./useCashFlowReport";

export function CashFlowTab({ report, companyName, accountingLockDate }: { report: ReturnType<typeof useCashFlowReport>; companyName: string; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const { period, data } = report;

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    const section = (key: string, titleId: string, lines: CashFlowLine[]): ReportRow[] => [
      { key, kind: "section", label: intl.formatMessage({ id: titleId }), values: [] },
      ...lines.map((line): ReportRow => ({ key: `${key}-${line.accountId}`, kind: "line", code: line.accountCode, label: line.accountName, values: [line.amount], href: accountPath(line.accountId) })),
    ];
    return [
      { key: "opening", kind: "summary", label: intl.formatMessage({ id: "reports.openingCash" }), values: [data.openingCash] },
      { key: "net-income", kind: "line", label: intl.formatMessage({ id: "reports.netIncomeLabel" }), values: [data.netIncome] },
      ...section("operating", "reports.cashFlowOperating", data.operating),
      ...section("investing", "reports.cashFlowInvesting", data.investing),
      ...section("financing", "reports.cashFlowFinancing", data.financing),
      { key: "net-change", kind: "summary", label: intl.formatMessage({ id: "reports.netChangeInCash" }), values: [data.netChange] },
      { key: "closing", kind: "summary", label: intl.formatMessage({ id: "reports.closingCash" }), values: [data.closingCash] },
      { key: "difference", kind: data.difference !== 0 ? "flag" : "line", label: intl.formatMessage({ id: "reports.difference" }), values: [data.difference] },
    ];
  }, [data, intl]);

  return (
    <ReportShell
      titleId="reports.cashFlow"
      companyName={companyName}
      periodEnd={period.to}
      accountingLockDate={accountingLockDate}
      onExport={report.exportFile}
      exporting={report.exporting}
      exportError={report.exportError}
      error={report.error}
      controls={<DateRangeFields idPrefix="cash-flow" from={period.from} to={period.to} onFrom={period.setFrom} onTo={period.setTo} />}
    >
      {data && data.difference !== 0 && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-800">
          <AlertDescription className="text-amber-800">
            {intl.formatMessage({ id: "reports.cashFlowDifferenceAlert" }, { amount: formatAmount(data.difference) })}
          </AlertDescription>
        </Alert>
      )}
      {data && <ReportGrid gridId="cashFlow" rows={rows} valueHeaders={[intl.formatMessage({ id: "common.amount" })]} />}
    </ReportShell>
  );
}
