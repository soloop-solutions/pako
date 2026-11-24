import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PurchaseOrderSummaryResponse } from "@pako/shared";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { Card, CardContent } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";
import { ListRibbon } from "@/components/list/ListRibbon";
import { ListTotalsBar } from "@/components/list/ListTotalsBar";
import { PageHeader, LIST_SURFACE } from "@/components/list/PageHeader";
import { useListFilters } from "@/components/list/useListFilters";
import { usePartners } from "@/hooks/useDistribution";
import { useListRibbonOptions } from "@/hooks/useListRibbonOptions";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { PURCHASE_ORDER_STATES, PurchaseOrderState } from "@/lib/purchase-order-enums";
import { PurchaseOrderStateBadge, ProgressBadge } from "@/pages/bills/PurchaseOrderBadges";
import { cn } from "@/lib/utils";

const GRID_ID = "purchase-orders";
const RIBBON_FILTERS = ["from", "to", "partnerId", "warehouseId"] as const;

// docs/INVENTORY_PLAN.md §12 P5 — what has been ordered from vendors, and how much of it is billed.
export function PurchaseOrders() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const grid = useDataGridUrlState(GRID_ID, 50);
  const [state, setState] = useUrlParam("state", "", [`${GRID_ID}.page`]);

  // Client request 2026-11-24: the list ribbon — order date, vendor, warehouse — and the totals
  // under the list. The state pills keep their own URL key (the low-stock reorder links to it).
  const ribbon = useListFilters(GRID_ID, RIBBON_FILTERS);
  const ribbonOptions = useListRibbonOptions();
  const vendors = (usePartners().data ?? []).filter((p) => p.isVendor);
  const filters = {
    state: state === "" ? undefined : Number(state),
    partnerId: ribbon.values.partnerId || undefined,
    search: grid.globalFilter || undefined,
    from: ribbon.values.from || undefined,
    to: ribbon.values.to || undefined,
    warehouseId: ribbon.values.warehouseId || undefined,
  };

  const query = useQuery({
    queryKey: ["purchaseOrders", activeCompanyId, filters, grid.page, grid.pageSize],
    queryFn: () => apiClient.listPurchaseOrders(activeCompanyId as string, filters.state, filters.partnerId,
      filters.search, grid.page, grid.pageSize, filters.from, filters.to, filters.warehouseId),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const totals = useQuery({
    queryKey: ["purchaseOrders-totals", activeCompanyId, filters],
    queryFn: () => apiClient.purchaseOrderListTotals(activeCompanyId as string, filters.state, filters.partnerId, filters.search,
      filters.from, filters.to, filters.warehouseId),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<PurchaseOrderSummaryResponse>[]>(
    () => [
      { accessorKey: "date", header: t("po.col.date"), cell: ({ getValue }) => intl.formatDate(new Date(`${getValue() as string}T00:00`), { dateStyle: "medium" }) },
      { accessorKey: "number", header: t("po.col.number"), cell: ({ getValue }) => (getValue() as string | undefined) ?? t("stock.doc.draftNumber") },
      { accessorKey: "partnerName", header: t("po.col.vendor") },
      {
        accessorKey: "expectedDate",
        header: t("po.col.expected"),
        cell: ({ getValue }) => (getValue() ? intl.formatDate(new Date(`${getValue() as string}T00:00`), { dateStyle: "medium" }) : "—"),
      },
      { accessorKey: "lineCount", header: t("stock.doc.lines"), meta: { numeric: true } },
      { accessorKey: "state", header: t("po.col.state"), cell: ({ getValue }) => <PurchaseOrderStateBadge state={getValue() as number} /> },
      {
        accessorKey: "progress",
        header: t("po.col.billed"),
        cell: ({ row }) => (row.original.state === PurchaseOrderState.Draft ? "—" : <ProgressBadge progress={row.original.progress} />),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.purchaseOrders")}
        description={t("nav.purchaseOrders.description")}
        newAction={canWrite("purchases") ? { label: t("po.new"), onClick: () => navigate("/purchase-orders/new") } : undefined}
      />
      <Card className={LIST_SURFACE}>
        <CardContent className="flex flex-col gap-3">
          <ListRibbon
            controls={ribbon}
            dateLabelId="po.col.date"
            selects={[
              { name: "partnerId", labelId: "po.col.vendor", className: "w-56", options: vendors.map((v) => ({ value: v.id, label: v.name })) },
              ...(ribbonOptions.warehouses.length > 1
                ? [{ name: "warehouseId", labelId: "listRibbon.warehouse", className: "w-44", options: ribbonOptions.warehouses.map((w) => ({ value: w.id, label: w.name })) }]
                : []),
            ]}
          >
            <div className="inline-flex w-fit flex-wrap rounded-md border bg-card p-0.5" role="radiogroup" aria-label={t("po.col.state")}>
              {["", ...PURCHASE_ORDER_STATES.map(String)].map((value) => (
                <button
                  key={value || "all"}
                  type="button"
                  role="radio"
                  aria-checked={state === value}
                  onClick={() => setState(value)}
                  className={cn(
                    "h-7 rounded-[5px] px-3 text-[12.5px] font-medium",
                    state === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {value === "" ? t("stock.doc.allTypes") : t(`po.state.${value}`)}
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
            getRowClassName={(r) => cn(r.state === PurchaseOrderState.Draft && "text-muted-foreground", r.state === PurchaseOrderState.Cancelled && "line-through text-muted-foreground")}
            onRowClick={(r) => navigate(`/purchase-orders/${r.id}`)}
            enableGlobalFilter
            globalFilterPlaceholder={t("po.search")}
            emptyMessage={t("po.empty")}
          />
          <ListTotalsBar totals={totals.data} isLoading={totals.isFetching} showOutstanding={false} />
        </CardContent>
      </Card>
    </div>
  );
}
