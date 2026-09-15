import { describe, expect, it } from "vitest";

import { applyItemDefaultsToLine, overriddenItemLineFields, type ItemDefaultableLine, type ItemDefaultsSource } from "@/lib/item-line-defaults";

const BASELINE_TAX_ID = "baseline-tax";

function itemA(): ItemDefaultsSource {
  return { name: "Item A", defaultUnitPrice: 100, defaultTaxDefinitionId: "tax-a", defaultAccountId: "account-a" };
}

function itemBNoDefaults(): ItemDefaultsSource {
  return { name: "Item B", defaultUnitPrice: undefined, defaultTaxDefinitionId: undefined, defaultAccountId: undefined };
}

function emptyLine(): ItemDefaultableLine {
  return { description: "", unitPrice: "", taxDefinitionId: "", accountId: "" };
}

describe("applyItemDefaultsToLine", () => {
  it("pulls every field the item has a default for onto an empty line", () => {
    const result = applyItemDefaultsToLine(emptyLine(), itemA(), BASELINE_TAX_ID);
    expect(result).toEqual({ description: "Item A", unitPrice: "100", taxDefinitionId: "tax-a", accountId: "account-a" });
  });

  it("does not overwrite an already-typed description", () => {
    const line = { ...emptyLine(), description: "Custom description" };
    const result = applyItemDefaultsToLine(line, itemA(), BASELINE_TAX_ID);
    expect(result.description).toBe("Custom description");
  });

  // Regression test for the switch-between-items bug: selecting item A pulls its account/price/tax
  // onto the line, then switching to item B (no defaults of its own) must reset those fields to
  // the form's neutral baseline — never leave A's leftover values sitting there unflagged.
  it("resets fields to the neutral baseline when switching to an item with no defaults, not the previous item's leftover values", () => {
    const afterA = applyItemDefaultsToLine(emptyLine(), itemA(), BASELINE_TAX_ID);
    expect(afterA.accountId).toBe("account-a");

    const afterB = applyItemDefaultsToLine(afterA, itemBNoDefaults(), BASELINE_TAX_ID);

    expect(afterB.unitPrice).toBe("");
    expect(afterB.taxDefinitionId).toBe(BASELINE_TAX_ID);
    expect(afterB.accountId).toBe("");
    // Description convenience-fill still keeps whatever was there (A's name in this case) — not
    // part of the reported bug, only the price/tax/account defaults are.
    expect(afterB.description).toBe("Item A");
  });

  it("only resets the specific fields the new item leaves unset, keeping the ones it does specify", () => {
    const afterA = applyItemDefaultsToLine(emptyLine(), itemA(), BASELINE_TAX_ID);
    const partialItem: ItemDefaultsSource = { name: "Item C", defaultUnitPrice: 50, defaultTaxDefinitionId: undefined, defaultAccountId: undefined };

    const afterC = applyItemDefaultsToLine(afterA, partialItem, BASELINE_TAX_ID);

    expect(afterC.unitPrice).toBe("50");
    expect(afterC.taxDefinitionId).toBe(BASELINE_TAX_ID);
    expect(afterC.accountId).toBe("");
  });
});

describe("overriddenItemLineFields", () => {
  it("flags nothing when no item is selected", () => {
    expect(overriddenItemLineFields(emptyLine(), undefined)).toEqual({ price: false, tax: false, account: false });
  });

  it("flags nothing right after an item's defaults are freshly applied", () => {
    const line = applyItemDefaultsToLine(emptyLine(), itemA(), BASELINE_TAX_ID);
    expect(overriddenItemLineFields(line, itemA())).toEqual({ price: false, tax: false, account: false });
  });

  it("flags only the field the user actually changed away from the selected item's default", () => {
    const line = applyItemDefaultsToLine(emptyLine(), itemA(), BASELINE_TAX_ID);
    const editedPrice = { ...line, unitPrice: "999" };
    expect(overriddenItemLineFields(editedPrice, itemA())).toEqual({ price: true, tax: false, account: false });
  });

  it("never flags a field the selected item has no default for, even if the line carries a leftover value", () => {
    // Simulates the exact post-fix state from the switch-between-items scenario: after resetting,
    // account is "" and item B has no default account, so there is nothing to compare — not
    // flagged. Before the fix this line would have still held item A's account unflagged too, for
    // the wrong reason (comparison was vacuously false against B's unset default either way) — this
    // test pins the correct end state, not just the absence of a false positive.
    const line = applyItemDefaultsToLine(applyItemDefaultsToLine(emptyLine(), itemA(), BASELINE_TAX_ID), itemBNoDefaults(), BASELINE_TAX_ID);
    expect(overriddenItemLineFields(line, itemBNoDefaults())).toEqual({ price: false, tax: false, account: false });
  });
});
