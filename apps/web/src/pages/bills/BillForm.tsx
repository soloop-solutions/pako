import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { BillResponse, PartnerResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { BILL_DOCUMENT_TYPE_OPTION_KEYS, BillDocumentType } from "@/lib/document-types";
import { computeFromGross, taxRatePercentLabel } from "@/lib/tax-enums";

type Line = { description: string; quantity: string; unitPrice: string; discountPercent: string; taxDefinitionId: string };

const EMPTY_LINE: Line = { description: "", quantity: "1", unitPrice: "", discountPercent: "0", taxDefinitionId: "" };

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Price is gross (brutto) — the vendor's actual per-unit price, VAT included.
function lineGross(line: Line): number {
  const quantity = parseFloat(line.quantity) || 0;
  const unitPrice = parseFloat(line.unitPrice) || 0;
  const discountPercent = parseFloat(line.discountPercent) || 0;
  return quantity * unitPrice * (1 - discountPercent / 100);
}

type BillFormProps = {
  companyId: string;
  vendors: PartnerResponse[];
  taxes: TaxDefinitionResponse[];
  bills: BillResponse[];
  onCreated: () => void;
  // A6 (v2 release): see InvoiceForm.tsx's identical prop for the full rationale — used by the
  // Purchase returns page to fix this form to PurchaseReturn with no type selector shown.
  fixedDocumentType?: number;
};

export function BillForm({ companyId, vendors, taxes, bills, onCreated, fixedDocumentType }: BillFormProps) {
  const intl = useIntl();
  const [partnerId, setPartnerId] = useState("");
  const [documentType, setDocumentType] = useState<number>(fixedDocumentType ?? BillDocumentType.Bill);
  const [originalBillId, setOriginalBillId] = useState("");
  const [vendorReference, setVendorReference] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A2 (v2 release): PurchaseReturn joins CreditNote in needing an original-bill picker, but
  // unlike CreditNote it's REQUIRED, not optional — see requiresOriginalBill below.
  const needsOriginalBill = documentType === BillDocumentType.CreditNote || documentType === BillDocumentType.PurchaseReturn;
  const requiresOriginalBill = documentType === BillDocumentType.PurchaseReturn;
  const originalBillCandidates = bills.filter((bill) => bill.partnerId === partnerId && bill.state === "Posted");

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!partnerId) {
      setError(intl.formatMessage({ id: "billForm.selectVendorError" }));
      return;
    }
    if (requiresOriginalBill && !originalBillId) {
      setError(intl.formatMessage({ id: "billForm.originalBillRequiredError" }));
      return;
    }
    const validLines = lines.filter((line) => line.description.trim());
    if (validLines.length === 0) {
      setError(intl.formatMessage({ id: "billForm.atLeastOneLine" }));
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.billsPOST(companyId, {
        partnerId,
        vendorReference: vendorReference.trim() || undefined,
        issueDate,
        dueDate,
        documentType,
        originalBillId: originalBillId || undefined,
        lines: validLines.map((line) => ({
          description: line.description,
          quantity: parseFloat(line.quantity) || 0,
          unitPrice: parseFloat(line.unitPrice) || 0,
          discountPercent: parseFloat(line.discountPercent) || 0,
          taxDefinitionId: line.taxDefinitionId || undefined,
          expenseAccountId: undefined,
        })),
      });
      setPartnerId("");
      setDocumentType(fixedDocumentType ?? BillDocumentType.Bill);
      setOriginalBillId("");
      setVendorReference("");
      setLines([{ ...EMPTY_LINE }]);
      onCreated();
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "billForm.createError" })));
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

      <div className="grid gap-4 sm:grid-cols-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bill-vendor">{intl.formatMessage({ id: "billForm.vendor" })}</Label>
          <Select id="bill-vendor" value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
            <option value="">{intl.formatMessage({ id: "billForm.selectVendor" })}</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </Select>
        </div>
        {fixedDocumentType === undefined && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="bill-document-type">{intl.formatMessage({ id: "billForm.documentType" })}</Label>
            <Select
              id="bill-document-type"
              value={documentType}
              onChange={(event) => {
                setDocumentType(Number(event.target.value));
                setOriginalBillId("");
              }}
            >
              {BILL_DOCUMENT_TYPE_OPTION_KEYS.map((option) => (
                <option key={option.value} value={option.value}>
                  {intl.formatMessage({ id: option.labelKey })}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="bill-vendor-reference">{intl.formatMessage({ id: "billForm.vendorInvoiceNumber" })}</Label>
          <Input
            id="bill-vendor-reference"
            value={vendorReference}
            onChange={(event) => setVendorReference(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bill-issue-date">{intl.formatMessage({ id: "billForm.issueDate" })}</Label>
          <Input
            id="bill-issue-date"
            type="date"
            value={issueDate}
            onChange={(event) => setIssueDate(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bill-due-date">{intl.formatMessage({ id: "billForm.dueDate" })}</Label>
          <Input id="bill-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
        </div>
      </div>

      {needsOriginalBill && (
        <div className="flex flex-col gap-2 sm:w-1/2">
          <Label htmlFor="bill-original">
            {intl.formatMessage({ id: requiresOriginalBill ? "billForm.originalBillRequired" : "billForm.originalBill" })}
          </Label>
          <Select id="bill-original" value={originalBillId} onChange={(event) => setOriginalBillId(event.target.value)}>
            {!requiresOriginalBill && <option value="">{intl.formatMessage({ id: "billForm.noOriginalBill" })}</option>}
            {requiresOriginalBill && originalBillCandidates.length === 0 && (
              <option value="">{intl.formatMessage({ id: "billForm.selectOriginalBill" })}</option>
            )}
            {originalBillCandidates.map((bill) => (
              <option key={bill.id} value={bill.id}>
                {bill.vendorReference ?? bill.id}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {lines.map((line, index) => {
          const gross = lineGross(line);
          const { net, tax } = computeFromGross(gross, taxes.find((t) => t.id === line.taxDefinitionId));
          return (
          <div key={index} className="grid grid-cols-[2fr_5rem_6rem_5rem_1fr_5rem_5rem_auto] items-end gap-2">
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.description" })}</Label>}
              <Input value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.qty" })}</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={line.quantity}
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.priceInclVat" })}</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={line.unitPrice}
                onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.discountPercent" })}</Label>}
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
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.tax" })}</Label>}
              <Select
                value={line.taxDefinitionId}
                onChange={(event) => updateLine(index, { taxDefinitionId: event.target.value })}
              >
                <option value="">{intl.formatMessage({ id: "billForm.noTax" })}</option>
                {taxes.map((tax) => (
                  <option key={tax.id} value={tax.id}>
                    {taxRatePercentLabel(tax)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.net" })}</Label>}
              <p className="px-3 py-2 text-sm text-muted-foreground">{net.toFixed(2)}</p>
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.vat" })}</Label>}
              <p className="px-3 py-2 text-sm text-muted-foreground">{tax.toFixed(2)}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)} disabled={lines.length <= 1}>
              {intl.formatMessage({ id: "billForm.remove" })}
            </Button>
          </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addLine}>
          {intl.formatMessage({ id: "billForm.addLine" })}
        </Button>
      </div>

      <Button type="submit" className="w-fit" disabled={submitting}>
        {submitting ? intl.formatMessage({ id: "billForm.creating" }) : intl.formatMessage({ id: "billForm.createBill" })}
      </Button>
    </form>
  );
}
