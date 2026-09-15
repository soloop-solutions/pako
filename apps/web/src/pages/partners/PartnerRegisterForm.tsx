import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { AccountResponse } from "@pako/shared";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { AccountType } from "@/lib/ledger-enums";
import type { PartnerV2 } from "@/lib/partners";

// F6 — in "edit" mode, the 6 real fields (name/taxNumber/fiscalNumber/isCustomer/isVendor/
// isVatRegistered) are rendered disabled, not just editable-looking: PartnersController has no
// real edit endpoint, so an "edited" real field only ever updates the in-memory mock store — any
// other screen calling the same GET .../partners with the mock inactive (Invoicing.tsx/
// Bills.tsx) would keep showing the real, unedited backend value, and a page reload loses the
// mock's override entirely. Locking these 6 fields in the UI avoids silently implying a save that
// wouldn't actually be visible anywhere else. Only controlAccountId/paymentTermDays/creditLimit
// (genuinely mocked — no real field exists for them to diverge from) are editable here. Create
// mode is unaffected: all 8 fields go through the real POST there and stay fully editable.
export interface PartnerRegisterFormFields {
  name: string;
  taxNumber: string | null;
  isCustomer: boolean;
  isVendor: boolean;
  fiscalNumber: string | null;
  isVatRegistered: boolean;
  // F6 — MOCKED, see src/mocks/partnersMockFlag.ts. Not sent to the real backend.
  controlAccountId: string | null;
  paymentTermDays: number | null;
  creditLimit: number | null;
}

interface PartnerRegisterFormProps {
  mode: "create" | "edit";
  accounts: AccountResponse[];
  initial?: PartnerV2;
  submitting: boolean;
  error: string | null;
  onSubmit: (fields: PartnerRegisterFormFields) => void;
  onCancel?: () => void;
}

export function PartnerRegisterForm({ mode, accounts, initial, submitting, error, onSubmit, onCancel }: PartnerRegisterFormProps) {
  const intl = useIntl();

  const [name, setName] = useState(initial?.name ?? "");
  const [taxNumber, setTaxNumber] = useState(initial?.taxNumber ?? "");
  const [fiscalNumber, setFiscalNumber] = useState(initial?.fiscalNumber ?? "");
  const [isCustomer, setIsCustomer] = useState(initial?.isCustomer ?? true);
  const [isVendor, setIsVendor] = useState(initial?.isVendor ?? false);
  const [isVatRegistered, setIsVatRegistered] = useState(initial?.isVatRegistered ?? false);
  const [controlAccountId, setControlAccountId] = useState(initial?.controlAccountId ?? "");
  const [paymentTermDays, setPaymentTermDays] = useState(initial?.paymentTermDays != null ? String(initial.paymentTermDays) : "");
  const [creditLimit, setCreditLimit] = useState(initial?.creditLimit != null ? String(initial.creditLimit) : "");

  // A customer's control account is naturally a Receivable-type account, a vendor's a
  // Payable-type one. B13 widened AccountType to Odoo's real 19 values, which now has exact
  // Receivable/Payable types — narrower and more correct than the old "any Asset/Liability-class
  // account" filter this used before (that let someone pick e.g. a Cash account as a customer's
  // control account, flagged during the earlier F6 review as too broad for lack of a better field
  // at the time). One shared field rather than two separate ones, per FRONTEND_BRIEF's own "or
  // just one general control account" allowance — a partner that is both customer and vendor sees
  // both groups.
  const receivableAccounts = accounts.filter((a) => a.accountType === AccountType.Receivable);
  const payableAccounts = accounts.filter((a) => a.accountType === AccountType.Payable);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      taxNumber: taxNumber.trim() || null,
      isCustomer,
      isVendor,
      fiscalNumber: fiscalNumber.trim() || null,
      isVatRegistered,
      controlAccountId: controlAccountId || null,
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

      {mode === "edit" && (
        <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "partners.form.realFieldsLockedHint" })}</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="partner-name">{intl.formatMessage({ id: "partners.form.name" })}</Label>
          <Input id="partner-name" required disabled={mode === "edit"} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="partner-tax-number">{intl.formatMessage({ id: "partners.form.taxNumber" })}</Label>
          <Input id="partner-tax-number" disabled={mode === "edit"} value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="partner-fiscal-number">{intl.formatMessage({ id: "partners.form.fiscalNumber" })}</Label>
          <Input id="partner-fiscal-number" disabled={mode === "edit"} value={fiscalNumber} onChange={(e) => setFiscalNumber(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="partner-control-account">{intl.formatMessage({ id: "partners.form.controlAccount" })}</Label>
          <Select id="partner-control-account" value={controlAccountId} onChange={(e) => setControlAccountId(e.target.value)}>
            <option value="">{intl.formatMessage({ id: "common.companyDefault" })}</option>
            {isCustomer && receivableAccounts.length > 0 && (
              <optgroup label={intl.formatMessage({ id: "partners.form.receivableGroup" })}>
                {receivableAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {isVendor && payableAccounts.length > 0 && (
              <optgroup label={intl.formatMessage({ id: "partners.form.payableGroup" })}>
                {payableAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
          <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "partners.form.controlAccountHint" })}</p>
        </div>
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

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={mode === "edit"} checked={isCustomer} onChange={(e) => setIsCustomer(e.target.checked)} />
          {intl.formatMessage({ id: "partners.form.isCustomer" })}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={mode === "edit"} checked={isVendor} onChange={(e) => setIsVendor(e.target.checked)} />
          {intl.formatMessage({ id: "partners.form.isVendor" })}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={mode === "edit"} checked={isVatRegistered} onChange={(e) => setIsVatRegistered(e.target.checked)} />
          {intl.formatMessage({ id: "partnerForm.vatRegistered" })}
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting || !name.trim() || (!isCustomer && !isVendor)}>
          {submitting
            ? intl.formatMessage({ id: "common.saving" })
            : intl.formatMessage({ id: mode === "create" ? "partners.addPartner" : "common.save" })}
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
