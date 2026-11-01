// docs/POS_PLAN.md P6 — distribution. Pako.Api doesn't emit enum member names, so these arrive as
// plain numbers. Order must match backend/Pako.Domain/Invoicing/SalesOrder.cs and
// backend/Pako.Domain/Inventory/VanSales.cs exactly, by hand.

export const SalesOrderState = { Draft: 0, Quoted: 1, Confirmed: 2, Closed: 3, Cancelled: 4 } as const;
export const SALES_ORDER_STATES = [0, 1, 2, 3, 4] as const;

export const RouteVisitOutcome = { Open: 0, Order: 1, Sale: 2, Collection: 3, NoOrder: 4, Closed: 5 } as const;
export const VISIT_OUTCOMES = [1, 2, 3, 4, 5] as const;

// A route's days are a bitmask: Monday = 1, Tuesday = 2, … Sunday = 64.
export const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const dayBit = (day: number) => 1 << day;
export const hasDay = (days: number, day: number) => (days & dayBit(day)) !== 0;

export function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const formatIsoDate = (intl: { formatDate: (d: Date, o: Intl.DateTimeFormatOptions) => string }, value: string | undefined) =>
  value ? intl.formatDate(new Date(`${value}T00:00`), { dateStyle: "medium" }) : "—";
