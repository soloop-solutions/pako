import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { InvoiceResponse, RentRunResponse } from "@pako/shared";
import { Play } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/context/CompanyContext";
import { usePartners } from "@/hooks/useDistribution";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { vxKeys } from "@/hooks/useVerticals";
import { formatIsoDate, isoToday } from "@/lib/sales-order-enums";
import { monthStart } from "@/lib/verticals-enums";
import { ErrorAlert, Field, Tile } from "@/pages/verticals/shared";
import { formatMonth, useT } from "@/pages/verticals/verticals-utils";

// docs/ERP_VERTICALS_PLAN.md §3 — the monthly rent run: one draft invoice per running lease for
// the month (part months prorated, meter readings re-billed), by the API. Leases already invoiced
// for the month are skipped, so running it twice is safe.
export function RentRun() {
  const intl = useIntl();
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const [month, setMonth] = useUrlParam("month", isoToday().slice(0, 7));
  const [result, setResult] = useState<RentRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const partners = usePartners().data ?? [];

  const run = useMutation({
    mutationFn: () => apiClient.runRent(activeCompanyId as string, { month: monthStart(month) }),
    onSuccess: async (r) => {
      setResult(r);
      await queryClient.invalidateQueries({ queryKey: vxKeys.leases(activeCompanyId) });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.rentRun.error"))),
  });
  const invoiceIds = result?.invoiceIds ?? [];
  const invoicesQuery = useQuery({
    queryKey: ["rentRunInvoices", activeCompanyId, invoiceIds.join(",")],
    queryFn: () => Promise.all(invoiceIds.map((id) => apiClient.invoicesGET(activeCompanyId as string, id))),
    enabled: !!activeCompanyId && invoiceIds.length > 0,
  });
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? "—";

  const columns = useMemo<ColumnDef<InvoiceResponse>[]>(
    () => [
      { accessorKey: "invoiceNumber", header: t("vx.number"), cell: ({ getValue }) => (getValue() as string | undefined) ?? <Badge variant="draft">{t("vx.draft")}</Badge> },
      { accessorKey: "issueDate", header: t("common.date"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string) },
      { id: "tenant", header: t("vx.lease.tenant"), accessorFn: (r) => partnerName(r.partnerId) },
      { accessorKey: "dueDate", header: t("vx.rentRun.dueDate"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string) },
      { id: "lines", header: t("vx.rentRun.lines"), accessorFn: (r) => r.lines.map((l) => l.description).join(", ") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, partners],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("vx.nav.rentRun")}</CardTitle>
          <CardDescription>{t("vx.nav.rentRun.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ErrorAlert error={error} />
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setError(null); setResult(null); run.mutate(); }}>
            <Field id="rent-month" label={t("vx.rentRun.month")} className="w-44">
              <Input id="rent-month" type="month" required value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            {canWrite("sales") && (
              <Button type="submit" disabled={run.isPending || !month}><Play className="size-4" />{t("vx.rentRun.run")}</Button>
            )}
          </form>
          <p className="text-xs text-muted-foreground">{t("vx.rentRun.hint")}</p>
        </CardContent>
      </Card>
      {result && (
        <>
          <p className="text-sm font-medium">{t("vx.rentRun.resultFor", { period: formatMonth(intl, result.period) })}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label={t("vx.rentRun.created")} value={String(result.created)} testId="rent-created" />
            <Tile label={t("vx.rentRun.alreadyInvoiced")} value={String(result.alreadyInvoiced)} testId="rent-already" />
            <Tile label={t("vx.rentRun.notRunning")} value={String(result.notRunning)} testId="rent-not-running" />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t("vx.rentRun.invoices")}</CardTitle>
              <CardDescription>{t("vx.rentRun.invoicesHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <DataGrid
                gridId="rent-run-invoices"
                columns={columns}
                data={invoicesQuery.data ?? []}
                rowCount={invoicesQuery.data?.length ?? 0}
                isLoading={invoiceIds.length > 0 && invoicesQuery.isPending}
                getRowId={(r) => r.id}
                onRowClick={(r) => navigate(`/invoicing/${r.id}`)}
                emptyMessage={t("vx.rentRun.noInvoices")}
                manualFiltering={false}
                manualSorting={false}
                manualGrouping={false}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
