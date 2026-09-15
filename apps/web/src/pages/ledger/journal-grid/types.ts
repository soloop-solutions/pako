// F9 — the manual journal entry grid. Shared types for the grid's own local, pre-save line model
// (distinct from CreateJournalEntryLineRequest, which is only built at submit time — see
// JournalEntryGrid.tsx's submit()).

export const GRID_COLUMNS = ["account", "description", "debit", "credit", "partner", "costCenter"] as const;

export type GridColumn = (typeof GRID_COLUMNS)[number];

export const COLUMN_COUNT = GRID_COLUMNS.length;

// F12 upgrades the single cost-center picker to a distribution: a line can be split across
// several cost centers by percentage instead of picking exactly one. `percentage` is kept as raw
// typed text (same "string, not number" convention as GridLine.debit/credit) so a half-typed value
// isn't silently coerced while the user is still editing it in the DistributionEditor popover.
export interface CostCenterAllocation {
  id: string;
  costCenterId: string;
  costCenterLabel: string;
  percentage: string;
}

export interface GridLine {
  id: string;
  accountId: string;
  accountLabel: string;
  description: string;
  debit: string;
  credit: string;
  partnerId: string;
  partnerLabel: string;
  costCenterAllocations: CostCenterAllocation[];
}

export function emptyLine(id: string, description = ""): GridLine {
  return {
    id,
    accountId: "",
    accountLabel: "",
    description,
    debit: "",
    credit: "",
    partnerId: "",
    partnerLabel: "",
    costCenterAllocations: [],
  };
}

export interface CellPosition {
  row: number;
  col: number;
}

export interface NavigationTarget extends CellPosition {
  grow: boolean;
}
