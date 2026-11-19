import type { PosCatalogItemResponse, PosOrderLineRequest, PosPaymentRequest, PosQuoteResponse } from "@pako/shared";

/**
 * Compute a display-only quote from cached catalog prices when the backend is unreachable.
 * The backend re-validates everything when the order syncs — this is only for the cashier's screen.
 */
export function computeLocalQuote(
  catalog: PosCatalogItemResponse[],
  lines: PosOrderLineRequest[],
  payments: PosPaymentRequest[] = [],
): PosQuoteResponse {
  const catalogMap = new Map(catalog.map((c) => [c.id, c]));

  // Per-line gross = qty * unitPrice - discount
  const lineResults = lines.map((line) => {
    const item = line.itemId ? catalogMap.get(line.itemId) : undefined;
    const price = line.unitPrice ?? item?.price ?? 0;
    const qty = line.quantity ?? 1;
    const discount = line.discountAmount ?? 0;
    const gross = Math.round((qty * price - discount) * 100) / 100;
    const taxRate = item?.taxRate ?? 0;
    const taxLetter = item?.taxLetter ?? "E";
    const net = Math.round((gross / (1 + taxRate)) * 100) / 100;
    const tax = Math.round((gross - net) * 100) / 100;
    return { taxLetter, taxRate, gross, net, tax };
  });

  // Aggregate by tax letter
  const taxMap = new Map<string, { taxLetter: string; taxRate: number; gross: number; net: number; tax: number }>();
  for (const lr of lineResults) {
    const existing = taxMap.get(lr.taxLetter);
    if (existing) {
      existing.gross = Math.round((existing.gross + lr.gross) * 100) / 100;
      existing.net = Math.round((existing.net + lr.net) * 100) / 100;
      existing.tax = Math.round((existing.tax + lr.tax) * 100) / 100;
    } else {
      taxMap.set(lr.taxLetter, { ...lr });
    }
  }

  const total = Math.round(lineResults.reduce((s, l) => s + l.gross, 0) * 100) / 100;
  const totalTax = Math.round(lineResults.reduce((s, l) => s + l.tax, 0) * 100) / 100;
  const paid = Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);
  const change = Math.max(0, Math.round((paid - total) * 100) / 100);

  return {
    lines: lineResults.map((lr) => ({ taxLetter: lr.taxLetter, gross: lr.gross, net: lr.net, tax: lr.tax })),
    taxes: [...taxMap.values()],
    total,
    totalTax,
    totalDiscount: 0,
    paid,
    remaining,
    change,
    cashLimitExceeded: false,
  };
}
