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
import { Select } from "@/components/ui/select";
import { CreditStatusPanel } from "@/pages/sales/CreditStatusPanel";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { isExpenseAccountType, isIncomeAccountType } from "@/lib/ledger-enums";
import { taxesForPurchase, taxesForSale, taxRatePercentLabel } from "@/lib/tax-enums";

export type PartnerEntityType = "company" | "person";

export interface PartnerRegisterFormFields {
  name: string;
  taxNumber: string | null;
  isCustomer: boolean;
  isVendor: boolean;
  fiscalNumber: string | null;
  isVatRegistered: boolean;
  /** VAT number (Nr. i TVSH), required when isVatRegistered; null otherwise. */
  vatNumber: string | null;
  receivableAccountId: string | null;
  payableAccountId: string | null;
  paymentTermDays: number | null;
  creditLimit: number | null;
  // docs/POS_PLAN.md P6: the customer's own price list (customer lists only) and how many days an
  // invoice may be overdue before new orders are blocked (null = never).
  priceListId: string | null;
  /** 0 = retail, 1 = wholesale item prices (when no price list sets one). */
  priceTier: number;
  overdueBlockDays: number | null;
  // Client request 2026-11-23: what new document lines for this partner take when their item sets
  // nothing (null = the company default).
  defaultSaleTaxDefinitionId: string | null;
  defaultPurchaseTaxDefinitionId: string | null;
  defaultRevenueAccountId: string | null;
  defaultExpenseAccountId: string | null;
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
  errorOnTaxNumber?: boolean;
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

export function PartnerRegisterForm({ mode, accounts, initial, submitting, error, errorOnTaxNumber, onSubmit, onCancel, defaultRole, role, createButtonLabelKey, onDirtyChange }: PartnerRegisterFormProps) {
  const intl = useIntl();

  const [entityType, setEntityType] = useState<PartnerEntityType>(inferEntityType(initial));
  const [name, setName] = useState(initial?.name ?? "");
  const [taxNumber, setTaxNumber] = useState(initial?.taxNumber ?? "");
  const [fiscalNumber, setFiscalNumber] = useState(initial?.fiscalNumber ?? "");
  // Client request 2026-11-23: a partner is a customer or a supplier, never both. A partner saved
  // with both roles before the split keeps them here so the form can say so; the server refuses
  // to save it until one role is chosen (on the Customers/Suppliers pages Save stays disabled).
  const legacyBothRoles = mode === "edit" && !!initial?.isCustomer && !!initial?.isVendor;
  const [isCustomer, setIsCustomer] = useState(
    legacyBothRoles ? true : role ? role === "customer" : (initial?.isCustomer ?? defaultRole !== "vendor"),
  );
  const [isVendor, setIsVendor] = useState(
    legacyBothRoles ? true : role ? role === "vendor" : (initial?.isVendor ?? defaultRole === "vendor"),
  );
  const [isVatRegistered, setIsVatRegistered] = useState(initial?.isVatRegistered ?? false);
  const [vatNumber, setVatNumber] = useState(initial?.vatNumber ?? "");
  const vatNumberMissing = isVatRegistered && !vatNumber.trim();
  const [receivableAccountId, setReceivableAccountId] = useState(initial?.receivableAccountId ?? "");
  const [payableAccountId, setPayableAccountId] = useState(initial?.payableAccountId ?? "");
  const [paymentTermDays, setPaymentTermDays] = useState(initial?.paymentTermDays != null ? String(initial.paymentTermDays) : "");
  const [creditLimit, setCreditLimit] = useState(initial?.creditLimit != null ? String(initial.creditLimit) : "");
  const [priceListId, setPriceListId] = useState(initial?.priceListId ?? "");
  const [priceTier, setPriceTier] = useState(String(initial?.priceTier ?? 0));
  const [overdueBlockDays, setOverdueBlockDays] = useState(initial?.overdueBlockDays != null ? String(initial.overdueBlockDays) : "");
  const [defaultSaleTaxId, setDefaultSaleTaxId] = useState(initial?.defaultSaleTaxDefinitionId ?? "");
  const [defaultPurchaseTaxId, setDefaultPurchaseTaxId] = useState(initial?.defaultPurchaseTaxDefinitionId ?? "");
  const [defaultRevenueAccountId, setDefaultRevenueAccountId] = useState(initial?.defaultRevenueAccountId ?? "");
  const [defaultExpenseAccountId, setDefaultExpenseAccountId] = useState(initial?.defaultExpenseAccountId ?? "");
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
  }, [name, taxNumber, fiscalNumber, isCustomer, isVendor, isVatRegistered, vatNumber, receivableAccountId, payableAccountId, paymentTermDays, creditLimit, priceListId, priceTier, overdueBlockDays, entityType, email, phone, contactPerson, streetAddress, city, postalCode, country, defaultSaleTaxId, defaultPurchaseTaxId, defaultRevenueAccountId, defaultExpenseAccountId]);

  const { activeCompanyId } = useCompany();
  const taxes = useQuery({
    queryKey: ["taxes", activeCompanyId],
    queryFn: () => apiClient.taxes(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  }).data ?? [];
  const activeTaxes = taxes.filter((t) => t.isActive !== false);
  const lineAccountLabel = (a: AccountResponse) => `${a.code} · ${a.name}`;
  const revenueAccounts = accounts.filter((a) => isIncomeAccountType(a.accountType));
  const expenseAccounts = accounts.filter((a) => isExpenseAccountType(a.accountType));

  const receivableAccounts = accounts.filter((a) => a.accountType === AccountType.Receivable);
  // Bug fix: also include CurrentLiability accounts that have a Partner subledger (value 1),
  // so accounts seeded before v2 COA migration (which may not have AccountType.Payable) still show.
  const payableAccounts = accounts.filter(
    (a) => a.accountType === AccountType.Payable || (a.accountType === AccountType.CurrentLiability && a.subledger === 1),
  );

  // Auto-open collapsible sections when they already have data (edit mode).
  const hasContactData = hasAny(initial?.contactPerson, initial?.email, initial?.phone);
  const hasAddressData = hasAny(initial?.streetAddress, initial?.city, initial?.postalCode, initial?.country);
  const hasAccountingData = hasAny(initial?.isVatRegistered, initial?.receivableAccountId, initial?.payableAccountId, initial?.paymentTermDays, initial?.creditLimit,
    initial?.defaultSaleTaxDefinitionId, initial?.defaultPurchaseTaxDefinitionId, initial?.defaultRevenueAccountId, initial?.defaultExpenseAccountId);
  const hasDistributionData = hasAny(initial?.priceListId, initial?.overdueBlockDays, initial?.priceTier || undefined);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      taxNumber: entityType === "company" ? (taxNumber.trim() || null) : null,
      isCustomer,
      isVendor,
      fiscalNumber: entityType === "person" ? (fiscalNumber.trim() || null) : null,
      isVatRegistered,
      vatNumber: isVatRegistered ? vatNumber.trim() || null : null,
      receivableAccountId: receivableAccountId || null,
      payableAccountId: payableAccountId || null,
      paymentTermDays: paymentTermDays ? parseInt(paymentTermDays, 10) : null,
      creditLimit: creditLimit ? parseFloat(creditLimit) : null,
      priceListId: isCustomer ? priceListId || null : null,
      priceTier: isCustomer ? parseInt(priceTier, 10) : 0,
      overdueBlockDays: isCustomer && overdueBlockDays !== "" ? parseInt(overdueBlockDays, 10) : null,
      defaultSaleTaxDefinitionId: isCustomer ? defaultSaleTaxId || null : null,
      defaultPurchaseTaxDefinitionId: isVendor ? defaultPurchaseTaxId || null : null,
      defaultRevenueAccountId: isCustomer ? defaultRevenueAccountId || null : null,
      defaultExpenseAccountId: isVendor ? defaultExpenseAccountId || null : null,
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
      {error && !(errorOnTaxNumber && entityType === "company") && (
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

        {legacyBothRoles && (
          <Alert variant="destructive">
            <AlertDescription>{intl.formatMessage({ id: "partners.form.legacyBothRoles" })}</AlertDescription>
          </Alert>
        )}
        {((!defaultRole && !role) || legacyBothRoles) && (
          // The full partner list (hidden route), or a partner saved with both roles: pick exactly one.
          <div className="flex gap-2" role="radiogroup" aria-label={intl.formatMessage({ id: "partners.form.roleLabel" })}>
            <Button type="button" size="sm" role="radio" aria-checked={isCustomer} variant={isCustomer ? "default" : "outline"}
              onClick={() => { setIsCustomer(true); setIsVendor(false); }}>
              {intl.formatMessage({ id: "partners.form.isCustomer" })}
            </Button>
            <Button type="button" size="sm" role="radio" aria-checked={isVendor} variant={isVendor ? "default" : "outline"}
              onClick={() => { setIsVendor(true); setIsCustomer(false); }}>
              {intl.formatMessage({ id: "partners.form.isVendor" })}
            </Button>
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
              <Input id="partner-tax-number" inputMode="numeric" maxLength={64} value={taxNumber} aria-invalid={errorOnTaxNumber ? true : undefined} aria-describedby={errorOnTaxNumber ? "partner-tax-number-error" : undefined} onChange={(e) => setTaxNumber(e.target.value)} />
              {errorOnTaxNumber && error ? (
                <p id="partner-tax-number-error" role="alert" className="text-xs text-destructive">{error}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "partners.form.nuiHint" })}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <Label htmlFor="partner-fiscal-number">{intl.formatMessage({ id: "partners.form.fiscalNumber" })}</Label>
              <Input id="partner-fiscal-number" value={fiscalNumber} onChange={(e) => setFiscalNumber(e.target.value)} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Checkbox checked={isVatRegistered} onChange={(e) => setIsVatRegistered(e.target.checked)} />
            {intl.formatMessage({ id: "partnerForm.vatRegistered" })}
          </label>
          {isVatRegistered && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="partner-vat-number">
                {intl.formatMessage({ id: "partners.form.vatNumber" })} <span className="text-destructive">*</span>
              </Label>
              <Input id="partner-vat-number" required maxLength={64} value={vatNumber} aria-invalid={vatNumberMissing || undefined}
                onChange={(e) => setVatNumber(e.target.value)} />
              {vatNumberMissing && (
                <p className="text-xs text-destructive">{intl.formatMessage({ id: "partners.form.vatNumberRequired" })}</p>
              )}
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

          {/* Line defaults: what a new invoice/bill line takes when its item sets nothing. */}
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "partners.form.lineDefaultsHint" })}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {showCustomerFields && (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="partner-default-sale-tax">{intl.formatMessage({ id: "partners.form.defaultSaleTax" })}</Label>
                  <SearchableSelect
                    id="partner-default-sale-tax"
                    value={defaultSaleTaxId}
                    onChange={setDefaultSaleTaxId}
                    placeholder={intl.formatMessage({ id: "common.companyDefault" })}
                    searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                    noResultsText={intl.formatMessage({ id: "common.noResults" })}
                    emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
                    options={taxesForSale(activeTaxes).map((t) => ({ value: t.id, label: taxRatePercentLabel(t), description: t.code ?? undefined }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="partner-default-revenue">{intl.formatMessage({ id: "partners.form.defaultRevenueAccount" })}</Label>
                  <SearchableSelect
                    id="partner-default-revenue"
                    value={defaultRevenueAccountId}
                    onChange={setDefaultRevenueAccountId}
                    placeholder={intl.formatMessage({ id: "common.companyDefault" })}
                    searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                    noResultsText={intl.formatMessage({ id: "common.noResults" })}
                    emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
                    options={revenueAccounts.map((a) => ({ value: a.id, label: lineAccountLabel(a) }))}
                  />
                </div>
              </>
            )}
            {showVendorFields && (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="partner-default-purchase-tax">{intl.formatMessage({ id: "partners.form.defaultPurchaseTax" })}</Label>
                  <SearchableSelect
                    id="partner-default-purchase-tax"
                    value={defaultPurchaseTaxId}
                    onChange={setDefaultPurchaseTaxId}
                    placeholder={intl.formatMessage({ id: "common.companyDefault" })}
                    searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                    noResultsText={intl.formatMessage({ id: "common.noResults" })}
                    emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
                    options={taxesForPurchase(activeTaxes).map((t) => ({ value: t.id, label: taxRatePercentLabel(t), description: t.code ?? undefined }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="partner-default-expense">{intl.formatMessage({ id: "partners.form.defaultExpenseAccount" })}</Label>
                  <SearchableSelect
                    id="partner-default-expense"
                    value={defaultExpenseAccountId}
                    onChange={setDefaultExpenseAccountId}
                    placeholder={intl.formatMessage({ id: "common.companyDefault" })}
                    searchPlaceholder={intl.formatMessage({ id: "common.search" })}
                    noResultsText={intl.formatMessage({ id: "common.noResults" })}
                    emptyOptionLabel={intl.formatMessage({ id: "common.companyDefault" })}
                    options={expenseAccounts.map((a) => ({ value: a.id, label: lineAccountLabel(a) }))}
                  />
                </div>
              </>
            )}
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
              <Label htmlFor="partner-price-tier">{intl.formatMessage({ id: "partners.form.priceTier" })}</Label>
              <Select
                id="partner-price-tier"
                value={priceTier}
                onValueChange={(v) => setPriceTier(v || "0")}
                options={[
                  { value: "0", label: intl.formatMessage({ id: "partners.priceTier.retail" }) },
                  { value: "1", label: intl.formatMessage({ id: "partners.priceTier.wholesale" }) },
                ]}
              />
              <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "partners.form.priceTierHint" })}</p>
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
        <Button type="submit" disabled={submitting || !name.trim() || (!isCustomer && !isVendor) || (isCustomer && isVendor) || vatNumberMissing}>
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
