import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useFormDraft } from "@/hooks/useFormDraft";
import { useIntl } from "react-intl";
import type { AccountResponse, CreditExposureResponse, InvoiceResponse, ItemResponse, PartnerResponse, PaymentMethodResponse, ResolvedPriceResponse, TaxDefinitionResponse } from "@pako/shared";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompanyBankAccounts } from "@/hooks/useCompanyBankAccounts";
import { buildDocumentDataFromForm } from "@/lib/invoice-document-data";
import { InvoicePreviewDialog } from "@/components/shared/InvoicePreviewDialog";
import { useCompany } from "@/context/CompanyContext";
import { INVOICE_DOCUMENT_TYPE_OPTION_KEYS, InvoiceDocumentType, invoiceDocumentTypeName } from "@/lib/document-types";
import { useEntityFavorites } from "@/hooks/useEntityFavorites";
import { applyItemDefaultsToLine, overriddenItemLineFields, reapplyPartnerDefaults, type ItemDefaultsSource } from "@/lib/item-line-defaults";
import { isIncomeAccountType } from "@/lib/ledger-enums";
import { findTaxByCode, PriceMode, taxRatePercentLabel } from "@/lib/tax-enums";
import { CustomerPanel } from "@/pages/invoicing/editor/CustomerPanel";
import { InvoiceTotalsPanel } from "@/pages/invoicing/editor/InvoiceTotalsPanel";
import { useInvoiceQuote } from "@/pages/invoicing/editor/useInvoiceQuote";
import { PaymentMethodSelect } from "@/pages/shared/PaymentMethodSelect";
import { FreeUnitInput } from "@/components/shared/FreeUnitInput";
import { LineUnitSelect, OnHandHint, WarehouseField } from "@/pages/inventory/StockFields";
import { baseQuantity } from "@/lib/item-units";
import { useStockOnHand } from "@/hooks/useStock";
import { BillProjectField } from "@/pages/construction/BillProjectFields";
import { FormDialog } from "@/components/shared/FormDialog";
import { PartnerForm } from "@/pages/shared/PartnerForm";
import { QuickItemForm } from "@/pages/shared/QuickItemForm";
import { useHotkey } from "@/hooks/useHotkey";

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
  // A sales return of a lot-tracked item without an original invoice names the lot it comes back
  // into (with an original, the server takes the original sale's lot).
  lotNumber?: string;
  // docs/POS_PLAN.md P6: the sales order line this invoice line bills and, when the goods already
  // left on a delivery note, that delivery line (then the invoice moves no stock for it). Kept on
  // every save so the order's invoiced quantities stay right.
  salesOrderLineId?: string;
  deliveryLineId?: string;
  // Set once the user types a price or discount on the line: a later customer or date change
  // then leaves that value alone instead of re-pricing it.
  priceEdited?: boolean;
  discountEdited?: boolean;
  // Display only: the order / delivery note the line came from.
  linkLabel?: string;
};

// docs/POS_PLAN.md P6: an invoice started from a sales order or a delivery note.
export interface InvoicePrefill {
  partnerId: string;
  warehouseId?: string;
  lines: Line[];
}
export type InvoicePrefillLine = Line;

function emptyLine(defaultTaxId: string, defaultAccountId = ""): Line {
  return { description: "", quantity: "1", unitPrice: "", discountPercent: "0", taxDefinitionId: defaultTaxId, itemId: "", revenueAccountId: defaultAccountId };
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

function applyItemDefaults(line: Line, item: ItemResponse | undefined, baselineTaxId: string, baselineAccountId = ""): Line {
  if (!item) return { ...line, itemId: "" };
  const applied = applyItemDefaultsToLine(
    { description: line.description, unitPrice: line.unitPrice, taxDefinitionId: line.taxDefinitionId, accountId: line.revenueAccountId },
    itemDefaultsSource(item),
    baselineTaxId,
    baselineAccountId,
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

type InvoiceFormProps = {
  companyId: string;
  customers: PartnerResponse[];
  taxes: TaxDefinitionResponse[];
  paymentMethods: PaymentMethodResponse[];
  isVatRegistered: boolean;
  // F5 — item picker on the line editor, and the accounts its default revenue account is picked
  // from. Optional and defaulted to empty so the other pages that already render this form
  // (Proforma.tsx, SalesReturns.tsx) keep compiling unchanged until they're wired up too.
  items?: ItemResponse[];
  accounts?: AccountResponse[];
  /** `keepOpen` is true for "Save and add new": the form clears itself and stays; otherwise the page
   * moves on to `invoice`, the created document. */
  onCreated: (options?: { keepOpen?: boolean; invoice?: InvoiceResponse }) => void;
  /** The page's Cancel button. */
  onCancel?: () => void;
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
  // docs/POS_PLAN.md P6: a new invoice filled from a sales order or a delivery note.
  prefill?: InvoicePrefill;
  /** Called after an inline partner creation so the parent can refresh its data. */
  onPartnerCreated?: (id: string) => void;
  /** Called after an inline item creation so the parent can refresh its data. */
  onItemCreated?: (id: string) => void;
};

export function InvoiceForm({
  companyId,
  customers,
  taxes,
  paymentMethods,
  isVatRegistered,
  items = [],
  accounts = [],
  onCreated,
  fixedDocumentType,
  editingInvoice,
  onSaved,
  prefill,
  onPartnerCreated,
  onItemCreated,
  onCancel,
}: InvoiceFormProps) {
  const intl = useIntl();
  const bankAccounts = useCompanyBankAccounts();
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

  const [partnerId, setPartnerId] = useState(editingInvoice?.partnerId ?? prefill?.partnerId ?? "");
  // F6 — a partner's own VAT-registered status decides the default tax on a NEW line: a
  // VAT-registered customer defaults to the standard domestic rate (S18), not the exempt
  // baseline — code review caught that the earlier version of this override always collapsed
  // back to the same exempt `defaultTaxId` no matter the branch (defaultTaxId is already SEX for
  // any VAT-registered company), so it never actually changed anything. A non-VAT-registered
  // customer, or no customer selected yet, keeps the exempt baseline. Only new lines pick this up
  // (addLine/selectLineItem below); it never rewrites a line the accountant already set explicitly.
  const selectedCustomer = customers.find((c) => c.id === partnerId);
  // Client request 2026-11-23: the customer's own default VAT code and revenue account come first.
  const partnerDrivenTaxId =
    (selectedCustomer?.defaultSaleTaxDefinitionId && taxes.some((t) => t.id === selectedCustomer.defaultSaleTaxDefinitionId)
      ? selectedCustomer.defaultSaleTaxDefinitionId
      : undefined) ??
    (isVatRegistered && selectedCustomer?.isVatRegistered
      ? (findTaxByCode(taxes, "S18")?.id ?? defaultTaxId)
      : defaultTaxId);
  const partnerDrivenAccountId = selectedCustomer?.defaultRevenueAccountId ?? "";
  const [documentType, setDocumentType] = useState<number>(editingInvoice?.documentType ?? fixedDocumentType ?? InvoiceDocumentType.Invoice);
  const [originalInvoiceId, setOriginalInvoiceId] = useState(editingInvoice?.originalInvoiceId ?? "");
  const [issueDate, setIssueDate] = useState(editingInvoice?.issueDate ?? today);
  const [dueDate, setDueDate] = useState(editingInvoice?.dueDate ?? today);
  const [internalNotes, setInternalNotes] = useState(editingInvoice?.internalNotes ?? "");
  // docs/INVENTORY_PLAN.md §6: the warehouse stock-tracked lines leave from ("" = the default one).
  const [warehouseId, setWarehouseId] = useState(editingInvoice?.warehouseId ?? prefill?.warehouseId ?? "");
  // docs/ERP_VERTICALS_PLAN.md: the ledger project the revenue belongs to.
  const [projectId, setProjectId] = useState(editingInvoice?.projectId ?? "");
  // C1/C3: PriceMode/PaymentTermDays/GraceDays/inline-payment are Create-only features —
  // UpdateInvoiceRequest (the Draft-edit path) doesn't carry any of these fields, so this state
  // is only read from the Create branch of handleSubmit and its inputs are hidden while editing.
  // A draft being edited still starts in its own mode: the line preview, the price label and the
  // price-list rule below all depend on it.
  const [priceMode, setPriceMode] = useState<number>(editingInvoice?.priceMode ?? PriceMode.GrossInclusive);
  const [paymentTermDays, setPaymentTermDays] = useState(editingInvoice ? "" : (selectedCustomer?.paymentTermDays != null ? String(selectedCustomer.paymentTermDays) : ""));
  const [graceDays, setGraceDays] = useState("");
  const [takePaymentNow, setTakePaymentNow] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
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
          salesOrderLineId: l.salesOrderLineId ?? undefined,
          deliveryLineId: l.deliveryLineId ?? undefined,
        }))
      : prefill && prefill.lines.length > 0
        ? prefill.lines
        : [emptyLine(defaultTaxId)],
  );
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const clearFieldError = (field: string) =>
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  const [submitting, setSubmitting] = useState(false);
  // Set by the "Save and add new" button just before the form submits.
  const keepOpenRef = useRef(false);
  // Ctrl+S / ⌘S saves, like the Save button (client request 2026-11-24).
  useHotkey("mod+s", () => {
    keepOpenRef.current = false;
    formRef.current?.requestSubmit();
  }, !submitting);
  const trackedItemIds = lines.map((l) => l.itemId).filter((id) => items.find((i) => i.id === id)?.trackInventory);
  const onHand = useStockOnHand(trackedItemIds, warehouseId || null);

  // A different customer (or none) re-applies its VAT code and revenue account to every line still
  // showing the previous customer's — the first line included; lines the user changed, and fields
  // the line's item sets, stay as they are.
  const lastPartnerDefaults = useRef({ taxDefinitionId: partnerDrivenTaxId, accountId: partnerDrivenAccountId });
  useEffect(() => {
    const previous = lastPartnerDefaults.current;
    const next = { taxDefinitionId: partnerDrivenTaxId, accountId: partnerDrivenAccountId };
    if (previous.taxDefinitionId === next.taxDefinitionId && previous.accountId === next.accountId) return;
    lastPartnerDefaults.current = next;
    setLines((prev) => prev.map((line) => {
      const item = items.find((i) => i.id === line.itemId);
      return reapplyPartnerDefaults(line, (l) => l.revenueAccountId, (l, id) => ({ ...l, revenueAccountId: id }),
        item ? itemDefaultsSource(item) : undefined, previous, next);
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the customer's defaults
  }, [partnerDrivenTaxId, partnerDrivenAccountId]);
  const [showPreview, setShowPreview] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [newPartnerOpen, setNewPartnerOpen] = useState(false);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newItemLineIndex, setNewItemLineIndex] = useState<number | null>(null);

  // Auto-fill payment term days from the selected customer's registration data.
  useEffect(() => {
    if (editingInvoice) return;
    if (!selectedCustomer) return;
    if (selectedCustomer.paymentTermDays != null) {
      const days = String(selectedCustomer.paymentTermDays);
      setPaymentTermDays(days);
      setDueDate(addDays(issueDate, selectedCustomer.paymentTermDays));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to partner changes
  }, [partnerId]);

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

  // Invoice number: auto-generated from the number series on create, editable by the user.
  // When editing an existing draft, pre-populated from the saved invoice number.
  const [invoiceNumber, setInvoiceNumber] = useState<string>(editingInvoice?.invoiceNumber ?? "");
  useEffect(() => {
    if (editingInvoice) return;
    const documentTypeName = invoiceDocumentTypeName(documentType);
    if (!documentTypeName) {
      setInvoiceNumber("");
      return;
    }
    let cancelled = false;
    apiClient
      .preview(companyId, documentTypeName, undefined)
      .then((result) => {
        if (!cancelled) setInvoiceNumber(result.number);
      })
      .catch(() => {
        if (!cancelled) setInvoiceNumber("");
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

  // Client request 2026-11-23: every amount on this screen is the server's (POST invoices/quote), one
  // quote line per form line.
  const { quote, isStale: quoteIsStale } = useInvoiceQuote(companyId, priceMode, lines);
  const currency = activeCompany?.functionalCurrency ?? "EUR";

  // SalesReturn joins CreditNote/DebitNote in offering an original-invoice picker. It is optional
  // for all three (client request 2026-11-23: a return need not be linked to an invoice).
  const needsOriginalInvoice =
    documentType === InvoiceDocumentType.CreditNote ||
    documentType === InvoiceDocumentType.DebitNote ||
    documentType === InvoiceDocumentType.SalesReturn;
  // A return linked to an invoice keeps that invoice's prices; one without takes list prices.
  const keepsOriginalPrices = isSalesReturn && !!originalInvoiceId;
  const [originalInvoiceCandidates, setOriginalInvoiceCandidates] = useState<InvoiceResponse[]>([]);
  useEffect(() => {
    if (!needsOriginalInvoice || !partnerId) {
      setOriginalInvoiceCandidates([]);
      return;
    }
    let cancelled = false;
    void apiClient
      .paged2(companyId, 1, 200, undefined, undefined, undefined, "Posted", "-issuedate", partnerId, undefined, undefined, undefined)
      .then((result) => {
        if (!cancelled) setOriginalInvoiceCandidates(result.items);
      })
      .catch(() => {
        if (!cancelled) setOriginalInvoiceCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, needsOriginalInvoice, partnerId]);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function selectLineItem(index: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    // Another item no longer bills the sales order / delivery line this one was linked to.
    setLines((prev) => prev.map((line, i) => (i === index
      ? {
          ...applyItemDefaults(line, item, partnerDrivenTaxId, partnerDrivenAccountId),
          unitName: undefined,
          priceEdited: false,
          discountEdited: false,
          salesOrderLineId: line.itemId === itemId ? line.salesOrderLineId : undefined,
          deliveryLineId: line.itemId === itemId ? line.deliveryLineId : undefined,
        }
      : line)));
    // §12 P4: with price lists, the line starts from the shop's (or company's) price on the issue
    // date instead of the item's own price. Returns keep the original invoice's prices. List prices
    // are VAT-inclusive, so they only fill a gross-priced invoice; on a net one the item's own
    // price stays rather than a gross figure being taken as net. The resolve result also carries
    // the period discount rule (rabat) for this customer and item, which fills the line's discount.
    if (item && !keepsOriginalPrices) {
      // docs/POS_PLAN.md P6: the customer's own price list and volume tiers count too.
      const quantity = parseFloat(lines[index]?.quantity ?? "") || 1;
      void apiClient.resolvePrices(companyId, [item.id], warehouseId || undefined, issueDate, partnerId || undefined, [quantity]).then((prices) => {
        const resolved = prices.find((p) => p.itemId === item.id);
        if (!resolved) return;
        setLines((prev) => prev.map((line, i) => (i === index && line.itemId === item.id ? applyResolved(line, resolved) : line)));
      }).catch(() => {
        // The item's own price stays; nothing to report.
      });
    }
  }

  // A resolved price fills the line unless the user typed one: list prices only on a gross-priced
  // invoice (they are VAT-inclusive), the item's own retail/wholesale price on either. The rabat of
  // the matching discount rule (or none) fills the discount unless the user typed one.
  function applyResolved(line: Line, resolved: ResolvedPriceResponse): Line {
    const itemPrice = resolved.source === "item" || resolved.source === "item-wholesale";
    const priceUsable = priceMode === PriceMode.GrossInclusive || itemPrice;
    const price = line.unitName ? resolved.units?.find((u) => u.unitName === line.unitName)?.price : resolved.price;
    return {
      ...line,
      unitPrice: !line.priceEdited && priceUsable && price != null ? String(price) : line.unitPrice,
      discountPercent: line.discountEdited ? line.discountPercent : String(resolved.discountPercent ?? 0),
    };
  }

  // A different customer or issue date can change the list price, the wholesale tier and the
  // discount rule: re-resolve every item line that the user has not priced by hand. Lines billing a
  // sales order keep the order's prices; returns keep the original invoice's.
  const repriceKey = `${partnerId}|${issueDate}`;
  const lastRepriceKey = useRef(repriceKey);
  useEffect(() => {
    if (lastRepriceKey.current === repriceKey) return;
    lastRepriceKey.current = repriceKey;
    if (keepsOriginalPrices || !partnerId) return;
    const targets = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.itemId && !line.salesOrderLineId && !(line.priceEdited && line.discountEdited));
    if (targets.length === 0) return;
    const ids = targets.map(({ line }) => line.itemId);
    const quantities = targets.map(({ line }) => baseQuantity(items.find((i) => i.id === line.itemId), line.unitName, parseFloat(line.quantity) || 1));
    void apiClient.resolvePrices(companyId, ids, warehouseId || undefined, issueDate, partnerId, quantities).then((prices) => {
      setLines((prev) => prev.map((line, i) => {
        const target = targets.find((t) => t.index === i);
        if (!target || line.itemId !== target.line.itemId) return line;
        const resolved = prices.find((p) => p.itemId === line.itemId);
        return resolved ? applyResolved(line, resolved) : line;
      }));
    }).catch(() => {
      // Prices stay as they are; nothing to report.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to customer/date changes
  }, [repriceKey]);

  // §12 P7: the price follows the line's unit. The server gives the price per sales/purchase unit
  // next to the base-unit one, so nothing is multiplied here. List prices are VAT-inclusive: on a
  // net invoice only the item's own price is used, and with a list price the field is cleared for
  // the user to enter rather than keeping a per-piece figure on a box.
  function changeLineUnit(index: number, unitName: string | undefined) {
    const line = lines[index];
    updateLine(index, { unitName });
    const itemId = line?.itemId;
    if (!itemId || keepsOriginalPrices) return;
    const quantity = baseQuantity(items.find((i) => i.id === itemId), unitName, parseFloat(line.quantity) || 1);
    void apiClient.resolvePrices(companyId, [itemId], warehouseId || undefined, issueDate, partnerId || undefined, [quantity]).then((prices) => {
      const resolved = prices.find((p) => p.itemId === itemId);
      if (!resolved) return;
      const usable = priceMode === PriceMode.GrossInclusive || resolved.source === "item" || resolved.source === "item-wholesale";
      const price = unitName ? resolved.units?.find((u) => u.unitName === unitName)?.price : resolved.price;
      setLines((prev) => prev.map((l, i) => (i === index && l.itemId === itemId && l.unitName === unitName
        ? { ...l, unitPrice: usable && price != null ? String(price) : "" }
        : l)));
    }).catch(() => {
      // The price stays as it was; nothing to report.
    });
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine(partnerDrivenTaxId, partnerDrivenAccountId)]);
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

  function validateBeforePayment(): boolean {
    const errors: Record<string, string> = {};
    if (!partnerId) errors.partnerId = intl.formatMessage({ id: "invoiceForm.selectCustomerError" });
    setFieldErrors(errors);
    if (!lines.some((line) => line.description.trim())) {
      setApiError(intl.formatMessage({ id: "invoiceForm.atLeastOneLine" }));
      return false;
    }
    setApiError(null);
    return Object.keys(errors).length === 0;
  }

  const invoiceDraft = useFormDraft({
    kind: "invoice",
    title: intl.formatMessage({ id: "drafts.invoice" }),
    enabled: !editingInvoice && !prefill && fixedDocumentType === undefined,
    dirty: !!partnerId || lines.some((l) => l.description.trim() !== "" || l.itemId !== ""),
    getState: () => ({ partnerId, documentType, issueDate, dueDate, internalNotes, warehouseId, projectId, priceMode, paymentTermDays, graceDays, lines }),
    restore: (d) => {
      setPartnerId(d.partnerId);
      setDocumentType(d.documentType);
      setIssueDate(d.issueDate);
      setDueDate(d.dueDate);
      setInternalNotes(d.internalNotes);
      setWarehouseId(d.warehouseId);
      setProjectId(d.projectId);
      setPriceMode(d.priceMode);
      setPaymentTermDays(d.paymentTermDays);
      setGraceDays(d.graceDays);
      setLines(d.lines);
    },
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const paying = takePaymentNow;
    setTakePaymentNow(false);
    setApiError(null);
    setFieldErrors({});

    const errors: Record<string, string> = {};
    if (!partnerId) {
      errors.partnerId = intl.formatMessage({ id: "invoiceForm.selectCustomerError" });
    }
    const validLines = lines.filter((line) => line.description.trim());
    if (validLines.length === 0) {
      setApiError(intl.formatMessage({ id: "invoiceForm.atLeastOneLine" }));
      return;
    }

    if (paying) {
      const parsedPaymentAmount = parseFloat(paymentAmount);
      if (!parsedPaymentAmount || parsedPaymentAmount <= 0) {
        errors.paymentAmount = intl.formatMessage({ id: "invoiceForm.paymentAmountError" });
      }
      if (!paymentMethodId) {
        errors.paymentMethodId = intl.formatMessage({ id: "invoiceForm.paymentMethodError" });
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
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
        lotNumber: isSalesReturn ? line.lotNumber?.trim() || undefined : undefined,
        salesOrderLineId: line.salesOrderLineId || undefined,
        deliveryLineId: line.deliveryLineId || undefined,
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
          projectId: projectId || undefined,
          invoiceNumber: invoiceNumber.trim() || undefined,
        });
        recordFavorites();
        onSaved?.();
      } else {
        const created = await apiClient.invoicesPOST(companyId, {
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
          projectId: projectId || undefined,
          invoiceNumber: invoiceNumber.trim() || undefined,
          payment: paying
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
        setInvoiceNumber("");
        setPaymentAmount("");
        setPaymentMethodId("");
        toast.success(intl.formatMessage({ id: "toast.invoiceCreated" }));
        invoiceDraft.markDone();
        onCreated({ keepOpen: keepOpenRef.current, invoice: created });
      }
    } catch (err) {
      const msg = getApiErrorMessage(err, intl.formatMessage({ id: editingInvoice ? "invoiceForm.saveError" : "invoiceForm.createError" }));
      setApiError(msg);
      toast.error(msg);
    } finally {
      keepOpenRef.current = false;
      setSubmitting(false);
    }
  }

  // Item option: "code · name [barcode]", so the code printed on the invoice is the one picked here.
  function itemOptionLabel(item: ItemResponse): string {
    const barcode = item.barcodes?.[0]?.barcode;
    return `${item.code} · ${item.name}${barcode ? ` [${barcode}]` : ""}`;
  }

  // Keyboard model of the line table (frontend rule: Excel-like editable grids): Enter or ↓ moves to
  // the same column on the next line — Enter on the last line adds one — and ↑ to the line above.
  // Enter never submits the form from a line cell.
  function handleLineKeyDown(event: KeyboardEvent<HTMLTableSectionElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName !== "INPUT") return;
    const cell = target.closest<HTMLElement>("[data-line-cell]");
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const column = cell.dataset.lineCell;
    let nextRow: number | null = null;
    if (event.key === "Enter" || event.key === "ArrowDown") nextRow = row + 1;
    else if (event.key === "ArrowUp") nextRow = row - 1;
    if (nextRow == null) return;
    event.preventDefault();
    if (nextRow < 0) return;
    const focus = () =>
      document.querySelector<HTMLInputElement>(`[data-line-cell="${column}"][data-row="${nextRow}"] input`)?.focus();
    if (nextRow >= lines.length) {
      if (event.key !== "Enter") return;
      addLine();
      requestAnimationFrame(focus);
    } else {
      focus();
    }
  }

  const priceLabelId = priceMode === PriceMode.NetExclusive ? "invoiceForm.priceExclVat" : "invoiceForm.priceInclVat";
  const otherBasisLabelId = priceMode === PriceMode.NetExclusive ? "invoiceEditor.inclVatShort" : "invoiceEditor.exclVatShort";
  const money = (value: number | undefined) => (value == null ? "—" : value.toFixed(2));
  const th = "px-1.5 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
  const thNum = `${th} text-right`;
  const td = "px-1 py-1 align-top";

  return (
    <form ref={formRef} className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {apiError && (
        <Alert variant="destructive">
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      )}

      {/* CUSTOMER + DOCUMENT */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CustomerPanel
          customers={customers}
          partnerId={partnerId}
          onChange={(v) => { setPartnerId(v); clearFieldError("partnerId"); }}
          error={fieldErrors.partnerId}
          favorites={{
            pinnedIds: partnerFavs.pinnedIds,
            autoIds: partnerFavs.autoIds,
            onPin: partnerFavs.pin,
            onUnpin: partnerFavs.unpin,
            pinnedLabel: intl.formatMessage({ id: "favorites.pinned" }),
            frequentLabel: intl.formatMessage({ id: "favorites.frequentlyUsed" }),
          }}
          onCreateCustomer={() => setNewPartnerOpen(true)}
          creditExposure={creditExposure}
          documentGross={quote?.totals.grossAmount}
          currency={currency}
        />

        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="invoice-document-heading">
          <h3 id="invoice-document-heading" className="text-sm font-semibold">{intl.formatMessage({ id: "invoiceEditor.documentSection" })}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={intl.formatMessage({ id: "invoiceForm.invoiceNumber" })} htmlFor="invoice-number">
              <Input
                id="invoice-number"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                placeholder={intl.formatMessage({ id: "invoiceForm.invoiceNumberPlaceholder" })}
              />
            </FormField>
            {fixedDocumentType === undefined ? (
              <FormField label={intl.formatMessage({ id: "invoiceForm.documentType" })} htmlFor="invoice-document-type">
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
              </FormField>
            ) : <div />}
            <FormField label={intl.formatMessage({ id: "invoiceForm.issueDate" })} htmlFor="invoice-issue-date" required>
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
            </FormField>
            <FormField label={intl.formatMessage({ id: "invoiceForm.dueDate" })} htmlFor="invoice-due-date" required>
              <Input id="invoice-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
            </FormField>
            {!editingInvoice ? (
              <>
                <FormField label={intl.formatMessage({ id: "invoiceForm.priceMode" })} htmlFor="invoice-price-mode">
                  <Select
                    id="invoice-price-mode"
                    value={String(priceMode)}
                    onValueChange={(v) => setPriceMode(Number(v))}
                    options={[
                      { value: String(PriceMode.GrossInclusive), label: intl.formatMessage({ id: "invoiceForm.priceModeGross" }) },
                      { value: String(PriceMode.NetExclusive), label: intl.formatMessage({ id: "invoiceForm.priceModeNet" }) },
                    ]}
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label={intl.formatMessage({ id: "invoiceForm.paymentTermDays" })} htmlFor="invoice-payment-term-days">
                    <Input id="invoice-payment-term-days" type="number" step="1" min="0" value={paymentTermDays}
                      onChange={(event) => handlePaymentTermDaysChange(event.target.value)} />
                  </FormField>
                  <FormField label={intl.formatMessage({ id: "invoiceForm.graceDays" })} htmlFor="invoice-grace-days">
                    <Input id="invoice-grace-days" type="number" step="1" min="0" value={graceDays}
                      onChange={(event) => setGraceDays(event.target.value)} />
                  </FormField>
                </div>
              </>
            ) : (
              <p className="self-end pb-2 text-sm text-muted-foreground sm:col-span-2">
                {intl.formatMessage({ id: "invoiceForm.priceMode" })}:{" "}
                {intl.formatMessage({ id: priceMode === PriceMode.NetExclusive ? "invoiceForm.priceModeNet" : "invoiceForm.priceModeGross" })}
              </p>
            )}
            <WarehouseField id="invoice-warehouse" value={warehouseId} onChange={setWarehouseId} />
            <BillProjectField id="invoice-project" value={projectId} onChange={setProjectId} />
            {needsOriginalInvoice && (
              <FormField
                label={intl.formatMessage({ id: "invoiceForm.originalInvoice" })}
                htmlFor="invoice-original"
                error={fieldErrors.originalInvoiceId}
                className="sm:col-span-2"
              >
                <SearchableSelect
                  id="invoice-original"
                  value={originalInvoiceId}
                  onChange={(v) => { setOriginalInvoiceId(v); clearFieldError("originalInvoiceId"); }}
                  placeholder={intl.formatMessage({ id: "invoiceForm.noOriginalInvoice" })}
                  searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                  noResultsText={intl.formatMessage({ id: "common.noResults" })}
                  emptyOptionLabel={intl.formatMessage({ id: "invoiceForm.noOriginalInvoice" })}
                  aria-invalid={!!fieldErrors.originalInvoiceId}
                  options={originalInvoiceCandidates.map((invoice) => ({
                    value: invoice.id,
                    label: invoice.invoiceNumber ?? invoice.id,
                  }))}
                />
              </FormField>
            )}
          </div>
        </section>
      </div>

      {/* LINES */}
      <section className="flex flex-col gap-2 rounded-lg border bg-card p-4" aria-labelledby="invoice-lines-heading">
        <h3 id="invoice-lines-heading" className="text-sm font-semibold">{intl.formatMessage({ id: "invoiceEditor.linesSection" })}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className={`${th} w-8`}>#</th>
                <th className={`${th} w-56`}>{intl.formatMessage({ id: "invoiceForm.item" })}</th>
                <th className={th}>{intl.formatMessage({ id: "invoiceForm.description" })}</th>
                <th className={`${th} w-44`}>{intl.formatMessage({ id: "invoiceForm.revenueAccount" })}</th>
                <th className={`${thNum} w-24`}>{intl.formatMessage({ id: "invoiceForm.qty" })}</th>
                <th className={`${th} w-24`}>{intl.formatMessage({ id: "invoiceDoc.col.unit" })}</th>
                <th className={`${thNum} w-28`}>{intl.formatMessage({ id: priceLabelId })}</th>
                <th className={`${thNum} w-20`}>{intl.formatMessage({ id: "invoiceForm.discountPercent" })}</th>
                <th className={`${thNum} w-24`}>{intl.formatMessage({ id: "invoiceDoc.col.net" })}</th>
                <th className={`${th} w-32`}>{intl.formatMessage({ id: "invoiceForm.tax" })}</th>
                <th className={`${thNum} w-20`}>{intl.formatMessage({ id: "invoiceForm.vat" })}</th>
                <th className={`${thNum} w-24`}>{intl.formatMessage({ id: "invoiceForm.totalGross" })}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody onKeyDown={handleLineKeyDown}>
              {lines.map((line, index) => {
                const selectedItem = items.find((i) => i.id === line.itemId);
                const overridden = overriddenFields(line, selectedItem);
                const amounts = quote?.lines[index];
                const dim = quoteIsStale ? "text-muted-foreground" : "";
                return (
                  <tr key={index} className="border-b last:border-b-0" data-testid={`invoice-line-${index}`}>
                    <td className={`${td} pt-2.5 text-xs tabular-nums text-muted-foreground`}>{index + 1}</td>
                    <td className={td}>
                      <SearchableSelect
                        aria-label={intl.formatMessage({ id: "invoiceForm.item" })}
                        value={line.itemId}
                        onChange={(val) => selectLineItem(index, val)}
                        placeholder={intl.formatMessage({ id: "invoiceForm.noItem" })}
                        searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                        noResultsText={intl.formatMessage({ id: "common.noResults" })}
                        emptyOptionLabel={intl.formatMessage({ id: "invoiceForm.noItem" })}
                        options={items.map((item) => ({
                          value: item.id,
                          label: itemOptionLabel(item),
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
                        createAction={{
                          label: intl.formatMessage({ id: "items.createItem" }),
                          onClick: () => { setNewItemLineIndex(index); setNewItemOpen(true); },
                        }}
                      />
                    </td>
                    <td className={td} data-line-cell="description" data-row={index}>
                      <Input
                        aria-label={intl.formatMessage({ id: "invoiceForm.description" })}
                        value={line.description}
                        onChange={(event) => updateLine(index, { description: event.target.value })}
                      />
                      {(line.salesOrderLineId || line.deliveryLineId) && (
                        <span className="text-[11px] text-muted-foreground" data-testid={`invoice-line-link-${index}`}>
                          {line.linkLabel ?? intl.formatMessage({ id: line.deliveryLineId ? "dist.invoice.fromDelivery" : "dist.invoice.fromOrder" })}
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      <SearchableSelect
                        aria-label={intl.formatMessage({ id: "invoiceForm.revenueAccount" })}
                        value={line.revenueAccountId}
                        onChange={(val) => updateLine(index, { revenueAccountId: val })}
                        placeholder={intl.formatMessage({ id: "common.companyDefault" })}
                        searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                        noResultsText={intl.formatMessage({ id: "common.noResults" })}
                        emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
                        options={revenueAccounts.map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }))}
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
                        <Badge variant="outline" className="mt-0.5 w-fit text-[10px] text-warning-foreground">
                          {intl.formatMessage({ id: "common.modified" })}
                        </Badge>
                      )}
                    </td>
                    <td className={td} data-line-cell="quantity" data-row={index}>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="text-right tabular-nums"
                        aria-label={intl.formatMessage({ id: "invoiceForm.qty" })}
                        value={line.quantity}
                        onChange={(event) => updateLine(index, { quantity: event.target.value })}
                      />
                      {isSalesReturn && selectedItem?.trackLots && (
                        <Input className="mt-0.5 h-7 text-xs" placeholder={intl.formatMessage({ id: "stock.lot.number" })} aria-label={intl.formatMessage({ id: "stock.lot.number" })}
                          value={line.lotNumber ?? ""} onChange={(event) => updateLine(index, { lotNumber: event.target.value })} />
                      )}
                      {selectedItem?.trackInventory && (
                        <OnHandHint
                          className="mt-0.5 block whitespace-nowrap text-right"
                          onHand={onHand.data ? (onHand.data.get(selectedItem.id) ?? 0) : undefined}
                          requested={baseQuantity(selectedItem, line.unitName, parseFloat(line.quantity) || 0)}
                          warnWhenShort={documentType === InvoiceDocumentType.Invoice}
                        />
                      )}
                    </td>
                    <td className={td}>
                      {selectedItem
                        ? <LineUnitSelect item={selectedItem} value={line.unitName ?? ""} onChange={(v) => changeLineUnit(index, v || undefined)} />
                        : <FreeUnitInput value={line.unitName ?? ""} onChange={(v) => updateLine(index, { unitName: v || undefined })} />}
                    </td>
                    <td className={td} data-line-cell="price" data-row={index}>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="text-right tabular-nums"
                        aria-label={intl.formatMessage({ id: priceLabelId })}
                        value={line.unitPrice}
                        onChange={(event) => updateLine(index, { unitPrice: event.target.value, priceEdited: true })}
                      />
                      {amounts && (
                        <span className={`block text-right text-[11px] tabular-nums text-muted-foreground`} data-testid={`invoice-line-other-price-${index}`}>
                          {intl.formatMessage({ id: otherBasisLabelId })}{" "}
                          {money(priceMode === PriceMode.NetExclusive ? amounts.unitPriceGross : amounts.unitPriceNet)}
                        </span>
                      )}
                      {overridden.price && (
                        <Badge variant="outline" className="mt-0.5 w-fit text-[10px] text-warning-foreground">
                          {intl.formatMessage({ id: "common.modified" })}
                        </Badge>
                      )}
                    </td>
                    <td className={td} data-line-cell="discount" data-row={index}>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        className="text-right tabular-nums"
                        aria-label={intl.formatMessage({ id: "invoiceForm.discountPercent" })}
                        value={line.discountPercent}
                        onChange={(event) => updateLine(index, { discountPercent: event.target.value, discountEdited: true })}
                      />
                      {amounts && amounts.discountAmount !== 0 && (
                        <span className="block text-right text-[11px] tabular-nums text-muted-foreground">-{money(amounts.discountAmount)}</span>
                      )}
                    </td>
                    <td className={`${td} pt-2.5 text-right tabular-nums ${dim}`}>{money(amounts?.netAmount)}</td>
                    <td className={td}>
                      <SearchableSelect
                        aria-label={intl.formatMessage({ id: "invoiceForm.tax" })}
                        value={line.taxDefinitionId}
                        onChange={(val) => updateLine(index, { taxDefinitionId: val })}
                        placeholder={intl.formatMessage({ id: "invoiceForm.noTax" })}
                        searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                        noResultsText={intl.formatMessage({ id: "common.noResults" })}
                        emptyOptionLabel={!isVatRegistered ? intl.formatMessage({ id: "invoiceForm.noTax" }) : undefined}
                        options={taxes.map((tax) => ({ value: tax.id, label: taxRatePercentLabel(tax), description: tax.code ?? undefined }))}
                      />
                      {overridden.tax && (
                        <Badge variant="outline" className="mt-0.5 w-fit text-[10px] text-warning-foreground">
                          {intl.formatMessage({ id: "common.modified" })}
                        </Badge>
                      )}
                    </td>
                    <td className={`${td} pt-2.5 text-right tabular-nums ${dim}`}>{money(amounts?.taxAmount)}</td>
                    <td className={`${td} pt-2.5 text-right font-medium tabular-nums ${dim}`}>{money(amounts?.grossAmount)}</td>
                    <td className={td}>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)} disabled={lines.length <= 1}
                        aria-label={intl.formatMessage({ id: "invoiceForm.remove" })} title={intl.formatMessage({ id: "invoiceForm.remove" })}>
                        ×
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addLine}>
            {intl.formatMessage({ id: "invoiceForm.addLine" })}
          </Button>
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "invoiceEditor.keyboardHint" })}</p>
        </div>
      </section>

      {/* NOTES + TOTALS */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
          <FormField label={intl.formatMessage({ id: "invoiceForm.internalNotes" })} htmlFor="invoice-internal-notes">
            <Textarea id="invoice-internal-notes" rows={4} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} />
          </FormField>
        </section>
        <InvoiceTotalsPanel quote={quote} isStale={quoteIsStale} taxes={taxes} currency={currency} />
      </div>

      {/* ACTIONS — kept in view at the bottom of the page */}
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur">
        {onCancel && (
          <Button type="button" variant="ghost" className="mr-auto" onClick={onCancel} disabled={submitting}>
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => setShowPreview(true)}>
          {intl.formatMessage({ id: "invoicePreview.previewInvoice" })}
        </Button>
        {!editingInvoice && (
          <Button type="submit" variant="outline" disabled={submitting} onClick={() => { keepOpenRef.current = true; }}>
            {intl.formatMessage({ id: "common.saveAndAddNew" })}
          </Button>
        )}
        {!editingInvoice && (
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => {
              if (!validateBeforePayment()) return;
              const gross = quote?.totals.grossAmount;
              setPaymentAmount(gross != null && gross > 0 ? gross.toFixed(2) : "");
              setShowPaymentDialog(true);
            }}
          >
            {intl.formatMessage({ id: "invoiceForm.saveAndPay" })}
          </Button>
        )}
        <Button type="submit" disabled={submitting} onClick={() => { keepOpenRef.current = false; }}>
          {editingInvoice
            ? submitting
              ? intl.formatMessage({ id: "invoiceForm.saving" })
              : intl.formatMessage({ id: "invoiceForm.saveChanges" })
            : submitting
              ? intl.formatMessage({ id: "invoiceForm.creating" })
              : intl.formatMessage({ id: "invoiceForm.createInvoice" })}
        </Button>
      </div>

      {/* Save & Pay dialog — select payment method, then submit with inline payment */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: "invoiceForm.saveAndPay" })}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <FormField label={intl.formatMessage({ id: "recordPayment.amount" })} htmlFor="pay-dialog-amount" error={fieldErrors.paymentAmount} required>
              <Input
                id="pay-dialog-amount"
                type="number"
                step="0.01"
                min="0"
                value={paymentAmount}
                onChange={(event) => { setPaymentAmount(event.target.value); clearFieldError("paymentAmount"); }}
                aria-invalid={!!fieldErrors.paymentAmount}
              />
            </FormField>
            <FormField label={intl.formatMessage({ id: "recordPayment.cashBankAccount" })} htmlFor="pay-dialog-method" error={fieldErrors.paymentMethodId} required>
              <PaymentMethodSelect
                id="pay-dialog-method"
                paymentMethods={paymentMethods}
                value={paymentMethodId}
                onChange={(v) => { setPaymentMethodId(v); clearFieldError("paymentMethodId"); }}
                emptyOptionLabelKey="invoiceForm.selectPaymentMethod"
                aria-invalid={!!fieldErrors.paymentMethodId}
              />
            </FormField>
            <Button
              type="button"
              disabled={submitting || !paymentMethodId || !(parseFloat(paymentAmount) > 0)}
              onClick={() => {
                setTakePaymentNow(true);
                setShowPaymentDialog(false);
                // Submit the form programmatically after state updates
                requestAnimationFrame(() => formRef.current?.requestSubmit());
              }}
            >
              {submitting ? intl.formatMessage({ id: "invoiceForm.creating" }) : intl.formatMessage({ id: "invoiceForm.confirmAndPay" })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Inline partner creation dialog */}
      <FormDialog
        open={newPartnerOpen}
        onOpenChange={(open) => { if (!open) setNewPartnerOpen(false); }}
        title={intl.formatMessage({ id: "invoicing.addCustomer" })}
        size="sm"
      >
        <PartnerForm
          companyId={companyId}
          role="customer"
          onCreated={(id) => {
            setNewPartnerOpen(false);
            if (id) setPartnerId(id);
            onPartnerCreated?.(id);
          }}
        />
      </FormDialog>

      {/* Inline item creation dialog */}
      <FormDialog
        open={newItemOpen}
        onOpenChange={(open) => { if (!open) { setNewItemOpen(false); setNewItemLineIndex(null); } }}
        title={intl.formatMessage({ id: "items.createItem" })}
        size="sm"
      >
        <QuickItemForm
          companyId={companyId}
          onCreated={(id) => {
            setNewItemOpen(false);
            if (newItemLineIndex != null) {
              selectLineItem(newItemLineIndex, id);
            }
            setNewItemLineIndex(null);
            onItemCreated?.(id);
          }}
        />
      </FormDialog>

      {showPreview && (
        <InvoicePreviewDialog
          data={buildDocumentDataFromForm({
            company: { ...(activeCompany ?? { name: "" }), bankAccounts: bankAccounts.data },
            customer: customers.find((c) => c.id === partnerId),
            lines: lines.map((line) => ({
              description: line.description,
              quantity: parseFloat(line.quantity) || 0,
              discountPercent: parseFloat(line.discountPercent) || 0,
              taxDefinitionId: line.taxDefinitionId || undefined,
              unitName: line.unitName,
              itemCode: items.find((i) => i.id === line.itemId)?.code?.toString(),
            })),
            quote,
            taxes,
            documentType,
            issueDate,
            dueDate,
            priceMode,
            internalNotes: internalNotes || undefined,
            paymentTermDays: paymentTermDays ? parseInt(paymentTermDays, 10) : undefined,
            originalDocumentNumber: originalInvoiceId ? (originalInvoiceCandidates.find((i) => i.id === originalInvoiceId)?.invoiceNumber ?? undefined) : undefined,
          })}
          onClose={() => setShowPreview(false)}
        />
      )}
    </form>
  );
}
