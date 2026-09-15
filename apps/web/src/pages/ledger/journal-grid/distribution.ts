// F12 — pure validation for a line's analytic distribution (see DistributionEditor.tsx). Cent-style
// integer arithmetic (hundredths of a percent) for the same reason balance.ts uses cent-integer
// money: summing typed decimal percentages as floats risks 0.1 + 0.2-style dust landing one hair
// away from exactly 100.

import type { CostCenterAllocation } from "@/pages/ledger/journal-grid/types";

const FULL_DISTRIBUTION_UNITS = 100_00;

export function toPercentageUnits(value: string): number {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function sumAllocationUnits(allocations: CostCenterAllocation[]): number {
  return allocations.reduce((sum, allocation) => sum + toPercentageUnits(allocation.percentage), 0);
}

// A line with zero allocations is "unassigned" — a valid, deliberate state (the same way the old
// single cost-center picker allowed leaving no cost center selected at all), not treated as an
// incomplete 0%. Any allocation actually present must have a cost center chosen and the full set
// must sum to exactly 100%; a partial split (e.g. 60% with 40% left unaccounted for) is invalid.
export function isDistributionComplete(allocations: CostCenterAllocation[]): boolean {
  if (allocations.length === 0) return true;
  if (allocations.some((allocation) => !allocation.costCenterId)) return false;
  return sumAllocationUnits(allocations) === FULL_DISTRIBUTION_UNITS;
}
