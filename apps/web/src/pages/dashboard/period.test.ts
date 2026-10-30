import { describe, expect, it } from "vitest";

import { compareRangeFor, rangeFor, readPeriod, writePeriod } from "@/pages/dashboard/period";

const today = new Date(2026, 9, 30); // 30 Oct 2026

describe("dashboard period", () => {
  it("resolves calendar periods from their anchor", () => {
    expect(rangeFor("month", "2026-02", today)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(rangeFor("quarter", "2026-Q3", today)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(rangeFor("year", "2025", today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(rangeFor("ytd", "", today)).toEqual({ from: "2026-01-01", to: "2026-10-30" });
    expect(rangeFor("last30", "", today)).toEqual({ from: "2026-10-01", to: "2026-10-30" });
    expect(rangeFor("last12m", "", today)).toEqual({ from: "2025-11-01", to: "2026-10-30" });
    // A custom range typed backwards is put in order.
    expect(rangeFor("custom", "", today, { from: "2026-03-10", to: "2026-01-15" })).toEqual({ from: "2026-01-15", to: "2026-03-10" });
  });

  it("compares with the previous period of the same shape, or the same dates in earlier years", () => {
    expect(compareRangeFor("previous", "month", { from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(compareRangeFor("previous", "quarter", { from: "2026-01-01", to: "2026-03-31" })).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(compareRangeFor("previous", "last30", { from: "2026-10-01", to: "2026-10-30" })).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(compareRangeFor("lastYear", "custom", { from: "2024-02-29", to: "2024-03-31" })).toEqual({ from: "2023-02-28", to: "2023-03-31" });
    expect(compareRangeFor("twoYears", "year", { from: "2026-01-01", to: "2026-12-31" })).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    expect(compareRangeFor("none", "month", { from: "2026-03-01", to: "2026-03-31" })).toBeNull();
    expect(compareRangeFor("custom", "month", { from: "2026-03-01", to: "2026-03-31" }, { from: "2025-01-01", to: "2025-06-30" })).toEqual({ from: "2025-01-01", to: "2025-06-30" });
  });

  it("reads and writes the URL, defaulting to this month against last year", () => {
    const initial = readPeriod(new URLSearchParams(), today);
    expect(initial.kind).toBe("month");
    expect(initial.range).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(initial.compare).toEqual({ from: "2025-10-01", to: "2025-10-31" });

    let params = writePeriod(new URLSearchParams("tab=x"), { kind: "quarter", anchor: "2026-Q2" });
    params = writePeriod(params, { compareKind: "previous", granularity: "week" });
    expect(params.get("tab")).toBe("x");
    const read = readPeriod(params, today);
    expect(read.range).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(read.compare).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(read.granularity).toBe("week");

    // Leaving custom drops its dates.
    params = writePeriod(writePeriod(params, { kind: "custom", from: "2026-01-01", to: "2026-01-31" }), { kind: "year" });
    expect(params.has("from")).toBe(false);
  });
});
