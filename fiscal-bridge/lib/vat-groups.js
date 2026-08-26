/**
 * Kosovo VAT group mapping for fiscal printers.
 * Group A = 18%, Group B = 8%, Group C = 0%
 */

const VAT_GROUPS = {
  18: { letter: "A", number: 1, rate: 18 },
  8: { letter: "B", number: 2, rate: 8 },
  0: { letter: "C", number: 3, rate: 0 },
};

function getVatGroup(rate) {
  const normalizedRate = Number(rate) || 0;
  return VAT_GROUPS[normalizedRate] || VAT_GROUPS[0];
}

function getVatGroupLetter(rate) {
  return getVatGroup(rate).letter;
}

function getVatGroupNumber(rate) {
  return getVatGroup(rate).number;
}

module.exports = { getVatGroup, getVatGroupLetter, getVatGroupNumber, VAT_GROUPS };
