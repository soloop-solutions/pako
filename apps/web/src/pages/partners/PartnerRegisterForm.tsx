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
import { usePriceLists } from "@/hooks/useDistribution";
import { CreditStatusPanel } from "@/pages/sales/CreditStatusPanel";

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
  // docs/POS_PLAN.md P6: the customer's own price list (customer lists only) and how many days an
  // invoice may be overdue before new orders are blocked (null = never).
  priceListId: string | null;
  overdueBlockDays: number | null;
  email: string | null;
  phone: string | null;
  contactPerson: string | null;
  streetAddress: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
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
  /** Edit the partner strictly as a customer or as a vendor: only that role's fields are shown. */
  role?: "customer" | "vendor";
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

/** True when any of the given fields have a non-empty value — used to auto-open sections. */
function hasAny(...values: (string | number | boolean | null | undefined)[]) {
  return values.some((v) => v != null && v !== "" && v !== false);
}

export function PartnerRegisterForm({ mode, accounts, initial, submitting, error, onSubmit, onCancel, defaultRole, role, createButtonLabelKey, onDirtyChange }: PartnerRegisterFormProps) {
  const intl = useIntl();

  const [entityType, setEntityType] = useState<PartnerEntityType>(inferEntityType(initial));
  const [name, setName] = useState(initial?.name ?? "");
  const [taxNumber, setTaxNumber] = useState(initial?.taxNumber ?? "");
  const [fiscalNumber, setFiscalNumber] = useState(initial?.fiscalNumber ?? "");
  const [isCustomer, setIsCustomer] = useState(role === "customer" ? true : (initial?.isCustomer ?? (defaultRole === "vendor" ? false : true)));
  const [isVendor, setIsVendor] = useState(role === "vendor" ? true : (initial?.isVendor ?? (defaultRole === "vendor" ? true : false)));
  const [isVatRegistered, setIsVatRegistered] = useState(initial?.isVatRegistered ?? false);
  const [receivableAccountId, setReceivableAccountId] = useState(initial?.receivableAccountId ?? "");
  const [payableAccountId, setPayableAccountId] = useState(initial?.payableAccountId ?? "");
  const [paymentTermDays, setPaymentTermDays] = useState(initial?.paymentTermDays != null ? String(initial.paymentTermDays) : "");
  const [creditLimit, setCreditLimit] = useState(initial?.creditLimit != null ? String(initial.creditLimit) : "");
  const [priceListId, setPriceListId] = useState(initial?.priceListId ?? "");
  const [overdueBlockDays, setOverdueBlockDays] = useState(initial?.overdueBlockDays != null ? String(initial.overdueBlockDays) : "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson ?? "");
  const [streetAddress, setStreetAddress] = useState(initial?.streetAddress ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [postalCode, setPostalCode] = useState(initial?.postalCode ?? "");
  const [country, setCountry] = useState(initial?.country ?? "");
  const showCustomerFields = role ? role === "customer" : isCustomer;
  const showVendorFields = role ? role === "vendor" : isVendor;
  const customerLists = (usePriceLists().data ?? []).filter((l) => l.isCustomerList && (l.isActive || l.id === initial?.priceListId));

  useEffect(() => {
    onDirtyChange?.(true);
  // only on field changes, not initial render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, taxNumber, fiscalNumber, isCustomer, isVendor, isVatRegistered, receivableAccountId, payableAccountId, paymentTermDays, creditLimit, priceListId, overdueBlockDays, entityType, email, phone, contactPerson, streetAddress, city, postalCode, country]);

  const receivableAccounts = accounts.filter((a) => a.accountType === AccountType.Receivable);
  // Bug fix: also include CurrentLiability accounts that have a Partner subledger (value 1),
  // so accounts seeded before v2 COA migration (which may not have AccountType.Payable) still show.
  const payableAccounts = accounts.filter(
    (a) => a.accountType === AccountType.Payable || (a.accountType === AccountType.CurrentLiability && a.subledger === 1),
  );

  // Auto-open collapsible sections when they already have data (edit mode).
  const hasContactData = hasAny(initial?.contactPerson, initial?.email, initial?.phone);
  const hasAddressData = hasAny(initial?.streetAddress, initial?.city, initial?.postalCode, initial?.country);
  const hasAccountingData = hasAny(initial?.isVatRegistered, initial?.receivableAccountId, initial?.payableAccountId, initial?.paymentTermDays, initial?.creditLimit);
  const hasDistributionData = hasAny(initial?.priceListId, initial?.overdueBlockDays);

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
      priceListId: isCustomer ? priceListId || null : null,
      overdueBlockDays: isCustomer && overdueBlockDays !== "" ? parseInt(overdueBlockDays, 10) : null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      contactPerson: contactPerson.trim() || null,
      streetAddress: streetAddress.trim() || null,
      city: city.trim() || null,
      postalCode: postalCode.trim() || null,
      country: country.trim() || null,
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Identity ── always visible, the essential fields */}
      <fieldset className="flex flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{intl.formatMessage({ id: "partners.form.identitySection" })}</legend>

        <div className="flex flex-col gap-1">
          <Label>{intl.formatMessage({ id: "partners.form.entityType" })}</Label>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={entityType === "company" ? "default" : "outline"} onClick={() => setEntityType("company")}>
              {intl.formatMessage({ id: "partners.form.entityCompany" })}
            </Button>
            <Button type="button" size="sm" variant={entityType === "person" ? "default" : "outline"} onClick={() => setEntityType("person")}>
              {intl.formatMessage({ id: "partners.form.entityPerson" })}
            </Button>
          </div>
        </div>

        {role && (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={role === "customer" ? isVendor : isCustomer}
                onChange={(e) => (role === "customer" ? setIsVendor(e.target.checked) : setIsCustomer(e.target.checked))}
              />
              {intl.formatMessage({ id: role === "customer" ? "partners.form.alsoVendor" : "partners.form.alsoCustomer" })}
            </label>
            <p className="text-xs text-muted-foreground">
              {intl.formatMessage({ id: role === "customer" ? "partners.form.alsoVendorHint" : "partners.form.alsoCustomerHint" })}
            </p>
          </div>
        )}
        {!defaultRole && !role && (
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="partner-name">
              {intl.formatMessage({ id: "partners.form.name" })} <span className="text-destructive">*</span>
            </Label>
            <Input id="partner-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {entityType === "company" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="partner-tax-number">{intl.formatMessage({ id: "partners.form.nui" })}</Label>
              <Input id="partner-tax-number" inputMode="numeric" maxLength={64} value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "partners.form.nuiHint" })}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <Label htmlFor="partner-fiscal-number">{intl.formatMessage({ id: "partners.form.fiscalNumber" })}</Label>
              <Input id="partner-fiscal-number" value={fiscalNumber} onChange={(e) => setFiscalNumber(e.target.value)} />
            </div>
          )}
        </div>
      </fieldset>

      {/* ── Contact ── collapsible, open if data exists */}
      <details className="group rounded-md border p-3" open={hasContactData || undefined}>
        <summary className="cursor-pointer text-sm font-medium">{intl.formatMessage({ id: "partners.form.contactSection" })}</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="partner-contact-person">{intl.formatMessage({ id: "partners.form.contactPerson" })}</Label>
            <Input id="partner-contact-person" maxLength={256} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="partner-email">{intl.formatMessage({ id: "partners.form.email" })}</Label>
            <Input id="partner-email" type="email" maxLength={256} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="partner-phone">{intl.formatMessage({ id: "partners.form.phone" })}</Label>
            <Input id="partner-phone" type="tel" maxLength={50} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
      </details>

      {/* ── Address ── collapsible, closed by default on create */}
      <details className="group rounded-md border p-3" open={hasAddressData || undefined}>
        <summary className="cursor-pointer text-sm font-medium">{intl.formatMessage({ id: "partners.form.addressSection" })}</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="partner-street">{intl.formatMessage({ id: "partners.form.streetAddress" })}</Label>
            <Input id="partner-street" maxLength={512} value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="partner-city">{intl.formatMessage({ id: "partners.form.city" })}</Label>
            <Input id="partner-city" maxLength={128} value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="partner-postal-code">{intl.formatMessage({ id: "partners.form.postalCode" })}</Label>
              <Input id="partner-postal-code" maxLength={32} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="partner-country">{intl.formatMessage({ id: "partners.form.country" })}</Label>
              <Input id="partner-country" maxLength={100} value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
          </div>
        </div>
      </details>

      {/* ── Accounting ── collapsible, open if data exists or editing */}
      <details className="group rounded-md border p-3" open={hasAccountingData || undefined}>
        <summary className="cursor-pointer text-sm font-medium">{intl.formatMessage({ id: "partners.form.accountingSection" })}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isVatRegistered} onChange={(e) => setIsVatRegistered(e.target.checked)} />
            {intl.formatMessage({ id: "partnerForm.vatRegistered" })}
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {showCustomerFields && (
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
            {showVendorFields && (
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
            {showCustomerFields && <div className="flex flex-col gap-1">
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
            </div>}
          </div>
        </div>
      </details>

      {/* ── Distribution ── collapsible, customers only, closed by default */}
      {showCustomerFields && (
        <details className="group rounded-md border p-3" open={hasDistributionData || undefined}>
          <summary className="cursor-pointer text-sm font-medium">{intl.formatMessage({ id: "partners.form.distributionSection" })}</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="partner-price-list">{intl.formatMessage({ id: "dist.partner.priceList" })}</Label>
              <SearchableSelect
                id="partner-price-list"
                value={priceListId}
                onChange={setPriceListId}
                placeholder={intl.formatMessage({ id: "dist.partner.noPriceList" })}
                emptyOptionLabel={intl.formatMessage({ id: "dist.partner.noPriceList" })}
                searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                noResultsText={intl.formatMessage({ id: "common.noResults" })}
                options={[
                  ...customerLists.map((l) => ({ value: l.id, label: l.name })),
                  ...(priceListId && !customerLists.some((l) => l.id === priceListId) ? [{ value: priceListId, label: priceListId }] : []),
                ]}
              />
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "dist.partner.priceListHint" })}</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="partner-overdue-block">{intl.formatMessage({ id: "dist.partner.overdueBlockDays" })}</Label>
              <Input
                id="partner-overdue-block"
                type="number"
                min="0"
                step="1"
                value={overdueBlockDays}
                onChange={(e) => setOverdueBlockDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "dist.partner.overdueBlockDaysHint" })}</p>
            </div>
            {mode === "edit" && initial?.isCustomer && <CreditStatusPanel partnerId={initial.id} />}
          </div>
        </details>
      )}

      {/* ── Actions ── */}
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
