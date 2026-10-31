import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { ItemCardRowResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { formatAmount } from "@/lib/payroll-enums";
import { stockMoveKindKey } from "@/lib/stock-enums";

// The item card (kartela e artikullit): every stock move of one item with the running quantity,
// average cost and value after it — the audit trail behind every stock figure.
export function ItemCardDialog({ itemId, title, onClose }: { itemId: string; title: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useQuery({
    queryKey: ["itemCard", activeCompanyId, itemId, from, to],
    queryFn: () => apiClient.getItemCard(activeCompanyId as string, itemId, from || undefined, to || undefined),
    enabled: !!activeCompanyId,
  });
  const card = query.data;
  const qty = (v: number) => (v === 0 ? "" : intl.formatNumber(v));

  const columns = useMemo<ColumnDef<ItemCardRowResponse>[]>(
    () => [
      { accessorKey: "date", header: t("stock.card.date"), cell: ({ getValue }) => intl.formatDate(new Date(`${getValue() as string}T00:00`), { dateStyle: "medium" }) },
      { accessorKey: "reference", header: t("stock.card.document"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "kind", header: t("stock.card.kind"), cell: ({ getValue }) => t(`stock.kind.${stockMoveKindKey(getValue() as number)}`) },
      { id: "route", header: t("stock.card.route"), cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.fromLocation} → {row.original.toLocation}</span> },
      { accessorKey: "quantityIn", header: t("stock.card.in"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
      { accessorKey: "quantityOut", header: t("stock.card.out"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
      { accessorKey: "unitCost", header: t("stock.col.averageCost"), meta: { numeric: true }, cell: ({ getValue }) => intl.formatNumber(getValue() as number, { maximumFractionDigits: 4 }) },
      { accessorKey: "value", header: t("stock.card.value"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "qtyAfter", header: t("stock.card.qtyAfter"), meta: { numeric: true }, cell: ({ getValue }) => intl.formatNumber(getValue() as number) },
      { accessorKey: "valueAfter", header: t("stock.card.valueAfter"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={title} description={t("stock.card.title")} size="xl">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="card-from">{t("dashboard.period.from")}</Label>
            <Input id="card-from" type="date" className="h-8 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="card-to">{t("dashboard.period.to")}</Label>
            <Input id="card-to" type="date" className="h-8 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {card && (
            <p className="ml-auto text-sm text-muted-foreground tnum">
              {intl.formatMessage({ id: "stock.card.summary" }, {
                openQty: intl.formatNumber(card.openingQuantity), openValue: formatAmount(card.openingValue),
                closeQty: intl.formatNumber(card.closingQuantity), closeValue: formatAmount(card.closingValue),
              })}
            </p>
          )}
        </div>
        <DataGrid
          gridId="item-card"
          columns={columns}
          data={card?.rows ?? []}
          rowCount={card?.rows.length ?? 0}
          isLoading={query.isPending}
          getRowId={(r) => r.moveId}
          emptyMessage={t("stock.card.empty")}
          exportFileName="item-card"
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </div>
    </FormDialog>
  );
}
