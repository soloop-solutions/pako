// docs/INVENTORY_PLAN.md §12 P5. Pako.Api doesn't emit enum member names, so these arrive as plain
// numbers. Order must match backend/Pako.Domain/Bills/PurchaseOrder.cs exactly, by hand.
export const PurchaseOrderState = { Draft: 0, Confirmed: 1, Closed: 2, Cancelled: 3 } as const;
export const PURCHASE_ORDER_STATES = [0, 1, 2, 3] as const;
