// F5 — shared by InvoiceForm.tsx (line.revenueAccountId) and BillForm.tsx
// (line.expenseAccountId), which otherwise had byte-identical "pull an item's defaults onto a
// line" / "did the user override something" logic under different field names. Operates on a
// small adapter shape rather than either form's own `Line` type, so it's directly unit-testable
// (see item-line-defaults.test.ts) without a component harness for either page.

export interface ItemDefaultableLine {
  description: string;
  unitPrice: string;
  taxDefinitionId: string;
  accountId: string;
}

export interface ItemDefaultsSource {
  name: string;
  defaultUnitPrice: number | undefined;
  defaultTaxDefinitionId: string | undefined;
  defaultAccountId: string | undefined;
}

// Pulls an item's defaults onto a line. A field the item has no default for resets to the form's
// own neutral baseline (`baselineTaxId`/empty), never to whatever value was left over from a
// PREVIOUSLY selected item on this same line — that was the real bug: switching from item A (a
// default revenue/expense account) to item B (no default account) used to leave the line silently
// showing A's account, unflagged as modified, even though it has nothing to do with either item or
// the company default. Only called with a real `item` — the "no item selected" transition is the
// caller's own responsibility (see InvoiceForm.tsx/BillForm.tsx's `selectLineItem`) and is left
// untouched, since a line whose item picker is set back to "none" keeps behaving like a plain
// free-text line, not reset to some other baseline.
export function applyItemDefaultsToLine(
  line: ItemDefaultableLine,
  item: ItemDefaultsSource,
  baselineTaxId: string,
): ItemDefaultableLine {
  return {
    description: line.description.trim() ? line.description : item.name,
    unitPrice: item.defaultUnitPrice != null ? String(item.defaultUnitPrice) : "",
    taxDefinitionId: item.defaultTaxDefinitionId ?? baselineTaxId,
    accountId: item.defaultAccountId ?? "",
  };
}

// "Shows clearly when it has overridden something": only a field the SELECTED item actually has
// its own default for can be "overridden" — comparing against an unset item default would flag
// every line as modified the moment it had any value at all.
export function overriddenItemLineFields(
  line: ItemDefaultableLine,
  item: ItemDefaultsSource | undefined,
): { price: boolean; tax: boolean; account: boolean } {
  if (!item) return { price: false, tax: false, account: false };
  const price =
    item.defaultUnitPrice != null && Math.round((parseFloat(line.unitPrice) || 0) * 100) !== Math.round(item.defaultUnitPrice * 100);
  const tax = item.defaultTaxDefinitionId != null && line.taxDefinitionId !== item.defaultTaxDefinitionId;
  const account = item.defaultAccountId != null && line.accountId !== item.defaultAccountId;
  return { price, tax, account };
}
