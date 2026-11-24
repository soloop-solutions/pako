export const NegativeNumberStyle = { Parentheses: 0, MinusSign: 1 } as const;

let currentStyle: number = NegativeNumberStyle.Parentheses;

export function setNegativeNumberStyle(style: number | undefined): void {
  currentStyle = style === NegativeNumberStyle.MinusSign ? NegativeNumberStyle.MinusSign : NegativeNumberStyle.Parentheses;
}

// User decision 2026-11-24: money reads 1,234.56 everywhere (comma thousands, point decimals),
// whatever the interface language — the same digits as the API sent, only grouped. Display only.
const moneyFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const text = moneyFormat.format(value);
  return text === "-0.00" ? "0.00" : text;
}

export function formatReportAmount(value: number): string {
  const text = moneyFormat.format(Math.abs(value));
  if (value >= 0 || text === "0.00") return text;
  return currentStyle === NegativeNumberStyle.MinusSign ? `-${text}` : `(${text})`;
}

const priceFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Unit prices: 1,234.5678 — up to four decimals, the same grouping as formatMoney. */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return priceFormat.format(value);
}

/** formatMoney, with a placeholder (e.g. "..." while a balance loads) when there is no value. */
export function formatMoneyOr(value: number | null | undefined, fallback: string): string {
  return value === null || value === undefined ? fallback : formatMoney(value);
}
