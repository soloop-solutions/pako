import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { AccountResponse, ItemCategoryResponse, ItemResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient } from "@/api/client";
import { useNumberPreview } from "@/hooks/useNumberPreview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useItemSearch } from "@/hooks/useStock";
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
  // docs/POS_PLAN.md §6.1 / P2: how the till sells the item.
  plu?: string;
  sellByWeight: boolean;
  openPrice: boolean;
  minimumAge?: number;
  depositItemId?: string;
  // P2: a serial number (IMEI) per unit sold, and the warranty it carries.
  trackSerials: boolean;
  warrantyMonths?: number;
  // docs/POS_PLAN.md P4 (services): booked on the calendar, sold as a package of sessions, or a membership plan.
  isBookable?: boolean;
  durationMinutes?: number;
  bufferMinutes?: number;
  packageServiceItemId?: string;
  packageSessions?: number;
  packageValidDays?: number;
  membershipDays?: number;
  // docs/POS_PLAN.md P7 (pharmacy): the medicine's classification, prescription and controlled
  // flags, and the state's maximum retail price per base unit.
  atcCode?: string;
  activeIngredient?: string;
  isPrescriptionOnly?: boolean;
  isControlled?: boolean;
  maxRetailPrice?: number;
  // P7 (agency): sold on behalf of a principal (a vendor) for a commission — e.g. phone top-ups.
  agencyPartnerId?: string;
  agencyCommissionPercent?: number;
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
  const { activeCompanyId } = useCompany();
  const nextCode = useNumberPreview(mode === "create" ? activeCompanyId ?? undefined : undefined, mode === "create" ? "Item" : undefined);

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
  // §6.1 P2: the till fields.
  const [plu, setPlu] = useState(initial?.plu ?? "");
  const [sellByWeight, setSellByWeight] = useState(initial?.sellByWeight ?? false);
  const [openPrice, setOpenPrice] = useState(initial?.openPrice ?? false);
  const [minimumAge, setMinimumAge] = useState(initial?.minimumAge != null ? String(initial.minimumAge) : "");
  const [depositItemId, setDepositItemId] = useState(initial?.depositItemId ?? "");
  const [trackSerials, setTrackSerials] = useState(initial?.trackSerials ?? false);
  const [warrantyMonths, setWarrantyMonths] = useState(initial?.warrantyMonths != null ? String(initial.warrantyMonths) : "");
  // P4: services.
  const [isBookable, setIsBookable] = useState(initial?.isBookable ?? false);
  const [duration, setDuration] = useState(initial?.durationMinutes != null ? String(initial.durationMinutes) : "");
  const [buffer, setBuffer] = useState(initial?.bufferMinutes != null ? String(initial.bufferMinutes) : "");
  const [packageOf, setPackageOf] = useState(initial?.packageServiceItemId ?? "");
  const [packageSessions, setPackageSessions] = useState(initial?.packageSessions != null ? String(initial.packageSessions) : "");
  const [packageValidDays, setPackageValidDays] = useState(initial?.packageValidDays != null ? String(initial.packageValidDays) : "");
  const [membershipDays, setMembershipDays] = useState(initial?.membershipDays != null ? String(initial.membershipDays) : "");
  // P7: pharmacy and agency.
  const [atcCode, setAtcCode] = useState(initial?.atcCode ?? "");
  const [activeIngredient, setActiveIngredient] = useState(initial?.activeIngredient ?? "");
  const [isPrescriptionOnly, setIsPrescriptionOnly] = useState(initial?.isPrescriptionOnly ?? false);
  const [isControlled, setIsControlled] = useState(initial?.isControlled ?? false);
  const [maxRetailPrice, setMaxRetailPrice] = useState(initial?.maxRetailPrice != null ? String(initial.maxRetailPrice) : "");
  const [agencyPartnerId, setAgencyPartnerId] = useState(initial?.agencyPartnerId ?? "");
  const [agencyCommission, setAgencyCommission] = useState(initial?.agencyCommissionPercent != null ? String(initial.agencyCommissionPercent) : "");
  const pharmacyRelevant = !!(initial?.atcCode || initial?.activeIngredient || initial?.isPrescriptionOnly || initial?.isControlled || initial?.maxRetailPrice != null);
  const agencyRelevant = !!initial?.agencyPartnerId;
  const vendors = (useQuery({
    queryKey: ["partners", activeCompanyId],
    queryFn: () => apiClient.partnersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  }).data ?? []).filter((p) => p.isVendor);
  const itemSearch = useItemSearch();
  const serviceSearch = useItemSearch();
  const packageKnown = !packageOf || serviceSearch.items.some((i) => i.id === packageOf);
  const savedPackageOf = useQuery({
    queryKey: ["items", activeCompanyId, "one", packageOf],
    queryFn: () => apiClient.itemsGET2(activeCompanyId as string, packageOf),
    enabled: !!activeCompanyId && !packageKnown,
  }).data;
  const packageOptions = useMemo(() => {
    // Not itself, and not a package (the server refuses both).
    const candidates = serviceSearch.items.filter((i) => i.id !== initial?.id && !i.packageServiceItemId);
    if (savedPackageOf && !candidates.some((i) => i.id === savedPackageOf.id)) candidates.unshift(savedPackageOf);
    return candidates.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, description: i.isBookable ? intl.formatMessage({ id: "svc.item.bookable" }) : undefined }));
  }, [serviceSearch.items, savedPackageOf, initial?.id, intl]);
  // The saved deposit item may not be among the searched ones: fetch it so the picker can name it.
  const depositKnown = !depositItemId || itemSearch.items.some((i) => i.id === depositItemId);
  const savedDeposit = useQuery({
    queryKey: ["items", activeCompanyId, "one", depositItemId],
    queryFn: () => apiClient.itemsGET2(activeCompanyId as string, depositItemId),
    enabled: !!activeCompanyId && !depositKnown,
  }).data;
  const depositOptions = useMemo(() => {
    // Not itself, and not an item that carries a deposit of its own (the server refuses both).
    const candidates = itemSearch.items.filter((i) => i.id !== initial?.id && !i.depositItemId);
    if (savedDeposit && !candidates.some((i) => i.id === savedDeposit.id)) candidates.unshift(savedDeposit);
    return candidates.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }));
  }, [itemSearch.items, savedDeposit, initial?.id]);

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
      plu: plu.trim() || undefined,
      sellByWeight,
      openPrice,
      minimumAge: minimumAge.trim() ? parseInt(minimumAge, 10) : undefined,
      depositItemId: depositItemId || undefined,
      trackSerials,
      warrantyMonths: warrantyMonths.trim() ? parseInt(warrantyMonths, 10) : undefined,
      isBookable,
      durationMinutes: isBookable && duration.trim() ? parseInt(duration, 10) : undefined,
      bufferMinutes: isBookable && buffer.trim() ? parseInt(buffer, 10) : undefined,
      packageServiceItemId: packageOf || undefined,
      packageSessions: packageOf && packageSessions.trim() ? parseInt(packageSessions, 10) : undefined,
      packageValidDays: packageOf && packageValidDays.trim() ? parseInt(packageValidDays, 10) : undefined,
      membershipDays: membershipDays.trim() ? parseInt(membershipDays, 10) : undefined,
      atcCode: atcCode.trim() || undefined,
      activeIngredient: activeIngredient.trim() || undefined,
      isPrescriptionOnly,
      isControlled,
      maxRetailPrice: maxRetailPrice.trim() ? parseFloat(maxRetailPrice) : undefined,
      agencyPartnerId: agencyPartnerId || undefined,
      agencyCommissionPercent: agencyPartnerId && agencyCommission.trim() ? parseFloat(agencyCommission) : undefined,
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {mode === "create" && nextCode && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {intl.formatMessage({ id: "items.nextCode" })}: <span className="font-medium">{nextCode}</span>
        </p>
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
          <Label htmlFor="item-revenue-account">{intl.formatMessage({ id: "items.form.revenueAccount" })} *</Label>
          <SearchableSelect
            id="item-revenue-account"
            value={revenueAccountId}
            onChange={setRevenueAccountId}
            placeholder={intl.formatMessage({ id: "items.form.selectAccount" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            options={incomeAccounts.map((account) => ({
              value: account.id,
              label: `${account.code} · ${account.name}`,
            }))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="item-expense-account">{intl.formatMessage({ id: "items.form.expenseAccount" })} *</Label>
          <SearchableSelect
            id="item-expense-account"
            value={expenseAccountId}
            onChange={setExpenseAccountId}
            placeholder={intl.formatMessage({ id: "items.form.selectAccount" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            options={expenseAccounts.map((account) => ({
              value: account.id,
              label: `${account.code} · ${account.name}`,
            }))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="item-inventory-account">{intl.formatMessage({ id: "items.form.inventoryAccount" })} *</Label>
          <SearchableSelect
            id="item-inventory-account"
            value={inventoryAccountId}
            onChange={setInventoryAccountId}
            placeholder={intl.formatMessage({ id: "items.form.selectAccount" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
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

      <fieldset className="flex flex-col gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{intl.formatMessage({ id: "items.till" })}</legend>
        <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.till.hint" })}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-plu">{intl.formatMessage({ id: "items.plu" })}</Label>
            <Input
              id="item-plu"
              inputMode="numeric"
              pattern="[0-9]{1,6}"
              maxLength={6}
              className="tabular-nums"
              value={plu}
              onChange={(e) => setPlu(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.plu.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-minimum-age">{intl.formatMessage({ id: "items.minimumAge" })}</Label>
            <Input
              id="item-minimum-age"
              type="number"
              min="1"
              max="99"
              step="1"
              className="text-right tabular-nums"
              value={minimumAge}
              onChange={(e) => setMinimumAge(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.minimumAge.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-deposit">{intl.formatMessage({ id: "items.depositItem" })}</Label>
            <SearchableSelect
              id="item-deposit"
              value={depositItemId}
              onChange={setDepositItemId}
              onSearchChange={itemSearch.onSearchChange}
              placeholder={intl.formatMessage({ id: "items.depositItem.none" })}
              searchPlaceholder={intl.formatMessage({ id: "common.search" })}
              noResultsText={intl.formatMessage({ id: "common.noResults" })}
              emptyOptionLabel={intl.formatMessage({ id: "items.depositItem.none" })}
              options={depositOptions}
            />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.depositItem.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={sellByWeight} onChange={(e) => setSellByWeight(e.target.checked)} />
              {intl.formatMessage({ id: "items.sellByWeight" })}
            </label>
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.sellByWeight.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={openPrice} onChange={(e) => setOpenPrice(e.target.checked)} />
              {intl.formatMessage({ id: "items.openPrice" })}
            </label>
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.openPrice.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={trackSerials} onChange={(e) => setTrackSerials(e.target.checked)} />
              {intl.formatMessage({ id: "items.trackSerials" })}
            </label>
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.trackSerials.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-warranty">{intl.formatMessage({ id: "items.warrantyMonths" })}</Label>
            <Input
              id="item-warranty"
              type="number"
              min="1"
              max="240"
              step="1"
              className="text-right tabular-nums"
              value={warrantyMonths}
              onChange={(e) => setWarrantyMonths(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.warrantyMonths.hint" })}</p>
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-md border p-3" data-testid="item-services">
        <legend className="px-1 text-sm font-medium">{intl.formatMessage({ id: "svc.item.section" })}</legend>
        <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "svc.item.hint" })}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={isBookable} onChange={(e) => setIsBookable(e.target.checked)} />
              {intl.formatMessage({ id: "svc.item.bookable" })}
            </label>
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "svc.item.bookable.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-duration">{intl.formatMessage({ id: "svc.item.duration" })}</Label>
            <Input id="item-duration" type="number" min="5" max="1440" step="1" className="text-right tabular-nums" disabled={!isBookable}
              required={isBookable} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-buffer">{intl.formatMessage({ id: "svc.item.buffer" })}</Label>
            <Input id="item-buffer" type="number" min="0" max="240" step="1" className="text-right tabular-nums" disabled={!isBookable}
              value={buffer} onChange={(e) => setBuffer(e.target.value)} />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "svc.item.buffer.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-package-of">{intl.formatMessage({ id: "svc.item.packageOf" })}</Label>
            <SearchableSelect
              id="item-package-of"
              value={packageOf}
              onChange={setPackageOf}
              onSearchChange={serviceSearch.onSearchChange}
              placeholder={intl.formatMessage({ id: "svc.item.packageOf.none" })}
              searchPlaceholder={intl.formatMessage({ id: "common.search" })}
              noResultsText={intl.formatMessage({ id: "common.noResults" })}
              emptyOptionLabel={intl.formatMessage({ id: "svc.item.packageOf.none" })}
              options={packageOptions}
            />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "svc.item.packageOf.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-package-sessions">{intl.formatMessage({ id: "svc.item.packageSessions" })}</Label>
            <Input id="item-package-sessions" type="number" min="1" max="1000" step="1" className="text-right tabular-nums" disabled={!packageOf}
              required={!!packageOf} value={packageSessions} onChange={(e) => setPackageSessions(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-package-valid">{intl.formatMessage({ id: "svc.item.packageValidDays" })}</Label>
            <Input id="item-package-valid" type="number" min="1" max="3650" step="1" className="text-right tabular-nums" disabled={!packageOf}
              value={packageValidDays} onChange={(e) => setPackageValidDays(e.target.value)} />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "svc.item.packageValidDays.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-membership-days">{intl.formatMessage({ id: "svc.item.membershipDays" })}</Label>
            <Input id="item-membership-days" type="number" min="1" max="3650" step="1" className="text-right tabular-nums"
              value={membershipDays} onChange={(e) => setMembershipDays(e.target.value)} />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "svc.item.membershipDays.hint" })}</p>
          </div>
        </div>
      </fieldset>

      {/* P7 pharmacy: collapsed unless the item already carries pharmacy data. */}
      <details className="group rounded-md border p-3" open={pharmacyRelevant} data-testid="item-pharmacy">
        <summary className="cursor-pointer text-sm font-medium">{intl.formatMessage({ id: "spec.item.pharmacy" })}</summary>
        <p className="mt-2 text-xs text-muted-foreground">{intl.formatMessage({ id: "spec.item.pharmacy.hint" })}</p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-atc">{intl.formatMessage({ id: "spec.item.atc" })}</Label>
            <Input id="item-atc" maxLength={10} placeholder="N02BE01" value={atcCode} onChange={(e) => setAtcCode(e.target.value.toUpperCase())} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-ingredient">{intl.formatMessage({ id: "spec.item.ingredient" })}</Label>
            <Input id="item-ingredient" maxLength={200} placeholder="paracetamol" value={activeIngredient} onChange={(e) => setActiveIngredient(e.target.value)} />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "spec.item.ingredient.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-max-price">{intl.formatMessage({ id: "spec.item.maxPrice" }, { unit: unit || "—" })}</Label>
            <Input id="item-max-price" type="number" min="0" step="0.01" className="text-right tabular-nums" value={maxRetailPrice}
              onChange={(e) => setMaxRetailPrice(e.target.value)} />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "spec.item.maxPrice.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={isPrescriptionOnly} onChange={(e) => setIsPrescriptionOnly(e.target.checked)} />
              {intl.formatMessage({ id: "spec.item.rxOnly" })}
            </label>
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "spec.item.rxOnly.hint" })}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={isControlled} onChange={(e) => setIsControlled(e.target.checked)} />
              {intl.formatMessage({ id: "spec.item.controlled" })}
            </label>
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "spec.item.controlled.hint" })}</p>
          </div>
        </div>
      </details>

      {/* P7 agency items: sold for a principal (a vendor) for a commission. */}
      <details className="group rounded-md border p-3" open={agencyRelevant} data-testid="item-agency">
        <summary className="cursor-pointer text-sm font-medium">{intl.formatMessage({ id: "spec.item.agency" })}</summary>
        <p className="mt-2 text-xs text-muted-foreground">{intl.formatMessage({ id: "spec.item.agency.hint" })}</p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="item-agency-partner">{intl.formatMessage({ id: "spec.item.agencyPartner" })}</Label>
            <SearchableSelect
              id="item-agency-partner"
              value={agencyPartnerId}
              onChange={setAgencyPartnerId}
              placeholder={intl.formatMessage({ id: "spec.item.agencyPartner.none" })}
              searchPlaceholder={intl.formatMessage({ id: "common.search" })}
              noResultsText={intl.formatMessage({ id: "common.noResults" })}
              emptyOptionLabel={intl.formatMessage({ id: "spec.item.agencyPartner.none" })}
              options={vendors.map((p) => ({ value: p.id, label: p.name, description: p.fiscalNumber ?? undefined }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-agency-commission">{intl.formatMessage({ id: "spec.item.agencyCommission" })}</Label>
            <Input id="item-agency-commission" type="number" min="0" max="100" step="0.01" className="text-right tabular-nums" disabled={!agencyPartnerId}
              value={agencyCommission} onChange={(e) => setAgencyCommission(e.target.value)} />
          </div>
        </div>
      </details>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting || !name.trim() || !unit.trim() || !revenueAccountId || !expenseAccountId || !inventoryAccountId}>
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
