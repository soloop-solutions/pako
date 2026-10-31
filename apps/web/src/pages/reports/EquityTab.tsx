import { useMemo } from "react";
import { useIntl } from "react-intl";

import { accountPath } from "@/lib/entityLinks";

import { ReportGrid, type ReportRow } from "./ReportGrid";
import { DateRangeFields, ReportShell } from "./ReportShell";
import type { useEquityStatementReport } from "./useEquityStatementReport";

export function EquityTab({ report, companyName, accountingLockDate }: { report: ReturnType<typeof useEquityStatementReport>; companyName: string; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const { period, data } = report;

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    return [
      { key: "opening", kind: "summary", label: intl.formatMessage({ id: "reports.openingEquity" }), values: [data.openingEquity] },
      { key: "net-income", kind: "line", label: intl.formatMessage({ id: "reports.netIncomeLabel" }), values: [data.netIncome] },
      { key: "movements", kind: "section", label: intl.formatMessage({ id: "reports.equityMovements" }), values: [] },
      ...data.movements.map((line): ReportRow => ({ key: `m-${line.accountId}`, kind: "line", code: line.accountCode, label: line.accountName, values: [line.amount], href: accountPath(line.accountId) })),
      { key: "closing", kind: "summary", label: intl.formatMessage({ id: "reports.closingEquity" }), values: [data.closingEquity] },
    ];
  }, [data, intl]);

  return (
    <ReportShell
      titleId="reports.equityStatement"
      companyName={companyName}
      periodEnd={period.to}
      accountingLockDate={accountingLockDate}
      onExport={report.exportFile}
      exporting={report.exporting}
      exportError={report.exportError}
      error={report.error}
      controls={<DateRangeFields idPrefix="equity" from={period.from} to={period.to} onFrom={period.setFrom} onTo={period.setTo} />}
    >
      {data && <ReportGrid gridId="equity" rows={rows} valueHeaders={[intl.formatMessage({ id: "common.amount" })]} />}
    </ReportShell>
  );
}
