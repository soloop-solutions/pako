import { useState, type FormEvent } from "react";
import type { AccountResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type RecordPaymentFormProps = {
  companyId: string;
  documentKind: "invoice" | "bill";
  documentId: string;
  partnerId: string;
  controlAccountId: string;
  journalId: string;
  cashAccounts: AccountResponse[];
  outstanding: number;
  onRecorded: () => void;
};

export function RecordPaymentForm({
  companyId,
  documentKind,
  documentId,
  partnerId,
  controlAccountId,
  journalId,
  cashAccounts,
  outstanding,
  onRecorded,
}: RecordPaymentFormProps) {
  const [amount, setAmount] = useState(() => outstanding.toFixed(2));
  const [cashAccountId, setCashAccountId] = useState(cashAccounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError("Enter a payment amount greater than zero.");
      return;
    }
    if (!cashAccountId) {
      setError("Select a cash or bank account.");
      return;
    }

    setSubmitting(true);
    try {
      const description = documentKind === "invoice" ? "Payment received" : "Payment made";
      const lines =
        documentKind === "invoice"
          ? [
              { accountId: cashAccountId, partnerId: undefined, debit: parsedAmount, credit: 0, description },
              { accountId: controlAccountId, partnerId, debit: 0, credit: parsedAmount, description },
            ]
          : [
              { accountId: controlAccountId, partnerId, debit: parsedAmount, credit: 0, description },
              { accountId: cashAccountId, partnerId: undefined, debit: 0, credit: parsedAmount, description },
            ];

      const draft = await apiClient.journalEntries(companyId, {
        journalId,
        date: new Date().toISOString().slice(0, 10),
        reference: undefined,
        lines,
      });
      const posted = await apiClient.post3(companyId, draft.id);
      const settlementLine = posted.lines.find((line) => line.accountId === controlAccountId);
      if (!settlementLine) {
        throw new Error("Could not find the posted settlement line to reconcile.");
      }

      await apiClient.reconciliations(companyId, {
        invoiceId: documentKind === "invoice" ? documentId : undefined,
        billId: documentKind === "bill" ? documentId : undefined,
        journalEntryLineId: settlementLine.id,
        amount: parsedAmount,
      });

      onRecorded();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not record the payment."));
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
          <Label htmlFor="payment-amount">Amount</Label>
          <Input
            id="payment-amount"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="payment-account">Cash / bank account</Label>
          <Select id="payment-account" value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}>
            {cashAccounts.length === 0 && <option value="">No cash/bank account seeded</option>}
            {cashAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} - {account.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={submitting || cashAccounts.length === 0}>
            {submitting ? "Recording..." : "Record payment"}
          </Button>
        </div>
      </div>
    </form>
  );
}
