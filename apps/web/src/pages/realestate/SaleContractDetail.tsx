import { forwardRef, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { InstallmentResponse, SaleContractResponse } from "@pako/shared";
import { ArrowLeft, FileText } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { PrintButton } from "@/components/shared/PrintButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { vxKeys } from "@/hooks/useVerticals";
import { formatIsoDate } from "@/lib/sales-order-enums";
import { cn } from "@/lib/utils";
import { ContractState } from "@/lib/verticals-enums";
import { ContractStateBadge, ErrorAlert, Field, Tile } from "@/pages/verticals/shared";
import { amount, useT } from "@/pages/verticals/verticals-utils";

// docs/ERP_VERTICALS_PLAN.md §2 — one sale contract: the payment plan (këstet) with what is open and
// overdue on each installment; installments not yet invoiced are picked and invoiced together.
export function SaleContractDetail() {
  const intl = useIntl();
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId, activeCompany } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const printRef = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: vxKeys.contract(activeCompanyId, id),
    queryFn: () => apiClient.getUnitSaleContract(activeCompanyId as string, id as string),
    enabled: !!activeCompanyId && !!id,
  });
  const contract = query.data;
  // The picked installments live in the URL (?sel=id,id) so the selection survives a reload.
  const [selParam, setSelParam] = useUrlParam("sel", "");
  const selected = useMemo(() => new Set(selParam.split(",").filter(Boolean)), [selParam]);
  const [issueDate, setIssueDate] = useUrlParam("issueDate", "");
  const [error, setError] = useState<string | null>(null);

  const toggle = (installmentId: string) => {
    const next = new Set(selected);
    if (next.has(installmentId)) next.delete(installmentId);
    else next.add(installmentId);
    setSelParam([...next].join(","));
  };

  const invoice = useMutation({
    mutationFn: () => apiClient.invoiceInstallments(activeCompanyId as string, id as string, {
      installmentIds: (contract?.installments ?? []).filter((i) => selected.has(i.id)).map((i) => i.id),
      issueDate: issueDate || undefined,
    }),
    onSuccess: async (invoiceId) => {
      await queryClient.invalidateQueries({ queryKey: vxKeys.contract(activeCompanyId, id) });
      await queryClient.invalidateQueries({ queryKey: vxKeys.contracts(activeCompanyId) });
      navigate(`/invoicing/${invoiceId}`);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.contract.invoiceError"))),
  });
  const cancel = useMutation({
    mutationFn: () => apiClient.cancelUnitSaleContract(activeCompanyId as string, id as string),
    onSuccess: async (saved) => {
      queryClient.setQueryData(vxKeys.contract(activeCompanyId, id), saved);
      await queryClient.invalidateQueries({ queryKey: vxKeys.contracts(activeCompanyId) });
      await queryClient.invalidateQueries({ queryKey: vxKeys.units(activeCompanyId) });
      await queryClient.invalidateQueries({ queryKey: vxKeys.buildings(activeCompanyId) });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.contract.cancelError"))),
  });

  const active = contract?.state === ContractState.Active;
  const columns = useMemo<ColumnDef<InstallmentResponse>[]>(
    () => [
      {
        id: "pick",
        header: "",
        cell: ({ row }) => (row.original.invoiceId || !active || !canWrite("sales") ? null : (
          <input type="checkbox" aria-label={t("vx.contract.pickInstallment", { number: row.original.number })}
            checked={selected.has(row.original.id)} onChange={() => toggle(row.original.id)} onClick={(e) => e.stopPropagation()} />
        )),
      },
      { accessorKey: "number", header: t("vx.contract.installment"), meta: { numeric: true } },
      { accessorKey: "dueDate", header: t("vx.contract.dueDate"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string) },
      { accessorKey: "amount", header: t("common.amount"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      {
        accessorKey: "invoiceNumber",
        header: t("vx.invoice"),
        cell: ({ row }) => (row.original.invoiceId
          ? <Link className="text-primary underline-offset-2 hover:underline" to={`/invoicing/${row.original.invoiceId}`}>{row.original.invoiceNumber ?? t("vx.draft")}</Link>
          : <Badge variant="draft">{t("vx.contract.notInvoiced")}</Badge>),
      },
      { accessorKey: "open", header: t("vx.contract.open"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      {
        accessorKey: "overdue",
        header: t("vx.state"),
        cell: ({ row }) => (row.original.overdue
          ? <Badge variant="destructive" data-testid="installment-overdue">{t("vx.contract.overdueBadge")}</Badge>
          : row.original.invoiceId && row.original.open === 0
            ? <Badge variant="success">{t("vx.contract.paidBadge")}</Badge>
            : row.original.invoiceId ? <Badge variant="warning">{t("vx.contract.openBadge")}</Badge> : null),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, selected, active, canWrite],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  if (!contract) return <p className="text-muted-foreground">{query.isError ? t("vx.contract.loadError") : t("common.loading")}</p>;
  const anyInvoiced = contract.installments.some((i) => i.invoiceId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="xs" variant="ghost">
          <Link to="/real-estate/contracts"><ArrowLeft className="size-3.5" />{t("vx.nav.contracts")}</Link>
        </Button>
        <h2 className="text-xl font-semibold">{contract.number} · {contract.buildingName} {contract.unitNumber}</h2>
        <ContractStateBadge state={contract.state} />
        <span className="text-sm text-muted-foreground">{t(`vx.contractKind.${contract.kind}`)}</span>
        <div className="ml-auto flex gap-2">
          <PrintButton contentRef={printRef} label={t("vx.contract.print")} />
          {active && !anyInvoiced && canApprove("sales") && (
            <Button size="xs" variant="outline" disabled={cancel.isPending} onClick={() => { setError(null); cancel.mutate(); }}>{t("vx.contract.cancel")}</Button>
          )}
        </div>
      </div>
      <ErrorAlert error={error} />
      <div className="grid gap-3 sm:grid-cols-5">
        <Tile label={t("vx.contract.price")} value={amount(contract.price)} />
        <Tile label={t("vx.contract.invoiced")} value={amount(contract.invoiced)} />
        <Tile label={t("vx.contract.paid")} value={amount(contract.paid)} />
        <Tile label={t("vx.contract.outstanding")} value={amount(contract.outstanding)} />
        <Tile label={t("vx.contract.overdue")} value={amount(contract.overdue)} warn={contract.overdue > 0} />
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>{t("vx.contract.plan")}</CardTitle>
            <CardDescription>{t("vx.contract.buyerLine", { buyer: contract.buyerName, date: formatIsoDate(intl, contract.contractDate) })}</CardDescription>
          </div>
          {active && canWrite("sales") && (
            <div className="flex flex-wrap items-end gap-2">
              <Field id="inst-issue" label={t("vx.contract.issueDate")} className="w-40">
                <Input id="inst-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </Field>
              <Button size="sm" disabled={selected.size === 0 || invoice.isPending} onClick={() => { setError(null); invoice.mutate(); }}>
                <FileText className="size-4" />{t("vx.contract.createInvoice", { count: selected.size })}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="contract-installments"
            columns={columns}
            data={contract.installments}
            rowCount={contract.installments.length}
            getRowId={(r) => r.id}
            getRowClassName={(r) => cn(r.overdue && "text-destructive", !r.invoiceId && "text-muted-foreground")}
            emptyMessage={t("vx.contract.noInstallments")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>
      {contract.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{contract.notes}</p>}
      <div className="sr-only" aria-hidden>
        <ContractPrint ref={printRef} contract={contract} companyName={activeCompany?.name ?? ""} />
      </div>
    </div>
  );
}

// The contract summary and payment plan on A4, for the buyer's signature.
const ContractPrint = forwardRef<HTMLDivElement, { contract: SaleContractResponse; companyName: string }>(
  function ContractPrint({ contract, companyName }, ref) {
    const intl = useIntl();
    const t = useT();
    return (
      <div ref={ref} className="flex flex-col gap-5 bg-white p-2 text-[12px] text-black">
        <header className="flex items-start justify-between gap-4 border-b border-black pb-3">
          <p className="text-lg font-bold">{companyName}</p>
          <div className="text-right">
            <p className="text-lg font-bold">{t("vx.contract.printTitle", { number: contract.number })}</p>
            <p>{t("common.date")}: {formatIsoDate(intl, contract.contractDate)}</p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase text-neutral-600">{t("vx.contract.buyer")}</p>
            <p className="font-semibold">{contract.buyerName}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-neutral-600">{t("vx.unit.label")}</p>
            <p className="font-semibold">{contract.buildingName} · {contract.unitNumber}</p>
            <p>{t(`vx.contractKind.${contract.kind}`)}</p>
          </div>
        </section>
        <p>{t("vx.contract.price")}: <span className="font-bold tabular-nums">{amount(contract.price)}</span> ({t("vx.vatIncluded")})</p>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1">#</th>
              <th className="py-1">{t("vx.contract.dueDate")}</th>
              <th className="py-1 text-right">{t("common.amount")}</th>
              <th className="py-1">{t("vx.invoice")}</th>
              <th className="py-1 text-right">{t("vx.contract.open")}</th>
            </tr>
          </thead>
          <tbody>
            {contract.installments.map((i) => (
              <tr key={i.id} className="border-b border-neutral-300">
                <td className="py-1">{i.number}</td>
                <td className="py-1">{formatIsoDate(intl, i.dueDate)}</td>
                <td className="py-1 text-right tabular-nums">{amount(i.amount)}</td>
                <td className="py-1">{i.invoiceNumber ?? "—"}</td>
                <td className="py-1 text-right tabular-nums">{amount(i.open)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="ml-auto grid w-72 grid-cols-2 gap-x-4 gap-y-1">
          <span>{t("vx.contract.paid")}</span><span className="text-right tabular-nums">{amount(contract.paid)}</span>
          <span className="font-bold">{t("vx.contract.outstanding")}</span><span className="text-right font-bold tabular-nums">{amount(contract.outstanding)}</span>
        </section>
        <section className="mt-10 grid grid-cols-2 gap-10">
          <div className="border-t border-black pt-1 text-center">{t("vx.contract.signSeller")}</div>
          <div className="border-t border-black pt-1 text-center">{t("vx.contract.signBuyer")}</div>
        </section>
      </div>
    );
  },
);
