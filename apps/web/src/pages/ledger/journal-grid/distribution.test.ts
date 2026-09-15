import { describe, expect, it } from "vitest";

import { isDistributionComplete, sumAllocationUnits, toPercentageUnits } from "@/pages/ledger/journal-grid/distribution";
import type { CostCenterAllocation } from "@/pages/ledger/journal-grid/types";

function allocation(costCenterId: string, percentage: string): CostCenterAllocation {
  return { id: `alloc-${costCenterId}-${percentage}`, costCenterId, costCenterLabel: costCenterId, percentage };
}

describe("toPercentageUnits", () => {
  it("parses a decimal percentage into hundredths", () => {
    expect(toPercentageUnits("33.33")).toBe(3333);
    expect(toPercentageUnits("")).toBe(0);
    expect(toPercentageUnits("abc")).toBe(0);
  });
});

describe("sumAllocationUnits", () => {
  it("sums without float dust across three thirds", () => {
    const allocations = [allocation("cc-1", "33.33"), allocation("cc-2", "33.33"), allocation("cc-3", "33.34")];
    expect(sumAllocationUnits(allocations)).toBe(10_000);
  });
});

describe("isDistributionComplete", () => {
  it("treats zero allocations as valid (unassigned)", () => {
    expect(isDistributionComplete([])).toBe(true);
  });

  it("accepts a single allocation at exactly 100%", () => {
    expect(isDistributionComplete([allocation("cc-1", "100")])).toBe(true);
  });

  it("accepts a multi-way split that sums to exactly 100%", () => {
    expect(isDistributionComplete([allocation("cc-1", "60"), allocation("cc-2", "40")])).toBe(true);
  });

  it("rejects a split that sums to less than 100%", () => {
    expect(isDistributionComplete([allocation("cc-1", "60"), allocation("cc-2", "20")])).toBe(false);
  });

  it("rejects a split that sums to more than 100%", () => {
    expect(isDistributionComplete([allocation("cc-1", "60"), allocation("cc-2", "50")])).toBe(false);
  });

  it("rejects an allocation with a percentage but no cost center chosen, even if percentages sum to 100", () => {
    expect(isDistributionComplete([{ id: "a", costCenterId: "", costCenterLabel: "", percentage: "100" }])).toBe(false);
  });
});
