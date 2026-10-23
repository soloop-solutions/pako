import { useIntl } from "react-intl";
import type { PaymentMethodResponse } from "@pako/shared";

import { SearchableSelect, type SelectGroup } from "@/components/ui/searchable-select";
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

  const groups: SelectGroup[] = [];
  if (cashMethods.length > 0) {
    groups.push({
      label: intl.formatMessage({ id: "paymentMethods.cash" }),
      options: cashMethods.map((m) => ({ value: m.id, label: m.name })),
    });
  }
  if (bankMethods.length > 0) {
    groups.push({
      label: intl.formatMessage({ id: "paymentMethods.bank" }),
      options: bankMethods.map((m) => ({ value: m.id, label: m.name })),
    });
  }

  return (
    <SearchableSelect
      id={id}
      value={value}
      onChange={onChange}
      placeholder={
        emptyOptionLabelKey
          ? intl.formatMessage({ id: emptyOptionLabelKey })
          : intl.formatMessage({ id: "recordPayment.noCashBankAccount" })
      }
      searchPlaceholder={intl.formatMessage({ id: "common.search" })}
      noResultsText={intl.formatMessage({ id: "common.noResults" })}
      emptyOptionLabel={emptyOptionLabelKey ? intl.formatMessage({ id: emptyOptionLabelKey }) : undefined}
      options={groups}
      searchable={false}
    />
  );
}
