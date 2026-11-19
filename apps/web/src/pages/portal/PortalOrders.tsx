import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PortalOrderSummaryResponse } from "@pako/shared";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-context";
import { formatDisplayDate } from "@/lib/dates";
import { formatAmount } from "@/lib/payroll-enums";
import { useRequiredPortalCompanyId } from "@/pages/portal/portal-context";
import { lineColumns } from "@/pages/portal/lineColumns";
import { PortalOrderStatus } from "@/pages/portal/shared";

const GRID_ID = "portalOrders";

// The customer's orders — the ones placed here and the ones the company's staff took for them.
export function PortalOrders() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const companyId = useRequiredPortalCompanyId();
  const grid = useDataGridUrlState(GRID_ID, 50);
  const query = useQuery({
    queryKey: ["portal", companyId, "orders", grid.page, grid.pageSize],
    queryFn: () => apiClient.listPortalOrders(companyId, grid.page, grid.pageSize),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<PortalOrderSummaryResponse>[]>(
    () => [
      { accessorKey: "reference", header: t("portal.col.order"), enableSorting: false },
      { accessorKey: "date", header: t("portal.col.date"), enableSorting: false, cell: ({ getValue }) => formatDisplayDate(getValue() as string) },
      { accessorKey: "deliveryDate", header: t("portal.col.delivery"), enableSorting: false, cell: ({ getValue }) => formatDisplayDate(getValue() as string | undefined) || "—" },
      { accessorKey: "customerReference", header: t("portal.yourReference"), enableSorting: false, cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "lineCount", header: t("portal.col.lines"), enableSorting: false, meta: { numeric: true } },
      { accessorKey: "gross", header: t("portal.col.total"), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "status", header: t("portal.col.status"), enableSorting: false, cell: ({ getValue }) => <PortalOrderStatus status={getValue() as string} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("portal.ordersTitle")}</h1>
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(query.error, t("portal.loadError"))}</AlertDescription>
        </Alert>
      )}
      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={query.data?.items ?? []}
        rowCount={query.data?.total ?? 0}
        isLoading={query.isPending}
        getRowId={(o) => o.id}
        getRowClassName={(o) => (o.status === "Cancelled" ? "text-muted-foreground line-through" : undefined)}
        onRowClick={(o) => navigate(`/portal/orders/${o.id}`)}
        emptyMessage={t("portal.ordersEmpty")}
      />
    </div>
  );
}

export function PortalOrderDetail() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { id } = useParams();
  const companyId = useRequiredPortalCompanyId();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["portal", companyId, "order", id],
    queryFn: () => apiClient.getPortalOrder(companyId, id as string),
    enabled: !!id,
  });
  const cancel = useMutation({
    mutationFn: () => apiClient.cancelPortalOrder(companyId, id as string),
    onSuccess: async (order) => {
      toast.success(intl.formatMessage({ id: "portal.withdrawn" }, { reference: order.reference }));
      await queryClient.invalidateQueries({ queryKey: ["portal", companyId] });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("portal.withdrawError"))),
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns = useMemo(() => lineColumns(t), [intl]);

  const order = query.data;
  return (
    <div className="flex flex-col gap-4">
      <Link to="/portal/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("portal.nav.orders")}
      </Link>
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(query.error, t("portal.loadError"))}</AlertDescription>
        </Alert>
      )}
      {order && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                {intl.formatMessage({ id: "portal.orderTitle" }, { reference: order.reference })}
                <PortalOrderStatus status={order.status} />
              </CardTitle>
              <CardDescription>
                {intl.formatMessage({ id: "portal.orderMeta" }, { date: formatDisplayDate(order.date) })}
                {order.deliveryDate && ` · ${intl.formatMessage({ id: "portal.wishedDeliveryOn" }, { date: formatDisplayDate(order.deliveryDate) })}`}
                {order.customerReference && ` · ${t("portal.yourReference")}: ${order.customerReference}`}
              </CardDescription>
              <p className="mt-1 text-sm text-muted-foreground">{t(`portal.statusHint.${order.status}`)}</p>
            </div>
            {order.canCancel && (
              <Button
                variant="outline"
                disabled={cancel.isPending}
                onClick={() => confirm(t("portal.withdrawConfirm"), () => { setError(null); cancel.mutate(); }, { confirmLabel: t("portal.withdraw"), destructive: true })}
              >
                {t("portal.withdraw")}
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DataGrid
              gridId="portalOrderLines"
              columns={columns}
              data={order.lines}
              rowCount={order.lines.length}
              getRowId={(_, index) => String(index)}
              footerRow={{ label: t("portal.total"), cells: { net: formatAmount(order.net), vat: formatAmount(order.vat), gross: formatAmount(order.gross) } }}
              manualFiltering={false}
              manualSorting={false}
              manualGrouping={false}
              defaultPageSize={200}
              pageSizeOptions={[200]}
            />
            {(order.deliveryAddress || order.notes) && (
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                {order.deliveryAddress && <p><span className="text-muted-foreground">{t("portal.deliveryAddress")}: </span>{order.deliveryAddress}</p>}
                {order.notes && <p className="whitespace-pre-line"><span className="text-muted-foreground">{t("portal.notes")}: </span>{order.notes}</p>}
              </div>
            )}
            {order.invoices.length > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground">{t("portal.invoicedOn")}: </span>
                {order.invoices.map((invoice, index) => (
                  <span key={invoice.id}>
                    {index > 0 && ", "}
                    <Link className="underline" to={`/portal/invoices/${invoice.id}`}>{invoice.number ?? formatDisplayDate(invoice.date)}</Link>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
