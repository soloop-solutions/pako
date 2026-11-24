import { describe, expect, it } from "vitest";

import { datePresetRange, matchingDatePreset } from "@/lib/date-presets";

// Wednesday 2026-11-25.
const TODAY = new Date(2026, 10, 25);

describe("date presets", () => {
  it.each([
    ["today", "2026-11-25", "2026-11-25"],
    ["yesterday", "2026-11-24", "2026-11-24"],
    ["thisWeek", "2026-11-23", "2026-11-29"],
    ["last7Days", "2026-11-19", "2026-11-25"],
    ["thisMonth", "2026-11-01", "2026-11-30"],
    ["lastMonth", "2026-10-01", "2026-10-31"],
    ["last30Days", "2026-10-27", "2026-11-25"],
    ["thisQuarter", "2026-10-01", "2026-12-31"],
    ["lastQuarter", "2026-07-01", "2026-09-30"],
    ["thisYear", "2026-01-01", "2026-12-31"],
    ["lastYear", "2025-01-01", "2025-12-31"],
  ] as const)("%s", (id, from, to) => {
    expect(datePresetRange(id, TODAY)).toEqual([from, to]);
  });

  it("crosses the year for last month and last quarter in January", () => {
    const january = new Date(2027, 0, 10);
    expect(datePresetRange("lastMonth", january)).toEqual(["2026-12-01", "2026-12-31"]);
    expect(datePresetRange("lastQuarter", january)).toEqual(["2026-10-01", "2026-12-31"]);
  });

  it("recognises a range that equals a preset", () => {
    expect(matchingDatePreset("2026-11-01", "2026-11-30", TODAY)).toBe("thisMonth");
    expect(matchingDatePreset("2026-11-02", "2026-11-30", TODAY)).toBeUndefined();
  });
});
