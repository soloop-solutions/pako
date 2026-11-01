import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import type {
  AccountResponse,
  ApplyCreditNoteResponse,
  ApplyDownPaymentResponse,
  DocumentBalanceResponse,
  InvoiceResponse,
  ItemResponse,
  MemberResponse,
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
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useTabMeta } from "@/context/TabsContext";
import { documentStateBadgeVariant, invoiceDocumentTypeLabel, InvoiceDocumentType } from "@/lib/document-types";
import { isCompanyAdminRole } from "@/lib/membership-enums";
import { computeLine } from "@/lib/tax-enums";
import { cn } from "@/lib/utils";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { buildDocumentDataFromResponse } from "@/lib/invoice-document-data";
import { InvoicePreviewDialog } from "@/components/shared/InvoicePreviewDialog";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";
import { ApplyCreditNoteForm, type CreditNoteOption } from "@/pages/shared/ApplyCreditNoteForm";
import { ApplyDownPaymentForm, type DownPaymentOption } from "@/pages/shared/ApplyDownPaymentForm";
import { PostingPreview } from "@/components/shared/PostingPreview";
import { ActivityTimeline } from "@/components/shared/ActivityTimeline";
import { RelatedDocuments } from "@/components/shared/RelatedDocuments";
import { AttachmentsPanel } from "@/pages/shared/AttachmentsPanel";
import { EditPostedFieldsForm } from "@/pages/shared/EditPostedFieldsForm";
import { OverrideNumberForm } from "@/pages/shared/OverrideNumberForm";
import { RecordPaymentForm } from "@/pages/shared/RecordPaymentForm";
import { useMyAccess } from "@/hooks/useMyAccess";

export function InvoiceDetail() {
  const intl = useIntl();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeCompany } = useCompany();
  const { auth } = useAuth();
  // docs/USER_ACCESS_PLAN.md: posting and payments need Sales: Approve.
  const { canApprove } = useMyAccess();
  const companyId = activeCompany?.id ?? null;

  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [allInvoices, setAllInvoices] = useState<InvoiceResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodResponse[]>([]);
  // F5 — see Invoicing.tsx's identical fields; needed here so editing a Draft invoice also gets
  // the item picker/account override.
  const [items, setItems] = useState<ItemResponse[]>([]);
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [members, setMembers] = useState<MemberResponse[]>([]);
  const [balance, setBalance] = useState<DocumentBalanceResponse | null>(null);
  const [creditNoteOptions, setCreditNoteOptions] = useState<CreditNoteOption[]>([]);
  const [downPaymentOptions, setDownPaymentOptions] = useState<DownPaymentOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [showPostPreview, setShowPostPreview] = useState(false);
  // A5 (v2 release): Draft = fully editable, toggled inline rather than a separate route.
  const [editing, setEditing] = useState(false);
  const [showDocPreview, setShowDocPreview] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId || !id) return;
    setError(null);
    try {
      const [invoiceResult, partnersResult, taxesResult, allInvoicesResult, paymentMethodsResult, membersResult, itemsResult, accountsResult] =
        await Promise.all([
          apiClient.invoicesGET(companyId, id),
          apiClient.partnersAll(companyId),
          apiClient.taxes(companyId),
          apiClient.invoicesAll(companyId),
          apiClient.paymentMethodsAll(companyId),
          apiClient.membersAll(companyId),
          apiClient.itemsGET(companyId, 1, 200, undefined, undefined),
          apiClient.accountsAll(companyId),
        ]);
      setInvoice(invoiceResult);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setAllInvoices(allInvoicesResult);
      setPaymentMethods(paymentMethodsResult);
      setMembers(membersResult);
      setItems(itemsResult.items);
      setAccounts(accountsResult);

      if (invoiceResult.state === "Posted") {
        setBalance(await apiClient.balance2(companyId, id));

        const partnerPostedInvoices = allInvoicesResult.filter(
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

  // Task 8: instance tabs are titled with the document number, per the same fallback InvoiceForm
  // already uses ("Draft invoice" until a number is assigned on posting). `dirty` is the existing
  // inline-edit toggle, not real field-level change tracking — no form in the app tracks that yet.
  useTabMeta({
    title: invoice ? (invoice.invoiceNumber ?? intl.formatMessage({ id: "invoiceDetail.draftInvoice" })) : undefined,
    dirty: editing,
  });

  useUnsavedChanges(editing);

  async function handlePost() {
    if (!companyId || !id) return;
    setPostError(null);
    setPosting(true);
    try {
      await apiClient.post2(companyId, id);
      toast.success(intl.formatMessage({ id: "toast.invoicePosted" }));
      await refresh();
    } catch (err) {
      const msg = getApiErrorMessage(err, intl.formatMessage({ id: "invoiceDetail.postError" }));
      setPostError(msg);
      toast.error(msg);
    } finally {
      setPosting(false);
    }
  }

  // A3 (v2 release): a proforma never posts — this replaces the Post button for that type below.
  async function handleConvert() {
    if (!companyId || !id) return;
    setPostError(null);
    setConverting(true);
    try {
      const newInvoice = await apiClient.convertToInvoice(companyId, id);
      navigate(`/invoicing/${newInvoice.id}`);
    } catch (err) {
      setPostError(getApiErrorMessage(err, intl.formatMessage({ id: "invoiceDetail.convertError" })));
    } finally {
      setConverting(false);
    }
  }

  async function handleAppliedCreditNote(response: ApplyCreditNoteResponse) {
    const msg = intl.formatMessage({ id: "invoiceDetail.appliedCreditNote" }, { amount: response.reconciliation.amount.toFixed(2) });
    setApplyMessage(msg);
    toast.success(msg);
    await refresh();
  }

  async function handleAppliedDownPayment(response: ApplyDownPaymentResponse) {
    const applied = response.reconciliation.amount;
    const msg = response.reclassifiedAmount > 0
      ? intl.formatMessage(
          { id: "invoiceDetail.appliedDownPaymentWithRevenue" },
          { amount: applied.toFixed(2), revenueAmount: response.reclassifiedAmount.toFixed(2) },
        )
      : intl.formatMessage({ id: "invoiceDetail.appliedDownPayment" }, { amount: applied.toFixed(2) });
    setApplyMessage(msg);
    toast.success(msg);
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
  const currentMembership = members.find((m) => m.userId === auth?.userId);
  const isAdmin = currentMembership ? isCompanyAdminRole(currentMembership.role) : false;
  const isCreditDocument = invoice.documentType === InvoiceDocumentType.CreditNote || invoice.documentType === InvoiceDocumentType.SalesReturn;

  // Item 29: Build related documents list
  const relatedDocs = [];
  if (invoice.originalInvoiceId) {
    const original = allInvoices.find((i) => i.id === invoice.originalInvoiceId);
    if (original) {
      relatedDocs.push({
        id: original.id,
        label: original.invoiceNumber ?? original.id,
        type: intl.formatMessage({ id: "relatedDocuments.originalInvoice" }),
        url: `/invoicing/${original.id}`,
      });
    }
  }
  // Find returns/credit notes that reference this invoice
  for (const related of allInvoices) {
    if (related.originalInvoiceId === invoice.id && related.id !== invoice.id) {
      const isReturn = related.documentType === InvoiceDocumentType.SalesReturn;
      relatedDocs.push({
        id: related.id,
        label: related.invoiceNumber ?? related.id,
        type: isReturn
          ? intl.formatMessage({ id: "relatedDocuments.salesReturn" })
          : intl.formatMessage({ id: "relatedDocuments.creditNote" }),
        url: isReturn ? `/sales-returns/${related.id}` : `/invoicing/${related.id}`,
      });
    }
  }

  let total = 0;
  let estimatedNet = 0;
  let estimatedTax = 0;
  for (const line of invoice.lines) {
    const enteredAmount = line.quantity * line.unitPrice * (1 - (line.discountPercent ?? 0) / 100);
    const { net, tax, gross } = computeLine(enteredAmount, taxes.find((t) => t.id === line.taxDefinitionId), invoice.priceMode);
    total += gross;
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

      <Card className={cn(invoice.state === "Draft" && "border-dashed bg-muted/30", invoice.state === "Cancelled" && "opacity-60")}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>{invoice.invoiceNumber ?? intl.formatMessage({ id: "invoiceDetail.draftInvoice" })}</CardTitle>
                <Badge variant="outline">{invoiceDocumentTypeLabel(invoice.documentType, intl)}</Badge>
              </div>
              <CardDescription>{partner?.name ?? invoice.partnerId}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {invoice.state === "Draft" && !editing && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  {intl.formatMessage({ id: "common.edit" })}
                </Button>
              )}
              {!editing && (
                <Button variant="outline" size="sm" onClick={() => setShowDocPreview(true)}>
                  {intl.formatMessage({ id: "invoicePreview.previewInvoice" })}
                </Button>
              )}
              <Badge variant={documentStateBadgeVariant(invoice.state)}>{invoice.state}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editing ? (
            <InvoiceForm
              companyId={activeCompany.id}
              customers={partners.filter((p) => p.isCustomer)}
              taxes={taxes}
              invoices={allInvoices}
              paymentMethods={paymentMethods}
              items={items}
              accounts={accounts}
              isVatRegistered={activeCompany.isVatRegistered}
              editingInvoice={invoice}
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
              <span className="text-muted-foreground">{intl.formatMessage({ id: "invoiceDetail.issueDate" })}</span> {invoice.issueDate}
            </p>
            <p>
              <span className="text-muted-foreground">{intl.formatMessage({ id: "invoiceDetail.dueDate" })}</span> {invoice.dueDate}
            </p>
            {invoice.internalNotes && (
              <p className="sm:col-span-2">
                <span className="text-muted-foreground">{intl.formatMessage({ id: "invoiceDetail.internalNotes" })}</span> {invoice.internalNotes}
              </p>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "invoiceForm.description" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "invoiceForm.qty" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "invoiceForm.priceInclVat" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "invoiceForm.discountPercent" })}</TableHead>
                {activeCompany.isVatRegistered && <TableHead>{intl.formatMessage({ id: "invoiceForm.tax" })}</TableHead>}
                {activeCompany.isVatRegistered && <TableHead className="text-right">{intl.formatMessage({ id: "invoiceForm.net" })}</TableHead>}
                {activeCompany.isVatRegistered && <TableHead className="text-right">{intl.formatMessage({ id: "invoiceForm.vat" })}</TableHead>}
                <TableHead className="text-right">{intl.formatMessage({ id: "common.total" })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((line) => {
                const enteredAmount = line.quantity * line.unitPrice * (1 - line.discountPercent / 100);
                const { net, tax, gross } = computeLine(enteredAmount, taxes.find((t) => t.id === line.taxDefinitionId), invoice.priceMode);
                return (
                  <TableRow key={line.id}>
                    <TableCell>{line.description}</TableCell>
                    <TableCell className="text-right">{line.quantity}</TableCell>
                    <TableCell className="text-right">{line.unitPrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{line.discountPercent.toFixed(2)}</TableCell>
                    {activeCompany.isVatRegistered && <TableCell>{taxes.find((t) => t.id === line.taxDefinitionId)?.name ?? "-"}</TableCell>}
                    {activeCompany.isVatRegistered && <TableCell className="text-right">{net.toFixed(2)}</TableCell>}
                    {activeCompany.isVatRegistered && <TableCell className="text-right">{tax.toFixed(2)}</TableCell>}
                    <TableCell className="text-right">{gross.toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex flex-col items-end gap-1 text-sm">
            {activeCompany.isVatRegistered && <p>{intl.formatMessage({ id: "invoiceDetail.netExclVat" }, { amount: estimatedNet.toFixed(2) })}</p>}
            {activeCompany.isVatRegistered && <p>{intl.formatMessage({ id: "invoiceDetail.vatAmount" }, { amount: estimatedTax.toFixed(2) })}</p>}
            <p className="font-medium">{intl.formatMessage({ id: "invoiceDetail.totalAmount" }, { amount: total.toFixed(2) })}</p>
          </div>

          {invoice.state === "Draft" && invoice.documentType === InvoiceDocumentType.Proforma && (
            <div className="flex flex-col items-start gap-1">
              <Button onClick={handleConvert} disabled={converting}>
                {converting ? intl.formatMessage({ id: "proforma.converting" }) : intl.formatMessage({ id: "proforma.convert" })}
              </Button>
              {postError && <span className="text-xs text-destructive">{postError}</span>}
            </div>
          )}

          {invoice.state === "Draft" && invoice.documentType !== InvoiceDocumentType.Proforma && canApprove("sales") && (
            <div className="flex flex-col items-start gap-1">
              <Button onClick={() => setShowPostPreview(true)} disabled={posting}>
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
            {relatedDocs.length > 0 && <RelatedDocuments documents={relatedDocs} />}
            </>
          )}
        </CardContent>
      </Card>

      {invoice.state === "Posted" && invoice.documentType === InvoiceDocumentType.Invoice && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "invoiceDetail.actions" })}</CardTitle>
            <CardDescription>{intl.formatMessage({ id: "invoiceDetail.actionsDescription" })}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/sales-returns">{intl.formatMessage({ id: "invoiceDetail.createReturn" })}</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/invoicing">{intl.formatMessage({ id: "invoiceDetail.createCreditNote" })}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {invoice.state === "Posted" && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "editPostedFields.title" })}</CardTitle>
          </CardHeader>
          <CardContent>
            <EditPostedFieldsForm
              companyId={activeCompany.id}
              documentKind="invoice"
              documentId={invoice.id}
              initialDueDate={invoice.dueDate}
              initialInternalNotes={invoice.internalNotes ?? undefined}
              onSaved={() => void refresh()}
            />
          </CardContent>
        </Card>
      )}

      {invoice.state === "Posted" && balance && balance.outstanding > 0 && canApprove("sales") && (
        <Card>
          <CardHeader>
            <CardTitle>
              {isCreditDocument
                ? intl.formatMessage({ id: "payment.refundCustomer" })
                : intl.formatMessage({ id: "invoiceDetail.recordPayment" })}
            </CardTitle>
            <CardDescription>
              {isCreditDocument
                ? intl.formatMessage({ id: "payment.refundCustomerDescription" })
                : intl.formatMessage({ id: "invoiceDetail.recordPaymentDescription" })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecordPaymentForm
              companyId={activeCompany.id}
              documentKind="invoice"
              documentId={invoice.id}
              paymentMethods={paymentMethods}
              outstanding={balance.outstanding}
              onRecorded={refresh}
              isRefund={isCreditDocument}
            />
          </CardContent>
        </Card>
      )}

      {invoice.state === "Posted" && balance && balance.outstanding > 0 && creditNoteOptions.length > 0 && canApprove("sales") && (
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

      {invoice.state === "Posted" && balance && balance.outstanding > 0 && downPaymentOptions.length > 0 && canApprove("sales") && (
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

      {invoice.state === "Posted" && activeCompany.allowNumberOverride && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "overrideNumber.title" })}</CardTitle>
            <CardDescription>{intl.formatMessage({ id: "overrideNumber.description" })}</CardDescription>
          </CardHeader>
          <CardContent>
            <OverrideNumberForm
              companyId={activeCompany.id}
              invoiceId={invoice.id}
              currentNumber={invoice.invoiceNumber}
              onOverridden={(newNumber) => {
                setApplyMessage(intl.formatMessage({ id: "overrideNumber.success" }, { number: newNumber }));
                void refresh();
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "attachments.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "attachments.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <AttachmentsPanel companyId={activeCompany.id} documentKind="invoice" documentId={invoice.id} />
        </CardContent>
      </Card>

      {invoice.state === "Posted" && (
        <Card>
          <CardContent className="pt-6">
            <ActivityTimeline companyId={activeCompany.id} documentKind="invoice" documentId={invoice.id} />
          </CardContent>
        </Card>
      )}

      {showPostPreview && (
        <PostingPreview
          companyId={activeCompany.id}
          documentKind="invoice"
          documentId={invoice.id}
          confirming={posting}
          onConfirm={() => {
            setShowPostPreview(false);
            void handlePost();
          }}
          onCancel={() => setShowPostPreview(false)}
        />
      )}

      {showDocPreview && (
        <InvoicePreviewDialog
          data={buildDocumentDataFromResponse({
            invoice,
            company: activeCompany,
            customer: partner ? { name: partner.name, taxNumber: partner.taxNumber ?? undefined, fiscalNumber: partner.fiscalNumber ?? undefined, isVatRegistered: partner.isVatRegistered } : undefined,
            taxes,
            originalDocumentNumber: invoice.originalInvoiceId
              ? (allInvoices.find((i) => i.id === invoice.originalInvoiceId)?.invoiceNumber ?? undefined)
              : undefined,
          })}
          onClose={() => setShowDocPreview(false)}
        />
      )}
    </div>
  );
}
