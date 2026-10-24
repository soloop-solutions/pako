import type { IntlShape } from "react-intl";
import type { PartnerResponse } from "@pako/shared";

export interface PartnerV2 extends Omit<PartnerResponse, "paymentTermDays" | "creditLimit"> {
  controlAccountId: string | null;
  paymentTermDays: number | null;
  creditLimit: number | null;
}

// Used on the customer/vendor picker in InvoiceForm.tsx/BillForm.tsx — F6 asks that the picker
// "shows VAT status inline, because that is what decides the tax code on the document." A plain
// <option> can only hold text, so this appends a short suffix rather than a Badge.
export function partnerOptionLabel(partner: PartnerResponse, intl: IntlShape): string {
  const vatLabel = intl.formatMessage({
    id: partner.isVatRegistered ? "partners.vatRegisteredShort" : "partners.notVatRegisteredShort",
  });
  return `${partner.name} — ${vatLabel}`;
}
