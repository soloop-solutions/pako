import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { InvoiceResponse, PartnerResponse, PaymentMethodResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { INVOICE_DOCUMENT_TYPE_OPTION_KEYS, InvoiceDocumentType } from "@/lib/document-types";
import { computeLine, findTaxByCode, PriceMode, taxRatePercentLabel } from "@/lib/tax-enums";
import { PaymentMethodSelect } from "@/pages/shared/PaymentMethodSelect";

type Line = { description: string; quantity: string; unitPrice: string; discountPercent: string; taxDefinitionId: string };

function emptyLine(defaultTaxId: string): Line {
  return { description: "", quantity: "1", unitPrice: "", discountPercent: "0", taxDefinitionId: defaultTaxId };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString: string, days: number): string {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

// Price is either gross (VAT-inclusive) or net (VAT-exclusive), per the document's own PriceMode.
function lineEnteredAmount(line: Line): number {
  const quantity = parseFloat(line.quantity) || 0;
  const unitPrice = parseFloat(line.unitPrice) || 0;
  const discountPercent = parseFloat(line.discountPercent) || 0;
  return quantity * unitPrice * (1 - discountPercent / 100);
}

type InvoiceFormProps = {
  companyId: string;
  customers: PartnerResponse[];
  taxes: TaxDefinitionResponse[];
  invoices: InvoiceResponse[];
  paymentMethods: PaymentMethodResponse[];
  isVatRegistered: boolean;
  onCreated: () => void;
  // A6 (v2 release): when set, this form is dedicated to a single document type (Sales returns,
  // Proforma) — the type selector is hidden entirely and every reset returns to this value,
  // rather than the free <Select> Sales/Purchase invoices still uses (INVOICE_DOCUMENT_TYPE_OPTION_KEYS
  // deliberately still lists only Invoice/CreditNote/DebitNote/DownPayment, unchanged, so that
  // dropdown never grows the new types).
  fixedDocumentType?: number;
  // A5 (v2 release): when set, this form edits an existing Draft invoice (PUT, full replace) in
  // place instead of creating a new one (POST) — every field pre-fills from it, submit calls
  // onSaved instead of onCreated. Only reachable from InvoiceDetail.tsx for a Draft document.
  editingInvoice?: InvoiceResponse;
  onSaved?: () => void;
};

export function InvoiceForm({
  companyId,
  customers,
  taxes,
  invoices,
  paymentMethods,
  isVatRegistered,
  onCreated,
  fixedDocumentType,
  editingInvoice,
  onSaved,
}: InvoiceFormProps) {
  const intl = useIntl();
  // C2: a VAT-registered company can never leave a line without a real tax code — default new
  // lines to the exempt sales code (SEX) instead of the old silent empty "no tax" option.
  const defaultTaxId = isVatRegistered ? (findTaxByCode(taxes, "SEX")?.id ?? "") : "";

  const [partnerId, setPartnerId] = useState(editingInvoice?.partnerId ?? "");
  const [documentType, setDocumentType] = useState<number>(editingInvoice?.documentType ?? fixedDocumentType ?? InvoiceDocumentType.Invoice);
  const [originalInvoiceId, setOriginalInvoiceId] = useState(editingInvoice?.originalInvoiceId ?? "");
  const [issueDate, setIssueDate] = useState(editingInvoice?.issueDate ?? today);
  const [dueDate, setDueDate] = useState(editingInvoice?.dueDate ?? today);
  const [internalNotes, setInternalNotes] = useState(editingInvoice?.internalNotes ?? "");
  // C1/C3: PriceMode/PaymentTermDays/GraceDays/inline-payment are Create-only features —
  // UpdateInvoiceRequest (the Draft-edit path) doesn't carry any of these fields, so this state
  // is only read from the Create branch of handleSubmit and its inputs are hidden while editing.
  const [priceMode, setPriceMode] = useState<number>(PriceMode.GrossInclusive);
  const [paymentTermDays, setPaymentTermDays] = useState("");
  const [graceDays, setGraceDays] = useState("");
  const [takePaymentNow, setTakePaymentNow] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [lines, setLines] = useState<Line[]>(
    editingInvoice
      ? editingInvoice.lines.map((l) => ({
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          discountPercent: String(l.discountPercent),
          taxDefinitionId: l.taxDefinitionId ?? "",
        }))
      : [emptyLine(defaultTaxId)],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A1 (v2 release): SalesReturn joins CreditNote/DebitNote in needing an original-invoice
  // picker, but unlike those two, it's REQUIRED, not optional — see requiresOriginalInvoice below.
  const needsOriginalInvoice =
    documentType === InvoiceDocumentType.CreditNote ||
    documentType === InvoiceDocumentType.DebitNote ||
    documentType === InvoiceDocumentType.SalesReturn;
  const requiresOriginalInvoice = documentType === InvoiceDocumentType.SalesReturn;
  const originalInvoiceCandidates = invoices.filter(
    (invoice) => invoice.partnerId === partnerId && invoice.state === "Posted",
  );

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine(defaultTaxId)]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function handlePaymentTermDaysChange(value: string) {
    setPaymentTermDays(value);
    const days = parseInt(value, 10);
    if (Number.isFinite(days) && days >= 0) {
      setDueDate(addDays(issueDate, days));
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!partnerId) {
      setError(intl.formatMessage({ id: "invoiceForm.selectCustomerError" }));
      return;
    }
    if (requiresOriginalInvoice && !originalInvoiceId) {
      setError(intl.formatMessage({ id: "invoiceForm.originalInvoiceRequiredError" }));
      return;
    }
    const validLines = lines.filter((line) => line.description.trim());
    if (validLines.length === 0) {
      setError(intl.formatMessage({ id: "invoiceForm.atLeastOneLine" }));
      return;
    }

    if (takePaymentNow) {
      const parsedPaymentAmount = parseFloat(paymentAmount);
      if (!parsedPaymentAmount || parsedPaymentAmount <= 0) {
        setError(intl.formatMessage({ id: "invoiceForm.paymentAmountError" }));
        return;
      }
      if (!paymentMethodId) {
        setError(intl.formatMessage({ id: "invoiceForm.paymentMethodError" }));
        return;
      }
    }

    setSubmitting(true);
    try {
      const lineRequests = validLines.map((line) => ({
        description: line.description,
        quantity: parseFloat(line.quantity) || 0,
        unitPrice: parseFloat(line.unitPrice) || 0,
        discountPercent: parseFloat(line.discountPercent) || 0,
        taxDefinitionId: line.taxDefinitionId || undefined,
        revenueAccountId: undefined,
      }));

      if (editingInvoice) {
        await apiClient.invoicesPUT(companyId, editingInvoice.id, {
          partnerId,
          issueDate,
          dueDate,
          documentType,
          originalInvoiceId: originalInvoiceId || undefined,
          lines: lineRequests,
          internalNotes: internalNotes.trim() || undefined,
        });
        onSaved?.();
      } else {
        await apiClient.invoicesPOST(companyId, {
          partnerId,
          issueDate,
          dueDate,
          documentType,
          originalInvoiceId: originalInvoiceId || undefined,
          priceMode,
          paymentTermDays: paymentTermDays ? parseInt(paymentTermDays, 10) : undefined,
          graceDays: graceDays ? parseInt(graceDays, 10) : undefined,
          lines: lineRequests,
          payment: takePaymentNow
            ? { amount: parseFloat(paymentAmount), paymentMethodId, date: issueDate }
            : undefined,
        });
        setPartnerId("");
        setDocumentType(fixedDocumentType ?? InvoiceDocumentType.Invoice);
        setOriginalInvoiceId("");
        setPriceMode(PriceMode.GrossInclusive);
        setPaymentTermDays("");
        setGraceDays("");
        setLines([emptyLine(defaultTaxId)]);
        setTakePaymentNow(false);
        setPaymentAmount("");
        setPaymentMethodId("");
        onCreated();
      }
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: editingInvoice ? "invoiceForm.saveError" : "invoiceForm.createError" })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-customer">{intl.formatMessage({ id: "invoiceForm.customer" })}</Label>
          <Select id="invoice-customer" value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
            <option value="">{intl.formatMessage({ id: "invoiceForm.selectCustomer" })}</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </Select>
        </div>
        {fixedDocumentType === undefined && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-document-type">{intl.formatMessage({ id: "invoiceForm.documentType" })}</Label>
            <Select
              id="invoice-document-type"
              value={documentType}
              onChange={(event) => {
                setDocumentType(Number(event.target.value));
                setOriginalInvoiceId("");
              }}
            >
              {INVOICE_DOCUMENT_TYPE_OPTION_KEYS.map((option) => (
                <option key={option.value} value={option.value}>
                  {intl.formatMessage({ id: option.labelKey })}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-issue-date">{intl.formatMessage({ id: "invoiceForm.issueDate" })}</Label>
          <Input
            id="invoice-issue-date"
            type="date"
            value={issueDate}
            onChange={(event) => {
              setIssueDate(event.target.value);
              const days = parseInt(paymentTermDays, 10);
              if (Number.isFinite(days) && days >= 0) {
                setDueDate(addDays(event.target.value, days));
              }
            }}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-due-date">{intl.formatMessage({ id: "invoiceForm.dueDate" })}</Label>
          <Input
            id="invoice-due-date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            required
          />
        </div>
      </div>

      {editingInvoice && (
        <div className="flex flex-col gap-2 sm:w-1/2">
          <Label htmlFor="invoice-internal-notes">{intl.formatMessage({ id: "invoiceForm.internalNotes" })}</Label>
          <Input id="invoice-internal-notes" value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} />
        </div>
      )}

      {!editingInvoice && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-price-mode">{intl.formatMessage({ id: "invoiceForm.priceMode" })}</Label>
            <Select id="invoice-price-mode" value={priceMode} onChange={(event) => setPriceMode(Number(event.target.value))}>
              <option value={PriceMode.GrossInclusive}>{intl.formatMessage({ id: "invoiceForm.priceModeGross" })}</option>
              <option value={PriceMode.NetExclusive}>{intl.formatMessage({ id: "invoiceForm.priceModeNet" })}</option>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-payment-term-days">{intl.formatMessage({ id: "invoiceForm.paymentTermDays" })}</Label>
            <Input
              id="invoice-payment-term-days"
              type="number"
              step="1"
              min="0"
              value={paymentTermDays}
              onChange={(event) => handlePaymentTermDaysChange(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-grace-days">{intl.formatMessage({ id: "invoiceForm.graceDays" })}</Label>
            <Input
              id="invoice-grace-days"
              type="number"
              step="1"
              min="0"
              value={graceDays}
              onChange={(event) => setGraceDays(event.target.value)}
            />
          </div>
        </div>
      )}

      {needsOriginalInvoice && (
        <div className="flex flex-col gap-2 sm:w-1/2">
          <Label htmlFor="invoice-original">
            {intl.formatMessage({ id: requiresOriginalInvoice ? "invoiceForm.originalInvoiceRequired" : "invoiceForm.originalInvoice" })}
          </Label>
          <Select
            id="invoice-original"
            value={originalInvoiceId}
            onChange={(event) => setOriginalInvoiceId(event.target.value)}
          >
            {!requiresOriginalInvoice && <option value="">{intl.formatMessage({ id: "invoiceForm.noOriginalInvoice" })}</option>}
            {requiresOriginalInvoice && originalInvoiceCandidates.length === 0 && (
              <option value="">{intl.formatMessage({ id: "invoiceForm.selectOriginalInvoice" })}</option>
            )}
            {originalInvoiceCandidates.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.invoiceNumber ?? invoice.id}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {lines.map((line, index) => {
          const enteredAmount = lineEnteredAmount(line);
          const { net, tax } = computeLine(enteredAmount, taxes.find((t) => t.id === line.taxDefinitionId), priceMode);
          return (
          <div key={index} className="grid grid-cols-[2fr_5rem_6rem_5rem_1fr_5rem_5rem_auto] items-end gap-2">
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "invoiceForm.description" })}</Label>}
              <Input value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "invoiceForm.qty" })}</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={line.quantity}
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && (
                <Label>
                  {intl.formatMessage({ id: priceMode === PriceMode.NetExclusive ? "invoiceForm.priceExclVat" : "invoiceForm.priceInclVat" })}
                </Label>
              )}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={line.unitPrice}
                onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "invoiceForm.discountPercent" })}</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={line.discountPercent}
                onChange={(event) => updateLine(index, { discountPercent: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "invoiceForm.tax" })}</Label>}
              <Select
                value={line.taxDefinitionId}
                onChange={(event) => updateLine(index, { taxDefinitionId: event.target.value })}
              >
                {!isVatRegistered && <option value="">{intl.formatMessage({ id: "invoiceForm.noTax" })}</option>}
                {taxes.map((tax) => (
                  <option key={tax.id} value={tax.id}>
                    {taxRatePercentLabel(tax)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "invoiceForm.net" })}</Label>}
              <p className="px-3 py-2 text-sm text-muted-foreground">{net.toFixed(2)}</p>
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "invoiceForm.vat" })}</Label>}
              <p className="px-3 py-2 text-sm text-muted-foreground">{tax.toFixed(2)}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)} disabled={lines.length <= 1}>
              {intl.formatMessage({ id: "invoiceForm.remove" })}
            </Button>
          </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addLine}>
          {intl.formatMessage({ id: "invoiceForm.addLine" })}
        </Button>
      </div>

      {!editingInvoice && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={takePaymentNow} onChange={(event) => setTakePaymentNow(event.target.checked)} />
            {intl.formatMessage({ id: "invoiceForm.takePaymentNow" })}
          </label>
          {takePaymentNow && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="invoice-payment-amount">{intl.formatMessage({ id: "recordPayment.amount" })}</Label>
                <Input
                  id="invoice-payment-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="invoice-payment-method">{intl.formatMessage({ id: "recordPayment.cashBankAccount" })}</Label>
                <PaymentMethodSelect
                  id="invoice-payment-method"
                  paymentMethods={paymentMethods}
                  value={paymentMethodId}
                  onChange={setPaymentMethodId}
                  emptyOptionLabelKey="invoiceForm.selectPaymentMethod"
                />
              </div>
            </div>
          )}
        </div>
      )}

      <Button type="submit" className="w-fit" disabled={submitting}>
        {editingInvoice
          ? submitting
            ? intl.formatMessage({ id: "invoiceForm.saving" })
            : intl.formatMessage({ id: "invoiceForm.saveChanges" })
          : submitting
            ? intl.formatMessage({ id: "invoiceForm.creating" })
            : intl.formatMessage({ id: "invoiceForm.createInvoice" })}
      </Button>
    </form>
  );
}
