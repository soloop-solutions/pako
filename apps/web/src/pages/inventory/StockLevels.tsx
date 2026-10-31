import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { StockLevelResponse } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useWarehouses } from "@/hooks/useStock";
import { formatAmount } from "@/lib/payroll-enums";
import { ItemCardDialog } from "@/pages/inventory/ItemCardDialog";
import { useUrlParam } from "@/hooks/useUrlParam";

const GRID_ID = "stock-levels";

// docs/INVENTORY_PLAN.md §5.5 — what is in stock: quantity per warehouse, average cost and value of
// every stock-tracked item. Filters live in the URL; a row opens the item card (kartela).
export function StockLevels() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const grid = useDataGridUrlState(GRID_ID, 50);
  const [warehouseId, setWarehouseId] = useUrlParam("warehouse", "", [`${GRID_ID}.page`]);
  const [categoryId, setCategoryId] = useUrlParam("category", "", [`${GRID_ID}.page`]);
  const [low, setLow] = useUrlParam("low", "", [`${GRID_ID}.page`]);
  const [cardItem, setCardItem] = useState<StockLevelResponse | null>(null);
  const warehouses = useWarehouses().data ?? [];
  const categories = useQuery({
    queryKey: ["itemCategories", activeCompanyId],
    queryFn: () => apiClient.listItemCategories(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? [];

  const query = useQuery({
    queryKey: ["stockLevels", activeCompanyId, grid.page, grid.pageSize, grid.globalFilter, warehouseId, categoryId, low],
    queryFn: () => apiClient.listStockLevels(activeCompanyId as string, grid.globalFilter || undefined, warehouseId || undefined,
      categoryId || undefined, low === "1", grid.page, grid.pageSize),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<StockLevelResponse>[]>(
    () => [
      { accessorKey: "itemCode", header: t("stock.col.code"), meta: { numeric: true } },
      {
        accessorKey: "itemName",
        header: t("stock.col.item"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.itemName}
            {row.original.belowMinimum && <Badge variant="warning">{t("stock.belowMinimum")}</Badge>}
          </span>
        ),
      },
      { accessorKey: "categoryName", header: t("stock.col.category"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      {
        id: "warehouses",
        header: t("stock.col.warehouses"),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.warehouses.map((w) => `${w.warehouseName}: ${intl.formatNumber(w.quantity)}`).join(" · ") || "—"}
          </span>
        ),
      },
      {
        accessorKey: "quantity",
        header: t("stock.col.quantity"),
        meta: { numeric: true },
        cell: ({ row }) => `${intl.formatNumber(row.original.quantity)} ${row.original.unit}`,
      },
      { accessorKey: "minimumStock", header: t("stock.col.minimum"), meta: { numeric: true }, cell: ({ getValue }) => (getValue() == null ? "—" : intl.formatNumber(getValue() as number)) },
      { accessorKey: "averageCost", header: t("stock.col.averageCost"), meta: { numeric: true }, cell: ({ getValue }) => intl.formatNumber(getValue() as number, { maximumFractionDigits: 4 }) },
      { accessorKey: "value", header: t("stock.col.value"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("nav.stockLevels")}</CardTitle>
        <CardDescription>{t("nav.stockLevels.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {warehouses.length > 1 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="stock-warehouse">{t("stock.warehouse")}</Label>
              <Select
                id="stock-warehouse"
                className="w-52"
                value={warehouseId}
                onValueChange={setWarehouseId}
                options={[{ value: "", label: t("stock.allWarehouses") }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
              />
            </div>
          )}
          {categories.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="stock-category">{t("stock.col.category")}</Label>
              <Select
                id="stock-category"
                className="w-52"
                value={categoryId}
                onValueChange={setCategoryId}
                options={[{ value: "", label: t("stock.allCategories") }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </div>
          )}
          <label className="flex h-8 items-center gap-2 text-sm">
            <input type="checkbox" checked={low === "1"} onChange={(e) => setLow(e.target.checked ? "1" : "")} />
            {t("stock.onlyBelowMinimum")}
          </label>
        </div>
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={query.data?.items ?? []}
          rowCount={query.data?.total ?? 0}
          isLoading={query.isPending}
          getRowId={(r) => r.itemId}
          onRowClick={setCardItem}
          enableGlobalFilter
          globalFilterPlaceholder={t("stock.search")}
          emptyMessage={t("stock.empty")}
          exportFileName="stock"
        />
      </CardContent>
      {cardItem && <ItemCardDialog itemId={cardItem.itemId} title={`${cardItem.itemCode} · ${cardItem.itemName}`} onClose={() => setCardItem(null)} />}
    </Card>
  );
}
