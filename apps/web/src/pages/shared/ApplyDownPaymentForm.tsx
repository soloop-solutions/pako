import { useState, type FormEvent } from "react";
import type { ApplyDownPaymentResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type DownPaymentOption = { id: string; label: string; total: number };

type ApplyDownPaymentFormProps = {
  companyId: string;
  invoiceId: string;
  outstanding: number;
  options: DownPaymentOption[];
  onApplied: (response: ApplyDownPaymentResponse) => void;
};

export function ApplyDownPaymentForm({ companyId, invoiceId, outstanding, options, onApplied }: ApplyDownPaymentFormProps) {
  const [downPaymentInvoiceId, setDownPaymentInvoiceId] = useState(options[0]?.id ?? "");
  const [amount, setAmount] = useState(() => Math.min(options[0]?.total ?? 0, outstanding).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSelectChange(id: string) {
    setDownPaymentInvoiceId(id);
    const option = options.find((candidate) => candidate.id === id);
    setAmount(Math.min(option?.total ?? 0, outstanding).toFixed(2));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!downPaymentInvoiceId) {
      setError("Select a down payment.");
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError("Enter an amount greater than zero.");
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
      setError(getApiErrorMessage(err, "Could not apply the down payment — nothing was changed."));
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
          <Label htmlFor="apply-down-payment-select">Down payment</Label>
          <Select
            id="apply-down-payment-select"
            value={downPaymentInvoiceId}
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
          <Label htmlFor="apply-down-payment-amount">Amount</Label>
          <Input
            id="apply-down-payment-amount"
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
            {submitting ? "Applying..." : "Apply down payment"}
          </Button>
        </div>
      </div>
    </form>
  );
}
