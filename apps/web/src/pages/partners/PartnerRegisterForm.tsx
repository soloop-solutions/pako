import { useEffect, useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse, PartnerResponse } from "@pako/shared";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { AccountType } from "@/lib/ledger-enums";

export type PartnerEntityType = "company" | "person";

export interface PartnerRegisterFormFields {
  name: string;
  taxNumber: string | null;
  isCustomer: boolean;
  isVendor: boolean;
  fiscalNumber: string | null;
  isVatRegistered: boolean;
  receivableAccountId: string | null;
  payableAccountId: string | null;
  paymentTermDays: number | null;
  creditLimit: number | null;
}

export interface PartnerRegisterFormProps {
  mode: "create" | "edit";
  accounts: AccountResponse[];
  initial?: PartnerResponse;
  submitting: boolean;
  error: string | null;
  onSubmit: (fields: PartnerRegisterFormFields) => void;
  onCancel?: () => void;
  /** Pre-select a role when creating from the Customers or Vendors page. */
  defaultRole?: "customer" | "vendor";
  /** Label override for the submit button in create mode. */
  createButtonLabelKey?: string;
  /** Called when form dirty state changes (for unsaved-changes protection). */
  onDirtyChange?: (dirty: boolean) => void;
}

function inferEntityType(initial?: PartnerResponse): PartnerEntityType {
  if (!initial) return "company";
  if (initial.fiscalNumber && !initial.taxNumber) return "person";
  return "company";
}

export function PartnerRegisterForm({ mode, accounts, initial, submitting, error, onSubmit, onCancel, defaultRole, createButtonLabelKey, onDirtyChange }: PartnerRegisterFormProps) {
  const intl = useIntl();

  const [entityType, setEntityType] = useState<PartnerEntityType>(inferEntityType(initial));
  const [name, setName] = useState(initial?.name ?? "");
  const [taxNumber, setTaxNumber] = useState(initial?.taxNumber ?? "");
  const [fiscalNumber, setFiscalNumber] = useState(initial?.fiscalNumber ?? "");
  const [isCustomer, setIsCustomer] = useState(initial?.isCustomer ?? (defaultRole === "vendor" ? false : true));
  const [isVendor, setIsVendor] = useState(initial?.isVendor ?? (defaultRole === "vendor" ? true : false));
  const [isVatRegistered, setIsVatRegistered] = useState(initial?.isVatRegistered ?? false);
  const [receivableAccountId, setReceivableAccountId] = useState(initial?.receivableAccountId ?? "");
  const [payableAccountId, setPayableAccountId] = useState(initial?.payableAccountId ?? "");
  const [paymentTermDays, setPaymentTermDays] = useState(initial?.paymentTermDays != null ? String(initial.paymentTermDays) : "");
  const [creditLimit, setCreditLimit] = useState(initial?.creditLimit != null ? String(initial.creditLimit) : "");

  useEffect(() => {
    onDirtyChange?.(true);
  // only on field changes, not initial render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, taxNumber, fiscalNumber, isCustomer, isVendor, isVatRegistered, receivableAccountId, payableAccountId, paymentTermDays, creditLimit, entityType]);

  const receivableAccounts = accounts.filter((a) => a.accountType === AccountType.Receivable);
  // Bug fix: also include CurrentLiability accounts that have a Partner subledger (value 1),
  // so accounts seeded before v2 COA migration (which may not have AccountType.Payable) still show.
  const payableAccounts = accounts.filter(
    (a) => a.accountType === AccountType.Payable || (a.accountType === AccountType.CurrentLiability && a.subledger === 1),
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      taxNumber: entityType === "company" ? (taxNumber.trim() || null) : null,
      isCustomer,
      isVendor,
      fiscalNumber: entityType === "person" ? (fiscalNumber.trim() || null) : null,
      isVatRegistered,
      receivableAccountId: receivableAccountId || null,
      payableAccountId: payableAccountId || null,
      paymentTermDays: paymentTermDays ? parseInt(paymentTermDays, 10) : null,
      creditLimit: creditLimit ? parseFloat(creditLimit) : null,
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* --- Entity type (Company / Person) --- */}
      <div className="flex flex-col gap-1">
        <Label>{intl.formatMessage({ id: "partners.form.entityType" })}</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={entityType === "company" ? "default" : "outline"}
            onClick={() => setEntityType("company")}
          >
            {intl.formatMessage({ id: "partners.form.entityCompany" })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={entityType === "person" ? "default" : "outline"}
            onClick={() => setEntityType("person")}
          >
            {intl.formatMessage({ id: "partners.form.entityPerson" })}
          </Button>
        </div>
      </div>

      {/* --- Role (only when no defaultRole — i.e. from /partners page) --- */}
      {!defaultRole && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isCustomer} onChange={(e) => setIsCustomer(e.target.checked)} />
            {intl.formatMessage({ id: "partners.form.isCustomer" })}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isVendor} onChange={(e) => setIsVendor(e.target.checked)} />
            {intl.formatMessage({ id: "partners.form.isVendor" })}
          </label>
        </div>
      )}

      {/* --- Identity --- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="partner-name">
            {intl.formatMessage({ id: "partners.form.name" })} <span className="text-destructive">*</span>
          </Label>
          <Input id="partner-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {entityType === "company" ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="partner-tax-number">{intl.formatMessage({ id: "partners.form.taxNumber" })}</Label>
            <Input id="partner-tax-number" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor="partner-fiscal-number">{intl.formatMessage({ id: "partners.form.fiscalNumber" })}</Label>
            <Input id="partner-fiscal-number" value={fiscalNumber} onChange={(e) => setFiscalNumber(e.target.value)} />
          </div>
        )}
      </div>

      {/* --- Accounting --- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isVatRegistered} onChange={(e) => setIsVatRegistered(e.target.checked)} />
          {intl.formatMessage({ id: "partnerForm.vatRegistered" })}
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {isCustomer && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="partner-receivable-account">{intl.formatMessage({ id: "partners.form.receivableAccount" })}</Label>
            <SearchableSelect
              id="partner-receivable-account"
              value={receivableAccountId}
              onChange={setReceivableAccountId}
              placeholder={intl.formatMessage({ id: "common.companyDefault" })}
              searchPlaceholder={intl.formatMessage({ id: "common.search" })}
              noResultsText={intl.formatMessage({ id: "common.noResults" })}
              emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
              options={receivableAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
            />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "partners.form.receivableAccountHint" })}</p>
          </div>
        )}
        {isVendor && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="partner-payable-account">{intl.formatMessage({ id: "partners.form.payableAccount" })}</Label>
            <SearchableSelect
              id="partner-payable-account"
              value={payableAccountId}
              onChange={setPayableAccountId}
              placeholder={intl.formatMessage({ id: "common.companyDefault" })}
              searchPlaceholder={intl.formatMessage({ id: "common.search" })}
              noResultsText={intl.formatMessage({ id: "common.noResults" })}
              emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
              options={payableAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
            />
            <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "partners.form.payableAccountHint" })}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="partner-payment-term-days">{intl.formatMessage({ id: "partners.form.paymentTermDays" })}</Label>
          <Input
            id="partner-payment-term-days"
            type="number"
            min="0"
            step="1"
            value={paymentTermDays}
            onChange={(e) => setPaymentTermDays(e.target.value)}
            placeholder="30"
          />
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "partners.form.paymentTermDaysHint" })}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="partner-credit-limit">{intl.formatMessage({ id: "partners.form.creditLimit" })}</Label>
          <Input
            id="partner-credit-limit"
            type="number"
            min="0"
            step="0.01"
            value={creditLimit}
            onChange={(e) => setCreditLimit(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      {/* --- Actions --- */}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting || !name.trim() || (!isCustomer && !isVendor)}>
          {submitting
            ? intl.formatMessage({ id: "common.saving" })
            : intl.formatMessage({ id: mode === "create" ? (createButtonLabelKey ?? "partners.addPartner") : "common.save" })}
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
