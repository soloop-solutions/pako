import { useEffect, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse, CreditExposureResponse, InvoiceResponse, ItemResponse, PartnerResponse, PaymentMethodResponse, TaxDefinitionResponse } from "@pako/shared";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { buildDocumentDataFromForm } from "@/lib/invoice-document-data";
import { InvoicePreviewDialog } from "@/components/shared/InvoicePreviewDialog";
import { useCompany } from "@/context/CompanyContext";
import { INVOICE_DOCUMENT_TYPE_OPTION_KEYS, InvoiceDocumentType, invoiceDocumentTypeName } from "@/lib/document-types";
import { useEntityFavorites } from "@/hooks/useEntityFavorites";
import { applyItemDefaultsToLine, overriddenItemLineFields, type ItemDefaultsSource } from "@/lib/item-line-defaults";
import { isIncomeAccountType } from "@/lib/ledger-enums";
import { partnerOptionLabel } from "@/lib/partners";
import { computeLine, findTaxByCode, PriceMode, taxRatePercentLabel } from "@/lib/tax-enums";
import { PaymentMethodSelect } from "@/pages/shared/PaymentMethodSelect";
import { LineUnitSelect, OnHandHint, WarehouseField } from "@/pages/inventory/StockFields";
import { baseQuantity } from "@/lib/item-units";
import { useStockOnHand } from "@/hooks/useStock";

type Line = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxDefinitionId: string;
  itemId: string;
  revenueAccountId: string;
  // §12 P7: the item unit the quantity is in (undefined = the base unit).
  unitName?: string;
};

function emptyLine(defaultTaxId: string): Line {
  return { description: "", quantity: "1", unitPrice: "", discountPercent: "0", taxDefinitionId: defaultTaxId, itemId: "", revenueAccountId: "" };
}

// F5 — thin adapters onto the shared, unit-tested item-defaults/override logic in
// src/lib/item-line-defaults.ts (identical to BillForm.tsx's pair except for the account field
// name). See that module for the full rationale, including the switch-between-items fix: a field
// the newly selected item leaves unset resets to the form's own baseline, never to whatever value
// was left over from a previously selected item on this line.
function itemDefaultsSource(item: ItemResponse): ItemDefaultsSource {
  return {
    name: item.name,
    defaultUnitPrice: item.defaultUnitPrice,
    defaultTaxDefinitionId: item.defaultTaxDefinitionId,
    defaultAccountId: item.defaultRevenueAccountId,
  };
}

function applyItemDefaults(line: Line, item: ItemResponse | undefined, baselineTaxId: string): Line {
  if (!item) return { ...line, itemId: "" };
  const applied = applyItemDefaultsToLine(
    { description: line.description, unitPrice: line.unitPrice, taxDefinitionId: line.taxDefinitionId, accountId: line.revenueAccountId },
    itemDefaultsSource(item),
    baselineTaxId,
  );
  return {
    ...line,
    itemId: item.id,
    description: applied.description,
    unitPrice: applied.unitPrice,
    taxDefinitionId: applied.taxDefinitionId,
    revenueAccountId: applied.accountId,
  };
}

function overriddenFields(line: Line, item: ItemResponse | undefined): { price: boolean; tax: boolean; account: boolean } {
  return overriddenItemLineFields(
    { description: line.description, unitPrice: line.unitPrice, taxDefinitionId: line.taxDefinitionId, accountId: line.revenueAccountId },
    item ? itemDefaultsSource(item) : undefined,
  );
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
  // F5 — item picker on the line editor, and the accounts its default revenue account is picked
  // from. Optional and defaulted to empty so the other pages that already render this form
  // (Proforma.tsx, SalesReturns.tsx) keep compiling unchanged until they're wired up too.
  items?: ItemResponse[];
  accounts?: AccountResponse[];
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
  items = [],
  accounts = [],
  onCreated,
  fixedDocumentType,
  editingInvoice,
  onSaved,
}: InvoiceFormProps) {
  const intl = useIntl();
  const activeCompany = useCompany().activeCompany;
  const partnerFavs = useEntityFavorites("Partner");
  const accountFavs = useEntityFavorites("Account");
  const itemFavs = useEntityFavorites("Item");
  // B13: AccountType widened to Odoo's real 19 values — Income is now a family of types
  // (Income/OtherIncome), not one bucket.
  const revenueAccounts = accounts.filter((a) => isIncomeAccountType(a.accountType));
  // C2: a VAT-registered company can never leave a line without a real tax code — default new
  // lines to the exempt sales code (SEX) instead of the old silent empty "no tax" option.
  const defaultTaxId = isVatRegistered ? (findTaxByCode(taxes, "SEX")?.id ?? "") : "";

  const [partnerId, setPartnerId] = useState(editingInvoice?.partnerId ?? "");
  // F6 — a partner's own VAT-registered status decides the default tax on a NEW line: a
  // VAT-registered customer defaults to the standard domestic rate (S18), not the exempt
  // baseline — code review caught that the earlier version of this override always collapsed
  // back to the same exempt `defaultTaxId` no matter the branch (defaultTaxId is already SEX for
  // any VAT-registered company), so it never actually changed anything. A non-VAT-registered
  // customer, or no customer selected yet, keeps the exempt baseline. Only new lines pick this up
  // (addLine/selectLineItem below); it never rewrites a line the accountant already set explicitly.
  const selectedCustomer = customers.find((c) => c.id === partnerId);
  const partnerDrivenTaxId =
    isVatRegistered && selectedCustomer?.isVatRegistered
      ? (findTaxByCode(taxes, "S18")?.id ?? defaultTaxId)
      : defaultTaxId;
  const [documentType, setDocumentType] = useState<number>(editingInvoice?.documentType ?? fixedDocumentType ?? InvoiceDocumentType.Invoice);
  const [originalInvoiceId, setOriginalInvoiceId] = useState(editingInvoice?.originalInvoiceId ?? "");
  const [issueDate, setIssueDate] = useState(editingInvoice?.issueDate ?? today);
  const [dueDate, setDueDate] = useState(editingInvoice?.dueDate ?? today);
  const [internalNotes, setInternalNotes] = useState(editingInvoice?.internalNotes ?? "");
  // docs/INVENTORY_PLAN.md §6: the warehouse stock-tracked lines leave from ("" = the default one).
  const [warehouseId, setWarehouseId] = useState(editingInvoice?.warehouseId ?? "");
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
          itemId: l.itemId ?? "",
          unitName: l.unitName ?? undefined,
          revenueAccountId: l.revenueAccountId ?? "",
        }))
      : [emptyLine(defaultTaxId)],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const trackedItemIds = lines.map((l) => l.itemId).filter((id) => items.find((i) => i.id === id)?.trackInventory);
  const onHand = useStockOnHand(trackedItemIds, warehouseId || null);
  const [showPreview, setShowPreview] = useState(false);

  // Auto-populate lines from the original invoice when creating a Sales Return. Only fires when:
  // 1. This form is fixed to SalesReturn (fixedDocumentType === 4)
  // 2. The user selects an originalInvoiceId
  // 3. The user has NOT already entered lines manually (still on a single empty line)
  // The user can then modify quantities for partial returns or remove lines they don't want.
  const isSalesReturn = fixedDocumentType === InvoiceDocumentType.SalesReturn;
  useEffect(() => {
    if (!isSalesReturn || !originalInvoiceId || editingInvoice) return;

    // Don't overwrite if the user has already entered lines manually: check whether we still have
    // the initial single empty line (no description filled in).
    const hasManualLines = lines.length > 1 || (lines.length === 1 && lines[0].description.trim() !== "");
    if (hasManualLines) return;

    let cancelled = false;
    apiClient
      .invoicesGET(companyId, originalInvoiceId)
      .then((invoice) => {
        if (cancelled) return;
        if (invoice.lines.length === 0) return;
        const populated: Line[] = invoice.lines.map((l) => ({
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          discountPercent: String(l.discountPercent),
          taxDefinitionId: l.taxDefinitionId ?? defaultTaxId,
          itemId: l.itemId ?? "",
          unitName: l.unitName ?? undefined,
          revenueAccountId: l.revenueAccountId ?? "",
        }));
        setLines(populated);
      })
      .catch(() => {
        // Silently ignore — the user can still enter lines manually.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only react to originalInvoiceId changes
  }, [originalInvoiceId]);

  // F7: preview only, never trusted as the real number — reserved only on post. Not fetched while
  // editing an existing Draft, since editing never consumes/changes numbering.
  const [previewNumber, setPreviewNumber] = useState<string | null>(null);
  useEffect(() => {
    if (editingInvoice) {
      setPreviewNumber(null);
      return;
    }
    const documentTypeName = invoiceDocumentTypeName(documentType);
    if (!documentTypeName) {
      setPreviewNumber(null);
      return;
    }
    let cancelled = false;
    apiClient
      .preview(companyId, documentTypeName)
      .then((result) => {
        if (!cancelled) setPreviewNumber(result.number);
      })
      .catch(() => {
        if (!cancelled) setPreviewNumber(null);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, documentType, editingInvoice]);

  // Credit limit exposure: fetch when a customer is selected, show informational banner.
  // Only fetched for customers that might have a credit limit; the backend returns null creditLimit
  // for partners with no limit set, in which case we show nothing.
  const [creditExposure, setCreditExposure] = useState<CreditExposureResponse | null>(null);
  useEffect(() => {
    setCreditExposure(null);
    if (!partnerId) return;
    let cancelled = false;
    apiClient
      .creditExposure(companyId, partnerId)
      .then((result) => {
        if (!cancelled) setCreditExposure(result);
      })
      .catch(() => {
        if (!cancelled) setCreditExposure(null);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, partnerId]);

  // Compute current invoice total for the "would exceed" warning. This is a display-only estimate
  // using the entered amounts — the backend enforces the real total on posting.
  const invoiceEnteredTotal = lines.reduce((sum, line) => sum + lineEnteredAmount(line), 0);

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

  function selectLineItem(index: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    setLines((prev) => prev.map((line, i) => (i === index ? { ...applyItemDefaults(line, item, partnerDrivenTaxId), unitName: undefined } : line)));
    // §12 P4: with price lists, the line starts from the shop's (or company's) price on the issue
    // date instead of the item's own price. Returns keep the original invoice's prices.
    if (item && !isSalesReturn) {
      void apiClient.resolvePrices(companyId, [item.id], warehouseId || undefined, issueDate).then((prices) => {
        const resolved = prices.find((p) => p.itemId === item.id);
        if (!resolved || resolved.source === "item") return;
        setLines((prev) => prev.map((line, i) => (i === index && line.itemId === item.id ? { ...line, unitPrice: String(resolved.price) } : line)));
      }).catch(() => {
        // The item's own price stays; nothing to report.
      });
    }
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine(partnerDrivenTaxId)]);
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
        revenueAccountId: line.revenueAccountId || undefined,
        itemId: line.itemId || undefined,
        unitName: line.unitName || undefined,
      }));

      // Record entity selections for smart favorites (on successful save)
      const recordFavorites = () => {
        if (partnerId) partnerFavs.recordSelection(partnerId);
        for (const line of validLines) {
          if (line.revenueAccountId) accountFavs.recordSelection(line.revenueAccountId);
          if (line.itemId) itemFavs.recordSelection(line.itemId);
        }
      };

      if (editingInvoice) {
        await apiClient.invoicesPUT(companyId, editingInvoice.id, {
          partnerId,
          issueDate,
          dueDate,
          documentType,
          originalInvoiceId: originalInvoiceId || undefined,
          lines: lineRequests,
          internalNotes: internalNotes.trim() || undefined,
          warehouseId: warehouseId || undefined,
        });
        recordFavorites();
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
          internalNotes: internalNotes.trim() || undefined,
          warehouseId: warehouseId || undefined,
          payment: takePaymentNow
            ? { amount: parseFloat(paymentAmount), paymentMethodId, date: issueDate }
            : undefined,
        });
        recordFavorites();
        setPartnerId("");
        setDocumentType(fixedDocumentType ?? InvoiceDocumentType.Invoice);
        setOriginalInvoiceId("");
        setPriceMode(PriceMode.GrossInclusive);
        setPaymentTermDays("");
        setGraceDays("");
        setLines([emptyLine(defaultTaxId)]);
        setInternalNotes("");
        setTakePaymentNow(false);
        setPaymentAmount("");
        setPaymentMethodId("");
        toast.success(intl.formatMessage({ id: "toast.invoiceCreated" }));
        onCreated();
      }
    } catch (err) {
      const msg = getApiErrorMessage(err, intl.formatMessage({ id: editingInvoice ? "invoiceForm.saveError" : "invoiceForm.createError" }));
      setError(msg);
      toast.error(msg);
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
          <SearchableSelect
            id="invoice-customer"
            value={partnerId}
            onChange={setPartnerId}
            placeholder={intl.formatMessage({ id: "invoiceForm.selectCustomer" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            emptyOptionLabel={intl.formatMessage({ id: "invoiceForm.selectCustomer" })}
            options={customers.map((customer) => ({
              value: customer.id,
              label: partnerOptionLabel(customer, intl),
              description: customer.taxNumber ?? undefined,
            }))}
            favorites={{
              pinnedIds: partnerFavs.pinnedIds,
              autoIds: partnerFavs.autoIds,
              onPin: partnerFavs.pin,
              onUnpin: partnerFavs.unpin,
              pinnedLabel: intl.formatMessage({ id: "favorites.pinned" }),
              frequentLabel: intl.formatMessage({ id: "favorites.frequentlyUsed" }),
            }}
          />
        </div>
        {fixedDocumentType === undefined && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-document-type">{intl.formatMessage({ id: "invoiceForm.documentType" })}</Label>
            <Select
              id="invoice-document-type"
              value={String(documentType)}
              onValueChange={(v) => {
                setDocumentType(Number(v));
                setOriginalInvoiceId("");
              }}
              options={INVOICE_DOCUMENT_TYPE_OPTION_KEYS.map((option) => ({
                value: String(option.value),
                label: intl.formatMessage({ id: option.labelKey }),
              }))}
            />
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
        <WarehouseField id="invoice-warehouse" value={warehouseId} onChange={setWarehouseId} />
      </div>

      {creditExposure && creditExposure.creditLimit != null && (() => {
        const isOverLimit = creditExposure.availableCredit != null && creditExposure.availableCredit < 0;
        const wouldExceed =
          !isOverLimit &&
          creditExposure.availableCredit != null &&
          invoiceEnteredTotal > 0 &&
          invoiceEnteredTotal > creditExposure.availableCredit;
        const fmt = (n: number) => n.toFixed(2) + " EUR";
        return (
          <div
            className={
              isOverLimit
                ? "rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                : wouldExceed
                  ? "rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300"
                  : "rounded-md border px-3 py-2 text-sm text-muted-foreground"
            }
          >
            {isOverLimit ? (
              <p className="font-medium">
                {intl.formatMessage(
                  { id: "invoicing.creditLimit.overLimit" },
                  { amount: fmt(Math.abs(creditExposure.availableCredit!)) },
                )}
              </p>
            ) : wouldExceed ? (
              <p className="font-medium">{intl.formatMessage({ id: "invoicing.creditLimit.wouldExceed" })}</p>
            ) : null}
            <p>
              {intl.formatMessage(
                { id: "invoicing.creditLimit.info" },
                {
                  available: fmt(creditExposure.availableCredit ?? 0),
                  limit: fmt(creditExposure.creditLimit),
                  outstanding: fmt(creditExposure.outstandingBalance),
                },
              )}
            </p>
          </div>
        );
      })()}

      {!editingInvoice && previewNumber && (
        <p className="text-xs text-muted-foreground">
          {intl.formatMessage({ id: "invoiceForm.nextNumberPreview" }, { number: previewNumber })}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:w-1/2">
        <Label htmlFor="invoice-internal-notes">{intl.formatMessage({ id: "invoiceForm.internalNotes" })}</Label>
        <Input id="invoice-internal-notes" value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} />
      </div>

      {!editingInvoice && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-price-mode">{intl.formatMessage({ id: "invoiceForm.priceMode" })}</Label>
            <Select
              id="invoice-price-mode"
              value={String(priceMode)}
              onValueChange={(v) => setPriceMode(Number(v))}
              options={[
                { value: String(PriceMode.GrossInclusive), label: intl.formatMessage({ id: "invoiceForm.priceModeGross" }) },
                { value: String(PriceMode.NetExclusive), label: intl.formatMessage({ id: "invoiceForm.priceModeNet" }) },
              ]}
            />
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
          <SearchableSelect
            id="invoice-original"
            value={originalInvoiceId}
            onChange={setOriginalInvoiceId}
            placeholder={intl.formatMessage({ id: requiresOriginalInvoice ? "invoiceForm.selectOriginalInvoice" : "invoiceForm.noOriginalInvoice" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            emptyOptionLabel={requiresOriginalInvoice ? undefined : intl.formatMessage({ id: "invoiceForm.noOriginalInvoice" })}
            options={originalInvoiceCandidates.map((invoice) => ({
              value: invoice.id,
              label: invoice.invoiceNumber ?? invoice.id,
            }))}
          />
        </div>
      )}

      <div className={trackedItemIds.length > 0 ? "flex flex-col gap-5" : "flex flex-col gap-2"}>
        {lines.map((line, index) => {
          const enteredAmount = lineEnteredAmount(line);
          const { net, tax } = computeLine(enteredAmount, taxes.find((t) => t.id === line.taxDefinitionId), priceMode);
          const selectedItem = items.find((i) => i.id === line.itemId);
          const overridden = overriddenFields(line, selectedItem);
          return (
          <div key={index} className="grid grid-cols-[1fr_1fr_2fr_5rem_6rem_5rem_1fr_5rem_5rem_auto] items-end gap-2">
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "invoiceForm.item" })}</Label>}
              <SearchableSelect
                value={line.itemId}
                onChange={(val) => selectLineItem(index, val)}
                placeholder={intl.formatMessage({ id: "invoiceForm.noItem" })}
                searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                noResultsText={intl.formatMessage({ id: "common.noResults" })}
                emptyOptionLabel={intl.formatMessage({ id: "invoiceForm.noItem" })}
                options={items.map((item) => ({
                  value: item.id,
                  label: item.name,
                  description: item.defaultUnitPrice != null ? `${item.defaultUnitPrice.toFixed(2)}` : undefined,
                }))}
                favorites={{
                  pinnedIds: itemFavs.pinnedIds,
                  autoIds: itemFavs.autoIds,
                  onPin: itemFavs.pin,
                  onUnpin: itemFavs.unpin,
                  pinnedLabel: intl.formatMessage({ id: "favorites.pinned" }),
                  frequentLabel: intl.formatMessage({ id: "favorites.frequentlyUsed" }),
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "invoiceForm.revenueAccount" })}</Label>}
              <SearchableSelect
                value={line.revenueAccountId}
                onChange={(val) => updateLine(index, { revenueAccountId: val })}
                placeholder={intl.formatMessage({ id: "common.companyDefault" })}
                searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                noResultsText={intl.formatMessage({ id: "common.noResults" })}
                emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
                options={revenueAccounts.map((account) => ({
                  value: account.id,
                  label: `${account.code} · ${account.name}`,
                }))}
                favorites={{
                  pinnedIds: accountFavs.pinnedIds,
                  autoIds: accountFavs.autoIds,
                  onPin: accountFavs.pin,
                  onUnpin: accountFavs.unpin,
                  pinnedLabel: intl.formatMessage({ id: "favorites.pinned" }),
                  frequentLabel: intl.formatMessage({ id: "favorites.frequentlyUsed" }),
                }}
              />
              {overridden.account && (
                <Badge variant="outline" className="w-fit text-[10px] text-amber-600">
                  {intl.formatMessage({ id: "common.modified" })}
                </Badge>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "invoiceForm.description" })}</Label>}
              <Input value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
            </div>
            <div className="relative flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "invoiceForm.qty" })}</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={line.quantity}
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
              />
              <LineUnitSelect item={selectedItem} value={line.unitName ?? ""} onChange={(v) => updateLine(index, { unitName: v || undefined })} />
              {selectedItem?.trackInventory && (
                <OnHandHint
                  className="absolute -bottom-4 right-0 whitespace-nowrap"
                  onHand={onHand.data ? (onHand.data.get(selectedItem.id) ?? 0) : undefined}
                  requested={baseQuantity(selectedItem, line.unitName, parseFloat(line.quantity) || 0)}
                  warnWhenShort={documentType === InvoiceDocumentType.Invoice}
                />
              )}
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
              {overridden.price && (
                <Badge variant="outline" className="w-fit text-[10px] text-amber-600">
                  {intl.formatMessage({ id: "common.modified" })}
                </Badge>
              )}
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
              <SearchableSelect
                value={line.taxDefinitionId}
                onChange={(val) => updateLine(index, { taxDefinitionId: val })}
                placeholder={intl.formatMessage({ id: "invoiceForm.noTax" })}
                searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                noResultsText={intl.formatMessage({ id: "common.noResults" })}
                emptyOptionLabel={!isVatRegistered ? intl.formatMessage({ id: "invoiceForm.noTax" }) : undefined}
                options={taxes.map((tax) => ({
                  value: tax.id,
                  label: taxRatePercentLabel(tax),
                  description: tax.code ?? undefined,
                }))}
              />
              {overridden.tax && (
                <Badge variant="outline" className="w-fit text-[10px] text-amber-600">
                  {intl.formatMessage({ id: "common.modified" })}
                </Badge>
              )}
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
            <Checkbox checked={takePaymentNow} onChange={(event) => setTakePaymentNow(event.target.checked)} />
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

      <div className="flex items-center gap-2">
        <Button type="submit" className="w-fit" disabled={submitting}>
          {editingInvoice
            ? submitting
              ? intl.formatMessage({ id: "invoiceForm.saving" })
              : intl.formatMessage({ id: "invoiceForm.saveChanges" })
            : submitting
              ? intl.formatMessage({ id: "invoiceForm.creating" })
              : intl.formatMessage({ id: "invoiceForm.createInvoice" })}
        </Button>
        <Button type="button" variant="outline" className="w-fit" onClick={() => setShowPreview(true)}>
          {intl.formatMessage({ id: "invoicePreview.previewInvoice" })}
        </Button>
      </div>

      {showPreview && (
        <InvoicePreviewDialog
          data={buildDocumentDataFromForm({
            company: activeCompany ?? { name: "" },
            customer: selectedCustomer ? { name: selectedCustomer.name, taxNumber: selectedCustomer.taxNumber ?? undefined, fiscalNumber: selectedCustomer.fiscalNumber ?? undefined, isVatRegistered: selectedCustomer.isVatRegistered } : undefined,
            lines,
            taxes,
            documentType,
            issueDate,
            dueDate,
            priceMode,
            internalNotes: internalNotes || undefined,
            paymentTermDays,
            originalDocumentNumber: originalInvoiceId ? (invoices.find((i) => i.id === originalInvoiceId)?.invoiceNumber ?? undefined) : undefined,
          })}
          onClose={() => setShowPreview(false)}
        />
      )}
    </form>
  );
}
