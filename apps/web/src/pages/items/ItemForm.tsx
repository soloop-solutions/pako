import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse, TaxDefinitionResponse } from "@pako/shared";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ITEM_TYPE_OPTION_KEYS, ItemType, type ItemWithType } from "@/lib/item-types";
import { taxRatePercentLabel } from "@/lib/tax-enums";

export interface ItemFormFields {
  name: string;
  unit: string;
  defaultUnitPrice?: number;
  defaultTaxDefinitionId?: string;
  defaultRevenueAccountId?: string;
  defaultExpenseAccountId?: string;
  // F5 — MOCKED, see src/lib/item-types.ts. Not sent to the real backend.
  type: number;
}

interface ItemFormProps {
  mode: "create" | "edit";
  taxes: TaxDefinitionResponse[];
  incomeAccounts: AccountResponse[];
  expenseAccounts: AccountResponse[];
  initial?: ItemWithType;
  submitting: boolean;
  error: string | null;
  onSubmit: (fields: ItemFormFields) => void;
  onCancel?: () => void;
}

export function ItemForm({ mode, taxes, incomeAccounts, expenseAccounts, initial, submitting, error, onSubmit, onCancel }: ItemFormProps) {
  const intl = useIntl();

  const [name, setName] = useState(initial?.name ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [price, setPrice] = useState(initial?.defaultUnitPrice != null ? String(initial.defaultUnitPrice) : "");
  const [type, setType] = useState<number>(initial?.type ?? ItemType.Goods);
  const [taxId, setTaxId] = useState(initial?.defaultTaxDefinitionId ?? "");
  const [revenueAccountId, setRevenueAccountId] = useState(initial?.defaultRevenueAccountId ?? "");
  const [expenseAccountId, setExpenseAccountId] = useState(initial?.defaultExpenseAccountId ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      unit: unit.trim(),
      defaultUnitPrice: price ? parseFloat(price) : undefined,
      defaultTaxDefinitionId: taxId || undefined,
      defaultRevenueAccountId: revenueAccountId || undefined,
      defaultExpenseAccountId: expenseAccountId || undefined,
      type,
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
          <Select id="item-type" value={type} onChange={(e) => setType(Number(e.target.value))}>
            {ITEM_TYPE_OPTION_KEYS.map((option) => (
              <option key={option.value} value={option.value}>
                {intl.formatMessage({ id: option.labelKey })}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "items.form.typeHint" })}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="item-tax">{intl.formatMessage({ id: "items.form.vatCode" })}</Label>
          <Select id="item-tax" value={taxId} onChange={(e) => setTaxId(e.target.value)}>
            <option value="">{intl.formatMessage({ id: "items.form.noVatCode" })}</option>
            {taxes.map((tax) => (
              <option key={tax.id} value={tax.id}>
                {taxRatePercentLabel(tax)}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="item-revenue-account">{intl.formatMessage({ id: "items.form.revenueAccount" })}</Label>
          <Select id="item-revenue-account" value={revenueAccountId} onChange={(e) => setRevenueAccountId(e.target.value)}>
            <option value="">{intl.formatMessage({ id: "common.companyDefault" })}</option>
            {incomeAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="item-expense-account">{intl.formatMessage({ id: "items.form.expenseAccount" })}</Label>
          <Select id="item-expense-account" value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)}>
            <option value="">{intl.formatMessage({ id: "common.companyDefault" })}</option>
            {expenseAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

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
