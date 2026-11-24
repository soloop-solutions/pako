import { useIntl } from "react-intl";

import type { ListTotalsResponse } from "@pako/shared";

// Client request 2026-11-24: the totals under a list — every document the ribbon's filters select,
// across all pages, as the server sums them (credit notes and returns count negative). Display
// only: nothing here is computed in the browser.
export function ListTotalsBar({ totals, isLoading, showOutstanding = true }: {
  totals: ListTotalsResponse | undefined;
  isLoading?: boolean;
  showOutstanding?: boolean;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  if (!totals) return null;
  const money = (value: number) => intl.formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const figures: [string, string][] = [
    ["listTotals.count", intl.formatNumber(totals.count)],
    ...(totals.discountAmount !== 0 ? ([["listTotals.discount", money(totals.discountAmount)]] as [string, string][]) : []),
    ["listTotals.net", money(totals.netAmount)],
    ["listTotals.tax", money(totals.taxAmount)],
    ["listTotals.gross", money(totals.grossAmount)],
  ];
  if (showOutstanding && totals.outstanding !== undefined && totals.outstanding !== null) {
    figures.push(["listTotals.outstanding", money(totals.outstanding)]);
  }

  return (
    <div
      className={`mt-2 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 rounded-md border bg-totals px-3 py-1.5 text-sm text-totals-foreground ${isLoading ? "opacity-60" : ""}`}
      data-testid="list-totals"
      aria-label={t("listTotals.title")}
    >
      <span className="mr-auto text-xs text-muted-foreground">{t("listTotals.title")}</span>
      {figures.map(([labelId, value]) => (
        <span key={labelId} className="flex items-baseline gap-1.5">
          <span className="text-xs text-muted-foreground">{t(labelId)}</span>
          <span className="font-semibold tabular-nums" data-testid={labelId}>{value}</span>
        </span>
      ))}
    </div>
  );
}
