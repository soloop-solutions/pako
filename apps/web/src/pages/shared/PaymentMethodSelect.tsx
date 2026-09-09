import { useIntl } from "react-intl";
import type { PaymentMethodResponse } from "@pako/shared";

import { Select } from "@/components/ui/select";
import { PaymentMethodKind } from "@/lib/payment-method-enums";

type PaymentMethodSelectProps = {
  id?: string;
  paymentMethods: PaymentMethodResponse[];
  value: string;
  onChange: (value: string) => void;
  emptyOptionLabelKey?: string;
};

// C4: the picker every payment-taking form uses — grouped "Cash"/"Bank" by PaymentMethodKind
// instead of asking the user to pick a raw ledger account.
export function PaymentMethodSelect({ id, paymentMethods, value, onChange, emptyOptionLabelKey }: PaymentMethodSelectProps) {
  const intl = useIntl();
  const cashMethods = paymentMethods.filter((m) => m.kind === PaymentMethodKind.Cash);
  const bankMethods = paymentMethods.filter((m) => m.kind === PaymentMethodKind.Bank);

  return (
    <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {(paymentMethods.length === 0 || emptyOptionLabelKey) && (
        <option value="">
          {emptyOptionLabelKey ? intl.formatMessage({ id: emptyOptionLabelKey }) : intl.formatMessage({ id: "recordPayment.noCashBankAccount" })}
        </option>
      )}
      {cashMethods.length > 0 && (
        <optgroup label={intl.formatMessage({ id: "paymentMethods.cash" })}>
          {cashMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.name}
            </option>
          ))}
        </optgroup>
      )}
      {bankMethods.length > 0 && (
        <optgroup label={intl.formatMessage({ id: "paymentMethods.bank" })}>
          {bankMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}
