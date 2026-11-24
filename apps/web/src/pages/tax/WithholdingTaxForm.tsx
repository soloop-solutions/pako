import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { WithholdingTaxEntryResponse } from "@pako/shared";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export interface WithholdingTaxFormFields {
  personalNumber: string;
  name: string;
  grossInterest: number;
  propertyRights: number;
  lotteryWinnings: number;
  grossRent: number;
  nonResidentEntertainer: number;
  nonResidentServices: number;
  nonEntrepreneur: number;
  rentalAreaM2?: number;
  monthlyGrossRent?: number;
  country: string;
}

interface WithholdingTaxFormProps {
  mode: "create" | "edit";
  countries: string[];
  defaultCountry: string;
  initial?: WithholdingTaxEntryResponse;
  submitting: boolean;
  error: string | null;
  onSubmit: (fields: WithholdingTaxFormFields) => void;
  onCancel?: () => void;
}

function amountText(value: number | undefined): string {
  return value ? String(value) : "";
}

function amountValue(text: string): number {
  return text ? parseFloat(text) || 0 : 0;
}

type PaymentType = "rent" | "interest" | "propertyRights" | "lottery" | "nonEntrepreneur" | "nonResident";

const PAYMENT_TYPES: PaymentType[] = ["rent", "interest", "propertyRights", "lottery", "nonEntrepreneur", "nonResident"];

function detectTypes(initial?: WithholdingTaxEntryResponse): Set<PaymentType> {
  const types = new Set<PaymentType>();
  if (initial?.grossRent) types.add("rent");
  if (initial?.grossInterest) types.add("interest");
  if (initial?.propertyRights) types.add("propertyRights");
  if (initial?.lotteryWinnings) types.add("lottery");
  if (initial?.nonEntrepreneur) types.add("nonEntrepreneur");
  if (initial?.nonResidentEntertainer || initial?.nonResidentServices) types.add("nonResident");
  if (types.size === 0) types.add("rent");
  return types;
}

export function WithholdingTaxForm({
  mode,
  countries,
  defaultCountry,
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
}: WithholdingTaxFormProps) {
  const intl = useIntl();

  const [personalNumber, setPersonalNumber] = useState(initial?.personalNumber ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [selectedTypes, setSelectedTypes] = useState<Set<PaymentType>>(() => detectTypes(initial));
  const [interest, setInterest] = useState(amountText(initial?.grossInterest));
  const [propertyRights, setPropertyRights] = useState(amountText(initial?.propertyRights));
  const [lottery, setLottery] = useState(amountText(initial?.lotteryWinnings));
  const [rent, setRent] = useState(amountText(initial?.grossRent));
  const [entertainer, setEntertainer] = useState(amountText(initial?.nonResidentEntertainer));
  const [services, setServices] = useState(amountText(initial?.nonResidentServices));
  const [nonEntrepreneur, setNonEntrepreneur] = useState(amountText(initial?.nonEntrepreneur));
  const [area, setArea] = useState(amountText(initial?.rentalAreaM2));
  const [monthlyRent, setMonthlyRent] = useState(amountText(initial?.monthlyGrossRent));
  const [monthlyEdited, setMonthlyEdited] = useState(
    !!initial?.monthlyGrossRent && initial.monthlyGrossRent !== initial.grossRent,
  );
  const [country, setCountry] = useState(initial?.country ?? defaultCountry);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  const has = (type: PaymentType) => selectedTypes.has(type);
  const hasRent = has("rent") && amountValue(rent) > 0;
  const areaMissing = hasRent && amountValue(area) <= 0;
  const cleanPersonalNumber = personalNumber.replace(/\s/g, "");
  const personalNumberInvalid = cleanPersonalNumber !== "" && !/^\d{9,10}$/.test(cleanPersonalNumber);

  function clearFieldError(field: string) {
    setFieldErrors((prev) => ({ ...prev, [field]: null }));
  }

  function toggleType(type: PaymentType) {
    const next = new Set(selectedTypes);
    if (next.has(type)) {
      next.delete(type);
      if (type === "rent") { setRent(""); setArea(""); setMonthlyRent(""); setMonthlyEdited(false); }
      if (type === "interest") setInterest("");
      if (type === "propertyRights") setPropertyRights("");
      if (type === "lottery") setLottery("");
      if (type === "nonEntrepreneur") setNonEntrepreneur("");
      if (type === "nonResident") { setEntertainer(""); setServices(""); }
    } else {
      next.add(type);
    }
    setSelectedTypes(next);
  }

  function changeRent(value: string) {
    setRent(value);
    if (!monthlyEdited) setMonthlyRent(value);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errors: Record<string, string | null> = {};
    if (!personalNumber.trim()) {
      errors.personalNumber = intl.formatMessage({ id: "validation.required" });
    } else if (personalNumberInvalid) {
      errors.personalNumber = intl.formatMessage({ id: "withholdingTax.personalNumberInvalid" });
    }
    if (!name.trim()) {
      errors.name = intl.formatMessage({ id: "validation.required" });
    }
    if (areaMissing) {
      errors.area = intl.formatMessage({ id: "withholdingTax.rentDetailsHint" });
    }
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors(errors);
      return;
    }
    onSubmit({
      personalNumber: cleanPersonalNumber,
      name: name.trim(),
      grossInterest: has("interest") ? amountValue(interest) : 0,
      propertyRights: has("propertyRights") ? amountValue(propertyRights) : 0,
      lotteryWinnings: has("lottery") ? amountValue(lottery) : 0,
      grossRent: has("rent") ? amountValue(rent) : 0,
      nonResidentEntertainer: has("nonResident") ? amountValue(entertainer) : 0,
      nonResidentServices: has("nonResident") ? amountValue(services) : 0,
      nonEntrepreneur: has("nonEntrepreneur") ? amountValue(nonEntrepreneur) : 0,
      rentalAreaM2: hasRent ? amountValue(area) : undefined,
      monthlyGrossRent: hasRent ? amountValue(monthlyRent) || amountValue(rent) : undefined,
      country,
    });
  }

  function amountField(id: string, labelId: string, value: string, setValue: (v: string) => void, errorKey?: string) {
    const err = errorKey ? fieldErrors[errorKey] : undefined;
    return (
      <FormField label={intl.formatMessage({ id: labelId })} htmlFor={id} error={err}>
        <Input
          id={id}
          type="number"
          step="0.01"
          min="0"
          className="text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          aria-invalid={!!err}
          aria-describedby={err ? `${id}-error` : undefined}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (errorKey) clearFieldError(errorKey);
          }}
          placeholder="0.00"
        />
      </FormField>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField
          label={intl.formatMessage({ id: "withholdingTax.personalNumber" })}
          htmlFor="wht-personal-number"
          error={fieldErrors.personalNumber ?? (personalNumberInvalid ? intl.formatMessage({ id: "withholdingTax.personalNumberInvalid" }) : undefined)}
          required
        >
          <Input
            id="wht-personal-number"
            required
            inputMode="numeric"
            aria-invalid={!!fieldErrors.personalNumber || personalNumberInvalid}
            aria-describedby={fieldErrors.personalNumber ? "wht-personal-number-error" : undefined}
            value={personalNumber}
            onChange={(e) => {
              setPersonalNumber(e.target.value);
              clearFieldError("personalNumber");
            }}
          />
        </FormField>
        <FormField
          label={intl.formatMessage({ id: "withholdingTax.name" })}
          htmlFor="wht-name"
          error={fieldErrors.name}
          required
          className="sm:col-span-2"
        >
          <Input
            id="wht-name"
            required
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? "wht-name-error" : undefined}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearFieldError("name");
            }}
          />
        </FormField>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{intl.formatMessage({ id: "withholdingTax.paymentTypes" })}</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label={intl.formatMessage({ id: "withholdingTax.paymentTypes" })}>
          {PAYMENT_TYPES.map((type) => (
            <Button
              key={type}
              type="button"
              size="sm"
              variant={has(type) ? "default" : "outline"}
              className={has(type) ? "border border-primary" : undefined}
              aria-pressed={has(type)}
              onClick={() => toggleType(type)}
            >
              {intl.formatMessage({ id: `withholdingTax.type.${type}` })}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {has("rent") && amountField("wht-rent", "withholdingTax.grossRent", rent, changeRent)}
        {has("rent") && amountField("wht-area", "withholdingTax.rentalAreaM2", area, setArea, "area")}
        {has("rent") && amountField("wht-monthly-rent", "withholdingTax.monthlyGrossRent", monthlyRent, (v) => { setMonthlyEdited(true); setMonthlyRent(v); })}
        {has("interest") && amountField("wht-interest", "withholdingTax.grossInterest", interest, setInterest)}
        {has("propertyRights") && amountField("wht-property-rights", "withholdingTax.propertyRights", propertyRights, setPropertyRights)}
        {has("lottery") && amountField("wht-lottery", "withholdingTax.lotteryWinnings", lottery, setLottery)}
        {has("nonEntrepreneur") && amountField("wht-non-entrepreneur", "withholdingTax.nonEntrepreneur", nonEntrepreneur, setNonEntrepreneur)}
        {has("nonResident") && amountField("wht-entertainer", "withholdingTax.nonResidentEntertainer", entertainer, setEntertainer)}
        {has("nonResident") && amountField("wht-services", "withholdingTax.nonResidentServices", services, setServices)}
        {has("nonResident") && (
          <FormField label={intl.formatMessage({ id: "withholdingTax.country" })} htmlFor="wht-country">
            <Select
              id="wht-country"
              value={country}
              onValueChange={(v) => setCountry(v)}
              options={countries.map((c) => ({
                value: c,
                label: c,
              }))}
            />
          </FormField>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting || !personalNumber.trim() || personalNumberInvalid || !name.trim() || selectedTypes.size === 0 || areaMissing}>
          {submitting
            ? intl.formatMessage({ id: "common.saving" })
            : intl.formatMessage({ id: mode === "create" ? "withholdingTax.addEntry" : "common.save" })}
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
