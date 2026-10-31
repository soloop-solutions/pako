import { useMemo } from "react";
import { useIntl } from "react-intl";

import type { BalanceSheetComparativeResponse, ComparativeLine, ComparativeTotals } from "@pako/shared";

import { formatAmount } from "./helpers";
import { ReportGrid, type ReportRow } from "./ReportGrid";

export function ComparativeBalanceSheet({ data }: { data: BalanceSheetComparativeResponse }) {
  const intl = useIntl();

  const rows = useMemo<ReportRow[]>(() => {
    const section = (key: string, titleId: string, lines: ComparativeLine[], totalTitleId: string, totals: ComparativeTotals): ReportRow[] => [
      { key, kind: "section", label: intl.formatMessage({ id: titleId }), values: [] },
      ...lines.map((line): ReportRow => ({
        key: `${key}-${line.accountId}`,
        kind: "line",
        code: line.accountCode,
        label: line.accountName,
        values: [line.current, line.prior, line.difference],
      })),
      { key: `${key}-total`, kind: "summary", label: intl.formatMessage({ id: totalTitleId }), values: [totals.current, totals.prior, totals.difference] },
    ];
    return [
      ...section("assets", "reports.assets", data.assets, "reports.totalAssetsRow", data.assetsTotals),
      ...section("liabilities", "reports.liabilities", data.liabilities, "reports.totalLiabilitiesRow", data.liabilitiesTotals),
      ...section("equity", "reports.equity", data.equity, "reports.totalEquityRow", data.equityTotals),
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
