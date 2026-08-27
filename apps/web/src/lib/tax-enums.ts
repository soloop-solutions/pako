import type { TaxDefinitionResponse } from "@pako/shared";

// Pako.Api doesn't emit enum member names (see ledger-enums.ts) - order must match
// backend/Pako.Domain/Tax/TaxDefinition.cs's TaxScope enum by hand.
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

export function estimatedTaxAmount(netAmount: number, taxDefinition: TaxDefinitionResponse | undefined): number {
  if (!taxDefinition) return 0;
  return Math.round(netAmount * taxDefinition.rate * 100) / 100;
}

type DiscountedTaxedLine = { quantity: number; unitPrice: number; discountPercent: number; taxDefinitionId: string | undefined };

export function documentNominalTotal(lines: DiscountedTaxedLine[], taxes: TaxDefinitionResponse[]): number {
  let total = 0;
  for (const line of lines) {
    const net = line.quantity * line.unitPrice * (1 - line.discountPercent / 100);
    total += net + estimatedTaxAmount(net, taxes.find((t) => t.id === line.taxDefinitionId));
  }
  return total;
}
