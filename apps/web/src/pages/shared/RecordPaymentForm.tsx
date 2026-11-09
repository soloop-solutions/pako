import { useState, type FormEvent } from "react";
import { useIntl } from "react-intl";
import type { PaymentMethodResponse } from "@pako/shared";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PaymentMethodSelect } from "@/pages/shared/PaymentMethodSelect";

type RecordPaymentFormProps = {
  companyId: string;
  documentKind: "invoice" | "bill";
  documentId: string;
  paymentMethods: PaymentMethodResponse[];
  outstanding: number;
  onRecorded: () => void;
  isRefund?: boolean;
};

export function RecordPaymentForm({
  companyId,
  documentKind,
  documentId,
  paymentMethods,
  outstanding,
  onRecorded,
  isRefund = false,
}: RecordPaymentFormProps) {
  const intl = useIntl();
  const [amount, setAmount] = useState(() => outstanding.toFixed(2));
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setApiError(null);

    const errors: Record<string, string | null> = {};
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      errors.amount = intl.formatMessage({ id: "recordPayment.amountError" });
    }
    if (!paymentMethodId) {
      errors.paymentMethodId = intl.formatMessage({ id: "recordPayment.accountError" });
    }

    const paymentMethod = paymentMethods.find((m) => m.id === paymentMethodId);
    if (paymentMethodId && !paymentMethod) {
      errors.paymentMethodId = intl.formatMessage({ id: "recordPayment.accountError" });
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        amount: parsedAmount,
        cashOrBankAccountId: paymentMethod!.ledgerAccountId,
        date: new Date().toISOString().slice(0, 10),
      };

      if (documentKind === "invoice") {
        await apiClient.recordPayment2(companyId, documentId, body);
      } else {
        await apiClient.recordPayment(companyId, documentId, body);
      }

      toast.success(intl.formatMessage({ id: "toast.paymentRecorded" }));
      onRecorded();
    } catch (err) {
      const msg = getApiErrorMessage(err, intl.formatMessage({ id: "recordPayment.error" }));
      setApiError(msg);
      toast.error(msg);
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
          label={intl.formatMessage({ id: "recordPayment.amount" })}
          htmlFor="payment-amount"
          error={fieldErrors.amount}
        >
          <Input
            id="payment-amount"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setFieldErrors((prev) => ({ ...prev, amount: null }));
            }}
            aria-invalid={!!fieldErrors.amount}
            required
          />
        </FormField>
        <FormField
          label={intl.formatMessage({ id: "recordPayment.cashBankAccount" })}
          htmlFor="payment-account"
          error={fieldErrors.paymentMethodId}
        >
          <PaymentMethodSelect
            id="payment-account"
            paymentMethods={paymentMethods}
            value={paymentMethodId}
            onChange={(v) => {
              setPaymentMethodId(v);
              setFieldErrors((prev) => ({ ...prev, paymentMethodId: null }));
            }}
            aria-invalid={!!fieldErrors.paymentMethodId}
          />
        </FormField>
        <div className="flex items-end">
          <Button type="submit" disabled={submitting || paymentMethods.length === 0} variant={isRefund ? "destructive" : "default"}>
            {submitting
              ? intl.formatMessage({ id: "recordPayment.recording" })
              : isRefund
                ? intl.formatMessage({ id: "payment.refund" })
                : intl.formatMessage({ id: "recordPayment.recordPayment" })}
          </Button>
        </div>
      </div>
    </form>
  );
}
