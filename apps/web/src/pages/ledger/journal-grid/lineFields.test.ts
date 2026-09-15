import { describe, expect, it } from "vitest";

import { commitCellValue, getCellText, sanitizeAmount } from "@/pages/ledger/journal-grid/lineFields";
import type { PickerOption } from "@/pages/ledger/journal-grid/pickerMatch";
import { emptyLine } from "@/pages/ledger/journal-grid/types";

const ACCOUNTS: PickerOption[] = [{ id: "acc-cash", code: "100100", name: "Cash" }];
const OPTIONS = { account: ACCOUNTS, partner: [] as PickerOption[] };

describe("sanitizeAmount", () => {
  it("passes through a plain decimal", () => {
    expect(sanitizeAmount("120.50", "")).toBe("120.50");
  });

  it("accepts a comma decimal separator", () => {
    expect(sanitizeAmount("120,50", "")).toBe("120.50");
  });

  it("clears on blank input", () => {
    expect(sanitizeAmount("   ", "9.00")).toBe("");
  });

  it("keeps the previous value for unparsable garbage", () => {
    expect(sanitizeAmount("abc", "9.00")).toBe("9.00");
  });
});

describe("commitCellValue", () => {
  it("writes description as-is", () => {
    const result = commitCellValue(emptyLine("l1"), "description", "September rent", OPTIONS);
    expect(result.description).toBe("September rent");
  });

  it("resolves the account column to an id + label via the picker match", () => {
    const result = commitCellValue(emptyLine("l1"), "account", "100100", OPTIONS);
    expect(result.accountId).toBe("acc-cash");
    expect(result.accountLabel).toBe("100100 · Cash");
  });

  it("clears the account when committed blank", () => {
    const withAccount = commitCellValue(emptyLine("l1"), "account", "100100", OPTIONS);
    const cleared = commitCellValue(withAccount, "account", "", OPTIONS);
    expect(cleared.accountId).toBe("");
    expect(cleared.accountLabel).toBe("");
  });

  it("round-trips through getCellText", () => {
    const result = commitCellValue(emptyLine("l1"), "debit", "42.00", OPTIONS);
    expect(getCellText(result, "debit")).toBe("42.00");
  });

  it("F12: the distribution (costCenter) cell has no free-text commit — it is a no-op with blank cell text", () => {
    const line = { ...emptyLine("l1"), costCenterAllocations: [{ id: "a1", costCenterId: "cc-1", costCenterLabel: "CC-1", percentage: "100" }] };
    expect(getCellText(line, "costCenter")).toBe("");
    const result = commitCellValue(line, "costCenter", "anything typed here", OPTIONS);
    expect(result.costCenterAllocations).toEqual(line.costCenterAllocations);
  });
});
