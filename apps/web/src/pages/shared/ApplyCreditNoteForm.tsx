import { useState, type FormEvent } from "react";
import type { ApplyCreditNoteResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type CreditNoteOption = { id: string; label: string; total: number };

type ApplyCreditNoteFormProps = {
  companyId: string;
  documentKind: "invoice" | "bill";
  documentId: string;
  outstanding: number;
  options: CreditNoteOption[];
  onApplied: (response: ApplyCreditNoteResponse) => void;
};

export function ApplyCreditNoteForm({
  companyId,
  documentKind,
  documentId,
  outstanding,
  options,
  onApplied,
}: ApplyCreditNoteFormProps) {
  const [creditNoteId, setCreditNoteId] = useState(options[0]?.id ?? "");
  const [amount, setAmount] = useState(() => Math.min(options[0]?.total ?? 0, outstanding).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSelectChange(id: string) {
    setCreditNoteId(id);
    const option = options.find((candidate) => candidate.id === id);
    setAmount(Math.min(option?.total ?? 0, outstanding).toFixed(2));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!creditNoteId) {
      setError("Select a credit note.");
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError("Enter an amount greater than zero.");
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
      setError(getApiErrorMessage(err, "Could not apply the credit note — nothing was changed."));
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
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="apply-credit-note-select">Credit note</Label>
          <Select
            id="apply-credit-note-select"
            value={creditNoteId}
            onChange={(event) => handleSelectChange(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} (available {option.total.toFixed(2)})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="apply-credit-note-amount">Amount</Label>
          <Input
            id="apply-credit-note-amount"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={submitting || options.length === 0}>
            {submitting ? "Applying..." : "Apply credit note"}
          </Button>
        </div>
      </div>
    </form>
  );
}
