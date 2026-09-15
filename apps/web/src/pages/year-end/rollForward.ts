// F12 — pure merge of two BalanceSheetResponse snapshots (beginning-of-year / end-of-year) into a
// roll-forward view. No new backend endpoint exists for this (there is no fiscal-year/closing
// concept anywhere in backend/ — see YearEnd.tsx's own header), so this is built entirely from the
// real, already-shipped `GET .../reports/balance-sheet?asOf=` endpoint called twice. The only
// arithmetic done client-side is `ending - beginning`, a plain subtraction of two numbers the API
// itself returned — not a derived business figure (no tax, no VAT, no rounding rule) — which is
// exactly what this task's own brief instructs ("show the difference as the year's movement").

import type { BalanceSheetResponse, ReportLine } from "@pako/shared";

export interface RollForwardLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  beginning: number;
  movement: number;
  ending: number;
}

export interface RollForward {
  assets: RollForwardLine[];
  liabilities: RollForwardLine[];
  equity: RollForwardLine[];
  totalBeginningAssets: number;
  totalEndingAssets: number;
  totalBeginningLiabilities: number;
  totalEndingLiabilities: number;
  totalBeginningEquity: number;
  totalEndingEquity: number;
}

// Union of the account ids present in either snapshot — an account with zero movement can
// legitimately be missing from one side (the balance-sheet endpoint only returns accounts with a
// nonzero balance) without meaning "delete this row," and one with a balance in only one snapshot
// still needs to show up with the other side at 0. Equity's synthetic "Current Earnings" line
// (Account.Id = Guid.Empty, same id in both snapshots per ReportsController.BalanceSheet) merges
// into one row naturally through this same id-based join — its movement works out to exactly the
// fiscal year's net income, since both snapshots are cumulative since company inception and the
// prior years' contributions cancel out in the subtraction.
export function buildRollForwardSection(beginningLines: ReportLine[], endingLines: ReportLine[]): RollForwardLine[] {
  const beginningById = new Map(beginningLines.map((line) => [line.accountId, line]));
  const endingById = new Map(endingLines.map((line) => [line.accountId, line]));
  const ids = new Set<string>([...beginningById.keys(), ...endingById.keys()]);

  return Array.from(ids)
    .map((accountId): RollForwardLine => {
      const beginningLine = beginningById.get(accountId);
      const endingLine = endingById.get(accountId);
      const reference = endingLine ?? beginningLine!;
      const beginning = beginningLine?.amount ?? 0;
      const ending = endingLine?.amount ?? 0;
      return {
        accountId,
        accountCode: reference.accountCode,
        accountName: reference.accountName,
        beginning,
        movement: ending - beginning,
        ending,
      };
    })
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

export function buildRollForward(beginning: BalanceSheetResponse, ending: BalanceSheetResponse): RollForward {
  return {
    assets: buildRollForwardSection(beginning.assets, ending.assets),
    liabilities: buildRollForwardSection(beginning.liabilities, ending.liabilities),
    equity: buildRollForwardSection(beginning.equity, ending.equity),
    totalBeginningAssets: beginning.totalAssets,
    totalEndingAssets: ending.totalAssets,
    totalBeginningLiabilities: beginning.totalLiabilities,
    totalEndingLiabilities: ending.totalLiabilities,
    totalBeginningEquity: beginning.totalEquity,
    totalEndingEquity: ending.totalEquity,
  };
}
