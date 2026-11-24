import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { StockDocumentSummaryResponse } from "@pako/shared";
import { Plus } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListRibbon } from "@/components/list/ListRibbon";
import { ListSumBar } from "@/components/list/ListTotalsBar";
import { PageHeader } from "@/components/list/PageHeader";
import { useListFilters } from "@/components/list/useListFilters";
import { usePartners } from "@/hooks/useDistribution";
import { useListRibbonOptions } from "@/hooks/useListRibbonOptions";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { formatAmount } from "@/lib/payroll-enums";
import { STOCK_DOCUMENT_TYPES, StockDocumentState, stockDocumentTypeKey } from "@/lib/stock-enums";
import { cn } from "@/lib/utils";
import { useUrlParam } from "@/hooks/useUrlParam";

const GRID_ID = "stock-documents";
const RIBBON_FILTERS = ["from", "to", "state", "warehouseId", "partnerId"] as const;

// docs/INVENTORY_PLAN.md §5.1 — opening stock, transfers, counts and write-offs, newest first.
export function StockDocuments() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const grid = useDataGridUrlState(GRID_ID, 50);
  const [type, setType] = useUrlParam("type", "", [`${GRID_ID}.page`]);

  // Client request 2026-11-24: the list ribbon — date, state, warehouse, partner — and the total
  // value under the list. The type pills keep their own URL key.
  const ribbon = useListFilters(GRID_ID, RIBBON_FILTERS);
  const ribbonOptions = useListRibbonOptions();
  const partners = usePartners().data ?? [];
  const filters = {
    type: type === "" ? undefined : Number(type),
    search: grid.globalFilter || undefined,
    state: ribbon.values.state ? Number(ribbon.values.state) : undefined,
    from: ribbon.values.from || undefined,
    to: ribbon.values.to || undefined,
    warehouseId: ribbon.values.warehouseId || undefined,
    partnerId: ribbon.values.partnerId || undefined,
  };

  const query = useQuery({
    queryKey: ["stockDocuments", activeCompanyId, filters, grid.page, grid.pageSize],
    queryFn: () => apiClient.listStockDocuments(activeCompanyId as string, filters.type, filters.search, grid.page, grid.pageSize, undefined,
      filters.state, filters.from, filters.to, filters.warehouseId, filters.partnerId),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const totals = useQuery({
    queryKey: ["stockDocuments-totals", activeCompanyId, filters],
    queryFn: () => apiClient.stockDocumentListTotals(activeCompanyId as string, filters.type, filters.search, undefined,
      filters.state, filters.from, filters.to, filters.warehouseId, filters.partnerId),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<StockDocumentSummaryResponse>[]>(
    () => [
      { accessorKey: "date", header: t("stock.card.date"), cell: ({ getValue }) => intl.formatDate(new Date(`${getValue() as string}T00:00`), { dateStyle: "medium" }) },
      { accessorKey: "number", header: t("stock.doc.number"), cell: ({ getValue }) => (getValue() as string | undefined) ?? t("stock.doc.draftNumber") },
      { accessorKey: "type", header: t("stock.doc.type"), cell: ({ getValue }) => t(`stock.doc.type.${stockDocumentTypeKey(getValue() as number)}`) },
      {
        id: "warehouses",
        header: t("stock.warehouse"),
        cell: ({ row }) => row.original.destinationWarehouseName ? `${row.original.warehouseName} → ${row.original.destinationWarehouseName}` : row.original.warehouseName,
      },
      { accessorKey: "lineCount", header: t("stock.doc.lines"), meta: { numeric: true } },
      { accessorKey: "totalValue", header: t("stock.col.value"), meta: { numeric: true }, cell: ({ row }) => (row.original.state === StockDocumentState.Posted ? formatAmount(row.original.totalValue) : "—") },
      {
        accessorKey: "state",
        header: t("stock.doc.state"),
        cell: ({ getValue }) => getValue() === StockDocumentState.Posted
          ? <Badge variant="success">{t("stock.doc.posted")}</Badge>
          : <Badge variant="outline" className="italic">{t("stock.doc.draft")}</Badge>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.stockDocuments")}
        description={t("nav.stockDocuments.description")}
        actions={canWrite("inventory") && STOCK_DOCUMENT_TYPES.map((value) => (
          <Button key={value} size="sm" variant="outline" onClick={() => navigate(`/stock-documents/new?type=${value}`)}>
            <Plus className="size-4" />
            {t(`stock.doc.type.${stockDocumentTypeKey(value)}`)}
          </Button>
        ))}
      />
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <ListRibbon
            controls={ribbon}
            dateLabelId="stock.card.date"
            selects={[
              { name: "state", labelId: "stock.doc.state", className: "w-36", options: [
                { value: String(StockDocumentState.Draft), label: t("stock.doc.draft") },
                { value: String(StockDocumentState.Posted), label: t("stock.doc.posted") },
              ] },
              ...(ribbonOptions.warehouses.length > 1
                ? [{ name: "warehouseId", labelId: "listRibbon.warehouse", className: "w-44", options: ribbonOptions.warehouses.map((w) => ({ value: w.id, label: w.name })) }]
                : []),
              { name: "partnerId", labelId: "listRibbon.partner", className: "w-56", options: partners.map((p) => ({ value: p.id, label: p.name })) },
            ]}
          >
            <div className="inline-flex w-fit flex-wrap rounded-md border bg-card p-0.5" role="radiogroup" aria-label={t("stock.doc.type")}>
              {["", ...STOCK_DOCUMENT_TYPES.map(String)].map((value) => (
                <button
                  key={value || "all"}
                  type="button"
                  role="radio"
                  aria-checked={type === value}
                  onClick={() => setType(value)}
                  className={cn(
                    "h-7 rounded-[5px] px-3 text-[12.5px] font-medium",
                    type === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {value === "" ? t("stock.doc.allTypes") : t(`stock.doc.type.${stockDocumentTypeKey(Number(value))}`)}
                </button>
              ))}
            </div>
          </ListRibbon>
          <DataGrid
            gridId={GRID_ID}
            columns={columns}
            data={query.data?.items ?? []}
            rowCount={query.data?.total ?? 0}
            isLoading={query.isPending}
            getRowId={(r) => r.id}
            getRowClassName={(r) => (r.state === StockDocumentState.Draft ? "text-muted-foreground" : undefined)}
            onRowClick={(r) => navigate(`/stock-documents/${r.id}`)}
            enableGlobalFilter
            globalFilterPlaceholder={t("stock.doc.search")}
            emptyMessage={t("stock.doc.empty")}
          />
          <ListSumBar totals={totals.data} isLoading={totals.isFetching} totalLabelId="listTotals.value" />
        </CardContent>
      </Card>
    </div>
  );
}
