import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

// F7: manual override on a posted invoice — the backend endpoint (POST
// .../invoices/{id}/override-number) only accepts this on a Posted invoice and only when the
// company has AllowNumberOverride enabled, both already checked by the caller before this form
// is rendered.
type OverrideNumberFormProps = {
  companyId: string;
  invoiceId: string;
  currentNumber: string | null | undefined;
  onOverridden: (newNumber: string) => void;
};

export function OverrideNumberForm({ companyId, invoiceId, currentNumber, onOverridden }: OverrideNumberFormProps) {
  const intl = useIntl();
  const [newNumber, setNewNumber] = useState(currentNumber ?? "");
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setApiError(null);
    setFieldError(null);
    if (!newNumber.trim()) {
      setFieldError(intl.formatMessage({ id: "overrideNumber.requiredError" }));
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.overrideNumber(companyId, invoiceId, { newNumber: newNumber.trim() });
      onOverridden(newNumber.trim());
    } catch (err) {
      setApiError(getApiErrorMessage(err, intl.formatMessage({ id: "overrideNumber.error" })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleSubmit}>
      {apiError && (
        <Alert variant="destructive" className="sm:basis-full">
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      )}
      <FormField
        label={intl.formatMessage({ id: "overrideNumber.newNumber" })}
        htmlFor="override-number-input"
        error={fieldError}
        required
        className="flex-1"
      >
        <Input
          id="override-number-input"
          value={newNumber}
          onChange={(event) => {
            setNewNumber(event.target.value);
            setFieldError(null);
          }}
          aria-invalid={!!fieldError}
          aria-describedby={fieldError ? "override-number-input-error" : undefined}
          required
        />
      </FormField>
      <Button type="submit" disabled={submitting}>
        {submitting ? intl.formatMessage({ id: "overrideNumber.saving" }) : intl.formatMessage({ id: "overrideNumber.save" })}
      </Button>
    </form>
  );
}
