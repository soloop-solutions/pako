import { useCallback, useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/amount";
import { useScrollToHash } from "@/hooks/useScrollToHash";
import { formatDisplayDate } from "@/lib/dates";
import { DocumentStateBadge } from "@/components/shared/DocumentStateBadge";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import type {
  ApplyCreditNoteResponse,
  BillResponse,
  DocumentBalanceResponse,
  PartnerResponse,
  PaymentMethodResponse,
  TaxDefinitionResponse,
} from "@pako/shared";

import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { apiClient, getApiErrorMessage } from "@/api/client";
import { monthLocksClient } from "@/api/month-locks-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { useTabMeta } from "@/context/TabsContext";
import { BillDocumentType, billDocumentTypeLabel } from "@/lib/document-types";
import { PriceMode } from "@/lib/tax-enums";
import { cn } from "@/lib/utils";
import { ActivityTimeline } from "@/components/shared/ActivityTimeline";
import { EntityHistory } from "@/components/shared/EntityHistory";
import { RelatedDocuments } from "@/components/shared/RelatedDocuments";
import { PrintButton } from "@/components/shared/PrintButton";
import { PostingPreview } from "@/components/shared/PostingPreview";
import { ApplyCreditNoteForm, type CreditNoteOption } from "@/pages/shared/ApplyCreditNoteForm";
import { AttachmentsPanel } from "@/pages/shared/AttachmentsPanel";
import { EditPostedFieldsForm } from "@/pages/shared/EditPostedFieldsForm";
import { RecordPaymentForm } from "@/pages/shared/RecordPaymentForm";
import { useMyAccess } from "@/hooks/useMyAccess";
import { blockingLockDate, lockDateLabel } from "@/lib/lock-dates";

export function BillDetail() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { activeCompany } = useCompany();
  // docs/USER_ACCESS_PLAN.md: posting and payments need Purchases: Approve.
  const { canApprove, canWrite } = useMyAccess();
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
  const [showPostPreview, setShowPostPreview] = useState(false);
  // A5 (v2 release): Draft = fully editable, toggled inline rather than a separate route.
  const billPrintRef = useRef<HTMLDivElement>(null);

  const billYear = bill ? new Date(bill.issueDate).getFullYear() : null;
  const billMonth = bill ? new Date(bill.issueDate).getMonth() + 1 : null;
  const monthLockQuery = useQuery({
    queryKey: ["month-locks", companyId, billYear],
    queryFn: () => monthLocksClient.getYear(companyId!, billYear!),
    enabled: !!companyId && billYear !== null,
  });
  const isMonthLocked = billMonth !== null
    && (monthLockQuery.data?.months ?? []).some((m) => m.month === billMonth && m.isLocked);
  const lockBlock = activeCompany ? blockingLockDate(bill?.issueDate, activeCompany, "purchase") : null;
  const isLockBlocked = !!lockBlock || isMonthLocked;

  const refresh = useCallback(async () => {
    if (!companyId || !id) return;
    setError(null);
    try {
      const [billResult, partnersResult, taxesResult, allBillsResult, paymentMethodsResult] = await Promise.all([
        apiClient.billsGET(companyId, id),
        apiClient.partnersAll(companyId, undefined),
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

  // Task 8: instance tab title follows the same fallback used on screen ("Draft bill"). Editing is
  // its own page now (/bills/:id/edit, user decision 2026-11-24).
  useTabMeta({
    title: bill ? (bill.vendorReference ?? intl.formatMessage({ id: bill.state === "Draft" ? "billDetail.draftBill" : "billDetail.title" })) : undefined,
  });

  async function handlePost() {
    if (!companyId || !id) return;
    setPostError(null);
    setPosting(true);
    try {
      await apiClient.post(companyId, id);
      toast.success(intl.formatMessage({ id: "toast.billPosted" }));
      await refresh();
    } catch (err) {
      const msg = getApiErrorMessage(err, intl.formatMessage({ id: "billDetail.postError" }));
      setPostError(msg);
      toast.error(msg);
    } finally {
      setPosting(false);
    }
  }

  async function handleAppliedCreditNote(response: ApplyCreditNoteResponse) {
    const msg = intl.formatMessage({ id: "billDetail.appliedCreditNote" }, { amount: formatMoney(response.reconciliation.amount) });
    setApplyMessage(msg);
    toast.success(msg);
    await refresh();
  }

  useScrollToHash(!!bill);

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
  const isCreditDocument = bill.documentType === BillDocumentType.CreditNote || bill.documentType === BillDocumentType.PurchaseReturn;

  // Task 7: Build related documents list
  const relatedDocs = [];
  if (bill.originalBillId) {
    const original = allBills.find((b) => b.id === bill.originalBillId);
    if (original) {
      relatedDocs.push({
        id: original.id,
        label: original.vendorReference ?? original.id,
        type: intl.formatMessage({ id: "relatedDocuments.originalBill" }),
        url: `/bills/${original.id}`,
      });
    }
  }
  // Find purchase returns / credit notes that reference this bill
  for (const related of allBills) {
    if (related.originalBillId === bill.id && related.id !== bill.id) {
      const isReturn = related.documentType === BillDocumentType.PurchaseReturn;
      relatedDocs.push({
        id: related.id,
        label: related.vendorReference ?? related.id,
        type: isReturn
          ? intl.formatMessage({ id: "relatedDocuments.purchaseReturn" })
          : intl.formatMessage({ id: "relatedDocuments.creditNote" }),
        url: isReturn ? `/purchase-returns/${related.id}` : `/bills/${related.id}`,
      });
    }
  }

  // Every amount comes from the server (DocumentLineCalculator), never computed here.
  const totals = bill.totals;
  const money = (value: number | undefined) => formatMoney((value ?? 0));
  const priceHeaderId = bill.priceMode === PriceMode.NetExclusive ? "billForm.priceExclVat" : "billForm.priceInclVat";

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

      {isMonthLocked && bill.state === "Posted" && (
        <div className="flex items-center gap-3 rounded-lg border border-warning-border bg-warning/40 px-4 py-3">
          <Lock className="size-4 shrink-0 text-warning-foreground" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-warning-foreground">
              {intl.formatMessage({ id: "billDetail.monthLocked.title" })}
            </span>
            <span className="text-xs text-warning-foreground/80">
              {intl.formatMessage({ id: "billDetail.monthLocked.description" })}
            </span>
          </div>
        </div>
      )}

      {lockBlock && bill.state === "Draft" && (
        <div className="flex items-center gap-3 rounded-lg border border-warning-border bg-warning/40 px-4 py-3">
          <Lock className="size-4 shrink-0 text-warning-foreground" />
          <span className="text-sm text-warning-foreground">
            {intl.formatMessage({ id: "document.lockDate.blocked" }, {
              lockType: lockDateLabel(lockBlock.key, intl).toLowerCase(),
              lockDate: formatDisplayDate(lockBlock.lockDate),
            })}
          </span>
        </div>
      )}

      <Card ref={billPrintRef} className={cn(bill.state === "Draft" && "border-dashed bg-muted/30", bill.state === "Cancelled" && "opacity-60")}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>{bill.vendorReference ?? intl.formatMessage({ id: bill.state === "Draft" ? "billDetail.draftBill" : "billDetail.title" })}</CardTitle>
                <Badge variant="outline">{billDocumentTypeLabel(bill.documentType, intl)}</Badge>
              </div>
              <CardDescription>{partner?.name ?? bill.partnerId}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {(bill.state === "Draft" || (bill.state === "Posted" && !isMonthLocked)) && (
                <Button variant="outline" size="sm" onClick={() => navigate(`${bill.documentType === BillDocumentType.PurchaseReturn ? "/purchase-returns" : "/bills"}/${bill.id}/edit`)}>
                  {intl.formatMessage({ id: "common.edit" })}
                </Button>
              )}
              <PrintButton contentRef={billPrintRef} size="sm" />
              <DocumentStateBadge state={bill.state} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">{intl.formatMessage({ id: "billDetail.issueDate" })}</span> {formatDisplayDate(bill.issueDate)}
            </p>
            <p>
              <span className="text-muted-foreground">{intl.formatMessage({ id: "billDetail.dueDate" })}</span> {bill.dueDate ? formatDisplayDate(bill.dueDate) : "—"}
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
                <TableHead className="text-right">{intl.formatMessage({ id: priceHeaderId })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "billForm.discountPercent" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "documentLine.netValue" })}</TableHead>
                {activeCompany.isVatRegistered && <TableHead>{intl.formatMessage({ id: "billForm.tax" })}</TableHead>}
                {activeCompany.isVatRegistered && <TableHead className="text-right">{intl.formatMessage({ id: "billForm.vat" })}</TableHead>}
                <TableHead className="text-right">{intl.formatMessage({ id: "common.total" })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bill.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.unitName ? `${line.quantity} ${line.unitName}` : line.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(line.unitPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.discountPercent.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(line.netAmount)}</TableCell>
                  {activeCompany.isVatRegistered && <TableCell>{taxes.find((t) => t.id === line.taxDefinitionId)?.name ?? "-"}</TableCell>}
                  {activeCompany.isVatRegistered && <TableCell className="text-right tabular-nums">{money(line.taxAmount)}</TableCell>}
                  <TableCell className="text-right tabular-nums">{money(line.grossAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-col items-end gap-1 text-sm">
            <p>{intl.formatMessage({ id: "billDetail.netExclVat" }, { amount: money(totals?.netAmount) })}</p>
            {activeCompany.isVatRegistered && <p>{intl.formatMessage({ id: "billDetail.vatAmount" }, { amount: money(totals?.taxAmount) })}</p>}
            <p className="font-medium">{intl.formatMessage({ id: "billDetail.totalAmount" }, { amount: money(totals?.grossAmount) })}</p>
          </div>

          {bill.state === "Draft" && canApprove("purchases") && (
            <div className="flex flex-col items-start gap-1">
              <Button onClick={() => setShowPostPreview(true)} disabled={posting || isLockBlocked}>
                {posting ? intl.formatMessage({ id: "billDetail.posting" }) : intl.formatMessage({ id: "billDetail.postBill" })}
              </Button>
              {postError && <span className="text-xs text-destructive">{postError}</span>}
            </div>
          )}

          {bill.state === "Posted" && balance && (
            <div className="flex gap-6 text-sm">
              <p>{intl.formatMessage({ id: "billDetail.totalAmount" }, { amount: formatMoney(balance.total) })}</p>
              <p>{intl.formatMessage({ id: "billDetail.reconciled" }, { amount: formatMoney(balance.reconciled) })}</p>
              <p className="font-medium">{intl.formatMessage({ id: "billDetail.outstanding" }, { amount: formatMoney(balance.outstanding) })}</p>
            </div>
          )}
            {relatedDocs.length > 0 && <RelatedDocuments documents={relatedDocs} />}
        </CardContent>
      </Card>

      {bill.state === "Posted" && bill.documentType === BillDocumentType.Bill && (
        <Card className={isMonthLocked ? "opacity-50 pointer-events-none select-none" : undefined}>
          <CardHeader>
            <CardTitle>{intl.formatMessage({ id: "billDetail.actions" })}</CardTitle>
            <CardDescription>{intl.formatMessage({ id: "billDetail.actionsDescription" })}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/purchase-returns">{intl.formatMessage({ id: "billDetail.createReturn" })}</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/bills">{intl.formatMessage({ id: "billDetail.createCreditNote" })}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {bill.state === "Posted" && (
        <Card className={isMonthLocked ? "opacity-50 pointer-events-none select-none" : undefined}>
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

      {bill.state === "Posted" && balance && balance.outstanding > 0 && canApprove("purchases") && (
        <Card id="payment" className={isMonthLocked ? "opacity-50 pointer-events-none select-none" : undefined}>
          <CardHeader>
            <CardTitle>
              {isCreditDocument
                ? intl.formatMessage({ id: "payment.refundSupplier" })
                : intl.formatMessage({ id: "billDetail.recordPayment" })}
            </CardTitle>
            <CardDescription>
              {isCreditDocument
                ? intl.formatMessage({ id: "payment.refundSupplierDescription" })
                : intl.formatMessage({ id: "billDetail.recordPaymentDescription" })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecordPaymentForm
              companyId={activeCompany.id}
              documentKind="bill"
              documentId={bill.id}
              paymentMethods={paymentMethods}
              outstanding={balance.outstanding}
              onRecorded={refresh}
              isRefund={isCreditDocument}
            />
          </CardContent>
        </Card>
      )}

      {bill.state === "Posted" && balance && balance.outstanding > 0 && creditNoteOptions.length > 0 && canApprove("purchases") && (
        <Card className={isMonthLocked ? "opacity-50 pointer-events-none select-none" : undefined}>
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

      <Card className={isMonthLocked ? "opacity-50 pointer-events-none select-none" : undefined}>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "attachments.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "attachments.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <AttachmentsPanel companyId={activeCompany.id} documentKind="bill" documentId={bill.id} readOnly={isMonthLocked || !canWrite("purchases")} />
        </CardContent>
      </Card>

      {bill.state === "Posted" && (
        <Card>
          <CardContent className="pt-6">
            <ActivityTimeline companyId={activeCompany.id} documentKind="bill" documentId={bill.id} />
          </CardContent>
        </Card>
      )}

      <EntityHistory entityType="Bill" entityId={bill.id} />

      {showPostPreview && (
        <PostingPreview
          companyId={activeCompany.id}
          documentKind="bill"
          documentId={bill.id}
          confirming={posting}
          onConfirm={() => {
            setShowPostPreview(false);
            void handlePost();
          }}
          onCancel={() => setShowPostPreview(false)}
        />
      )}
    </div>
  );
}
