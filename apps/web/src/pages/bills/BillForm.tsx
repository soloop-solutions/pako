import { useEffect, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse, BillResponse, ItemResponse, PartnerResponse, PaymentMethodResponse, TaxDefinitionResponse } from "@pako/shared";
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
import { BILL_DOCUMENT_TYPE_OPTION_KEYS, BillDocumentType } from "@/lib/document-types";
import { useEntityFavorites } from "@/hooks/useEntityFavorites";
import { applyItemDefaultsToLine, overriddenItemLineFields, type ItemDefaultsSource } from "@/lib/item-line-defaults";
import { isExpenseAccountType } from "@/lib/ledger-enums";
import { partnerOptionLabel } from "@/lib/partners";
import { PaymentMethodKind } from "@/lib/payment-method-enums";
import { computeLine, findTaxByCode, PriceMode, taxRatePercentLabel } from "@/lib/tax-enums";
import { PaymentMethodSelect } from "@/pages/shared/PaymentMethodSelect";
import { LineUnitSelect, OnHandHint, WarehouseField } from "@/pages/inventory/StockFields";
import { baseQuantity } from "@/lib/item-units";
import { useStockOnHand } from "@/hooks/useStock";
// docs/ERP_VERTICALS_PLAN.md §1: the bill's project and, on a construction site, each line's cost code.
import { useProjectCostCodes } from "@/hooks/useVerticals";
import { BillProjectField, CostCodeSelect } from "@/pages/construction/BillProjectFields";
import { FormDialog } from "@/components/shared/FormDialog";
import { PartnerForm } from "@/pages/shared/PartnerForm";
import { QuickItemForm } from "@/pages/shared/QuickItemForm";

type Line = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxDefinitionId: string;
  itemId: string;
  expenseAccountId: string;
  // §12 P7: the item unit the quantity is in (undefined = the base unit).
  unitName?: string;
  // §12 P8: for lot-tracked items, the lot received and its expiry.
  lotNumber?: string;
  expiryDate?: string;
  // The purchase-order line this bill line bills. A draft edit rebuilds every line, so it has to
  // travel with the line or the link to the order is lost.
  purchaseOrderLineId?: string;
  // The construction site's cost code the line is charged to (only with a site's project).
  costCodeId?: string;
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
  /** Called after an inline vendor creation so the parent can refresh its data. */
  onPartnerCreated?: (id: string) => void;
  /** Called after an inline item creation so the parent can refresh its data. */
  onItemCreated?: (id: string) => void;
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
  onPartnerCreated,
  onItemCreated,
}: BillFormProps) {
  const intl = useIntl();
  const partnerFavs = useEntityFavorites("Partner");
  const accountFavs = useEntityFavorites("Account");
  const itemFavs = useEntityFavorites("Item");
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
  // docs/INVENTORY_PLAN.md §6: the warehouse stock-tracked lines arrive in ("" = the default one).
  const [warehouseId, setWarehouseId] = useState(editingBill?.warehouseId ?? "");
  const [projectId, setProjectId] = useState(editingBill?.projectId ?? "");
  const projectCostCodes = useProjectCostCodes(projectId || undefined);
  // C1/C5: PriceMode/inline-payment are Create-only features — UpdateBillRequest (the Draft-edit
  // path) doesn't carry either field, so this state is only read from the Create branch of
  // handleSubmit and its inputs are hidden while editing. A draft being edited still starts in its
  // own mode, so the line preview and the "price incl./excl. VAT" label match what is saved.
  const [priceMode, setPriceMode] = useState<number>(editingBill?.priceMode ?? PriceMode.GrossInclusive);
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
          unitName: l.unitName ?? undefined,
          lotNumber: l.lotNumber ?? undefined,
          expiryDate: l.expiryDate ?? undefined,
          expenseAccountId: l.expenseAccountId ?? "",
          purchaseOrderLineId: l.purchaseOrderLineId ?? undefined,
          costCodeId: l.costCodeId ?? undefined,
        }))
      : [emptyLine(defaultTaxId)],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [newPartnerOpen, setNewPartnerOpen] = useState(false);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newItemLineIndex, setNewItemLineIndex] = useState<number | null>(null);
  const trackedItemIds = lines.map((l) => l.itemId).filter((id) => items.find((i) => i.id === id)?.trackInventory);
  const onHand = useStockOnHand(trackedItemIds, warehouseId || null);

  // Auto-populate lines from the original bill when creating a Purchase Return. Only fires when:
  // 1. This form is fixed to PurchaseReturn (fixedDocumentType === 2)
  // 2. The user selects an originalBillId
  // 3. The user has NOT already entered lines manually (still on a single empty line)
  // The user can then modify quantities for partial returns or remove lines they don't want.
  const isPurchaseReturn = fixedDocumentType === BillDocumentType.PurchaseReturn;
  useEffect(() => {
    if (!isPurchaseReturn || !originalBillId || editingBill) return;

    // Don't overwrite if the user has already entered lines manually.
    const hasManualLines = lines.length > 1 || (lines.length === 1 && lines[0].description.trim() !== "");
    if (hasManualLines) return;

    let cancelled = false;
    apiClient
      .billsGET(companyId, originalBillId)
      .then((bill) => {
        if (cancelled) return;
        if (bill.lines.length === 0) return;
        // Not purchaseOrderLineId: a return does not bill the order line a second time.
        const populated: Line[] = bill.lines.map((l) => ({
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          discountPercent: String(l.discountPercent),
          taxDefinitionId: l.taxDefinitionId ?? defaultTaxId,
          itemId: l.itemId ?? "",
          unitName: l.unitName ?? undefined,
          lotNumber: l.lotNumber ?? undefined,
          expiryDate: l.expiryDate ?? undefined,
          expenseAccountId: l.expenseAccountId ?? "",
        }));
        setLines(populated);
      })
      .catch(() => {
        // Silently ignore — the user can still enter lines manually.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only react to originalBillId changes
  }, [originalBillId]);

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
    // Another item is no longer the purchase-order line this one billed.
    setLines((prev) => prev.map((line, i) => (i === index
      ? { ...applyItemDefaults(line, item, partnerDrivenTaxId), unitName: undefined, purchaseOrderLineId: line.itemId === itemId ? line.purchaseOrderLineId : undefined }
      : line)));
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
        unitName: line.unitName || undefined,
        lotNumber: line.lotNumber?.trim() || undefined,
        expiryDate: line.expiryDate || undefined,
        purchaseOrderLineId: line.purchaseOrderLineId || undefined,
        costCodeId: projectCostCodes.length > 0 ? line.costCodeId || undefined : undefined,
      }));

      const recordFavorites = () => {
        if (partnerId) partnerFavs.recordSelection(partnerId);
        for (const line of validLines) {
          if (line.expenseAccountId) accountFavs.recordSelection(line.expenseAccountId);
          if (line.itemId) itemFavs.recordSelection(line.itemId);
        }
      };

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
          warehouseId: warehouseId || undefined,
          projectId: projectId || undefined,
        });
        recordFavorites();
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
          warehouseId: warehouseId || undefined,
          projectId: projectId || undefined,
          payment: takePaymentNow
            ? { amount: parseFloat(paymentAmount), paymentMethodId, date: issueDate }
            : undefined,
        });
        recordFavorites();
        setPartnerId("");
        setDocumentType(fixedDocumentType ?? BillDocumentType.Bill);
        setOriginalBillId("");
        setVendorReference("");
        setPriceMode(PriceMode.GrossInclusive);
        setLines([emptyLine(defaultTaxId)]);
        setTakePaymentNow(false);
        setPaymentAmount("");
        setPaymentMethodId("");
        toast.success(intl.formatMessage({ id: "toast.billCreated" }));
        onCreated();
      }
    } catch (err) {
      const msg = getApiErrorMessage(err, intl.formatMessage({ id: editingBill ? "billForm.saveError" : "billForm.createError" }));
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

      <div className="grid gap-4 sm:grid-cols-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bill-vendor">{intl.formatMessage({ id: "billForm.vendor" })}</Label>
          <SearchableSelect
            id="bill-vendor"
            value={partnerId}
            onChange={setPartnerId}
            placeholder={intl.formatMessage({ id: "billForm.selectVendor" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            emptyOptionLabel={intl.formatMessage({ id: "billForm.selectVendor" })}
            options={vendors.map((vendor) => ({
              value: vendor.id,
              label: partnerOptionLabel(vendor, intl),
              description: vendor.taxNumber ?? undefined,
            }))}
            favorites={{
              pinnedIds: partnerFavs.pinnedIds,
              autoIds: partnerFavs.autoIds,
              onPin: partnerFavs.pin,
              onUnpin: partnerFavs.unpin,
              pinnedLabel: intl.formatMessage({ id: "favorites.pinned" }),
              frequentLabel: intl.formatMessage({ id: "favorites.frequentlyUsed" }),
            }}
            createAction={{
              label: intl.formatMessage({ id: "bills.addVendor" }),
              onClick: () => setNewPartnerOpen(true),
            }}
          />
        </div>
        {fixedDocumentType === undefined && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="bill-document-type">{intl.formatMessage({ id: "billForm.documentType" })}</Label>
            <Select
              id="bill-document-type"
              value={String(documentType)}
              onValueChange={(v) => {
                setDocumentType(Number(v));
                setOriginalBillId("");
              }}
              options={BILL_DOCUMENT_TYPE_OPTION_KEYS.map((option) => ({
                value: String(option.value),
                label: intl.formatMessage({ id: option.labelKey }),
              }))}
            />
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
        <WarehouseField id="bill-warehouse" value={warehouseId} onChange={setWarehouseId} />
        <BillProjectField id="bill-project" value={projectId} onChange={setProjectId} />
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
          <Select
            id="bill-price-mode"
            value={String(priceMode)}
            onValueChange={(v) => setPriceMode(Number(v))}
            options={[
              { value: String(PriceMode.GrossInclusive), label: intl.formatMessage({ id: "invoiceForm.priceModeGross" }) },
              { value: String(PriceMode.NetExclusive), label: intl.formatMessage({ id: "invoiceForm.priceModeNet" }) },
            ]}
          />
        </div>
      )}

      {needsOriginalBill && (
        <div className="flex flex-col gap-2 sm:w-1/2">
          <Label htmlFor="bill-original">
            {intl.formatMessage({ id: requiresOriginalBill ? "billForm.originalBillRequired" : "billForm.originalBill" })}
          </Label>
          <SearchableSelect
            id="bill-original"
            value={originalBillId}
            onChange={setOriginalBillId}
            placeholder={intl.formatMessage({ id: requiresOriginalBill ? "billForm.selectOriginalBill" : "billForm.noOriginalBill" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            emptyOptionLabel={requiresOriginalBill ? undefined : intl.formatMessage({ id: "billForm.noOriginalBill" })}
            options={originalBillCandidates.map((bill) => ({
              value: bill.id,
              label: bill.vendorReference ?? bill.id,
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
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.item" })}</Label>}
              <SearchableSelect
                value={line.itemId}
                onChange={(val) => selectLineItem(index, val)}
                placeholder={intl.formatMessage({ id: "billForm.noItem" })}
                searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                noResultsText={intl.formatMessage({ id: "common.noResults" })}
                emptyOptionLabel={intl.formatMessage({ id: "billForm.noItem" })}
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
                createAction={{
                  label: intl.formatMessage({ id: "items.createItem" }),
                  onClick: () => { setNewItemLineIndex(index); setNewItemOpen(true); },
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.expenseAccount" })}</Label>}
              <SearchableSelect
                value={line.expenseAccountId}
                onChange={(val) => updateLine(index, { expenseAccountId: val })}
                placeholder={intl.formatMessage({ id: "common.companyDefault" })}
                searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                noResultsText={intl.formatMessage({ id: "common.noResults" })}
                emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
                options={expenseAccounts.map((account) => ({
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
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.description" })}</Label>}
              <Input value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} />
              {projectCostCodes.length > 0 && (
                <CostCodeSelect costCodes={projectCostCodes} value={line.costCodeId ?? ""} onChange={(v) => updateLine(index, { costCodeId: v || undefined })} />
              )}
            </div>
            <div className="relative flex flex-col gap-1">
              {index === 0 && <Label>{intl.formatMessage({ id: "billForm.qty" })}</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={line.quantity}
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
              />
              <LineUnitSelect item={selectedItem} value={line.unitName ?? ""} onChange={(v) => updateLine(index, { unitName: v || undefined })} />
              {selectedItem?.trackLots && (
                <div className="flex gap-1">
                  <Input className="h-7 text-xs" placeholder={intl.formatMessage({ id: "stock.lot.number" })} aria-label={intl.formatMessage({ id: "stock.lot.number" })}
                    value={line.lotNumber ?? ""} onChange={(event) => updateLine(index, { lotNumber: event.target.value })} />
                  <Input className="h-7 text-xs" type="date" aria-label={intl.formatMessage({ id: "stock.lot.expiry" })}
                    value={line.expiryDate ?? ""} onChange={(event) => updateLine(index, { expiryDate: event.target.value })} />
                </div>
              )}
              {selectedItem?.trackInventory && (
                <OnHandHint
                  className="absolute -bottom-4 right-0 whitespace-nowrap"
                  onHand={onHand.data ? (onHand.data.get(selectedItem.id) ?? 0) : undefined}
                  requested={baseQuantity(selectedItem, line.unitName, parseFloat(line.quantity) || 0)}
                  warnWhenShort={documentType === BillDocumentType.PurchaseReturn}
                />
              )}
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
                placeholder={intl.formatMessage({ id: "billForm.purchasePricePlaceholder" })}
                value={line.unitPrice}
                onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
              />
              {overridden.price && (
                <Badge variant="outline" className="w-fit text-[10px] text-amber-600">
                  {intl.formatMessage({ id: "billForm.priceOverridden" })}
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
              <SearchableSelect
                value={line.taxDefinitionId}
                onChange={(val) => updateLine(index, { taxDefinitionId: val })}
                placeholder={intl.formatMessage({ id: "billForm.noTax" })}
                searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                noResultsText={intl.formatMessage({ id: "common.noResults" })}
                emptyOptionLabel={!isVatRegistered ? intl.formatMessage({ id: "billForm.noTax" }) : undefined}
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
            {isVatRegistered && (
              <div className="flex flex-col gap-1">
                {index === 0 && <Label>{intl.formatMessage({ id: "billForm.net" })}</Label>}
                <p className="px-3 py-2 text-sm text-muted-foreground">{net.toFixed(2)}</p>
              </div>
            )}
            {isVatRegistered && (
              <div className="flex flex-col gap-1">
                {index === 0 && <Label>{intl.formatMessage({ id: "billForm.vat" })}</Label>}
                <p className="px-3 py-2 text-sm text-muted-foreground">{tax.toFixed(2)}</p>
              </div>
            )}
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
            <Checkbox checked={takePaymentNow} onChange={(event) => setTakePaymentNow(event.target.checked)} />
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

      {/* Inline vendor creation dialog */}
      <FormDialog
        open={newPartnerOpen}
        onOpenChange={(open) => { if (!open) setNewPartnerOpen(false); }}
        title={intl.formatMessage({ id: "bills.addVendor" })}
        size="sm"
      >
        <PartnerForm
          companyId={companyId}
          role="vendor"
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
    </form>
  );
}
