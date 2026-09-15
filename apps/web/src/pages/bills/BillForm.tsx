import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse, BillResponse, ItemResponse, PartnerResponse, PaymentMethodResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { BILL_DOCUMENT_TYPE_OPTION_KEYS, BillDocumentType } from "@/lib/document-types";
import { applyItemDefaultsToLine, overriddenItemLineFields, type ItemDefaultsSource } from "@/lib/item-line-defaults";
import { isExpenseAccountType } from "@/lib/ledger-enums";
import { partnerOptionLabel } from "@/lib/partners";
import { PaymentMethodKind } from "@/lib/payment-method-enums";
import { computeLine, findTaxByCode, PriceMode, taxRatePercentLabel } from "@/lib/tax-enums";
import { PaymentMethodSelect } from "@/pages/shared/PaymentMethodSelect";

type Line = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxDefinitionId: string;
  itemId: string;
  expenseAccountId: string;
};

function emptyLine(defaultTaxId: string): Line {
  return { description: "", quantity: "1", unitPrice: "", discountPercent: "0", taxDefinitionId: defaultTaxId, itemId: "", expenseAccountId: "" };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Price is either gross (VAT-inclusive) or net (VAT-exclusive), per the document's own PriceMode.
function lineEnteredAmount(line: Line): number {
  const quantity = parseFloat(line.quantity) || 0;
  const unitPrice = parseFloat(line.unitPrice) || 0;
  const discountPercent = parseFloat(line.discountPercent) || 0;
  return quantity * unitPrice * (1 - discountPercent / 100);
}

// F5 — thin adapters onto the shared, unit-tested item-defaults/override logic in
// src/lib/item-line-defaults.ts (mirror of InvoiceForm.tsx's identical pair, only the account
// field name differs). See that module for the full rationale, including the switch-between-items
// fix: a field the newly selected item leaves unset resets to the form's own baseline, never to
// whatever value was left over from a previously selected item on this line.
function itemDefaultsSource(item: ItemResponse): ItemDefaultsSource {
  return {
    name: item.name,
    defaultUnitPrice: item.defaultUnitPrice,
    defaultTaxDefinitionId: item.defaultTaxDefinitionId,
    defaultAccountId: item.defaultExpenseAccountId,
  };
}

function applyItemDefaults(line: Line, item: ItemResponse | undefined, baselineTaxId: string): Line {
  if (!item) return { ...line, itemId: "" };
  const applied = applyItemDefaultsToLine(
    { description: line.description, unitPrice: line.unitPrice, taxDefinitionId: line.taxDefinitionId, accountId: line.expenseAccountId },
    itemDefaultsSource(item),
    baselineTaxId,
  );
  return {
    ...line,
    itemId: item.id,
    description: applied.description,
    unitPrice: applied.unitPrice,
    taxDefinitionId: applied.taxDefinitionId,
    expenseAccountId: applied.accountId,
  };
}

function overriddenFields(line: Line, item: ItemResponse | undefined): { price: boolean; tax: boolean; account: boolean } {
  return overriddenItemLineFields(
    { description: line.description, unitPrice: line.unitPrice, taxDefinitionId: line.taxDefinitionId, accountId: line.expenseAccountId },
    item ? itemDefaultsSource(item) : undefined,
  );
}

type BillFormProps = {
  companyId: string;
  vendors: PartnerResponse[];
  taxes: TaxDefinitionResponse[];
  bills: BillResponse[];
  paymentMethods: PaymentMethodResponse[];
  isVatRegistered: boolean;
  // F5 — see InvoiceForm.tsx's identical props for the full rationale. Optional/defaulted so
  // PurchaseReturns.tsx keeps compiling unchanged until it's wired up too.
  items?: ItemResponse[];
  accounts?: AccountResponse[];
  onCreated: () => void;
  // A6 (v2 release): see InvoiceForm.tsx's identical prop for the full rationale — used by the
  // Purchase returns page to fix this form to PurchaseReturn with no type selector shown.
  fixedDocumentType?: number;
  // A5 (v2 release): mirror of InvoiceForm.tsx's identical props — edits an existing Draft bill
  // (PUT, full replace) in place instead of creating a new one (POST).
  editingBill?: BillResponse;
  onSaved?: () => void;
};

export function BillForm({
  companyId,
  vendors,
  taxes,
  bills,
  paymentMethods,
  isVatRegistered,
  items = [],
  accounts = [],
  onCreated,
  fixedDocumentType,
  editingBill,
  onSaved,
}: BillFormProps) {
  const intl = useIntl();
  // C2: same rule as InvoiceForm — default new lines to the exempt purchase code (BEX).
  const defaultTaxId = isVatRegistered ? (findTaxByCode(taxes, "BEX")?.id ?? "") : "";
  // B13: AccountType widened to Odoo's real 19 values — Expense is now a family of types
  // (Expense/OtherExpense/Depreciation/CostOfRevenue), not one bucket.
  const expenseAccounts = accounts.filter((a) => isExpenseAccountType(a.accountType));
  // C5: a bill can only take cash inline at creation — a bank payment is only ever known once it
  // clears the statement, recorded later through the ordinary payment route.
  const cashPaymentMethods = paymentMethods.filter((m) => m.kind === PaymentMethodKind.Cash);

  const [partnerId, setPartnerId] = useState(editingBill?.partnerId ?? "");
  // F6 — same fix as InvoiceForm (see its comment): a VAT-registered vendor defaults new lines
  // to the standard domestic purchase rate (B18), not the exempt baseline — the earlier version
  // always collapsed back to the same exempt `defaultTaxId` regardless of branch and never
  // actually changed anything. A non-VAT-registered vendor, or none selected yet, keeps the
  // exempt baseline.
  const selectedVendor = vendors.find((v) => v.id === partnerId);
  const partnerDrivenTaxId =
    isVatRegistered && selectedVendor?.isVatRegistered
      ? (findTaxByCode(taxes, "B18")?.id ?? defaultTaxId)
      : defaultTaxId;
  const [documentType, setDocumentType] = useState<number>(editingBill?.documentType ?? fixedDocumentType ?? BillDocumentType.Bill);
  const [originalBillId, setOriginalBillId] = useState(editingBill?.originalBillId ?? "");
  const [vendorReference, setVendorReference] = useState(editingBill?.vendorReference ?? "");
  const [issueDate, setIssueDate] = useState(editingBill?.issueDate ?? today);
  const [dueDate, setDueDate] = useState(editingBill?.dueDate ?? today);
  const [internalNotes, setInternalNotes] = useState(editingBill?.internalNotes ?? "");
  // C1/C5: PriceMode/inline-payment are Create-only features — UpdateBillRequest (the Draft-edit
  // path) doesn't carry either field, so this state is only read from the Create branch of
  // handleSubmit and its inputs are hidden while editing.
  const [priceMode, setPriceMode] = useState<number>(PriceMode.GrossInclusive);
  const [takePaymentNow, setTakePaymentNow] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [lines, setLines] = useState<Line[]>(
    editingBill
      ? editingBill.lines.map((l) => ({
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          discountPercent: String(l.discountPercent),
          taxDefinitionId: l.taxDefinitionId ?? "",
          itemId: l.itemId ?? "",
          expenseAccountId: l.expenseAccountId ?? "",
        }))
      : [emptyLine(defaultTaxId)],
  );
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

  function selectLineItem(index: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    setLines((prev) => prev.map((line, i) => (i === index ? applyItemDefaults(line, item, partnerDrivenTaxId) : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine(partnerDrivenTaxId)]);
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
        expenseAccountId: line.expenseAccountId || undefined,
        itemId: line.itemId || undefined,
      }));

      if (editingBill) {
        await apiClient.billsPUT(companyId, editingBill.id, {
          partnerId,
          vendorReference: vendorReference.trim() || undefined,
          issueDate,
          dueDate,
          documentType,
          originalBillId: originalBillId || undefined,
          lines: lineRequests,
          internalNotes: internalNotes.trim() || undefined,
        });
        onSaved?.();
      } else {
        await apiClient.billsPOST(companyId, {
          partnerId,
          vendorReference: vendorReference.trim() || undefined,
          issueDate,
          dueDate,
          documentType,
          originalBillId: originalBillId || undefined,
          priceMode,
          lines: lineRequests,
          payment: takePaymentNow
            ? { amount: parseFloat(paymentAmount), paymentMethodId, date: issueDate }
            : undefined,
        });
        setPartnerId("");
        setDocumentType(fixedDocumentType ?? BillDocumentType.Bill);
        setOriginalBillId("");
        setVendorReference("");
        setPriceMode(PriceMode.GrossInclusive);
        setLines([emptyLine(defaultTaxId)]);
        setTakePaymentNow(false);
        setPaymentAmount("");
        setPaymentMethodId("");
        onCreated();
      }
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: editingBill ? "billForm.saveError" : "billForm.createError" })));
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
                {partnerOptionLabel(vendor, intl)}
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

      {editingBill && (
        <div className="flex flex-col gap-2 sm:w-1/2">
          <Label htmlFor="bill-internal-notes">{intl.formatMessage({ id: "billForm.internalNotes" })}</Label>
          <Input id="bill-internal-notes" value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} />
        </div>
      )}

      {!editingBill && (
        <div className="flex flex-col gap-2 sm:w-1/4">
          <Label htmlFor="bill-price-mode">{intl.formatMessage({ id: "invoiceForm.priceMode" })}</Label>
          <Select id="bill-price-mode" value={priceMode} onChange={(event) => setPriceMode(Number(event.target.value))}>
            <option value={PriceMode.GrossInclusive}>{intl.formatMessage({ id: "invoiceForm.priceModeGross" })}</option>
            <option value={PriceMode.NetExclusive}>{intl.formatMessage({ id: "invoiceForm.priceModeNet" })}</option>
          </Select>
        </div>
      )}

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
          const enteredAmount = lineEnteredAmount(line);
          const { net, tax } = computeLine(enteredAmount, taxes.find((t) => t.id === line.taxDefinitionId), priceMode);
          const selectedItem = items.find((i) => i.id === line.itemId);
          const overridden = overriddenFields(line, selectedItem);
          return (
          <div key={index} className="grid grid-cols-[1fr_2fr_5rem_6rem_5rem_1fr_1fr_5rem_5rem_auto] items-end gap-2">
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.item" })}</Label>}
              <Select value={line.itemId} onChange={(event) => selectLineItem(index, event.target.value)}>
                <option value="">{intl.formatMessage({ id: "billForm.noItem" })}</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </div>
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
              {index === 0 && (
                <Label>
                  {intl.formatMessage({ id: priceMode === PriceMode.NetExclusive ? "billForm.priceExclVat" : "billForm.priceInclVat" })}
                </Label>
              )}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={line.unitPrice}
                onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
              />
              {overridden.price && (
                <Badge variant="outline" className="w-fit text-[10px] text-amber-600">
                  {intl.formatMessage({ id: "common.modified" })}
                </Badge>
              )}
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
                {!isVatRegistered && <option value="">{intl.formatMessage({ id: "billForm.noTax" })}</option>}
                {taxes.map((tax) => (
                  <option key={tax.id} value={tax.id}>
                    {taxRatePercentLabel(tax)}
                  </option>
                ))}
              </Select>
              {overridden.tax && (
                <Badge variant="outline" className="w-fit text-[10px] text-amber-600">
                  {intl.formatMessage({ id: "common.modified" })}
                </Badge>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.expenseAccount" })}</Label>}
              <Select value={line.expenseAccountId} onChange={(event) => updateLine(index, { expenseAccountId: event.target.value })}>
                <option value="">{intl.formatMessage({ id: "common.companyDefault" })}</option>
                {expenseAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code}
                  </option>
                ))}
              </Select>
              {overridden.account && (
                <Badge variant="outline" className="w-fit text-[10px] text-amber-600">
                  {intl.formatMessage({ id: "common.modified" })}
                </Badge>
              )}
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

      {!editingBill && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={takePaymentNow} onChange={(event) => setTakePaymentNow(event.target.checked)} />
            {intl.formatMessage({ id: "billForm.takeCashPaymentNow" })}
          </label>
          {takePaymentNow && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="bill-payment-amount">{intl.formatMessage({ id: "recordPayment.amount" })}</Label>
                <Input
                  id="bill-payment-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="bill-payment-method">{intl.formatMessage({ id: "recordPayment.cashBankAccount" })}</Label>
                <PaymentMethodSelect
                  id="bill-payment-method"
                  paymentMethods={cashPaymentMethods}
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
        {editingBill
          ? submitting
            ? intl.formatMessage({ id: "billForm.saving" })
            : intl.formatMessage({ id: "billForm.saveChanges" })
          : submitting
            ? intl.formatMessage({ id: "billForm.creating" })
            : intl.formatMessage({ id: "billForm.createBill" })}
      </Button>
    </form>
  );
}
