import { useMemo, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { OpenDocumentResponse, PaymentAllocationRequest, PaymentResponse } from "@pako/shared";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TabButton } from "@/components/ui/tabs";
import { usePartners } from "@/hooks/useDistribution";
import { useMyAccess } from "@/hooks/useMyAccess";
import { dateToIso, formatDisplayDate } from "@/lib/dates";
import { PaymentMethodSelect } from "@/pages/shared/PaymentMethodSelect";

export type PaymentDirection = "Inbound" | "Outbound";

const money = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Typed amount → number, or undefined when empty/not a positive number. Parsing only. */
function parseAmount(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function allocationsFrom(direction: PaymentDirection, values: Record<string, string>): PaymentAllocationRequest[] {
  return Object.entries(values)
    .map(([documentId, text]) => ({ documentId, amount: parseAmount(text) }))
    .filter((a): a is { documentId: string; amount: number } => a.amount !== undefined)
    .map(({ documentId, amount }) =>
      direction === "Inbound" ? { invoiceId: documentId, billId: undefined, amount } : { invoiceId: undefined, billId: documentId, amount },
    );
}

// Direct payments (2026-11-24): the partner's open invoices (money received) or bills (money paid)
// with what each still owes, from the server, and an amount to apply per row. "Oldest first" fills
// in the server's suggestion for the payment amount; the server validates every figure.
function AllocationTable({
  companyId,
  partnerId,
  direction,
  amount,
  values,
  onChange,
}: {
  companyId: string;
  partnerId: string;
  direction: PaymentDirection;
  amount: number | undefined;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const open = useQuery({
    queryKey: ["paymentOpenDocuments", companyId, partnerId, direction, amount],
    queryFn: () => apiClient.listPaymentOpenDocuments(companyId, partnerId, direction, amount),
    enabled: !!partnerId,
  });
  const rows = useMemo(() => open.data ?? [], [open.data]);

  const columns = useMemo<ColumnDef<OpenDocumentResponse>[]>(
    () => [
      { accessorKey: "number", header: t("reports.documentNumber"), cell: ({ getValue }) => getValue<string>() ?? "—" },
      { accessorKey: "dueDate", header: t("directPayment.dueDate"), cell: ({ getValue }) => formatDisplayDate(getValue<string>()), size: 110 },
      { accessorKey: "total", header: t("directPayment.total"), cell: ({ getValue }) => money(getValue<number>()), meta: { numeric: true }, size: 110 },
      { accessorKey: "outstanding", header: t("directPayment.owed"), cell: ({ getValue }) => money(getValue<number>()), meta: { numeric: true }, size: 110 },
      {
        id: "apply",
        header: t("directPayment.apply"),
        size: 130,
        meta: { numeric: true },
        cell: ({ row }) => (
          <Input
            type="number"
            step="0.01"
            min="0"
            className="h-7 text-right tabular-nums"
            aria-label={`${t("directPayment.apply")} ${row.original.number ?? ""}`}
            value={values[row.original.documentId] ?? ""}
            onChange={(event) => onChange({ ...values, [row.original.documentId]: event.target.value })}
            onClick={(event) => event.stopPropagation()}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, values, onChange],
  );

  if (!partnerId) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t(direction === "Inbound" ? "directPayment.applyToInvoices" : "directPayment.applyToBills")}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!amount || rows.length === 0}
          onClick={() => onChange(Object.fromEntries(rows.filter((r) => r.suggested > 0).map((r) => [r.documentId, String(r.suggested)])))}
        >
          {t("directPayment.oldestFirst")}
        </Button>
      </div>
      {rows.length === 0 && !open.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("directPayment.nothingOpen")}</p>
      ) : (
        <DataGrid
          gridId="payment-allocations"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={open.isLoading}
          getRowId={(row) => row.documentId}
          enableGlobalFilter={false}
          manualFiltering={false}
          manualSorting={false}
        />
      )}
      <p className="text-xs text-muted-foreground">{t("directPayment.applyHint")}</p>
    </div>
  );
}

export function NewPaymentDialog({ companyId, open, onOpenChange }: { companyId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const queryClient = useQueryClient();
  const { canApprove } = useMyAccess();
  const mayReceive = canApprove("sales");
  const mayPay = canApprove("purchases");

  const [direction, setDirection] = useState<PaymentDirection>(mayReceive || !mayPay ? "Inbound" : "Outbound");
  const [partnerId, setPartnerId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => dateToIso(new Date()));
  const [reference, setReference] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const partners = usePartners().data ?? [];
  const methods = useQuery({
    queryKey: ["paymentMethods", companyId],
    queryFn: () => apiClient.paymentMethodsAll(companyId),
    enabled: open && !!companyId,
  });
  const paymentMethods = methods.data ?? [];
  // Like "Record payment" on an invoice: the first cash/bank method until the user picks another.
  const methodId = paymentMethodId || paymentMethods[0]?.id || "";

  const partnerOptions = partners
    .filter((p) => (direction === "Inbound" ? p.isCustomer : p.isVendor))
    .map((p) => ({ value: p.id, label: p.name }));

  function reset() {
    setPartnerId("");
    setAmount("");
    setReference("");
    setAllocations({});
    setError(null);
  }

  const create = useMutation({
    mutationFn: () => {
      const method = paymentMethods.find((m) => m.id === methodId);
      return apiClient.createPayment(companyId, {
        direction,
        partnerId,
        amount: parseAmount(amount) ?? 0,
        cashOrBankAccountId: method?.ledgerAccountId ?? "",
        date,
        reference: reference.trim() || undefined,
        allocations: allocationsFrom(direction, allocations),
      });
    },
    onSuccess: () => {
      toast.success(t("toast.paymentRecorded"));
      queryClient.invalidateQueries({ queryKey: ["payments", companyId] });
      reset();
      onOpenChange(false);
    },
    onError: (err) => setError(getApiErrorMessage(err, t("recordPayment.error"))),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!partnerId || !methodId || parseAmount(amount) === undefined) {
      setError(t("directPayment.required"));
      return;
    }
    setError(null);
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("directPayment.newTitle")}</DialogTitle>
          <DialogDescription>{t("directPayment.newDescription")}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <TabButton
              selected={direction === "Inbound"}
              disabled={!mayReceive}
              onClick={() => { setDirection("Inbound"); setPartnerId(""); setAllocations({}); }}
            >
              {t("directPayment.received")}
            </TabButton>
            <TabButton
              selected={direction === "Outbound"}
              disabled={!mayPay}
              onClick={() => { setDirection("Outbound"); setPartnerId(""); setAllocations({}); }}
            >
              {t("directPayment.paid")}
            </TabButton>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t(direction === "Inbound" ? "directPayment.customer" : "directPayment.vendor")} htmlFor="direct-payment-partner" required>
              <SearchableSelect
                id="direct-payment-partner"
                aria-label={t(direction === "Inbound" ? "directPayment.customer" : "directPayment.vendor")}
                value={partnerId}
                onChange={(value) => { setPartnerId(value); setAllocations({}); }}
                options={partnerOptions}
              />
            </FormField>
            <FormField label={t("recordPayment.cashBankAccount")} htmlFor="direct-payment-method" required>
              <PaymentMethodSelect id="direct-payment-method" paymentMethods={paymentMethods} value={methodId} onChange={setPaymentMethodId} />
            </FormField>
            <FormField label={t("recordPayment.amount")} htmlFor="direct-payment-amount" required>
              <Input id="direct-payment-amount" type="number" step="0.01" min="0" className="tabular-nums" value={amount}
                onChange={(event) => setAmount(event.target.value)} />
            </FormField>
            <FormField label={t("recordPayment.date")} htmlFor="direct-payment-date" required>
              <Input id="direct-payment-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </FormField>
            <FormField label={t("directPayment.reference")} htmlFor="direct-payment-reference" className="sm:col-span-2">
              <Input id="direct-payment-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
            </FormField>
          </div>
          <AllocationTable
            companyId={companyId}
            partnerId={partnerId}
            direction={direction}
            amount={parseAmount(amount)}
            values={allocations}
            onChange={setAllocations}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={create.isPending}>{t("directPayment.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ApplyPaymentDialog({ companyId, payment, onClose }: { companyId: string; payment: PaymentResponse | null; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const queryClient = useQueryClient();
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const direction = (payment?.direction ?? "Inbound") as PaymentDirection;

  const apply = useMutation({
    mutationFn: () => apiClient.applyPayment(companyId, payment!.id, { allocations: allocationsFrom(direction, allocations) }),
    onSuccess: () => {
      toast.success(t("directPayment.applied"));
      queryClient.invalidateQueries({ queryKey: ["payments", companyId] });
      setAllocations({});
      setError(null);
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, t("recordPayment.error"))),
  });

  return (
    <Dialog open={!!payment} onOpenChange={(next) => { if (!next) { setAllocations({}); setError(null); onClose(); } }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("directPayment.applyTitle")}</DialogTitle>
          {payment && (
            <DialogDescription>
              {intl.formatMessage({ id: "directPayment.applyDescription" }, { partner: payment.partnerName ?? "", amount: money(payment.unapplied ?? 0) })}
            </DialogDescription>
          )}
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {payment && (
          <AllocationTable
            companyId={companyId}
            partnerId={payment.partnerId}
            direction={direction}
            amount={payment.unapplied ?? undefined}
            values={allocations}
            onChange={setAllocations}
          />
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="button" disabled={apply.isPending || allocationsFrom(direction, allocations).length === 0} onClick={() => apply.mutate()}>
            {t("directPayment.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
