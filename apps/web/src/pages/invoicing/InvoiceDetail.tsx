import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  AccountResponse,
  ApplyCreditNoteResponse,
  ApplyDownPaymentResponse,
  DocumentBalanceResponse,
  InvoiceResponse,
  PartnerResponse,
  TaxDefinitionResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { invoiceDocumentTypeLabel, InvoiceDocumentType } from "@/lib/document-types";
import { isCashOrBankAccountSubType } from "@/lib/ledger-enums";
import { computeFromGross } from "@/lib/tax-enums";
import { ApplyCreditNoteForm, type CreditNoteOption } from "@/pages/shared/ApplyCreditNoteForm";
import { ApplyDownPaymentForm, type DownPaymentOption } from "@/pages/shared/ApplyDownPaymentForm";
import { RecordPaymentForm } from "@/pages/shared/RecordPaymentForm";

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [balance, setBalance] = useState<DocumentBalanceResponse | null>(null);
  const [creditNoteOptions, setCreditNoteOptions] = useState<CreditNoteOption[]>([]);
  const [downPaymentOptions, setDownPaymentOptions] = useState<DownPaymentOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId || !id) return;
    setError(null);
    try {
      const [invoiceResult, partnersResult, taxesResult, accountsResult] = await Promise.all([
        apiClient.invoicesGET(companyId, id),
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.accounts(companyId),
      ]);
      setInvoice(invoiceResult);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setAccounts(accountsResult);

      if (invoiceResult.state === "Posted") {
        setBalance(await apiClient.balance2(companyId, id));

        // The balance endpoint now correctly computes remaining capacity for CreditNote/
        // DownPayment documents too (branches on DocumentType server-side) - fetch each
        // candidate's own balance and use its real outstanding amount, not a nominal total.
        const allInvoices = await apiClient.invoicesAll(companyId);
        const partnerPostedInvoices = allInvoices.filter(
          (candidate) => candidate.id !== id && candidate.partnerId === invoiceResult.partnerId && candidate.state === "Posted",
        );

        const withBalances = async (documentType: number) => {
          const candidates = partnerPostedInvoices.filter((candidate) => candidate.documentType === documentType);
          const balances = await Promise.all(candidates.map((candidate) => apiClient.balance2(companyId, candidate.id)));
          return candidates
            .map((candidate, index) => ({
              id: candidate.id,
              label: candidate.invoiceNumber ?? candidate.id,
              total: balances[index].outstanding,
            }))
            .filter((option) => option.total > 0);
        };

        setCreditNoteOptions(await withBalances(InvoiceDocumentType.CreditNote));
        setDownPaymentOptions(await withBalances(InvoiceDocumentType.DownPayment));
      } else {
        setBalance(null);
        setCreditNoteOptions([]);
        setDownPaymentOptions([]);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load the invoice."));
    }
  }, [companyId, id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handlePost() {
    if (!companyId || !id) return;
    setPostError(null);
    setPosting(true);
    try {
      await apiClient.post2(companyId, id);
      await refresh();
    } catch (err) {
      setPostError(getApiErrorMessage(err, "Could not post this invoice."));
    } finally {
      setPosting(false);
    }
  }

  async function handleAppliedCreditNote(response: ApplyCreditNoteResponse) {
    setApplyMessage(`Applied ${response.reconciliation.amount.toFixed(2)} from credit note.`);
    await refresh();
  }

  async function handleAppliedDownPayment(response: ApplyDownPaymentResponse) {
    const applied = response.reconciliation.amount;
    setApplyMessage(
      response.reclassifiedAmount > 0
        ? `Applied ${applied.toFixed(2)} — ${response.reclassifiedAmount.toFixed(2)} recognized as revenue.`
        : `Applied ${applied.toFixed(2)}.`,
    );
    await refresh();
  }

  if (!activeCompany || !invoice) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invoice</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">Loading...</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const partner = partners.find((p) => p.id === invoice.partnerId);
  const cashAccounts = accounts.filter((a) => isCashOrBankAccountSubType(a.accountSubType));

  // Line entry is gross (brutto): unitPrice is VAT-inclusive, so the sum of gross line amounts
  // IS the invoice total (what the receivable line shows) — net/VAT are backed out of it for
  // display, not added on top.
  let total = 0;
  let estimatedNet = 0;
  let estimatedTax = 0;
  for (const line of invoice.lines) {
    const gross = line.quantity * line.unitPrice * (1 - (line.discountPercent ?? 0) / 100);
    total += gross;
    const { net, tax } = computeFromGross(gross, taxes.find((t) => t.id === line.taxDefinitionId));
    estimatedNet += net;
    estimatedTax += tax;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link className="text-sm text-muted-foreground hover:underline" to="/invoicing">
        &larr; Back to invoicing
      </Link>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {applyMessage && (
        <Alert>
          <AlertDescription>{applyMessage}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>{invoice.invoiceNumber ?? "Draft invoice"}</CardTitle>
                <Badge variant="outline">{invoiceDocumentTypeLabel(invoice.documentType)}</Badge>
              </div>
              <CardDescription>{partner?.name ?? invoice.partnerId}</CardDescription>
            </div>
            <Badge variant={invoice.state === "Posted" ? "default" : "secondary"}>{invoice.state}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Issue date:</span> {invoice.issueDate}
            </p>
            <p>
              <span className="text-muted-foreground">Due date:</span> {invoice.dueDate}
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price (incl. VAT)</TableHead>
                <TableHead className="text-right">Discount %</TableHead>
                <TableHead>Tax</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">VAT</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((line) => {
                const gross = line.quantity * line.unitPrice * (1 - line.discountPercent / 100);
                const { net, tax } = computeFromGross(gross, taxes.find((t) => t.id === line.taxDefinitionId));
                return (
                  <TableRow key={line.id}>
                    <TableCell>{line.description}</TableCell>
                    <TableCell className="text-right">{line.quantity}</TableCell>
                    <TableCell className="text-right">{line.unitPrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{line.discountPercent.toFixed(2)}</TableCell>
                    <TableCell>{taxes.find((t) => t.id === line.taxDefinitionId)?.name ?? "-"}</TableCell>
                    <TableCell className="text-right">{net.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{tax.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{gross.toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex flex-col items-end gap-1 text-sm">
            <p>Net (excl. VAT): {estimatedNet.toFixed(2)}</p>
            <p>VAT: {estimatedTax.toFixed(2)}</p>
            <p className="font-medium">Total: {total.toFixed(2)}</p>
          </div>

          {invoice.state === "Draft" && (
            <div className="flex flex-col items-start gap-1">
              <Button onClick={handlePost} disabled={posting}>
                {posting ? "Posting..." : "Post invoice"}
              </Button>
              {postError && <span className="text-xs text-destructive">{postError}</span>}
            </div>
          )}

          {invoice.state === "Posted" && balance && (
            <div className="flex gap-6 text-sm">
              <p>Total: {balance.total.toFixed(2)}</p>
              <p>Reconciled: {balance.reconciled.toFixed(2)}</p>
              <p className="font-medium">Outstanding: {balance.outstanding.toFixed(2)}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {invoice.state === "Posted" && balance && balance.outstanding > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Record payment</CardTitle>
            <CardDescription>Records and reconciles the payment against this invoice in one step.</CardDescription>
          </CardHeader>
          <CardContent>
            <RecordPaymentForm
              companyId={activeCompany.id}
              documentKind="invoice"
              documentId={invoice.id}
              cashAccounts={cashAccounts}
              outstanding={balance.outstanding}
              onRecorded={refresh}
            />
          </CardContent>
        </Card>
      )}

      {invoice.state === "Posted" && balance && balance.outstanding > 0 && creditNoteOptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Apply credit note</CardTitle>
            <CardDescription>Reconciles one of this customer's posted credit notes against this invoice.</CardDescription>
          </CardHeader>
          <CardContent>
            <ApplyCreditNoteForm
              companyId={activeCompany.id}
              documentKind="invoice"
              documentId={invoice.id}
              outstanding={balance.outstanding}
              options={creditNoteOptions}
              onApplied={handleAppliedCreditNote}
            />
          </CardContent>
        </Card>
      )}

      {invoice.state === "Posted" && balance && balance.outstanding > 0 && downPaymentOptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Apply down payment</CardTitle>
            <CardDescription>Reconciles one of this customer's posted down payments against this invoice.</CardDescription>
          </CardHeader>
          <CardContent>
            <ApplyDownPaymentForm
              companyId={activeCompany.id}
              invoiceId={invoice.id}
              outstanding={balance.outstanding}
              options={downPaymentOptions}
              onApplied={handleAppliedDownPayment}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
