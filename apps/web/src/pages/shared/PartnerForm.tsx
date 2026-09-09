import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PartnerFormProps = {
  companyId: string;
  role: "customer" | "vendor";
  onCreated: () => void;
};

export function PartnerForm({ companyId, role, onCreated }: PartnerFormProps) {
  const intl = useIntl();
  const [name, setName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [fiscalNumber, setFiscalNumber] = useState("");
  const [isVatRegistered, setIsVatRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.partners(companyId, {
        name: name.trim(),
        taxNumber: taxNumber.trim() || undefined,
        isCustomer: role === "customer",
        isVendor: role === "vendor",
        fiscalNumber: fiscalNumber.trim() || undefined,
        isVatRegistered,
      });
      setName("");
      setTaxNumber("");
      setFiscalNumber("");
      setIsVatRegistered(false);
      onCreated();
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          role === "customer"
            ? intl.formatMessage({ id: "partnerForm.createCustomerError" })
            : intl.formatMessage({ id: "partnerForm.createVendorError" }),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor={`${role}-name`}>{intl.formatMessage({ id: "partnerForm.name" })}</Label>
          <Input id={`${role}-name`} required value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor={`${role}-tax-number`}>{intl.formatMessage({ id: "partnerForm.taxNumber" })}</Label>
          <Input id={`${role}-tax-number`} value={taxNumber} onChange={(event) => setTaxNumber(event.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor={`${role}-fiscal-number`}>{intl.formatMessage({ id: "partnerForm.fiscalNumber" })}</Label>
          <Input id={`${role}-fiscal-number`} value={fiscalNumber} onChange={(event) => setFiscalNumber(event.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isVatRegistered}
            onChange={e => setIsVatRegistered(e.target.checked)}
          />
          {intl.formatMessage({ id: "partnerForm.vatRegistered" })}
        </label>
        <Button type="submit" disabled={submitting || name.trim().length === 0}>
          {submitting
            ? intl.formatMessage({ id: "partnerForm.creating" })
            : role === "customer"
              ? intl.formatMessage({ id: "partnerForm.addCustomer" })
              : intl.formatMessage({ id: "partnerForm.addVendor" })}
        </Button>
      </div>
    </form>
  );
}
