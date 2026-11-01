import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { ProgressBillResponse, SaveProgressBillRequest, SiteResponse } from "@pako/shared";
import { AlertTriangle, CheckCircle2, FileText, Plus } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { PrintButton } from "@/components/shared/PrintButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { vxKeys } from "@/hooks/useVerticals";
import { formatIsoDate, isoToday } from "@/lib/sales-order-enums";
import { cn } from "@/lib/utils";
import { ProgressBillState } from "@/lib/verticals-enums";
import { ErrorAlert, Field, ProgressBillStateBadge } from "@/pages/verticals/shared";
import { amount, gridKeyDown, parseNum, useT } from "@/pages/verticals/verticals-utils";

// One editable row: the BoQ line, what was certified before and the cumulative quantity typed now.
interface EditorRow {
  boqLineId: string;
  code: string;
  description: string;
  unit: string;
  contractQuantity: number;
  unitPrice: number;
  previousQuantity: number;
  cumulative: string;
  // From the API once saved.
  periodQuantity?: number;
  amount?: number;
  overContract?: boolean;
}

// docs/ERP_VERTICALS_PLAN.md §1 — progress bills (situacione): cumulative quantities per BoQ line,
// one draft at a time; approved by the client's supervisor, then invoiced as a draft invoice.
export function ProgressBillsTab({ site }: { site: SiteResponse }) {
  const intl = useIntl();
  const t = useT();
  const { activeCompanyId } = useCompany();
  const [billId, setBillId] = useUrlParam("bill", "");
  const billsQuery = useQuery({
    queryKey: vxKeys.progressBills(activeCompanyId, site.id),
    queryFn: () => apiClient.listProgressBills(activeCompanyId as string, site.id),
    enabled: !!activeCompanyId,
  });
  const bills = useMemo(() => billsQuery.data ?? [], [billsQuery.data]);
  const hasDraft = bills.some((b) => b.state === ProgressBillState.Draft);
  const { canWrite } = useMyAccess();
  const selected = billId === "new" ? "new" : bills.find((b) => b.id === billId);

  const columns = useMemo<ColumnDef<ProgressBillResponse>[]>(
    () => [
      { accessorKey: "number", header: t("vx.bill.number"), meta: { numeric: true } },
      { accessorKey: "periodTo", header: t("vx.bill.periodTo"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string) },
      { accessorKey: "amount", header: t("vx.bill.amount"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      { accessorKey: "retention", header: t("vx.retention"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      { accessorKey: "netDue", header: t("vx.bill.netDue"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      { accessorKey: "state", header: t("vx.state"), cell: ({ getValue }) => <ProgressBillStateBadge state={getValue() as number} /> },
      {
        accessorKey: "invoiceId",
        header: t("vx.invoice"),
        cell: ({ row }) => (row.original.invoiceId
          ? <Link className="text-primary underline-offset-2 hover:underline" to={`/invoicing/${row.original.invoiceId}`} onClick={(e) => e.stopPropagation()}>{t("vx.openInvoice")}</Link>
          : "—"),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("vx.site.tab.bills")}</CardTitle>
            <CardDescription>{t("vx.bill.hint")}</CardDescription>
          </div>
          {canWrite("sales") && !hasDraft && (
            <Button size="sm" onClick={() => setBillId("new")} disabled={site.boq.length === 0}>
              <Plus className="size-4" />{t("vx.bill.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="progress-bills"
            columns={columns}
            data={bills}
            rowCount={bills.length}
            isLoading={billsQuery.isPending}
            getRowId={(r) => r.id}
            getRowClassName={(r) => cn(r.state === ProgressBillState.Draft && "text-muted-foreground italic", r.id === billId && "bg-accent")}
            onRowClick={(r) => setBillId(r.id)}
            emptyMessage={t("vx.bill.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>
      {selected && (
        <ProgressBillEditor key={selected === "new" ? "new" : selected.id} site={site} bill={selected === "new" ? undefined : selected}
          onSaved={(b) => setBillId(b.id)} />
      )}
    </div>
  );
}

function rowsFor(site: SiteResponse, bill: ProgressBillResponse | undefined): EditorRow[] {
  if (bill) {
    return bill.lines.map((l) => ({
      boqLineId: l.boqLineId, code: l.code, description: l.description, unit: l.unit, contractQuantity: l.contractQuantity, unitPrice: l.unitPrice,
      previousQuantity: l.previousQuantity, cumulative: String(l.cumulativeQuantity), periodQuantity: l.periodQuantity, amount: l.amount, overContract: l.overContract,
    }));
  }
  // A new bill starts from what is already certified on each BoQ line.
  return site.boq.map((b) => ({
    boqLineId: b.id, code: b.code, description: b.description, unit: b.unit, contractQuantity: b.quantity, unitPrice: b.unitPrice,
    previousQuantity: b.certified, cumulative: String(b.certified),
  }));
}

function ProgressBillEditor({ site, bill, onSaved }: { site: SiteResponse; bill: ProgressBillResponse | undefined; onSaved: (b: ProgressBillResponse) => void }) {
  const intl = useIntl();
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId, activeCompany } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const printRef = useRef<HTMLDivElement>(null);
  const isDraft = !bill || bill.state === ProgressBillState.Draft;
  const editable = isDraft && canWrite("sales");
  const [periodTo, setPeriodTo] = useState(bill?.periodTo ?? isoToday());
  const [rows, setRows] = useState<EditorRow[]>(() => rowsFor(site, bill));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(rowsFor(site, bill));
    setPeriodTo(bill?.periodTo ?? isoToday());
  }, [site, bill]);

  const refresh = async (saved?: ProgressBillResponse) => {
    await queryClient.invalidateQueries({ queryKey: vxKeys.progressBills(activeCompanyId, site.id) });
    await queryClient.invalidateQueries({ queryKey: vxKeys.site(activeCompanyId, site.id) });
    await queryClient.invalidateQueries({ queryKey: vxKeys.siteProgress(activeCompanyId, site.id) });
    if (saved) onSaved(saved);
  };

  const save = useMutation({
    mutationFn: () => {
      const body: SaveProgressBillRequest = {
        periodTo,
        lines: rows.map((r) => ({ boqLineId: r.boqLineId, cumulativeQuantity: parseNum(r.cumulative) || 0 })),
      };
      return bill
        ? apiClient.updateProgressBill(activeCompanyId as string, bill.id, body)
        : apiClient.createProgressBill(activeCompanyId as string, site.id, body);
    },
    onSuccess: (saved) => refresh(saved),
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.bill.saveError"))),
  });
  const approve = useMutation({
    mutationFn: () => apiClient.approveProgressBill(activeCompanyId as string, (bill as ProgressBillResponse).id),
    onSuccess: (saved) => refresh(saved),
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.bill.approveError"))),
  });
  const invoice = useMutation({
    mutationFn: () => apiClient.invoiceProgressBill(activeCompanyId as string, (bill as ProgressBillResponse).id),
    onSuccess: async (invoiceId) => {
      await refresh();
      navigate(`/invoicing/${invoiceId}`);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.bill.invoiceError"))),
  });

  const setCumulative = (i: number, value: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, cumulative: value } : r)));
  const qty = (v: number | undefined) => (v == null ? "—" : intl.formatNumber(v, { maximumFractionDigits: 4 }));

  return (
    <Card data-testid="progress-bill-editor">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            {bill ? t("vx.bill.title", { number: bill.number }) : t("vx.bill.new")}
            {bill && <ProgressBillStateBadge state={bill.state} />}
          </CardTitle>
          <CardDescription>{editable ? t("vx.bill.editorHint") : t("vx.bill.readOnlyHint")}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {bill && <PrintButton contentRef={printRef} label={t("vx.bill.print")} />}
          {bill?.state === ProgressBillState.Draft && canApprove("sales") && (
            <Button size="xs" variant="outline" disabled={approve.isPending} onClick={() => { setError(null); approve.mutate(); }}>
              <CheckCircle2 className="size-3.5" />{t("vx.bill.approve")}
            </Button>
          )}
          {bill?.state === ProgressBillState.Approved && canWrite("sales") && (
            <Button size="xs" disabled={invoice.isPending} onClick={() => { setError(null); invoice.mutate(); }}>
              <FileText className="size-3.5" />{t("vx.bill.createInvoice")}
            </Button>
          )}
          {bill?.invoiceId && (
            <Button asChild size="xs" variant="outline">
              <Link to={`/invoicing/${bill.invoiceId}`}><FileText className="size-3.5" />{t("vx.openInvoice")}</Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ErrorAlert error={error} />
        <Field id="pb-period" label={t("vx.bill.periodTo")} className="w-44">
          <Input id="pb-period" type="date" value={periodTo} disabled={!editable} onChange={(e) => setPeriodTo(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-1 overflow-x-auto" data-edit-grid>
          <div className="grid min-w-[60rem] grid-cols-[5rem_minmax(12rem,1fr)_4rem_6rem_6rem_6rem_7rem_6rem_7rem] gap-2 text-xs font-medium text-muted-foreground">
            <span>{t("common.code")}</span><span>{t("common.description")}</span><span>{t("vx.unit")}</span>
            <span className="text-right">{t("vx.bill.contractQty")}</span><span className="text-right">{t("vx.unitPrice")}</span>
            <span className="text-right">{t("vx.bill.previous")}</span><span className="text-right">{t("vx.bill.cumulative")}</span>
            <span className="text-right">{t("vx.bill.period")}</span><span className="text-right">{t("common.amount")}</span>
          </div>
          {rows.map((r, i) => (
            <div key={r.boqLineId} data-testid="pb-row"
              className={cn("grid min-w-[60rem] grid-cols-[5rem_minmax(12rem,1fr)_4rem_6rem_6rem_6rem_7rem_6rem_7rem] items-center gap-2 text-sm", r.overContract && "text-destructive")}>
              <span>{r.code}</span>
              <span className="flex items-center gap-1 truncate">
                {r.description}
                {r.overContract && <AlertTriangle className="size-3.5 shrink-0" aria-label={t("vx.bill.overContract")} />}
              </span>
              <span>{r.unit}</span>
              <span className="text-right tnum">{qty(r.contractQuantity)}</span>
              <span className="text-right tnum">{amount(r.unitPrice)}</span>
              <span className="text-right tnum">{qty(r.previousQuantity)}</span>
              {editable ? (
                <Input className="h-7 text-right tnum" inputMode="decimal" aria-label={t("vx.bill.cumulativeFor", { code: r.code })} value={r.cumulative}
                  data-row={i} data-col="cumulative" onKeyDown={gridKeyDown}
                  onChange={(e) => setCumulative(i, e.target.value)} />
              ) : (
                <span className="text-right tnum">{qty(parseNum(r.cumulative))}</span>
              )}
              <span className="text-right tnum">{qty(r.periodQuantity)}</span>
              <span className="text-right tnum">{r.amount == null ? "—" : amount(r.amount)}</span>
            </div>
          ))}
        </div>
        {bill && (
          <div className="ml-auto grid w-72 grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="pb-totals">
            <span className="text-muted-foreground">{t("vx.bill.amount")}</span><span className="text-right tnum">{amount(bill.amount)}</span>
            <span className="text-muted-foreground">{t("vx.retention")}</span><span className="text-right tnum">−{amount(bill.retention)}</span>
            <span className="font-semibold">{t("vx.bill.netDue")}</span><span className="text-right font-semibold tnum">{amount(bill.netDue)}</span>
          </div>
        )}
        {editable && (
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" disabled={save.isPending} onClick={() => { setError(null); save.mutate(); }}>
              {save.isPending ? t("common.saving") : t("vx.bill.saveDraft")}
            </Button>
          </div>
        )}
      </CardContent>
      {bill && (
        <div className="sr-only" aria-hidden>
          <ProgressBillPrint ref={printRef} site={site} bill={bill} companyName={activeCompany?.name ?? ""} />
        </div>
      )}
    </Card>
  );
}

// "Situacioni nr. N" on A4: the lines, the period's amount, retention and the net due — every
// figure as the API computed it.
export const ProgressBillPrint = forwardRef<HTMLDivElement, { site: SiteResponse; bill: ProgressBillResponse; companyName: string }>(
  function ProgressBillPrint({ site, bill, companyName }, ref) {
    const intl = useIntl();
    const t = useT();
    const qty = (v: number) => intl.formatNumber(v, { maximumFractionDigits: 4 });
    return (
      <div ref={ref} className="flex flex-col gap-5 bg-white p-2 text-[11px] text-black">
        <header className="flex items-start justify-between gap-4 border-b border-black pb-3">
          <div>
            <p className="text-lg font-bold">{companyName}</p>
            <p>{site.projectCode} · {site.name}</p>
            {site.address && <p>{site.address}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">{t("vx.bill.printTitle", { number: bill.number })}</p>
            <p>{t("vx.bill.periodTo")}: {formatIsoDate(intl, bill.periodTo)}</p>
            <p>{t("vx.site.client")}: {site.clientName}</p>
          </div>
        </header>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1">{t("common.code")}</th>
              <th className="py-1">{t("common.description")}</th>
              <th className="py-1">{t("vx.unit")}</th>
              <th className="py-1 text-right">{t("vx.bill.contractQty")}</th>
              <th className="py-1 text-right">{t("vx.unitPrice")}</th>
              <th className="py-1 text-right">{t("vx.bill.previous")}</th>
              <th className="py-1 text-right">{t("vx.bill.cumulative")}</th>
              <th className="py-1 text-right">{t("vx.bill.period")}</th>
              <th className="py-1 text-right">{t("common.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((l) => (
              <tr key={l.id} className="border-b border-neutral-300">
                <td className="py-1">{l.code}</td>
                <td className="py-1">{l.description}</td>
                <td className="py-1">{l.unit}</td>
                <td className="py-1 text-right tabular-nums">{qty(l.contractQuantity)}</td>
                <td className="py-1 text-right tabular-nums">{amount(l.unitPrice)}</td>
                <td className="py-1 text-right tabular-nums">{qty(l.previousQuantity)}</td>
                <td className="py-1 text-right tabular-nums">{qty(l.cumulativeQuantity)}</td>
                <td className="py-1 text-right tabular-nums">{qty(l.periodQuantity)}</td>
                <td className="py-1 text-right tabular-nums">{amount(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="ml-auto grid w-72 grid-cols-2 gap-x-4 gap-y-1">
          <span>{t("vx.bill.amount")}</span><span className="text-right tabular-nums">{amount(bill.amount)}</span>
          <span>{t("vx.retention")} ({intl.formatNumber(site.retentionPercent)}%)</span><span className="text-right tabular-nums">−{amount(bill.retention)}</span>
          <span className="font-bold">{t("vx.bill.netDue")}</span><span className="text-right font-bold tabular-nums">{amount(bill.netDue)}</span>
        </section>
        <section className="mt-10 grid grid-cols-2 gap-10">
          <div className="border-t border-black pt-1 text-center">{t("vx.bill.signContractor")}</div>
          <div className="border-t border-black pt-1 text-center">{t("vx.bill.signSupervisor")}</div>
        </section>
      </div>
    );
  },
);
