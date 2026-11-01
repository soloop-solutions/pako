import { describe, expect, it } from "vitest";

import { accountPath, employeePath, entityPath, itemPath, partnerPath, stockMoveSourcePath } from "./entityLinks";

describe("entityLinks", () => {
  it.each([
    ["Invoice", "/invoicing/a1"],
    ["SalesReturn", "/sales-returns/a1"],
    ["Bill", "/bills/a1"],
    ["PurchaseReturn", "/purchase-returns/a1"],
    ["PayrollRun", "/payroll/a1"],
    ["StockDocument", "/stock-documents/a1"],
    ["JournalEntry", "/ledger?entry=a1"],
  ])("maps %s", (kind, path) => {
    expect(entityPath({ kind, id: "a1" })).toBe(path);
  });

  it("returns null for missing or unknown input", () => {
    expect(entityPath(null)).toBeNull();
    expect(entityPath({ kind: "Invoice" })).toBeNull();
    expect(entityPath({ kind: undefined, id: "a1" })).toBeNull();
    expect(entityPath({ kind: "Nope", id: "a1" })).toBeNull();
    expect(entityPath({ kind: "constructor", id: "a1" })).toBeNull();
    expect(entityPath({ kind: "Invoice", id: "" })).toBeNull();
  });

  it("builds account, partner, item and employee paths", () => {
    expect(accountPath("x")).toBe("/chart-of-accounts?open=x");
    expect(partnerPath("x")).toBe("/partners?open=x");
    expect(partnerPath("x", "customer")).toBe("/customers?open=x");
    expect(partnerPath("x", "vendor")).toBe("/vendors?open=x");
    expect(itemPath("x")).toBe("/items?open=x");
    expect(employeePath("x")).toBe("/employees/x");
    for (const fn of [accountPath, partnerPath, itemPath, employeePath]) {
      expect(fn(undefined)).toBeNull();
      expect(fn("")).toBeNull();
    }
  });

  it("maps stock move sources", () => {
    expect(stockMoveSourcePath(0, "b")).toBe("/bills/b");
    expect(stockMoveSourcePath(1, "i")).toBe("/invoicing/i");
    expect(stockMoveSourcePath(2, "d")).toBe("/stock-documents/d");
    expect(stockMoveSourcePath(9, "d")).toBeNull();
    expect(stockMoveSourcePath(1, undefined)).toBeNull();
    expect(stockMoveSourcePath(undefined, "x")).toBeNull();
  });

  it.each([
    ["empty guid", "00000000-0000-0000-0000-000000000000"],
    ["braced", "{00000000-0000-0000-0000-000000000000}"],
    ["blank", "   "],
  ])("every helper returns null for %s", (_n, id) => {
    expect(entityPath({ kind: "Invoice", id })).toBeNull();
    expect(accountPath(id)).toBeNull();
    expect(partnerPath(id)).toBeNull();
    expect(partnerPath(id, "customer")).toBeNull();
    expect(itemPath(id)).toBeNull();
    expect(employeePath(id)).toBeNull();
    expect(stockMoveSourcePath(1, id)).toBeNull();
  });
});
