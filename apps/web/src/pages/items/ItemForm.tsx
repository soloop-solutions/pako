import { useEffect, useRef, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse, ItemCategoryResponse, ItemResponse, TaxDefinitionResponse } from "@pako/shared";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { ITEM_TYPE_OPTION_KEYS, ItemType } from "@/lib/item-types";
import { taxRatePercentLabel } from "@/lib/tax-enums";

export interface ItemFormFields {
  name: string;
  description?: string;
  unit: string;
  type: number;
  defaultUnitPrice?: number;
  defaultTaxDefinitionId?: string;
  defaultRevenueAccountId?: string;
  defaultExpenseAccountId?: string;
  defaultInventoryAccountId?: string;
  categoryId?: string;
  trackInventory: boolean;
  minimumStock?: number;
  trackLots?: boolean;
  purchaseUnit?: string;
  purchaseUnitFactor?: number;
  salesUnit?: string;
  salesUnitFactor?: number;
}

interface ItemFormProps {
  mode: "create" | "edit";
  taxes: TaxDefinitionResponse[];
  incomeAccounts: AccountResponse[];
  expenseAccounts: AccountResponse[];
  inventoryAccounts: AccountResponse[];
  /** docs/INVENTORY_PLAN.md D9: product categories (empty hides the field). */
  categories?: ItemCategoryResponse[];
  /** Show "Track stock" / minimum stock: the company has the Inventory module and the user can see it. */
  showStock?: boolean;
  initial?: ItemResponse;
  submitting: boolean;
  error: string | null;
  onSubmit: (fields: ItemFormFields) => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function ItemForm({
  mode,
  taxes,
  incomeAccounts,
  expenseAccounts,
  inventoryAccounts,
  categories = [],
  showStock = false,
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
  onDirtyChange,
}: ItemFormProps) {
  const intl = useIntl();

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "");

  const initialRef = useRef({ name: initial?.name ?? "", unit: initial?.unit ?? "" });
  useEffect(() => {
    const isDirty = name !== initialRef.current.name || unit !== initialRef.current.unit;
    onDirtyChange?.(isDirty);
  }, [name, unit, onDirtyChange]);
  const [price, setPrice] = useState(initial?.defaultUnitPrice != null ? String(initial.defaultUnitPrice) : "");
  const [type, setType] = useState<number>(initial?.type ?? ItemType.Goods);
  const [taxId, setTaxId] = useState(initial?.defaultTaxDefinitionId ?? "");
  const [revenueAccountId, setRevenueAccountId] = useState(initial?.defaultRevenueAccountId ?? "");
  const [expenseAccountId, setExpenseAccountId] = useState(initial?.defaultExpenseAccountId ?? "");
  const [inventoryAccountId, setInventoryAccountId] = useState(initial?.defaultInventoryAccountId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [trackInventory, setTrackInventory] = useState(initial?.trackInventory ?? false);
  const [trackLots, setTrackLots] = useState(initial?.trackLots ?? false);
  const [minimumStock, setMinimumStock] = useState(initial?.minimumStock != null ? String(initial.minimumStock) : "");
  // §12 P7: purchase and sales units, each a multiple of the base unit.
  const [purchaseUnit, setPurchaseUnit] = useState(initial?.purchaseUnit ?? "");
  const [purchaseFactor, setPurchaseFactor] = useState(initial?.purchaseUnitFactor != null ? String(initial.purchaseUnitFactor) : "");
  const [salesUnit, setSalesUnit] = useState(initial?.salesUnit ?? "");
  const [salesFactor, setSalesFactor] = useState(initial?.salesUnitFactor != null ? String(initial.salesUnitFactor) : "");
  // Tracking can't be switched once stock has moved: the ledger and the stock card would disagree.
  const trackingLocked = initial?.hasStockMoves ?? false;
  const canTrack = type === ItemType.Goods;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      unit: unit.trim(),
      type,
      defaultUnitPrice: price ? parseFloat(price) : undefined,
      defaultTaxDefinitionId: taxId || undefined,
      defaultRevenueAccountId: revenueAccountId || undefined,
      defaultExpenseAccountId: expenseAccountId || undefined,
      defaultInventoryAccountId: inventoryAccountId || undefined,
      categoryId: categoryId || undefined,
      trackInventory: canTrack && trackInventory,
      minimumStock: canTrack && trackInventory && minimumStock ? parseFloat(minimumStock) : undefined,
      trackLots: canTrack && trackInventory && trackLots,
      purchaseUnit: canTrack && purchaseUnit.trim() ? purchaseUnit.trim() : undefined,
      purchaseUnitFactor: canTrack && purchaseUnit.trim() && purchaseFactor ? parseFloat(purchaseFactor) : undefined,
      salesUnit: canTrack && salesUnit.trim() ? salesUnit.trim() : undefined,
      salesUnitFactor: canTrack && salesUnit.trim() && salesFactor ? parseFloat(salesFactor) : undefined,
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="item-name">{intl.formatMessage({ id: "items.name" })}</Label>
          <Input id="item-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Laptop HP ProBook 450" />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="item-description">{intl.formatMessage({ id: "items.form.description" })}</Label>
          <Textarea
            id="item-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={intl.formatMessage({ id: "items.form.descriptionPlaceholder" })}
            rows={2}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="item-unit">{intl.formatMessage({ id: "items.unit" })}</Label>
          <Input id="item-unit" required value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="copë" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="item-price">{intl.formatMessage({ id: "items.defaultPrice" })}</Label>
          <Input id="item-price" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="item-type">{intl.formatMessage({ id: "items.form.type" })}</Label>
          <Select
            id="item-type"
            value={String(type)}
            onValueChange={(v) => setType(Number(v))}
            options={ITEM_TYPE_OPTION_KEYS.map((option) => ({
              value: String(option.value),
              label: intl.formatMessage({ id: option.labelKey }),
            }))}
          />
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.form.typeHint" })}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="item-tax">{intl.formatMessage({ id: "items.form.vatCode" })}</Label>
          <SearchableSelect
            id="item-tax"
            value={taxId}
            onChange={setTaxId}
            placeholder={intl.formatMessage({ id: "items.form.noVatCode" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            emptyOptionLabel={intl.formatMessage({ id: "items.form.noVatCode" })}
            options={taxes.map((tax) => ({
              value: tax.id,
              label: taxRatePercentLabel(tax),
              description: tax.code ?? undefined,
            }))}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="item-revenue-account">{intl.formatMessage({ id: "items.form.revenueAccount" })}</Label>
          <SearchableSelect
            id="item-revenue-account"
            value={revenueAccountId}
            onChange={setRevenueAccountId}
            placeholder={intl.formatMessage({ id: "common.companyDefault" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
            options={incomeAccounts.map((account) => ({
              value: account.id,
              label: `${account.code} · ${account.name}`,
            }))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="item-expense-account">{intl.formatMessage({ id: "items.form.expenseAccount" })}</Label>
          <SearchableSelect
            id="item-expense-account"
            value={expenseAccountId}
            onChange={setExpenseAccountId}
            placeholder={intl.formatMessage({ id: "common.companyDefault" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
            options={expenseAccounts.map((account) => ({
              value: account.id,
              label: `${account.code} · ${account.name}`,
            }))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="item-inventory-account">{intl.formatMessage({ id: "items.form.inventoryAccount" })}</Label>
          <SearchableSelect
            id="item-inventory-account"
            value={inventoryAccountId}
            onChange={setInventoryAccountId}
            placeholder={intl.formatMessage({ id: "common.companyDefault" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
            options={inventoryAccounts.map((account) => ({
              value: account.id,
              label: `${account.code} · ${account.name}`,
            }))}
          />
        </div>
      </div>

      {(categories.length > 0 || (showStock && canTrack)) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {categories.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="item-category">{intl.formatMessage({ id: "items.category" })}</Label>
              <SearchableSelect
                id="item-category"
                value={categoryId}
                onChange={setCategoryId}
                placeholder={intl.formatMessage({ id: "items.noCategory" })}
                searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                noResultsText={intl.formatMessage({ id: "common.noResults" })}
                emptyOptionLabel={intl.formatMessage({ id: "items.noCategory" })}
                options={categories.filter((c) => c.isActive || c.id === categoryId).map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
          )}
          {showStock && canTrack && (
            <>
              <div className="flex flex-col gap-1">
                <Label className="invisible" aria-hidden>{intl.formatMessage({ id: "items.trackInventory" })}</Label>
                <label className="flex h-9 items-center gap-2 text-sm" title={intl.formatMessage({ id: trackingLocked ? "items.trackInventory.locked" : "items.trackInventory.hint" })}>
                  <input
                    id="item-track"
                    type="checkbox"
                    checked={trackInventory}
                    disabled={trackingLocked}
                    onChange={(e) => setTrackInventory(e.target.checked)}
                  />
                  {intl.formatMessage({ id: "items.trackInventory" })}
                </label>
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage({ id: trackingLocked ? "items.trackInventory.locked" : "items.trackInventory.hint" })}
                </p>
              </div>
              {trackInventory && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="item-minimum">{intl.formatMessage({ id: "items.minimumStock" })}</Label>
                  <Input
                    id="item-minimum"
                    type="number"
                    min="0"
                    step="any"
                    className="text-right tabular-nums"
                    value={minimumStock}
                    onChange={(e) => setMinimumStock(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.minimumStock.hint" })}</p>
                </div>
              )}
              {trackInventory && (
                <div className="flex flex-col gap-1">
                  <Label className="invisible" aria-hidden>{intl.formatMessage({ id: "items.trackLots" })}</Label>
                  <label className="flex h-9 items-center gap-2 text-sm">
                    <input type="checkbox" checked={trackLots} disabled={trackingLocked} onChange={(e) => setTrackLots(e.target.checked)} />
                    {intl.formatMessage({ id: "items.trackLots" })}
                  </label>
                  <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.trackLots.hint" })}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {canTrack && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {([
            ["purchase", purchaseUnit, setPurchaseUnit, purchaseFactor, setPurchaseFactor],
            ["sales", salesUnit, setSalesUnit, salesFactor, setSalesFactor],
          ] as const).map(([kind, name, setName, factor, setFactor]) => (
            <div key={kind} className="contents">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`item-${kind}-unit`}>{intl.formatMessage({ id: `items.${kind}Unit` })}</Label>
                <Input id={`item-${kind}-unit`} maxLength={32} placeholder={intl.formatMessage({ id: "items.unitPlaceholder" })}
                  value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`item-${kind}-factor`}>{intl.formatMessage({ id: "items.unitFactor" }, { unit: unit || "—" })}</Label>
                <Input id={`item-${kind}-factor`} type="number" min="0" step="any" className="text-right tabular-nums"
                  disabled={!name.trim()} value={factor} onChange={(e) => setFactor(e.target.value)} />
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground sm:col-span-4">{intl.formatMessage({ id: "items.units.hint" })}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting || !name.trim() || !unit.trim()}>
          {submitting
            ? intl.formatMessage({ id: "common.saving" })
            : intl.formatMessage({ id: mode === "create" ? "items.addItem" : "common.save" })}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
        )}
      </div>
    </form>
  );
}
