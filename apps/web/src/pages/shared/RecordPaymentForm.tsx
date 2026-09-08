import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { PaymentMethodResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaymentMethodSelect } from "@/pages/shared/PaymentMethodSelect";

type RecordPaymentFormProps = {
  companyId: string;
  documentKind: "invoice" | "bill";
  documentId: string;
  paymentMethods: PaymentMethodResponse[];
  outstanding: number;
  onRecorded: () => void;
};

export function RecordPaymentForm({
  companyId,
  documentKind,
  documentId,
  paymentMethods,
  outstanding,
  onRecorded,
}: RecordPaymentFormProps) {
  const intl = useIntl();
  const [amount, setAmount] = useState(() => outstanding.toFixed(2));
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError(intl.formatMessage({ id: "recordPayment.amountError" }));
      return;
    }
    if (!paymentMethodId) {
      setError(intl.formatMessage({ id: "recordPayment.accountError" }));
      return;
    }

    const paymentMethod = paymentMethods.find((m) => m.id === paymentMethodId);
    if (!paymentMethod) {
      setError(intl.formatMessage({ id: "recordPayment.accountError" }));
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        amount: parsedAmount,
        cashOrBankAccountId: paymentMethod.ledgerAccountId,
        date: new Date().toISOString().slice(0, 10),
      };

      if (documentKind === "invoice") {
        await apiClient.recordPayment2(companyId, documentId, body);
      } else {
        await apiClient.recordPayment(companyId, documentId, body);
      }

      onRecorded();
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "recordPayment.error" })));
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
          <Label htmlFor="payment-amount">{intl.formatMessage({ id: "recordPayment.amount" })}</Label>
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
          <Label htmlFor="payment-account">{intl.formatMessage({ id: "recordPayment.cashBankAccount" })}</Label>
          <PaymentMethodSelect id="payment-account" paymentMethods={paymentMethods} value={paymentMethodId} onChange={setPaymentMethodId} />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={submitting || paymentMethods.length === 0}>
            {submitting ? intl.formatMessage({ id: "recordPayment.recording" }) : intl.formatMessage({ id: "recordPayment.recordPayment" })}
          </Button>
        </div>
      </div>
    </form>
  );
}
