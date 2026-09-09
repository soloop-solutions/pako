import type { TaxDefinitionResponse } from "@pako/shared";

// Pako.Api doesn't emit enum member names (see ledger-enums.ts) - order must match
// backend/Pako.Domain/Tax/TaxDefinition.cs's TaxScope enum by hand.
const TAX_SCOPE_SALE = 0;
const TAX_SCOPE_PURCHASE = 1;
const TAX_SCOPE_BOTH = 2;

// C1 — order must match backend/Pako.Domain/Invoicing/Invoice.cs's PriceMode enum by hand.
export const PriceMode = { GrossInclusive: 0, NetExclusive: 1 } as const;

// C2: the exempt VAT codes already seeded by VatWithholdingTemplate.cs — SEX on the sales side,
// BEX on the purchase side. Used as the default line tax for a VAT-registered company instead of
// the old silent "no tax" option (see defaultLineTaxId below).
export function findTaxByCode(taxes: TaxDefinitionResponse[], code: string): TaxDefinitionResponse | undefined {
  return taxes.find((t) => t.code === code);
}

export function taxesForSale(taxes: TaxDefinitionResponse[]): TaxDefinitionResponse[] {
  return taxes.filter((t) => t.scope === TAX_SCOPE_SALE || t.scope === TAX_SCOPE_BOTH);
}

export function taxesForPurchase(taxes: TaxDefinitionResponse[]): TaxDefinitionResponse[] {
  return taxes.filter((t) => t.scope === TAX_SCOPE_PURCHASE || t.scope === TAX_SCOPE_BOTH);
}

export function taxRatePercentLabel(taxDefinition: TaxDefinitionResponse): string {
  return `${taxDefinition.name} (${(taxDefinition.rate * 100).toFixed(0)}%)`;
}

// Line entry is gross (brutto) — backend/Pako.Domain/Tax/TaxComputationService.ComputeFromGross
// is the source of truth this mirrors. Tax is the exact remainder (gross - net), never an
// independently-rounded net*rate, so net+tax always equals the entered gross amount exactly —
// see that method's own comment for why naive independent rounding can drift by a cent.
// Reverse-charge codes (RC18): the foreign vendor never charged VAT, so the entered amount is
// fully net regardless of gross-entry convention — nothing is backed out.
export function computeFromGross(
  grossAmount: number,
  taxDefinition: TaxDefinitionResponse | undefined,
): { net: number; tax: number } {
  if (!taxDefinition || taxDefinition.isReverseCharge) {
    return { net: grossAmount, tax: 0 };
  }
  const net = Math.round((grossAmount / (1 + taxDefinition.rate)) * 100) / 100;
  const tax = Math.round((grossAmount - net) * 100) / 100;
  return { net, tax };
}

// C1: mirrors backend/Pako.Domain/Documents/DocumentLineCalculator.cs exactly — the entered
// amount is VAT-inclusive (GrossInclusive, backs VAT out via computeFromGross above) or
// VAT-exclusive (NetExclusive, adds VAT on top), decided by the document's own PriceMode. Both
// paths converge on the same net/tax/gross figures for the same underlying amount.
export function computeLine(
  enteredAmount: number,
  taxDefinition: TaxDefinitionResponse | undefined,
  priceMode: number,
): { net: number; tax: number; gross: number } {
  if (!taxDefinition || taxDefinition.isReverseCharge) {
    return { net: enteredAmount, tax: 0, gross: enteredAmount };
  }
  if (priceMode === PriceMode.NetExclusive) {
    const tax = Math.round(enteredAmount * taxDefinition.rate * 100) / 100;
    return { net: enteredAmount, tax, gross: enteredAmount + tax };
  }
  const { net, tax } = computeFromGross(enteredAmount, taxDefinition);
  return { net, tax, gross: enteredAmount };
}

type DiscountedTaxedLine = { quantity: number; unitPrice: number; discountPercent: number; taxDefinitionId: string | undefined };

// A document's nominal total is simply the sum of its gross line entries — under gross entry,
// VAT is already included in what was typed, there's nothing left to add on top.
export function documentNominalTotal(lines: DiscountedTaxedLine[]): number {
  let total = 0;
  for (const line of lines) {
    total += line.quantity * line.unitPrice * (1 - line.discountPercent / 100);
  }
  return total;
}
