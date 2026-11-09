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
  const [interest, setInterest] = useState(amountText(initial?.grossInterest));
  const [propertyRights, setPropertyRights] = useState(amountText(initial?.propertyRights));
  const [lottery, setLottery] = useState(amountText(initial?.lotteryWinnings));
  const [rent, setRent] = useState(amountText(initial?.grossRent));
  const [entertainer, setEntertainer] = useState(amountText(initial?.nonResidentEntertainer));
  const [services, setServices] = useState(amountText(initial?.nonResidentServices));
  const [nonEntrepreneur, setNonEntrepreneur] = useState(amountText(initial?.nonEntrepreneur));
  const [area, setArea] = useState(amountText(initial?.rentalAreaM2));
  const [monthlyRent, setMonthlyRent] = useState(amountText(initial?.monthlyGrossRent));
  const [country, setCountry] = useState(initial?.country ?? defaultCountry);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  const hasRent = amountValue(rent) > 0;
  const rentDetailsMissing = hasRent && (amountValue(area) <= 0 || amountValue(monthlyRent) <= 0);

  function clearFieldError(field: string) {
    setFieldErrors((prev) => ({ ...prev, [field]: null }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errors: Record<string, string | null> = {};
    if (!personalNumber.trim()) {
      errors.personalNumber = intl.formatMessage({ id: "validation.required" });
    }
    if (!name.trim()) {
      errors.name = intl.formatMessage({ id: "validation.required" });
    }
    if (rentDetailsMissing) {
      if (amountValue(area) <= 0) errors.area = intl.formatMessage({ id: "withholdingTax.rentDetailsHint" });
      if (amountValue(monthlyRent) <= 0) errors.monthlyRent = intl.formatMessage({ id: "withholdingTax.rentDetailsHint" });
    }
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors(errors);
      return;
    }
    onSubmit({
      personalNumber: personalNumber.trim(),
      name: name.trim(),
      grossInterest: amountValue(interest),
      propertyRights: amountValue(propertyRights),
      lotteryWinnings: amountValue(lottery),
      grossRent: amountValue(rent),
      nonResidentEntertainer: amountValue(entertainer),
      nonResidentServices: amountValue(services),
      nonEntrepreneur: amountValue(nonEntrepreneur),
      rentalAreaM2: hasRent ? amountValue(area) : undefined,
      monthlyGrossRent: hasRent ? amountValue(monthlyRent) : undefined,
      country,
    });
  }

  function amountField(id: string, labelId: string, value: string, setValue: (v: string) => void, disabled = false, errorKey?: string) {
    const err = errorKey ? fieldErrors[errorKey] : undefined;
    return (
      <FormField label={intl.formatMessage({ id: labelId })} htmlFor={id} error={err}>
        <Input
          id={id}
          type="number"
          step="0.01"
          min="0"
          className="text-right tabular-nums"
          disabled={disabled}
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
          error={fieldErrors.personalNumber}
          required
        >
          <Input
            id="wht-personal-number"
            required
            aria-invalid={!!fieldErrors.personalNumber}
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {amountField("wht-interest", "withholdingTax.grossInterest", interest, setInterest)}
        {amountField("wht-property-rights", "withholdingTax.propertyRights", propertyRights, setPropertyRights)}
        {amountField("wht-lottery", "withholdingTax.lotteryWinnings", lottery, setLottery)}
        {amountField("wht-entertainer", "withholdingTax.nonResidentEntertainer", entertainer, setEntertainer)}
        {amountField("wht-services", "withholdingTax.nonResidentServices", services, setServices)}
        {amountField("wht-non-entrepreneur", "withholdingTax.nonEntrepreneur", nonEntrepreneur, setNonEntrepreneur)}
        {amountField("wht-rent", "withholdingTax.grossRent", rent, setRent)}
        {amountField("wht-area", "withholdingTax.rentalAreaM2", area, setArea, !hasRent, "area")}
        {amountField("wht-monthly-rent", "withholdingTax.monthlyGrossRent", monthlyRent, setMonthlyRent, !hasRent, "monthlyRent")}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting || !personalNumber.trim() || !name.trim() || rentDetailsMissing}>
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
