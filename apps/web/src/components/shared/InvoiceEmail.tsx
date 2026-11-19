import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { FileResponse, InvoiceEmailResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { downloadFileResponse } from "@/lib/download";
import { splitRecipients } from "@/lib/invoice-email";

// Email delivery (docs/EMAIL.md): the server-rendered PDF of an invoice, and sending it to the customer.
// The PDF and the email carry the server's amounts; nothing here computes a figure.

const MAX_RECIPIENTS = 5;

const stateVariant: Record<string, "secondary" | "outline" | "destructive"> = {
  Sent: "secondary",
  Pending: "outline",
  Failed: "destructive",
};

interface PdfButtonProps {
  fileName: string;
  load: () => Promise<FileResponse>;
}

// "Download PDF": staff (invoices endpoint) and portal (portal endpoint) pass their own loader.
export function InvoicePdfButton({ fileName, load }: PdfButtonProps) {
  const intl = useIntl();
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      downloadFileResponse(await load(), fileName);
    } catch (err) {
      toast.error(getApiErrorMessage(err, intl.formatMessage({ id: "invoiceEmail.downloadError" })));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={() => void download()} disabled={busy}>
      {intl.formatMessage({ id: "invoiceEmail.downloadPdf" })}
    </Button>
  );
}

interface InvoiceEmailCardProps {
  companyId: string;
  invoiceId: string;
  /** e.g. "Invoice" / "Credit note" — already translated. */
  documentLabel: string;
  number: string | undefined;
  customerName: string;
  customerEmail: string | undefined;
  canSend: boolean;
}

// Posted documents only: an "Email…" button and the list of what was sent, with Retry on failures.
export function InvoiceEmailCard({ companyId, invoiceId, documentLabel, number, customerName, customerEmail, canSend }: InvoiceEmailCardProps) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const queryClient = useQueryClient();
  const historyKey = ["invoiceEmails", companyId, invoiceId] as const;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = useQuery({ queryKey: historyKey, queryFn: () => apiClient.listInvoiceEmails(companyId, invoiceId) });

  const retry = useMutation({
    mutationFn: (emailId: string) => apiClient.retryInvoiceEmail(companyId, invoiceId, emailId),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("invoiceEmail.retryError"))),
  });

  const columns = useMemo<ColumnDef<InvoiceEmailResponse>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: t("invoiceEmail.col.when"),
        enableSorting: false,
        cell: ({ getValue }) => intl.formatDate(getValue() as string, { dateStyle: "short", timeStyle: "short" }),
      },
      { accessorKey: "recipient", header: t("invoiceEmail.col.to"), enableSorting: false },
      {
        accessorKey: "state",
        header: t("invoiceEmail.col.state"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <Badge variant={stateVariant[row.original.state] ?? "outline"}>{t(`notifications.state.${row.original.state}`)}</Badge>
            {row.original.lastError && (
              <span className="truncate text-xs text-muted-foreground" title={row.original.lastError}>
                {row.original.lastError}
              </span>
            )}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.state === "Failed" && canSend ? (
            <Button size="xs" variant="ghost" disabled={retry.isPending} onClick={() => retry.mutate(row.original.id)}>
              {t("invoiceEmail.retry")}
            </Button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, canSend, retry.isPending],
  );

  const rows = history.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">{t("invoiceEmail.title")}</CardTitle>
            <CardDescription>{t("invoiceEmail.description")}</CardDescription>
          </div>
          {canSend && (
            <Button size="sm" onClick={() => setOpen(true)}>
              {t("invoiceEmail.send")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm font-medium">{t("invoiceEmail.history")}</p>
        <DataGrid
          gridId="invoice-emails"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={history.isPending}
          getRowId={(row) => row.id}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
          emptyMessage={t("invoiceEmail.historyEmpty")}
        />
      </CardContent>
      {open && (
        <InvoiceEmailDialog
          companyId={companyId}
          invoiceId={invoiceId}
          title={t("invoiceEmail.dialogTitle", { document: documentLabel, number: number ?? "" })}
          customerName={customerName}
          customerEmail={customerEmail}
          onClose={() => setOpen(false)}
          onSent={(queued) => {
            setOpen(false);
            setError(null);
            toast.success(t("invoiceEmail.queued", { count: queued.length, first: queued[0]?.recipient ?? "" }));
            void queryClient.invalidateQueries({ queryKey: historyKey });
          }}
        />
      )}
    </Card>
  );
}

interface DialogProps {
  companyId: string;
  invoiceId: string;
  title: string;
  customerName: string;
  customerEmail: string | undefined;
  onClose: () => void;
  onSent: (queued: InvoiceEmailResponse[]) => void;
}

function InvoiceEmailDialog({ companyId, invoiceId, title, customerName, customerEmail, onClose, onSent }: DialogProps) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [to, setTo] = useState(customerEmail ?? "");
  const [message, setMessage] = useState("");
  const [culture, setCulture] = useState("sq");
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () =>
      apiClient.emailInvoice(companyId, invoiceId, {
        to: splitRecipients(to),
        message: message.trim() || undefined,
        culture,
      }),
    onSuccess: onSent,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("invoiceEmail.sendError"))),
  });

  const recipients = splitRecipients(to);
  const canSubmit = recipients.length > 0 && recipients.length <= MAX_RECIPIENTS && !send.isPending;

  return (
    <Dialog open onOpenChange={(next) => !next && !send.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("invoiceEmail.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) send.mutate();
          }}
        >
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!customerEmail && (
            <p className="text-sm text-warning-foreground">{t("invoiceEmail.noCustomerEmail", { customer: customerName })}</p>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-email-to">{t("invoiceEmail.recipients")}</Label>
            <Input id="invoice-email-to" type="text" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />
            <p className="text-xs text-muted-foreground">{t("invoiceEmail.recipientsHint")}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-email-message">{t("invoiceEmail.message")}</Label>
            <Textarea id="invoice-email-message" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("invoiceEmail.messageHint")}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-email-language">{t("invoiceEmail.language")}</Label>
            <Select
              id="invoice-email-language"
              aria-label={t("invoiceEmail.language")}
              value={culture}
              onValueChange={setCulture}
              options={[
                { value: "sq", label: t("invoiceEmail.language.sq") },
                { value: "en", label: t("invoiceEmail.language.en") },
              ]}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={send.isPending}>
              {t("invoiceEmail.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {send.isPending ? t("invoiceEmail.sending") : t("invoiceEmail.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
