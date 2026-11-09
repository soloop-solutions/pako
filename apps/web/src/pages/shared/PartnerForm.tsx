import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

type PartnerFormProps = {
  companyId: string;
  role: "customer" | "vendor";
  onCreated: (id: string) => void;
};

export function PartnerForm({ companyId, role, onCreated }: PartnerFormProps) {
  const intl = useIntl();
  const [name, setName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [fiscalNumber, setFiscalNumber] = useState("");
  const [isVatRegistered, setIsVatRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const nextErrors: Record<string, string | null> = {};
    if (!name.trim()) {
      nextErrors.name = intl.formatMessage({ id: "validation.required" });
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      const result = await apiClient.partnersPOST(companyId, {
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
      onCreated(result.id);
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
        <FormField
          label={intl.formatMessage({ id: "partnerForm.name" })}
          htmlFor={`${role}-name`}
          error={errors.name}
          required
          className="flex-1"
        >
          <Input
            id={`${role}-name`}
            value={name}
            aria-invalid={!!errors.name}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name) setErrors((prev) => ({ ...prev, name: null }));
            }}
          />
        </FormField>
        <FormField
          label={intl.formatMessage({ id: "partnerForm.taxNumber" })}
          htmlFor={`${role}-tax-number`}
          className="flex-1"
        >
          <Input id={`${role}-tax-number`} value={taxNumber} onChange={(event) => setTaxNumber(event.target.value)} />
        </FormField>
        <FormField
          label={intl.formatMessage({ id: "partnerForm.fiscalNumber" })}
          htmlFor={`${role}-fiscal-number`}
          className="flex-1"
        >
          <Input id={`${role}-fiscal-number`} value={fiscalNumber} onChange={(event) => setFiscalNumber(event.target.value)} />
        </FormField>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
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
