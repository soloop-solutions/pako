import { describe, expect, it } from "vitest";

import { isMultiCellBlock, parseClipboardBlock } from "@/pages/ledger/journal-grid/clipboard";

describe("parseClipboardBlock", () => {
  it("parses a single cell", () => {
    expect(parseClipboardBlock("100.00")).toEqual([["100.00"]]);
  });

  it("parses a single row of tab-separated columns", () => {
    expect(parseClipboardBlock("100100\tRent\t500.00")).toEqual([["100100", "Rent", "500.00"]]);
  });

  it("parses multiple newline-separated rows", () => {
    expect(parseClipboardBlock("100100\tRent\n200100\tAP")).toEqual([
      ["100100", "Rent"],
      ["200100", "AP"],
    ]);
  });

  it("handles CRLF line endings from Excel", () => {
    expect(parseClipboardBlock("A\tB\r\nC\tD")).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("drops a single trailing blank row from a trailing newline, but keeps interior blank rows", () => {
    expect(parseClipboardBlock("A\nB\n")).toEqual([["A"], ["B"]]);
    expect(parseClipboardBlock("A\n\nB")).toEqual([["A"], [""], ["B"]]);
  });
});

describe("isMultiCellBlock", () => {
  it("is false for a single cell", () => {
    expect(isMultiCellBlock([["100.00"]])).toBe(false);
  });

  it("is true for multiple columns or multiple rows", () => {
    expect(isMultiCellBlock([["A", "B"]])).toBe(true);
    expect(isMultiCellBlock([["A"], ["B"]])).toBe(true);
  });
});
