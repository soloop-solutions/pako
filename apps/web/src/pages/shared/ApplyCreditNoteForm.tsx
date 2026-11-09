import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { ApplyCreditNoteResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";

export type CreditNoteOption = { id: string; label: string; total: number };

type ApplyCreditNoteFormProps = {
  companyId: string;
  documentKind: "invoice" | "bill";
  documentId: string;
  outstanding: number;
  options: CreditNoteOption[];
  onApplied: (response: ApplyCreditNoteResponse) => void;
};

type FieldErrors = { creditNote?: string; amount?: string };

export function ApplyCreditNoteForm({
  companyId,
  documentKind,
  documentId,
  outstanding,
  options,
  onApplied,
}: ApplyCreditNoteFormProps) {
  const intl = useIntl();
  const [creditNoteId, setCreditNoteId] = useState(options[0]?.id ?? "");
  const [amount, setAmount] = useState(() => Math.min(options[0]?.total ?? 0, outstanding).toFixed(2));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSelectChange(id: string) {
    setCreditNoteId(id);
    setFieldErrors((prev) => ({ ...prev, creditNote: undefined }));
    const option = options.find((candidate) => candidate.id === id);
    setAmount(Math.min(option?.total ?? 0, outstanding).toFixed(2));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setApiError(null);

    const errors: FieldErrors = {};
    if (!creditNoteId) {
      errors.creditNote = intl.formatMessage({ id: "applyCreditNote.selectError" });
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      errors.amount = intl.formatMessage({ id: "applyCreditNote.amountError" });
    }
    if (errors.creditNote || errors.amount) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const body = { creditNoteId, amount: parsedAmount };
      const response =
        documentKind === "invoice"
          ? await apiClient.applyCreditNote2(companyId, documentId, body)
          : await apiClient.applyCreditNote(companyId, documentId, body);
      onApplied(response);
    } catch (err) {
      setApiError(getApiErrorMessage(err, intl.formatMessage({ id: "applyCreditNote.error" })));
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
          label={intl.formatMessage({ id: "applyCreditNote.creditNote" })}
          htmlFor="apply-credit-note-select"
          error={fieldErrors.creditNote}
        >
          <SearchableSelect
            id="apply-credit-note-select"
            value={creditNoteId}
            onChange={handleSelectChange}
            placeholder={intl.formatMessage({ id: "applyCreditNote.creditNote" })}
            searchPlaceholder={intl.formatMessage({ id: "common.search" })}
            noResultsText={intl.formatMessage({ id: "common.noResults" })}
            aria-invalid={!!fieldErrors.creditNote}
            options={options.map((option) => ({
              value: option.id,
              label: option.label,
              description: `${intl.formatMessage({ id: "applyCreditNote.available" })} ${option.total.toFixed(2)}`,
            }))}
          />
        </FormField>
        <FormField
          label={intl.formatMessage({ id: "applyCreditNote.amount" })}
          htmlFor="apply-credit-note-amount"
          error={fieldErrors.amount}
        >
          <Input
            id="apply-credit-note-amount"
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
            {submitting ? intl.formatMessage({ id: "applyCreditNote.applying" }) : intl.formatMessage({ id: "applyCreditNote.apply" })}
          </Button>
        </div>
      </div>
    </form>
  );
}
