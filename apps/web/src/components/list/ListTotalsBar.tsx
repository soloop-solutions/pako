import { useIntl } from "react-intl";

import { formatMoney } from "@/lib/amount";
import type { BankStatementListTotalsResponse, JournalListTotalsResponse, ListSumResponse, ListTotalsResponse } from "@pako/shared";

export interface ListFigure {
  labelId: string;
  value: string;
}

// Client request 2026-11-24: the totals under a list — every row the ribbon's filters select,
// across all pages, as the server sums them. Display only: nothing here is computed in the browser.
export function ListFiguresBar({ figures, isLoading }: { figures: ListFigure[] | undefined; isLoading?: boolean }) {
  const intl = useIntl();
  if (!figures) return null;
  return (
    <div
      className={`mt-2 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 rounded-md border bg-totals px-3 py-1.5 text-sm text-totals-foreground ${isLoading ? "opacity-60" : ""}`}
      data-testid="list-totals"
      aria-label={intl.formatMessage({ id: "listTotals.title" })}
    >
      <span className="mr-auto text-xs text-muted-foreground">{intl.formatMessage({ id: "listTotals.title" })}</span>
      {figures.map(({ labelId, value }) => (
        <span key={labelId} className="flex items-baseline gap-1.5">
          <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: labelId })}</span>
          <span className="font-semibold tabular-nums" data-testid={labelId}>{value}</span>
        </span>
      ))}
    </div>
  );
}

function useMoney() {
  const intl = useIntl();
  return {
    money: (value: number) => formatMoney(value),
    count: (value: number) => intl.formatNumber(value),
  };
}

/** Sales and purchase documents: count, discount, net, VAT, total and (optionally) outstanding. */
export function ListTotalsBar({ totals, isLoading, showOutstanding = true }: {
  totals: ListTotalsResponse | undefined;
  isLoading?: boolean;
  showOutstanding?: boolean;
}) {
  const { money, count } = useMoney();
  if (!totals) return null;
  const figures: ListFigure[] = [{ labelId: "listTotals.count", value: count(totals.count) }];
  if (totals.discountAmount !== 0) figures.push({ labelId: "listTotals.discount", value: money(totals.discountAmount) });
  figures.push(
    { labelId: "listTotals.net", value: money(totals.netAmount) },
    { labelId: "listTotals.tax", value: money(totals.taxAmount) },
    { labelId: "listTotals.gross", value: money(totals.grossAmount) },
  );
  if (showOutstanding && totals.outstanding !== undefined && totals.outstanding !== null) {
    figures.push({ labelId: "listTotals.outstanding", value: money(totals.outstanding) });
  }
  return <ListFiguresBar figures={figures} isLoading={isLoading} />;
}

/** One amount per row (stock document value, POS order total): count and total. */
export function ListSumBar({ totals, isLoading, totalLabelId = "listTotals.gross" }: {
  totals: ListSumResponse | undefined;
  isLoading?: boolean;
  totalLabelId?: string;
}) {
  const { money, count } = useMoney();
  if (!totals) return null;
  return (
    <ListFiguresBar
      isLoading={isLoading}
      figures={[{ labelId: "listTotals.count", value: count(totals.count) }, { labelId: totalLabelId, value: money(totals.total) }]}
    />
  );
}

/** Journal entries: count, debit and credit. */
export function JournalTotalsBar({ totals, isLoading }: { totals: JournalListTotalsResponse | undefined; isLoading?: boolean }) {
  const { money, count } = useMoney();
  if (!totals) return null;
  return (
    <ListFiguresBar
      isLoading={isLoading}
      figures={[
        { labelId: "listTotals.entries", value: count(totals.count) },
        { labelId: "listTotals.debit", value: money(totals.debit) },
        { labelId: "listTotals.credit", value: money(totals.credit) },
      ]}
    />
  );
}

/** Bank statements: how many, and the money in and out of their lines (server sums). */
export function BankStatementTotalsBar({ totals, isLoading }: { totals: BankStatementListTotalsResponse | undefined; isLoading?: boolean }) {
  const { money, count } = useMoney();
  if (!totals) return null;
  return (
    <ListFiguresBar
      isLoading={isLoading}
      figures={[
        { labelId: "listTotals.statements", value: count(totals.count) },
        { labelId: "listTotals.moneyIn", value: money(totals.totalIn) },
        { labelId: "listTotals.moneyOut", value: money(totals.totalOut) },
      ]}
    />
  );
}
