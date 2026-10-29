import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { WithholdingTaxEntryResponse } from "@pako/shared";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const hasRent = amountValue(rent) > 0;
  const rentDetailsMissing = hasRent && (amountValue(area) <= 0 || amountValue(monthlyRent) <= 0);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
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

  function amountField(id: string, labelId: string, value: string, setValue: (v: string) => void, disabled = false) {
    return (
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{intl.formatMessage({ id: labelId })}</Label>
        <Input
          id={id}
          type="number"
          step="0.01"
          min="0"
          className="text-right tabular-nums"
          disabled={disabled}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0.00"
        />
      </div>
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
        <div className="flex flex-col gap-1">
          <Label htmlFor="wht-personal-number">{intl.formatMessage({ id: "withholdingTax.personalNumber" })}</Label>
          <Input id="wht-personal-number" required value={personalNumber} onChange={(e) => setPersonalNumber(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="wht-name">{intl.formatMessage({ id: "withholdingTax.name" })}</Label>
          <Input id="wht-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {amountField("wht-interest", "withholdingTax.grossInterest", interest, setInterest)}
        {amountField("wht-property-rights", "withholdingTax.propertyRights", propertyRights, setPropertyRights)}
        {amountField("wht-lottery", "withholdingTax.lotteryWinnings", lottery, setLottery)}
        {amountField("wht-entertainer", "withholdingTax.nonResidentEntertainer", entertainer, setEntertainer)}
        {amountField("wht-services", "withholdingTax.nonResidentServices", services, setServices)}
        {amountField("wht-non-entrepreneur", "withholdingTax.nonEntrepreneur", nonEntrepreneur, setNonEntrepreneur)}
        {amountField("wht-rent", "withholdingTax.grossRent", rent, setRent)}
        {amountField("wht-area", "withholdingTax.rentalAreaM2", area, setArea, !hasRent)}
        {amountField("wht-monthly-rent", "withholdingTax.monthlyGrossRent", monthlyRent, setMonthlyRent, !hasRent)}
      </div>
      {rentDetailsMissing && (
        <p className="text-xs text-amber-600">{intl.formatMessage({ id: "withholdingTax.rentDetailsHint" })}</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="wht-country">{intl.formatMessage({ id: "withholdingTax.country" })}</Label>
          <Select
            id="wht-country"
            value={country}
            onValueChange={(v) => setCountry(v)}
            options={countries.map((c) => ({
              value: c,
              label: c,
            }))}
          />
        </div>
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
