import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { SalesOrderSummaryResponse } from "@pako/shared";
import { Plus } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCompany } from "@/context/CompanyContext";
import { usePartners } from "@/hooks/useDistribution";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatAmount } from "@/lib/payroll-enums";
import { SALES_ORDER_STATES, SalesOrderState, formatIsoDate } from "@/lib/sales-order-enums";
import { cn } from "@/lib/utils";
import { SalesOrderStateBadge, SalesProgressBadge } from "@/pages/sales/SalesOrderBadges";

const GRID_ID = "sales-orders";

// docs/POS_PLAN.md P6 — quotes and B2B sales orders, and how much of each is delivered and invoiced.
export function SalesOrders() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const grid = useDataGridUrlState(GRID_ID, 50);
  const [state, setState] = useUrlParam("state", "", [`${GRID_ID}.page`]);
  const [partnerId, setPartnerId] = useUrlParam("partner", "", [`${GRID_ID}.page`]);
  const customers = (usePartners().data ?? []).filter((p) => p.isCustomer);

  const query = useQuery({
    queryKey: ["salesOrders", activeCompanyId, state, partnerId, grid.globalFilter, grid.page, grid.pageSize],
    queryFn: () => apiClient.listSalesOrders(activeCompanyId as string, state === "" ? undefined : Number(state), partnerId || undefined,
      grid.globalFilter || undefined, grid.page, grid.pageSize),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<SalesOrderSummaryResponse>[]>(
    () => [
      { accessorKey: "date", header: t("so.col.date"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string) },
      {
        accessorKey: "number",
        header: t("so.col.number"),
        cell: ({ row }) => row.original.number ?? row.original.quoteNumber ?? t("stock.doc.draftNumber"),
      },
      { accessorKey: "partnerName", header: t("so.col.customer") },
      { accessorKey: "deliveryDate", header: t("so.col.deliveryDate"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string | undefined) },
      { accessorKey: "lineCount", header: t("stock.doc.lines"), meta: { numeric: true } },
      { accessorKey: "total", header: t("so.col.total"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "state", header: t("so.col.state"), cell: ({ getValue }) => <SalesOrderStateBadge state={getValue() as number} /> },
      {
        accessorKey: "delivery",
        header: t("so.col.delivery"),
        cell: ({ row }) => (row.original.state < SalesOrderState.Confirmed ? "—" : <SalesProgressBadge kind="delivery" progress={row.original.delivery} />),
      },
      {
        accessorKey: "invoicing",
        header: t("so.col.invoicing"),
        cell: ({ row }) => (row.original.state < SalesOrderState.Confirmed ? "—" : <SalesProgressBadge kind="invoicing" progress={row.original.invoicing} />),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("nav.salesOrders")}</CardTitle>
          <CardDescription>{t("nav.salesOrders.description")}</CardDescription>
        </div>
        {canWrite("sales") && (
          <Button size="sm" onClick={() => navigate("/sales-orders/new")}>
            <Plus className="size-4" />
            {t("so.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex w-fit flex-wrap rounded-md border bg-card p-0.5" role="radiogroup" aria-label={t("so.col.state")}>
            {["", ...SALES_ORDER_STATES.map(String)].map((value) => (
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
                {value === "" ? t("stock.doc.allTypes") : t(`so.state.${value}`)}
              </button>
            ))}
          </div>
          <div className="flex w-64 flex-col gap-1">
            <Label htmlFor="so-filter-customer">{t("so.col.customer")}</Label>
            <SearchableSelect id="so-filter-customer" value={partnerId} onChange={setPartnerId}
              placeholder={t("so.allCustomers")} emptyOptionLabel={t("so.allCustomers")} searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")} options={customers.map((c) => ({ value: c.id, label: c.name }))} />
          </div>
        </div>
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={query.data?.items ?? []}
          rowCount={query.data?.total ?? 0}
          isLoading={query.isPending}
          getRowId={(r) => r.id}
          getRowClassName={(r) => cn(r.state === SalesOrderState.Draft && "text-muted-foreground", r.state === SalesOrderState.Cancelled && "line-through text-muted-foreground")}
          onRowClick={(r) => navigate(`/sales-orders/${r.id}`)}
          enableGlobalFilter
          globalFilterPlaceholder={t("so.search")}
          emptyMessage={t("so.empty")}
        />
      </CardContent>
    </Card>
  );
}
