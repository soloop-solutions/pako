export type EntityRef = { kind?: string | null; id?: string | null };

const SOURCE_ROUTES: Record<string, (id: string) => string> = {
  Invoice: (id) => `/invoicing/${id}`,
  SalesReturn: (id) => `/sales-returns/${id}`,
  Bill: (id) => `/bills/${id}`,
  PurchaseReturn: (id) => `/purchase-returns/${id}`,
  PayrollRun: (id) => `/payroll/${id}`,
  StockDocument: (id) => `/stock-documents/${id}`,
  JournalEntry: (id) => `/ledger?entry=${id}`,
};

export function entityPath(ref: EntityRef | null | undefined): string | null {
  if (!ref?.kind || !ref.id) return null;
  const build = Object.hasOwn(SOURCE_ROUTES, ref.kind) ? SOURCE_ROUTES[ref.kind] : undefined;
  return build ? build(ref.id) : null;
}

export function accountPath(id: string | null | undefined): string | null {
  return id ? `/chart-of-accounts?open=${id}` : null;
}

export function partnerPath(id: string | null | undefined, side?: "customer" | "vendor"): string | null {
  if (!id) return null;
  const base = side === "customer" ? "/customers" : side === "vendor" ? "/vendors" : "/partners";
  return `${base}?open=${id}`;
}

export function itemPath(id: string | null | undefined): string | null {
  return id ? `/items?open=${id}` : null;
}

export function employeePath(id: string | null | undefined): string | null {
  return id ? `/employees/${id}` : null;
}

const STOCK_MOVE_SOURCE_KINDS: Record<number, string> = {
  0: "Bill",
  1: "Invoice",
  2: "StockDocument",
};

export function stockMoveSourcePath(sourceType: number | null | undefined, sourceId: string | null | undefined): string | null {
  if (sourceType === null || sourceType === undefined) return null;
  return entityPath({ kind: STOCK_MOVE_SOURCE_KINDS[sourceType], id: sourceId });
}
