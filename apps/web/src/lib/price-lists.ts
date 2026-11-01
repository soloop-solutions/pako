import type { PriceListResponse } from "@pako/shared";

// "Retail · Shop 2", or "Hotels · Customer list" (docs/POS_PLAN.md P6).
export function priceListLabel(list: PriceListResponse, customerListLabel: string): string {
  if (list.isCustomerList) return `${list.name} · ${customerListLabel}`;
  return list.warehouseName ? `${list.name} · ${list.warehouseName}` : list.name;
}
