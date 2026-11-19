export const NegativeNumberStyle = { Parentheses: 0, MinusSign: 1 } as const;

let currentStyle: number = NegativeNumberStyle.Parentheses;

export function setNegativeNumberStyle(style: number | undefined): void {
  currentStyle = style === NegativeNumberStyle.MinusSign ? NegativeNumberStyle.MinusSign : NegativeNumberStyle.Parentheses;
}

export function formatReportAmount(value: number): string {
  const text = Math.abs(value).toFixed(2);
  if (value >= 0 || Number(text) === 0) return text;
  return currentStyle === NegativeNumberStyle.MinusSign ? `-${text}` : `(${text})`;
}
