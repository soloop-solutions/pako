import { describe, expect, it } from "vitest";
import type { BalanceSheetResponse, ReportLine } from "@pako/shared";

import { buildRollForward, buildRollForwardSection } from "@/pages/year-end/rollForward";

function line(accountId: string, accountCode: string, accountName: string, amount: number): ReportLine {
  return { accountId, accountCode, accountName, amount };
}

describe("buildRollForwardSection", () => {
  it("computes beginning, movement and ending for an account present in both snapshots", () => {
    const beginning = [line("a1", "1000", "Cash", 100)];
    const ending = [line("a1", "1000", "Cash", 120)];
    expect(buildRollForwardSection(beginning, ending)).toEqual([
      { accountId: "a1", accountCode: "1000", accountName: "Cash", beginning: 100, movement: 20, ending: 120 },
    ]);
  });

  it("treats an account missing from the ending snapshot as ending at 0", () => {
    const beginning = [line("a1", "1000", "Cash", 50)];
    const ending: ReportLine[] = [];
    expect(buildRollForwardSection(beginning, ending)).toEqual([
      { accountId: "a1", accountCode: "1000", accountName: "Cash", beginning: 50, movement: -50, ending: 0 },
    ]);
  });

  it("treats an account missing from the beginning snapshot as beginning at 0", () => {
    const beginning: ReportLine[] = [];
    const ending = [line("a2", "1010", "Bank", 30)];
    expect(buildRollForwardSection(beginning, ending)).toEqual([
      { accountId: "a2", accountCode: "1010", accountName: "Bank", beginning: 0, movement: 30, ending: 30 },
    ]);
  });

  it("sorts the merged rows by account code", () => {
    const beginning = [line("a3", "3000", "C", 0), line("a1", "1000", "A", 0)];
    const ending = [line("a2", "2000", "B", 0)];
    expect(buildRollForwardSection(beginning, ending).map((l) => l.accountCode)).toEqual(["1000", "2000", "3000"]);
  });

  it("merges the synthetic Current Earnings line (shared Guid.Empty id) into one row across both snapshots", () => {
    const beginning = [line("00000000-0000-0000-0000-000000000000", "3999", "Current Earnings", 500)];
    const ending = [line("00000000-0000-0000-0000-000000000000", "3999", "Current Earnings", 620)];
    expect(buildRollForwardSection(beginning, ending)).toEqual([
      {
        accountId: "00000000-0000-0000-0000-000000000000",
        accountCode: "3999",
        accountName: "Current Earnings",
        beginning: 500,
        movement: 120,
        ending: 620,
      },
    ]);
  });
});

describe("buildRollForward", () => {
  it("carries each section's real API totals through untouched and merges the per-account lines", () => {
    const beginning: BalanceSheetResponse = {
      asOf: "2025-12-31",
      assets: [line("a1", "1000", "Cash", 1000)],
      liabilities: [line("l1", "2000", "AP", 400)],
      equity: [line("e1", "3000", "Capital", 600)],
      currentEarnings: 0,
      totalAssets: 1000,
      totalLiabilities: 400,
      totalEquity: 600,
    };
    const ending: BalanceSheetResponse = {
      asOf: "2026-12-31",
      assets: [line("a1", "1000", "Cash", 1500)],
      liabilities: [line("l1", "2000", "AP", 300)],
      equity: [line("e1", "3000", "Capital", 600), line("e2", "3999", "Current Earnings", 300)],
      currentEarnings: 300,
      totalAssets: 1500,
      totalLiabilities: 300,
      totalEquity: 900,
    };

    const rollForward = buildRollForward(beginning, ending);

    expect(rollForward.assets).toEqual([{ accountId: "a1", accountCode: "1000", accountName: "Cash", beginning: 1000, movement: 500, ending: 1500 }]);
    expect(rollForward.totalBeginningAssets).toBe(1000);
    expect(rollForward.totalEndingAssets).toBe(1500);
    expect(rollForward.totalBeginningLiabilities).toBe(400);
    expect(rollForward.totalEndingLiabilities).toBe(300);
    expect(rollForward.totalBeginningEquity).toBe(600);
    expect(rollForward.totalEndingEquity).toBe(900);
    // Beginning had no Current Earnings row (a fresh company with 0 net income to date); ending
    // gained one — the merge must show it at beginning 0, not drop it.
    expect(rollForward.equity.find((l) => l.accountId === "e2")).toEqual({
      accountId: "e2",
      accountCode: "3999",
      accountName: "Current Earnings",
      beginning: 0,
      movement: 300,
      ending: 300,
    });
  });
});
