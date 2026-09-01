import type { TaxDefinitionResponse } from '@pako/shared';

// Pako.Api doesn't emit enum member names (see ledger-enums.ts) - order must match
// backend/Pako.Domain/Tax/TaxDefinition.cs's TaxScope enum by hand. Mirrors
// apps/web/src/lib/tax-enums.ts.
const TAX_SCOPE_SALE = 0;
const TAX_SCOPE_PURCHASE = 1;
const TAX_SCOPE_BOTH = 2;

export function taxesForSale(taxes: TaxDefinitionResponse[]): TaxDefinitionResponse[] {
  return taxes.filter((t) => t.scope === TAX_SCOPE_SALE || t.scope === TAX_SCOPE_BOTH);
}

export function taxesForPurchase(taxes: TaxDefinitionResponse[]): TaxDefinitionResponse[] {
  return taxes.filter((t) => t.scope === TAX_SCOPE_PURCHASE || t.scope === TAX_SCOPE_BOTH);
}

export function taxRatePercentLabel(taxDefinition: TaxDefinitionResponse): string {
  return `${taxDefinition.name} (${(taxDefinition.rate * 100).toFixed(0)}%)`;
}

// Line entry is gross (brutto) — mirrors backend/Pako.Domain/Tax/TaxComputationService.
// ComputeFromGross and apps/web/src/lib/tax-enums.ts's computeFromGross exactly. Tax is the
// exact remainder (gross - net), never an independently-rounded net*rate, so net+tax always
// equals the entered gross amount exactly. Reverse-charge codes (RC18): the foreign vendor
// never charged VAT, so the entered amount is fully net regardless of gross-entry convention.
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

// The line amount as entered (gross, VAT included) — quantity * unit price, discounted.
export function lineGrossAmount(quantity: number, unitPrice: number, discountPercent: number): number {
  return quantity * unitPrice * (1 - discountPercent / 100);
}

type DiscountedLine = { quantity: number; unitPrice: number; discountPercent: number; taxDefinitionId?: string };

// A document's nominal total is simply the sum of its gross line entries — VAT is already
// included in what was typed, there's nothing left to add on top.
export function estimatedDocumentTotal(lines: DiscountedLine[]): number {
  let total = 0;
  for (const line of lines) {
    total += lineGrossAmount(line.quantity, line.unitPrice, line.discountPercent);
  }
  return total;
}
