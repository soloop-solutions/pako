// docs/INVENTORY_PLAN.md. Pako.Api doesn't emit enum member names (see ledger-enums.ts), so these
// arrive as plain numbers. Order must match backend/Pako.Domain/Inventory exactly, by hand.

export const StockDocumentType = { Opening: 0, Transfer: 1, Count: 2, WriteOff: 3, WriteDown: 4, Receipt: 5, Delivery: 6, SiteIssue: 7 } as const;
export type StockDocumentTypeValue = (typeof StockDocumentType)[keyof typeof StockDocumentType];
// docs/POS_PLAN.md P6 adds Delivery (fletëdërgesë). SiteIssue belongs to another phase: it is named
// in lists but not offered here.
export const STOCK_DOCUMENT_TYPES: StockDocumentTypeValue[] = [5, 6, 0, 1, 2, 3, 4];
export const stockDocumentTypeKey = (t: number) => ["opening", "transfer", "count", "writeOff", "writeDown", "receipt", "delivery", "siteIssue"][t] ?? "opening";

export const StockDocumentState = { Draft: 0, Posted: 1 } as const;

export const WriteOffReason = { Expired: 0, Damaged: 1, Theft: 2, Disaster: 3, Unexplained: 4, Other: 5 } as const;
export const WRITE_OFF_REASONS = [0, 1, 2, 3, 4, 5] as const;
export const writeOffReasonKey = (r: number) => ["expired", "damaged", "theft", "disaster", "unexplained", "other"][r] ?? "other";
// AI 03/2015 Art. 61.2: destroying expired or damaged goods needs written notice to ATK first.
export const needsAtkNotice = (r: number | null | undefined) => r === WriteOffReason.Expired || r === WriteOffReason.Damaged;

export const StockMoveKind = { Receipt: 0, Issue: 1, Transfer: 2, Revaluation: 3 } as const;
export const stockMoveKindKey = (k: number) => ["receipt", "issue", "transfer", "revaluation"][k] ?? "receipt";

export const StockMoveSource = { Bill: 0, Invoice: 1, StockDocument: 2 } as const;

export const NegativeStockPolicy = { Block: 0, Warn: 1 } as const;

// §12 P4 price changes (Nivelim).
export const PriceChangeState = { Draft: 0, Posted: 1 } as const;
