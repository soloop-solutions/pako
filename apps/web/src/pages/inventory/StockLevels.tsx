import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { StockLevelResponse } from "@pako/shared";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useMyAccess } from "@/hooks/useMyAccess";
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
import { ExportButton } from "@/pages/reports/shared";
import { useReportExport } from "@/pages/reports/useReportExport";

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
  const [low] = useUrlParam("low", "", [`${GRID_ID}.page`]);
  const [, setSearchParams] = useSearchParams();
  // The low-stock view is the reorder list: one group per usual supplier.
  const setLow = (on: boolean) =>
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete(`${GRID_ID}.page`);
      if (on) {
        p.set("low", "1");
        p.set(`${GRID_ID}.group`, "supplier");
      } else {
        p.delete("low");
        if (p.get(`${GRID_ID}.group`) === "supplier") p.delete(`${GRID_ID}.group`);
      }
      return p;
    }, { replace: true });
  const [cardItem, setCardItem] = useState<StockLevelResponse | null>(null);
  const navigate = useNavigate();
  const { canWrite } = useMyAccess();
  // §12 P5: the reorder list becomes one draft purchase order per usual supplier.
  const createOrders = useMutation({
    mutationFn: () => apiClient.createPurchaseOrdersFromLowStock(activeCompanyId as string),
    onSuccess: (result) => {
      toast.success(intl.formatMessage({ id: "stock.lowStock.ordersCreated" }, { orders: result.purchaseOrderIds.length, items: result.items - result.itemsWithoutSupplier }));
      if (result.itemsWithoutSupplier > 0) toast.warning(intl.formatMessage({ id: "stock.lowStock.noSupplier" }, { count: result.itemsWithoutSupplier }));
      if (result.purchaseOrderIds.length > 0) navigate("/purchase-orders?state=0");
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, t("stock.lowStock.ordersError"))),
  });
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

  const exporter = useReportExport(
    () => apiClient.stockLevelsExport(activeCompanyId as string, grid.globalFilter || undefined, warehouseId || undefined,
      categoryId || undefined, low === "1"),
    "stock-levels.xlsx",
  );

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
      { accessorKey: "shortBy", header: t("stock.col.shortBy"), meta: { numeric: true }, cell: ({ getValue }) => (getValue() == null ? "" : intl.formatNumber(getValue() as number)) },
      {
        id: "supplier",
        accessorFn: (row) => row.usualSupplierName ?? t("stock.noSupplier"),
        header: t("stock.col.supplier"),
      },
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
            <input type="checkbox" checked={low === "1"} onChange={(e) => setLow(e.target.checked)} />
            {t("stock.onlyBelowMinimum")}
          </label>
          <ExportButton onClick={exporter.exportFile} loading={exporter.exporting} />
          {low === "1" && canWrite("purchases") && (query.data?.total ?? 0) > 0 && (
            <Button size="sm" variant="outline" className="ml-auto" disabled={createOrders.isPending} onClick={() => createOrders.mutate()}>
              <ShoppingCart className="size-4" />
              {t("stock.lowStock.createOrders")}
            </Button>
          )}
        </div>
        {exporter.exportError && <p role="alert" className="text-sm text-destructive">{exporter.exportError}</p>}
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
          // Grouping happens in the browser, and only in the low-stock view, which is a short list.
          manualGrouping={low !== "1"}
        />
      </CardContent>
      {cardItem && <ItemCardDialog itemId={cardItem.itemId} title={`${cardItem.itemCode} · ${cardItem.itemName}`} onClose={() => setCardItem(null)} />}
    </Card>
  );
}
