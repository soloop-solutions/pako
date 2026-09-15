// F6 (partner register) — types and helpers for the "control account / payment terms / credit
// limit" fields that are not yet on the real generated PartnerResponse (see
// backend/Pako.Domain/Companies/Partner.cs — those three fields genuinely don't exist on the
// domain entity yet). Field names below match this task's own contract, not a real backend
// contract — see src/mocks/partnersHandlers.ts for the mock that currently serves this shape,
// same pattern src/lib/account-v2.ts already established for F2's mocked fields.

import type { IntlShape } from "react-intl";
import type { PartnerResponse } from "@pako/shared";

export interface PartnerV2 extends PartnerResponse {
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
