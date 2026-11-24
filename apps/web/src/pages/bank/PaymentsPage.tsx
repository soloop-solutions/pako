import { useMemo } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PaymentResponse } from "@pako/shared";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TabButton } from "@/components/ui/tabs";
import { useCompany } from "@/context/CompanyContext";
import { useConfirm } from "@/components/ui/confirm-context";
import { entityPath } from "@/lib/entityLinks";
import { formatDisplayDate } from "@/lib/dates";

type Tab = "all" | "outstanding" | "reconciled" | "cancelled";

function stateParam(tab: Tab): string | undefined {
  if (tab === "outstanding") return "Posted";
  if (tab === "reconciled") return "Reconciled";
  if (tab === "cancelled") return "Cancelled";
  return undefined;
}

export function PaymentsPage() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const tab = (searchParams.get("state") as Tab) || "all";
  const page = Number(searchParams.get("page")) || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 50;
  const sort = searchParams.get("sort") ?? "-date";

  const setTab = (t: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (t === "all") params.delete("state");
    else params.set("state", t);
    params.set("page", "1");
    setSearchParams(params);
  };

  const queryKey = ["payments", companyId, tab, page, pageSize, sort];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => apiClient.payments(companyId, stateParam(tab), undefined, undefined, page, pageSize, sort),
    enabled: !!companyId,
  });

  const cancelMutation = useMutation({
    mutationFn: (paymentId: string) => apiClient.cancel(companyId, paymentId),
    onSuccess: () => {
      toast.success(t("payments.cancel"));
      queryClient.invalidateQueries({ queryKey: ["payments", companyId] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Error")),
  });

  const handleCancel = (payment: PaymentResponse) => {
    confirm(t("payments.cancelConfirm"), () => cancelMutation.mutate(payment.id), { destructive: true });
  };

  const columns = useMemo<ColumnDef<PaymentResponse>[]>(() => [
    {
      accessorKey: "date",
      header: t("recordPayment.date"),
      cell: ({ getValue }) => formatDisplayDate(getValue<string>()),
      size: 110,
    },
    {
      accessorKey: "direction",
      header: t("payments.title"),
      cell: ({ getValue }) => (
        <Badge variant={getValue<string>() === "Inbound" ? "default" : "secondary"}>
          {t(getValue<string>() === "Inbound" ? "payments.direction.inbound" : "payments.direction.outbound")}
        </Badge>
      ),
      size: 100,
    },
    {
      accessorKey: "partnerName",
      header: t("common.partner"),
      cell: ({ getValue }) => getValue<string>() ?? "—",
    },
    {
      accessorKey: "amount",
      header: t("recordPayment.amount"),
      cell: ({ getValue }) => getValue<number>().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      meta: { numeric: true },
      size: 120,
    },
    {
      accessorKey: "documentNumber",
      header: t("reports.documentNumber"),
      cell: ({ getValue }) => getValue<string>() ?? "—",
    },
    {
      accessorKey: "destinationAccountName",
      header: t("recordPayment.cashBankAccount"),
      cell: ({ getValue }) => getValue<string>() ?? "—",
    },
    {
      accessorKey: "state",
      header: t("lockDates.exceptions.status"),
      cell: ({ getValue }) => {
        const state = getValue<string>();
        const variant = state === "Posted" ? "outline" : state === "Reconciled" ? "default" : "destructive";
        const label = state === "Posted" ? t("payments.outstanding")
          : state === "Reconciled" ? t("payments.reconciled")
          : t("payments.cancelled");
        return <Badge variant={variant}>{label}</Badge>;
      },
      size: 120,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) =>
        row.original.state === "Posted" ? (
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleCancel(row.original); }}>
            {t("payments.cancel")}
          </Button>
        ) : null,
      size: 140,
    },
  ], [intl]);

  const getRowLink = (row: PaymentResponse) => {
    if (row.invoiceId) return entityPath({ kind: "Invoice", id: row.invoiceId });
    if (row.billId) return entityPath({ kind: "Bill", id: row.billId });
    return null;
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">{t("payments.title")}</h1>
      <div className="flex gap-2">
        <TabButton selected={tab === "all"} onClick={() => setTab("all")}>{t("payments.all")}</TabButton>
        <TabButton selected={tab === "outstanding"} onClick={() => setTab("outstanding")}>{t("payments.outstanding")}</TabButton>
        <TabButton selected={tab === "reconciled"} onClick={() => setTab("reconciled")}>{t("payments.reconciled")}</TabButton>
        <TabButton selected={tab === "cancelled"} onClick={() => setTab("cancelled")}>{t("payments.cancelled")}</TabButton>
      </div>
      {data && data.items.length === 0 && !isLoading ? (
        <EmptyState icon={CreditCard} title={t("payments.empty")} />
      ) : (
        <DataGrid
          gridId="payments"
          columns={columns}
          data={data?.items ?? []}
          rowCount={data?.total ?? 0}
          isLoading={isLoading}
          getRowLink={getRowLink}
        />
      )}
    </div>
  );
}
