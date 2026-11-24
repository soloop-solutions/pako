import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { ItemResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useMyAccess } from "@/hooks/useMyAccess";
import { AccountType, isExpenseAccountType, isIncomeAccountType } from "@/lib/ledger-enums";

type QuickItemFormProps = {
  companyId: string;
  items?: ItemResponse[];
  showPrice?: boolean;
  onCreated: (item: ItemResponse) => void;
};

type AccountChoice = { revenue?: string; expense?: string; inventory?: string };

export function QuickItemForm({ companyId, items = [], showPrice = true, onCreated }: QuickItemFormProps) {
  const intl = useIntl();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [defaultUnitPrice, setDefaultUnitPrice] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const { canSee } = useMyAccess();
  const canTrack = canSee("inventory");
  const [trackInventory, setTrackInventory] = useState(true);
  const [chosen, setChosen] = useState<AccountChoice>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const accountsData = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: () => apiClient.accountsAll(companyId),
  }).data;
  const categories = useQuery({
    queryKey: ["itemCategories", companyId],
    queryFn: () => apiClient.listItemCategories(companyId),
  }).data ?? [];

  const usable = useMemo(() => (accountsData ?? []).filter((a) => a.isActive && a.isPostable), [accountsData]);
  const incomeAccounts = useMemo(() => usable.filter((a) => isIncomeAccountType(a.accountType)), [usable]);
  const expenseAccounts = useMemo(() => usable.filter((a) => isExpenseAccountType(a.accountType)), [usable]);
  const inventoryAccounts = useMemo(() => usable.filter((a) => a.accountType === AccountType.CurrentAsset), [usable]);

  const lastItem = useMemo(
    () => items
      .filter((i) => i.defaultRevenueAccountId && i.defaultExpenseAccountId && i.defaultInventoryAccountId)
      .sort((a, b) => b.code - a.code)[0],
    [items],
  );
  const category = categories.find((c) => c.id === categoryId);

  function pick(list: { id: string }[], ...candidates: (string | undefined)[]) {
    return candidates.find((id) => id && list.some((a) => a.id === id)) ?? "";
  }
  const revenueAccountId = pick(incomeAccounts, chosen.revenue, category?.revenueAccountId, lastItem?.defaultRevenueAccountId);
  const expenseAccountId = pick(expenseAccounts, chosen.expense, category?.expenseAccountId, lastItem?.defaultExpenseAccountId);
  const inventoryAccountId = pick(inventoryAccounts, chosen.inventory, category?.inventoryAccountId, lastItem?.defaultInventoryAccountId);

  const unitNumeric = /^\d+$/.test(unit.trim());
  const ready = name.trim().length > 0 && !unitNumeric && !!revenueAccountId && !!expenseAccountId && !!inventoryAccountId;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!ready) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiClient.itemsPOST(companyId, {
        name: name.trim(),
        unit: unit.trim() || "pcs",
        type: 0,
        defaultUnitPrice: defaultUnitPrice ? parseFloat(defaultUnitPrice) : undefined,
        trackInventory: canTrack && trackInventory,
        categoryId: categoryId || undefined,
        defaultRevenueAccountId: revenueAccountId,
        defaultExpenseAccountId: expenseAccountId,
        defaultInventoryAccountId: inventoryAccountId,
      });
      onCreated(result);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "quickItem.createError" })));
    } finally {
      setSubmitting(false);
    }
  }

  const accountOptions = (list: { id: string; code: string; name: string }[]) =>
    list.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const selectProps = {
    placeholder: intl.formatMessage({ id: "items.form.selectAccount" }),
    searchPlaceholder: intl.formatMessage({ id: "common.search" }),
    noResultsText: intl.formatMessage({ id: "common.noResults" }),
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FormField label={intl.formatMessage({ id: "quickItem.name" })} htmlFor="quick-item-name" required>
        <Input id="quick-item-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={intl.formatMessage({ id: "quickItem.unit" })} htmlFor="quick-item-unit" error={unitNumeric ? intl.formatMessage({ id: "items.unitNumeric" }) : undefined}>
          <Input id="quick-item-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs" />
        </FormField>
        {showPrice && (
          <FormField label={intl.formatMessage({ id: "quickItem.defaultPrice" })} htmlFor="quick-item-price">
            <Input id="quick-item-price" type="number" step="0.01" min="0" value={defaultUnitPrice} onChange={(e) => setDefaultUnitPrice(e.target.value)} />
          </FormField>
        )}
      </div>
      {canTrack && (
        <label className="flex items-center gap-2 text-sm" title={intl.formatMessage({ id: "items.trackInventory.hint" })}>
          <Checkbox id="quick-item-track" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} />
          {intl.formatMessage({ id: "items.trackInventory" })}
        </label>
      )}
      <FormField label={intl.formatMessage({ id: "items.category" })} htmlFor="quick-item-category">
        <SearchableSelect
          id="quick-item-category"
          value={categoryId}
          onChange={setCategoryId}
          placeholder={intl.formatMessage({ id: "items.noCategory" })}
          searchPlaceholder={intl.formatMessage({ id: "common.search" })}
          noResultsText={intl.formatMessage({ id: "common.noResults" })}
          emptyOptionLabel={intl.formatMessage({ id: "items.noCategory" })}
          options={categories.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))}
        />
      </FormField>
      <FormField label={intl.formatMessage({ id: "items.form.revenueAccount" })} htmlFor="quick-item-revenue-account" required>
        <SearchableSelect id="quick-item-revenue-account" value={revenueAccountId} onChange={(v) => setChosen((c) => ({ ...c, revenue: v }))}
          options={accountOptions(incomeAccounts)} {...selectProps} />
      </FormField>
      <FormField label={intl.formatMessage({ id: "items.form.expenseAccount" })} htmlFor="quick-item-expense-account" required>
        <SearchableSelect id="quick-item-expense-account" value={expenseAccountId} onChange={(v) => setChosen((c) => ({ ...c, expense: v }))}
          options={accountOptions(expenseAccounts)} {...selectProps} />
      </FormField>
      <FormField label={intl.formatMessage({ id: "items.form.inventoryAccount" })} htmlFor="quick-item-inventory-account" required>
        <SearchableSelect id="quick-item-inventory-account" value={inventoryAccountId} onChange={(v) => setChosen((c) => ({ ...c, inventory: v }))}
          options={accountOptions(inventoryAccounts)} {...selectProps} />
      </FormField>
      <Button type="submit" disabled={submitting || !ready}>
        {submitting ? intl.formatMessage({ id: "common.saving" }) : intl.formatMessage({ id: "quickItem.create" })}
      </Button>
    </form>
  );
}
