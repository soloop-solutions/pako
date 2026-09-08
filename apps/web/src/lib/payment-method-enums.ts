// Pako.Api doesn't emit enum member names (see ledger-enums.ts) — order must match
// backend/Pako.Domain/Companies/PaymentMethod.cs's PaymentMethodKind enum by hand.
export const PaymentMethodKind = { Cash: 0, Bank: 1 } as const;
