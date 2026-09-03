import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
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
  const intl = useIntl();
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
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "invoiceDetail.loadError" })));
    }
  }, [companyId, id, intl]);

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
      setPostError(getApiErrorMessage(err, intl.formatMessage({ id: "invoiceDetail.postError" })));
    } finally {
      setPosting(false);
    }
  }

  async function handleAppliedCreditNote(response: ApplyCreditNoteResponse) {
    setApplyMessage(intl.formatMessage({ id: "invoiceDetail.appliedCreditNote" }, { amount: response.reconciliation.amount.toFixed(2) }));
    await refresh();
  }

  async function handleAppliedDownPayment(response: ApplyDownPaymentResponse) {
    const applied = response.reconciliation.amount;
    setApplyMessage(
      response.reclassifiedAmount > 0
        ? intl.formatMessage(
            { id: "invoiceDetail.appliedDownPaymentWithRevenue" },
            { amount: applied.toFixed(2), revenueAmount: response.reclassifiedAmount.toFixed(2) },
          )
        : intl.formatMessage({ id: "invoiceDetail.appliedDownPayment" }, { amount: applied.toFixed(2) }),
    );
    await refresh();
  }

  if (!activeCompany || !invoice) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "invoiceDetail.title" })}</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const partner = partners.find((p) => p.id === invoice.partnerId);
  const cashAccounts = accounts.filter((a) => isCashOrBankAccountSubType(a.accountSubType));

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
        &larr; {intl.formatMessage({ id: "invoiceDetail.backToInvoicing" })}
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
                <CardTitle>{invoice.invoiceNumber ?? intl.formatMessage({ id: "invoiceDetail.draftInvoice" })}</CardTitle>
                <Badge variant="outline">{invoiceDocumentTypeLabel(invoice.documentType, intl)}</Badge>
              </div>
              <CardDescription>{partner?.name ?? invoice.partnerId}</CardDescription>
            </div>
            <Badge variant={invoice.state === "Posted" ? "default" : "secondary"}>{invoice.state}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">{intl.formatMessage({ id: "invoiceDetail.issueDate" })}</span> {invoice.issueDate}
            </p>
            <p>
              <span className="text-muted-foreground">{intl.formatMessage({ id: "invoiceDetail.dueDate" })}</span> {invoice.dueDate}
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "invoiceForm.description" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "invoiceForm.qty" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "invoiceForm.priceInclVat" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "invoiceForm.discountPercent" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "invoiceForm.tax" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "invoiceForm.net" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "invoiceForm.vat" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "common.total" })}</TableHead>
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
            <p>{intl.formatMessage({ id: "invoiceDetail.netExclVat" }, { amount: estimatedNet.toFixed(2) })}</p>
            <p>{intl.formatMessage({ id: "invoiceDetail.vatAmount" }, { amount: estimatedTax.toFixed(2) })}</p>
            <p className="font-medium">{intl.formatMessage({ id: "invoiceDetail.totalAmount" }, { amount: total.toFixed(2) })}</p>
          </div>

          {invoice.state === "Draft" && (
            <div className="flex flex-col items-start gap-1">
              <Button onClick={handlePost} disabled={posting}>
                {posting ? intl.formatMessage({ id: "invoiceDetail.posting" }) : intl.formatMessage({ id: "invoiceDetail.postInvoice" })}
              </Button>
              {postError && <span className="text-xs text-destructive">{postError}</span>}
            </div>
          )}

          {invoice.state === "Posted" && balance && (
            <div className="flex gap-6 text-sm">
              <p>{intl.formatMessage({ id: "invoiceDetail.totalAmount" }, { amount: balance.total.toFixed(2) })}</p>
              <p>{intl.formatMessage({ id: "invoiceDetail.reconciled" }, { amount: balance.reconciled.toFixed(2) })}</p>
              <p className="font-medium">{intl.formatMessage({ id: "invoiceDetail.outstanding" }, { amount: balance.outstanding.toFixed(2) })}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {invoice.state === "Posted" && balance && balance.outstanding > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "invoiceDetail.recordPayment" })}</CardTitle>
            <CardDescription>{intl.formatMessage({ id: "invoiceDetail.recordPaymentDescription" })}</CardDescription>
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
            <CardTitle>{intl.formatMessage({ id: "invoiceDetail.applyCreditNote" })}</CardTitle>
            <CardDescription>{intl.formatMessage({ id: "invoiceDetail.applyCreditNoteDescription" })}</CardDescription>
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
            <CardTitle>{intl.formatMessage({ id: "invoiceDetail.applyDownPayment" })}</CardTitle>
            <CardDescription>{intl.formatMessage({ id: "invoiceDetail.applyDownPaymentDescription" })}</CardDescription>
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
