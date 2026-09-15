import { describe, expect, it } from "vitest";

import { filterOptions, optionLabel, resolvePickerCommit, type PickerOption } from "@/pages/ledger/journal-grid/pickerMatch";

const ACCOUNTS: PickerOption[] = [
  { id: "acc-cash", code: "100100", name: "Cash" },
  { id: "acc-bank", code: "101003", name: "Bank — ProCredit" },
  { id: "acc-rent", code: "661200", name: "Other Expenses" },
];

describe("optionLabel", () => {
  it("prefixes the code when present", () => {
    expect(optionLabel(ACCOUNTS[0])).toBe("100100 · Cash");
  });

  it("falls back to just the name when there is no code", () => {
    expect(optionLabel({ id: "p1", name: "Acme LLC" })).toBe("Acme LLC");
  });
});

describe("filterOptions", () => {
  it("returns everything for a blank query", () => {
    expect(filterOptions(ACCOUNTS, "  ")).toEqual(ACCOUNTS);
  });

  it("matches by code substring", () => {
    expect(filterOptions(ACCOUNTS, "6612")).toEqual([ACCOUNTS[2]]);
    expect(filterOptions(ACCOUNTS, "10")).toEqual([ACCOUNTS[0], ACCOUNTS[1]]);
  });

  it("matches by name substring, case-insensitively", () => {
    expect(filterOptions(ACCOUNTS, "expenses")).toEqual([ACCOUNTS[2]]);
  });
});

describe("resolvePickerCommit", () => {
  it("clears the selection for blank text", () => {
    expect(resolvePickerCommit("   ", ACCOUNTS, { id: "acc-cash", label: "100100 · Cash" })).toBeNull();
  });

  it("takes an exact code match over any other match", () => {
    expect(resolvePickerCommit("101003", ACCOUNTS, null)).toEqual({ id: "acc-bank", label: "101003 · Bank — ProCredit" });
  });

  it("takes the first match when the text narrows to one or more options", () => {
    expect(resolvePickerCommit("cash", ACCOUNTS, null)).toEqual({ id: "acc-cash", label: "100100 · Cash" });
  });

  it("keeps the previous selection when nothing matches, instead of clearing it", () => {
    const previous = { id: "acc-cash", label: "100100 · Cash" };
    expect(resolvePickerCommit("zzz-no-match", ACCOUNTS, previous)).toEqual(previous);
  });

  it("returns null when nothing matches and there was no previous selection", () => {
    expect(resolvePickerCommit("zzz-no-match", ACCOUNTS, null)).toBeNull();
  });
});
