import { useMemo } from "react";
import { useIntl } from "react-intl";

import type { BalanceSheetComparativeResponse, ComparativeLine } from "@pako/shared";

import { formatAmount } from "./helpers";
import { ReportGrid, type ReportRow } from "./ReportGrid";

export function ComparativeBalanceSheet({ data }: { data: BalanceSheetComparativeResponse }) {
  const intl = useIntl();

  const rows = useMemo<ReportRow[]>(() => {
    const section = (key: string, titleId: string, lines: ComparativeLine[]): ReportRow[] => [
      { key, kind: "section", label: intl.formatMessage({ id: titleId }), values: [] },
      ...lines.map((line): ReportRow => ({
        key: `${key}-${line.accountId}`,
        kind: "line",
        code: line.accountCode,
        label: line.accountName,
        values: [line.current, line.prior, line.difference],
      })),
    ];
    return [
      ...section("assets", "reports.assets", data.assets),
      ...section("liabilities", "reports.liabilities", data.liabilities),
      ...section("equity", "reports.equity", data.equity),
    ];
  }, [data, intl]);

  const headers = [
    intl.formatMessage({ id: "reports.current" }),
    intl.formatMessage({ id: "reports.prior" }),
    intl.formatMessage({ id: "reports.difference" }),
  ];

  return (
    <div className="flex flex-col gap-2">
      <ReportGrid gridId="balanceSheetCompare" rows={rows} valueHeaders={headers} />
      <p className="text-right text-sm font-medium">
        {intl.formatMessage({ id: "reports.totalAssets" }, { amount: formatAmount(data.totalAssets) })}
      </p>
      <p className="text-right text-sm font-medium">
        {intl.formatMessage({ id: "reports.totalLiabilitiesAndEquity" }, { amount: formatAmount(data.totalLiabilitiesAndEquity) })}
      </p>
    </div>
  );
}
