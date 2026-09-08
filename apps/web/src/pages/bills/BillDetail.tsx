import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Link, useParams } from "react-router-dom";
import type {
  ApplyCreditNoteResponse,
  BillResponse,
  DocumentBalanceResponse,
  PartnerResponse,
  PaymentMethodResponse,
  TaxDefinitionResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { BillDocumentType, billDocumentTypeLabel } from "@/lib/document-types";
import { computeLine } from "@/lib/tax-enums";
import { BillForm } from "@/pages/bills/BillForm";
import { ApplyCreditNoteForm, type CreditNoteOption } from "@/pages/shared/ApplyCreditNoteForm";
import { EditPostedFieldsForm } from "@/pages/shared/EditPostedFieldsForm";
import { RecordPaymentForm } from "@/pages/shared/RecordPaymentForm";

export function BillDetail() {
  const intl = useIntl();
  const { id } = useParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [bill, setBill] = useState<BillResponse | null>(null);
  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [allBills, setAllBills] = useState<BillResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodResponse[]>([]);
  const [balance, setBalance] = useState<DocumentBalanceResponse | null>(null);
  const [creditNoteOptions, setCreditNoteOptions] = useState<CreditNoteOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  // A5 (v2 release): Draft = fully editable, toggled inline rather than a separate route.
  const [editing, setEditing] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId || !id) return;
    setError(null);
    try {
      const [billResult, partnersResult, taxesResult, allBillsResult, paymentMethodsResult] = await Promise.all([
        apiClient.billsGET(companyId, id),
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.billsAll(companyId),
        apiClient.paymentMethodsAll(companyId),
      ]);
      setBill(billResult);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setAllBills(allBillsResult);
      setPaymentMethods(paymentMethodsResult);

      if (billResult.state === "Posted") {
        setBalance(await apiClient.balance(companyId, id));

        const creditNoteCandidates = allBillsResult.filter(
          (candidate) =>
            candidate.id !== id &&
            candidate.partnerId === billResult.partnerId &&
            candidate.state === "Posted" &&
            candidate.documentType === BillDocumentType.CreditNote,
        );
        const creditNoteBalances = await Promise.all(
          creditNoteCandidates.map((candidate) => apiClient.balance(companyId, candidate.id)),
        );
        setCreditNoteOptions(
          creditNoteCandidates
            .map((candidate, index) => ({
              id: candidate.id,
              label: candidate.vendorReference ?? candidate.id,
              total: creditNoteBalances[index].outstanding,
            }))
            .filter((option) => option.total > 0),
        );
      } else {
        setBalance(null);
        setCreditNoteOptions([]);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "billDetail.loadError" })));
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
      await apiClient.post(companyId, id);
      await refresh();
    } catch (err) {
      setPostError(getApiErrorMessage(err, intl.formatMessage({ id: "billDetail.postError" })));
    } finally {
      setPosting(false);
    }
  }

  async function handleAppliedCreditNote(response: ApplyCreditNoteResponse) {
    setApplyMessage(intl.formatMessage({ id: "billDetail.appliedCreditNote" }, { amount: response.reconciliation.amount.toFixed(2) }));
    await refresh();
  }

  if (!activeCompany || !bill) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "billDetail.title" })}</CardTitle>
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

  const partner = partners.find((p) => p.id === bill.partnerId);

  let total = 0;
  let estimatedNet = 0;
  let estimatedTax = 0;
  for (const line of bill.lines) {
    const enteredAmount = line.quantity * line.unitPrice * (1 - (line.discountPercent ?? 0) / 100);
    const { net, tax, gross } = computeLine(enteredAmount, taxes.find((t) => t.id === line.taxDefinitionId), bill.priceMode);
    total += gross;
    estimatedNet += net;
    estimatedTax += tax;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link className="text-sm text-muted-foreground hover:underline" to="/bills">
        &larr; {intl.formatMessage({ id: "billDetail.backToBills" })}
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
                <CardTitle>{bill.vendorReference ?? intl.formatMessage({ id: "billDetail.draftBill" })}</CardTitle>
                <Badge variant="outline">{billDocumentTypeLabel(bill.documentType, intl)}</Badge>
              </div>
              <CardDescription>{partner?.name ?? bill.partnerId}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {bill.state === "Draft" && !editing && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  {intl.formatMessage({ id: "common.edit" })}
                </Button>
              )}
              <Badge variant={bill.state === "Posted" ? "default" : "secondary"}>{bill.state}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editing ? (
            <BillForm
              companyId={activeCompany.id}
              vendors={partners.filter((p) => p.isVendor)}
              taxes={taxes}
              bills={allBills}
              paymentMethods={paymentMethods}
              isVatRegistered={activeCompany.isVatRegistered}
              editingBill={bill}
              onCreated={() => {}}
              onSaved={() => {
                setEditing(false);
                void refresh();
              }}
            />
          ) : (
            <>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">{intl.formatMessage({ id: "billDetail.issueDate" })}</span> {bill.issueDate}
            </p>
            <p>
              <span className="text-muted-foreground">{intl.formatMessage({ id: "billDetail.dueDate" })}</span> {bill.dueDate}
            </p>
            {bill.internalNotes && (
              <p className="sm:col-span-2">
                <span className="text-muted-foreground">{intl.formatMessage({ id: "billDetail.internalNotes" })}</span> {bill.internalNotes}
              </p>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "billForm.description" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "billForm.qty" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "billForm.priceInclVat" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "billForm.discountPercent" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "billForm.tax" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "billForm.net" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "billForm.vat" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "common.total" })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bill.lines.map((line) => {
                const enteredAmount = line.quantity * line.unitPrice * (1 - line.discountPercent / 100);
                const { net, tax, gross } = computeLine(enteredAmount, taxes.find((t) => t.id === line.taxDefinitionId), bill.priceMode);
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
            <p>{intl.formatMessage({ id: "billDetail.netExclVat" }, { amount: estimatedNet.toFixed(2) })}</p>
            <p>{intl.formatMessage({ id: "billDetail.vatAmount" }, { amount: estimatedTax.toFixed(2) })}</p>
            <p className="font-medium">{intl.formatMessage({ id: "billDetail.totalAmount" }, { amount: total.toFixed(2) })}</p>
          </div>

          {bill.state === "Draft" && (
            <div className="flex flex-col items-start gap-1">
              <Button onClick={handlePost} disabled={posting}>
                {posting ? intl.formatMessage({ id: "billDetail.posting" }) : intl.formatMessage({ id: "billDetail.postBill" })}
              </Button>
              {postError && <span className="text-xs text-destructive">{postError}</span>}
            </div>
          )}

          {bill.state === "Posted" && balance && (
            <div className="flex gap-6 text-sm">
              <p>{intl.formatMessage({ id: "billDetail.totalAmount" }, { amount: balance.total.toFixed(2) })}</p>
              <p>{intl.formatMessage({ id: "billDetail.reconciled" }, { amount: balance.reconciled.toFixed(2) })}</p>
              <p className="font-medium">{intl.formatMessage({ id: "billDetail.outstanding" }, { amount: balance.outstanding.toFixed(2) })}</p>
            </div>
          )}
            </>
          )}
        </CardContent>
      </Card>

      {bill.state === "Posted" && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "editPostedFields.title" })}</CardTitle>
          </CardHeader>
          <CardContent>
            <EditPostedFieldsForm
              companyId={activeCompany.id}
              documentKind="bill"
              documentId={bill.id}
              initialDueDate={bill.dueDate}
              initialInternalNotes={bill.internalNotes ?? undefined}
              onSaved={() => void refresh()}
            />
          </CardContent>
        </Card>
      )}

      {bill.state === "Posted" && balance && balance.outstanding > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "billDetail.recordPayment" })}</CardTitle>
            <CardDescription>{intl.formatMessage({ id: "billDetail.recordPaymentDescription" })}</CardDescription>
          </CardHeader>
          <CardContent>
            <RecordPaymentForm
              companyId={activeCompany.id}
              documentKind="bill"
              documentId={bill.id}
              paymentMethods={paymentMethods}
              outstanding={balance.outstanding}
              onRecorded={refresh}
            />
          </CardContent>
        </Card>
      )}

      {bill.state === "Posted" && balance && balance.outstanding > 0 && creditNoteOptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "billDetail.applyCreditNote" })}</CardTitle>
            <CardDescription>{intl.formatMessage({ id: "billDetail.applyCreditNoteDescription" })}</CardDescription>
          </CardHeader>
          <CardContent>
            <ApplyCreditNoteForm
              companyId={activeCompany.id}
              documentKind="bill"
              documentId={bill.id}
              outstanding={balance.outstanding}
              options={creditNoteOptions}
              onApplied={handleAppliedCreditNote}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
