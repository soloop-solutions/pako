import type { TaxDefinitionResponse } from '@pako/shared';

import { computeFromGross, taxesForPurchase, taxesForSale, taxRatePercentLabel } from '@/lib/tax-enums';

const sale: TaxDefinitionResponse = {
  id: 's',
  name: 'VAT 18% (Sales)',
  rate: 0.18,
  type: 0,
  scope: 0,
  isActive: true,
  code: 'S18',
  direction: 0,
  isReverseCharge: false,
};
const purchase: TaxDefinitionResponse = {
  id: 'p',
  name: 'VAT 18% (Purchases)',
  rate: 0.18,
  type: 0,
  scope: 1,
  isActive: true,
  code: 'B18',
  direction: 1,
  isReverseCharge: false,
};
const exempt: TaxDefinitionResponse = {
  id: 'e',
  name: 'Exempt',
  rate: 0,
  type: 2,
  scope: 2,
  isActive: true,
  code: 'NA',
  direction: 4,
  isReverseCharge: false,
};
const reverseCharge: TaxDefinitionResponse = {
  id: 'rc',
  name: 'Reverse charge - imported services 18%',
  rate: 0.18,
  type: 0,
  scope: 2,
  isActive: true,
  code: 'RC18',
  direction: 3,
  isReverseCharge: true,
};

test('taxesForSale includes Sale and Both scoped taxes', () => {
  expect(taxesForSale([sale, purchase, exempt])).toEqual([sale, exempt]);
});

test('taxesForPurchase includes Purchase and Both scoped taxes', () => {
  expect(taxesForPurchase([sale, purchase, exempt])).toEqual([purchase, exempt]);
});

test('taxRatePercentLabel formats the rate as a whole percentage', () => {
  expect(taxRatePercentLabel(sale)).toBe('VAT 18% (Sales) (18%)');
});

test('computeFromGross backs VAT out of the entered gross amount, not on top of it', () => {
  // 100 gross at 18% VAT: net = 100/1.18 = 84.7457... rounds to 84.75, tax = the exact
  // remainder 15.25 (not 84.75 * 0.18 = 15.255 rounded independently to 15.26).
  expect(computeFromGross(100, sale)).toEqual({ net: 84.75, tax: 15.25 });
  expect(computeFromGross(100, undefined)).toEqual({ net: 100, tax: 0 });
});

test('computeFromGross leaves reverse-charge amounts untouched', () => {
  expect(computeFromGross(100, reverseCharge)).toEqual({ net: 100, tax: 0 });
});
