// F9 — the manual journal entry grid. Shared types for the grid's own local, pre-save line model
// (distinct from CreateJournalEntryLineRequest, which is only built at submit time — see
// JournalEntryGrid.tsx's submit()).

export const GRID_COLUMNS = ["account", "description", "debit", "credit", "partner", "costCenter"] as const;

export type GridColumn = (typeof GRID_COLUMNS)[number];

export const COLUMN_COUNT = GRID_COLUMNS.length;

export interface GridLine {
  id: string;
  accountId: string;
  accountLabel: string;
  description: string;
  debit: string;
  credit: string;
  partnerId: string;
  partnerLabel: string;
  costCenterId: string;
  costCenterLabel: string;
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
    costCenterId: "",
    costCenterLabel: "",
  };
}

export interface CellPosition {
  row: number;
  col: number;
}

export interface NavigationTarget extends CellPosition {
  grow: boolean;
}
