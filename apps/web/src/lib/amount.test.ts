import { afterEach, describe, expect, it } from "vitest";

import { formatReportAmount, NegativeNumberStyle, setNegativeNumberStyle } from "@/lib/amount";

afterEach(() => setNegativeNumberStyle(undefined));

describe("formatReportAmount", () => {
  it("wraps negatives in parentheses by default, never (-100)", () => {
    expect(formatReportAmount(-1234.5)).toBe("(1234.50)");
    expect(formatReportAmount(1234.5)).toBe("1234.50");
    expect(formatReportAmount(0)).toBe("0.00");
  });

  it("shows a minus sign when the company chose it", () => {
    setNegativeNumberStyle(NegativeNumberStyle.MinusSign);
    expect(formatReportAmount(-100)).toBe("-100.00");
    expect(formatReportAmount(100)).toBe("100.00");
  });

  it("never prints a negative zero", () => {
    expect(formatReportAmount(-0.004)).toBe("0.00");
    setNegativeNumberStyle(NegativeNumberStyle.MinusSign);
    expect(formatReportAmount(-0.004)).toBe("0.00");
  });
});
