import type { TaxDefinitionResponse } from '@pako/shared';

import { estimatedTaxAmount, taxesForPurchase, taxesForSale, taxRatePercentLabel } from '@/lib/tax-enums';

const sale: TaxDefinitionResponse = { id: 's', name: 'VAT 18% (Sales)', rate: 0.18, type: 0, scope: 0, isActive: true };
const purchase: TaxDefinitionResponse = { id: 'p', name: 'VAT 18% (Purchases)', rate: 0.18, type: 0, scope: 1, isActive: true };
const exempt: TaxDefinitionResponse = { id: 'e', name: 'Exempt', rate: 0, type: 2, scope: 2, isActive: true };

test('taxesForSale includes Sale and Both scoped taxes', () => {
  expect(taxesForSale([sale, purchase, exempt])).toEqual([sale, exempt]);
});

test('taxesForPurchase includes Purchase and Both scoped taxes', () => {
  expect(taxesForPurchase([sale, purchase, exempt])).toEqual([purchase, exempt]);
});

test('taxRatePercentLabel formats the rate as a whole percentage', () => {
  expect(taxRatePercentLabel(sale)).toBe('VAT 18% (Sales) (18%)');
});

test('estimatedTaxAmount rounds to 2 decimals', () => {
  expect(estimatedTaxAmount(100, sale)).toBe(18);
  expect(estimatedTaxAmount(100, undefined)).toBe(0);
});
