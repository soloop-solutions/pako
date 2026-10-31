import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useIntl } from "react-intl";

import type { StockMovementRow } from "@pako/shared";

import { DataGrid } from "@/components/data-grid/DataGrid";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

import { formatAmount } from "./helpers";
import { staticColumn } from "./reportColumns";
import { DateRangeFields, ReportShell } from "./ReportShell";
import { STOCK_MOVEMENTS_GRID_ID, STOCK_MOVEMENTS_SORTABLE, type useStockMovementsReport } from "./useStockMovementsReport";

export function StockMovementsTab({ report, companyName, accountingLockDate }: { report: ReturnType<typeof useStockMovementsReport>; companyName: string; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const { period, data } = report;

  const columns = useMemo<ColumnDef<StockMovementRow>[]>(() => {
    const col = (id: string, header: string, accessorFn: (row: StockMovementRow) => string | number, numeric = false, format?: (row: StockMovementRow) => string) =>
      staticColumn<StockMovementRow>({
        id,
        header,
        accessorFn,
        enableSorting: STOCK_MOVEMENTS_SORTABLE.has(id),
        ...(format ? { cell: ({ row }: { row: { original: StockMovementRow } }) => format(row.original) } : {}),
        meta: { numeric },
      });
    const amount = (pick: (row: StockMovementRow) => number | undefined) => (row: StockMovementRow) => {
      const value = pick(row);
      return value == null ? "" : formatAmount(value);
    };
    const quantity = (pick: (row: StockMovementRow) => number) => (row: StockMovementRow) => intl.formatNumber(pick(row));
    return [
      col("code", intl.formatMessage({ id: "stock.col.code" }), (row) => row.itemCode, true),
      col("name", intl.formatMessage({ id: "reports.smName" }), (row) => row.itemName),
      col("unit", intl.formatMessage({ id: "reports.smUnit" }), (row) => row.unit),
      col("category", intl.formatMessage({ id: "stock.col.category" }), (row) => row.categoryName ?? ""),
      col("openingQuantity", intl.formatMessage({ id: "reports.smOpeningQty" }), (row) => row.openingQuantity, true, quantity((row) => row.openingQuantity)),
      col("openingValue", intl.formatMessage({ id: "reports.smOpeningValue" }), (row) => row.openingValue, true, amount((row) => row.openingValue)),
      col("inQuantity", intl.formatMessage({ id: "reports.smInQty" }), (row) => row.inQuantity, true, quantity((row) => row.inQuantity)),
      col("inValue", intl.formatMessage({ id: "reports.smInValue" }), (row) => row.inValue, true, amount((row) => row.inValue)),
      col("outQuantity", intl.formatMessage({ id: "reports.smOutQty" }), (row) => row.outQuantity, true, quantity((row) => row.outQuantity)),
      col("outValue", intl.formatMessage({ id: "reports.smOutValue" }), (row) => row.outValue, true, amount((row) => row.outValue)),
      col("closingQuantity", intl.formatMessage({ id: "reports.smClosingQty" }), (row) => row.closingQuantity, true, quantity((row) => row.closingQuantity)),
      col("averageCost", intl.formatMessage({ id: "reports.smAverageCost" }), (row) => row.averageCost, true, (row) => intl.formatNumber(row.averageCost, { maximumFractionDigits: 4 })),
      col("closingValue", intl.formatMessage({ id: "reports.smClosingValue" }), (row) => row.closingValue, true, amount((row) => row.closingValue)),
      col("sellPriceExVat", intl.formatMessage({ id: "reports.smSellPrice" }), (row) => row.sellPriceExVat ?? "", true, amount((row) => row.sellPriceExVat)),
      col("markup", intl.formatMessage({ id: "reports.smMarkup" }), (row) => row.markupPercent ?? "", true, amount((row) => row.markupPercent)),
    ];
  }, [intl]);

  const filtered = !!(report.search || report.categoryId || report.warehouseId);

  return (
    <ReportShell
      titleId="reports.stockMovements"
      companyName={companyName}
      periodEnd={period.to}
      accountingLockDate={accountingLockDate}
      onExport={report.exportFile}
      exporting={report.exporting}
      exportError={report.exportError}
      error={report.error}
      controls={
        <>
          <DateRangeFields idPrefix="stock-movements" from={period.from} to={period.to} onFrom={period.setFrom} onTo={period.setTo} />
          <div className="flex flex-col gap-2">
            <Label>{intl.formatMessage({ id: "stock.col.category" })}</Label>
            <Select
              className="w-56"
              aria-label={intl.formatMessage({ id: "stock.col.category" })}
              value={report.categoryId ?? ""}
              onValueChange={(value) => period.setParam("category", value || null)}
              options={[
                { value: "", label: intl.formatMessage({ id: "stock.allCategories" }) },
                ...report.categories.map((category) => ({ value: category.id, label: category.name })),
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{intl.formatMessage({ id: "stock.warehouse" })}</Label>
            <Select
              className="w-56"
              aria-label={intl.formatMessage({ id: "stock.warehouse" })}
              value={report.warehouseId ?? ""}
              onValueChange={(value) => period.setParam("warehouse", value || null)}
              options={[
                { value: "", label: intl.formatMessage({ id: "stock.allWarehouses" }) },
                ...report.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
              ]}
            />
          </div>
        </>
      }
    >
      {!report.forbidden && (
        <DataGrid<StockMovementRow>
          gridId={STOCK_MOVEMENTS_GRID_ID}
          columns={columns}
          data={data?.items ?? []}
          rowCount={data?.total ?? 0}
          isLoading={report.loading && !data}
          getRowId={(row) => row.itemId}
          enableGlobalFilter
          globalFilterPlaceholder={intl.formatMessage({ id: "reports.smSearchPlaceholder" })}
          emptyMessage={filtered ? undefined : intl.formatMessage({ id: "reports.smEmpty" })}
          footerRow={
            data
              ? {
                  label: intl.formatMessage({ id: "common.total" }),
                  cells: {
                    openingValue: formatAmount(data.totalOpeningValue),
                    inValue: formatAmount(data.totalInValue),
                    outValue: formatAmount(data.totalOutValue),
                    closingValue: formatAmount(data.totalClosingValue),
                  },
                }
              : undefined
          }
        />
      )}
    </ReportShell>
  );
}
