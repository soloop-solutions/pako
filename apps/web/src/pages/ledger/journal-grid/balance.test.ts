import { describe, expect, it } from "vitest";

import { autoBalanceLastLine, computeTotals } from "@/pages/ledger/journal-grid/balance";
import { emptyLine, type GridLine } from "@/pages/ledger/journal-grid/types";

function line(overrides: Partial<GridLine> = {}): GridLine {
  return { ...emptyLine("id"), ...overrides };
}

describe("computeTotals", () => {
  it("sums debit and credit and reports the difference in cents", () => {
    const totals = computeTotals([line({ debit: "100.00" }), line({ credit: "40.00" })]);
    expect(totals).toEqual({ debit: 100, credit: 40, diffCents: 6000 });
  });

  it("treats blank/garbage amounts as zero", () => {
    const totals = computeTotals([line({ debit: "" }), line({ debit: "not-a-number" })]);
    expect(totals).toEqual({ debit: 0, credit: 0, diffCents: 0 });
  });

  it("avoids float drift across many lines", () => {
    const lines = Array.from({ length: 10 }, () => line({ debit: "0.1" }));
    expect(computeTotals(lines).debit).toBe(1);
  });
});

describe("autoBalanceLastLine", () => {
  it("sets the last line's credit when debit is ahead", () => {
    // Other lines: 100 debit. Last line's existing debit is cleared, credit set to close the gap.
    const result = autoBalanceLastLine([line({ debit: "100.00" }), line({ debit: "20.00" })]);
    expect(result[1].debit).toBe("");
    expect(result[1].credit).toBe("100.00");
    expect(computeTotals(result).diffCents).toBe(0);
  });

  it("sets the last line's debit when credit is ahead", () => {
    // Other lines: 75 credit. Last line's existing credit is cleared, debit set to close the gap.
    const result = autoBalanceLastLine([line({ credit: "75.00" }), line({ credit: "5.00" })]);
    expect(result[1].debit).toBe("75.00");
    expect(result[1].credit).toBe("");
    expect(computeTotals(result).diffCents).toBe(0);
  });

  it("replaces the last line as a pure balancing entry, clearing both sides first", () => {
    // Other lines: 100 debit. Last line had 10 credit — discarded and replaced with 100 credit.
    const result = autoBalanceLastLine([line({ debit: "100.00" }), line({ credit: "10.00" })]);
    expect(result[1].debit).toBe("");
    expect(result[1].credit).toBe("100.00");
    expect(computeTotals(result).diffCents).toBe(0);
  });

  it("never creates a line with both debit and credit positive", () => {
    // Last line has debit=50 — auto-balance must clear it, not leave both sides positive.
    const result = autoBalanceLastLine([line({ debit: "200.00" }), line({ debit: "50.00", credit: "10.00" })]);
    expect(result[1].debit).toBe("");
    expect(result[1].credit).toBe("200.00");
    expect(computeTotals(result).diffCents).toBe(0);
  });

  it("is a no-op when already balanced", () => {
    const lines = [line({ debit: "50.00" }), line({ credit: "50.00" })];
    expect(autoBalanceLastLine(lines)).toBe(lines);
  });

  it("is a no-op on an empty grid", () => {
    expect(autoBalanceLastLine([])).toEqual([]);
  });
});
