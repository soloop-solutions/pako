import type { ItemResponse } from "@pako/shared";

// docs/INVENTORY_PLAN.md §12 P7.
// The base units a line's quantity stands for (quantity × the unit's factor).
export function baseQuantity(item: ItemResponse | undefined, unitName: string | undefined, quantity: number): number {
  if (!item || !unitName) return quantity;
  if (unitName === item.purchaseUnit) return quantity * (item.purchaseUnitFactor ?? 1);
  if (unitName === item.salesUnit) return quantity * (item.salesUnitFactor ?? 1);
  return quantity;
}
