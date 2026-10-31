import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PurchaseOrderSummaryResponse } from "@pako/shared";
import { Plus } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { PURCHASE_ORDER_STATES, PurchaseOrderState } from "@/lib/purchase-order-enums";
import { PurchaseOrderStateBadge, ProgressBadge } from "@/pages/bills/PurchaseOrderBadges";
import { cn } from "@/lib/utils";

const GRID_ID = "purchase-orders";

// docs/INVENTORY_PLAN.md §12 P5 — what has been ordered from vendors, and how much of it is billed.
export function PurchaseOrders() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const grid = useDataGridUrlState(GRID_ID, 50);
  const [state, setState] = useUrlParam("state", "", [`${GRID_ID}.page`]);

  const query = useQuery({
    queryKey: ["purchaseOrders", activeCompanyId, state, grid.globalFilter, grid.page, grid.pageSize],
    queryFn: () => apiClient.listPurchaseOrders(activeCompanyId as string, state === "" ? undefined : Number(state), undefined,
      grid.globalFilter || undefined, grid.page, grid.pageSize),
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
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("nav.purchaseOrders")}</CardTitle>
          <CardDescription>{t("nav.purchaseOrders.description")}</CardDescription>
        </div>
        {canWrite("purchases") && (
          <Button size="sm" onClick={() => navigate("/purchase-orders/new")}>
            <Plus className="size-4" />
            {t("po.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
      </CardContent>
    </Card>
  );
}
