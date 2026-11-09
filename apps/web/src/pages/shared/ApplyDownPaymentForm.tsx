import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { ApplyDownPaymentResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";

export type DownPaymentOption = { id: string; label: string; total: number };

type ApplyDownPaymentFormProps = {
  companyId: string;
  invoiceId: string;
  outstanding: number;
  options: DownPaymentOption[];
  onApplied: (response: ApplyDownPaymentResponse) => void;
};

type FieldErrors = { downPayment?: string; amount?: string };

export function ApplyDownPaymentForm({ companyId, invoiceId, outstanding, options, onApplied }: ApplyDownPaymentFormProps) {
  const intl = useIntl();
  const [downPaymentInvoiceId, setDownPaymentInvoiceId] = useState(options[0]?.id ?? "");
  const [amount, setAmount] = useState(() => Math.min(options[0]?.total ?? 0, outstanding).toFixed(2));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSelectChange(id: string) {
    setDownPaymentInvoiceId(id);
    setFieldErrors((prev) => ({ ...prev, downPayment: undefined }));
    const option = options.find((candidate) => candidate.id === id);
    setAmount(Math.min(option?.total ?? 0, outstanding).toFixed(2));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setApiError(null);

    const errors: FieldErrors = {};
    if (!downPaymentInvoiceId) {
      errors.downPayment = intl.formatMessage({ id: "applyDownPayment.selectError" });
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      errors.amount = intl.formatMessage({ id: "applyDownPayment.amountError" });
    }
    if (errors.downPayment || errors.amount) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiClient.applyDownPayment(companyId, invoiceId, {
        downPaymentInvoiceId,
        amount: parsedAmount,
      });
      onApplied(response);
    } catch (err) {
      setApiError(getApiErrorMessage(err, intl.formatMessage({ id: "applyDownPayment.error" })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {apiError && (
        <Alert variant="destructive">
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          label={intl.formatMessage({ id: "applyDownPayment.downPayment" })}
          htmlFor="apply-down-payment-select"
          error={fieldErrors.downPayment}
        >
          <SearchableSelect
            id="apply-down-payment-select"
            value={downPaymentInvoiceId}
            onChange={handleSelectChange}
            placeholder={intl.formatMessage({ id: "applyDownPayment.downPayment" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            aria-invalid={!!fieldErrors.downPayment}
            options={options.map((option) => ({
              value: option.id,
              label: option.label,
              description: `${intl.formatMessage({ id: "applyDownPayment.available" })} ${option.total.toFixed(2)}`,
            }))}
          />
        </FormField>
        <FormField
          label={intl.formatMessage({ id: "applyDownPayment.amount" })}
          htmlFor="apply-down-payment-amount"
          error={fieldErrors.amount}
        >
          <Input
            id="apply-down-payment-amount"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setFieldErrors((prev) => ({ ...prev, amount: undefined }));
            }}
            aria-invalid={!!fieldErrors.amount}
            required
          />
        </FormField>
        <div className="flex items-end">
          <Button type="submit" disabled={submitting || options.length === 0}>
            {submitting ? intl.formatMessage({ id: "applyDownPayment.applying" }) : intl.formatMessage({ id: "applyDownPayment.apply" })}
          </Button>
        </div>
      </div>
    </form>
  );
}
