import { useQuery } from "@tanstack/react-query";
import type { ItemResponse } from "@pako/shared";
import { useSearchParams } from "react-router-dom";

import { apiClient } from "@/api/client";
import { isoToday } from "@/lib/sales-order-enums";
import { StockDocumentState, StockDocumentType } from "@/lib/stock-enums";
import type { InvoicePrefill, InvoicePrefillLine } from "@/pages/invoicing/InvoiceForm";

// The items behind the lines, for their default VAT code and revenue account.
async function loadItems(companyId: string, ids: (string | undefined)[]): Promise<Map<string, ItemResponse>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const items = await Promise.all(unique.map((id) => apiClient.itemsGET2(companyId, id).catch(() => undefined)));
  return new Map(items.filter((i): i is ItemResponse => !!i).map((i) => [i.id, i]));
}

// What the sales order still has to bill (only what was delivered, or everything with
// `undelivered`), each line keeping its order line and delivery line. Prices are the order's.
export async function prefillFromSalesOrder(companyId: string, salesOrderId: string, undelivered: boolean): Promise<InvoicePrefill> {
  const draft = await apiClient.getSalesOrderInvoiceDraft(companyId, salesOrderId, undelivered || undefined);
  const items = await loadItems(companyId, draft.lines.map((l) => l.itemId));
  return {
    partnerId: draft.partnerId,
    warehouseId: draft.warehouseId ?? undefined,
    lines: draft.lines.map((l): InvoicePrefillLine => {
      const item = l.itemId ? items.get(l.itemId) : undefined;
      return {
        description: l.description,
        quantity: String(l.quantity),
        unitPrice: String(l.unitPrice),
        discountPercent: String(l.discountPercent),
        taxDefinitionId: l.taxDefinitionId ?? item?.defaultTaxDefinitionId ?? "",
        itemId: l.itemId ?? "",
        revenueAccountId: item?.defaultRevenueAccountId ?? "",
        unitName: l.unitName ?? undefined,
        salesOrderLineId: l.salesOrderLineId,
        deliveryLineId: l.deliveryLineId ?? undefined,
        linkLabel: [draft.orderNumber, l.deliveryNumber].filter(Boolean).join(" · ") || undefined,
      };
    }),
  };
}

// A posted delivery note's lines not billed yet, at the customer's price today.
export async function prefillFromDelivery(companyId: string, deliveryId: string, nothingLeft: string): Promise<InvoicePrefill> {
  const doc = await apiClient.getStockDocument(companyId, deliveryId);
  const open = doc.type === StockDocumentType.Delivery && doc.state === StockDocumentState.Posted
    ? doc.lines.map((l) => ({ line: l, remaining: l.quantity - (l.billed ?? 0) })).filter((x) => x.remaining > 0)
    : [];
  if (open.length === 0 || !doc.partnerId) throw new Error(nothingLeft);
  const [prices, items] = await Promise.all([
    apiClient.resolvePrices(companyId, open.map((x) => x.line.itemId), doc.warehouseId, isoToday(), doc.partnerId, open.map((x) => x.remaining)),
    loadItems(companyId, open.map((x) => x.line.itemId)),
  ]);
  return {
    partnerId: doc.partnerId,
    warehouseId: doc.warehouseId,
    lines: open.map(({ line, remaining }, index): InvoicePrefillLine => {
      const item = items.get(line.itemId);
      const resolved = prices[index]?.itemId === line.itemId ? prices[index] : prices.find((p) => p.itemId === line.itemId);
      return {
        description: line.itemName,
        quantity: String(remaining),
        unitPrice: resolved ? String(resolved.price) : item?.defaultUnitPrice != null ? String(item.defaultUnitPrice) : "",
        discountPercent: "0",
        taxDefinitionId: item?.defaultTaxDefinitionId ?? "",
        itemId: line.itemId,
        revenueAccountId: item?.defaultRevenueAccountId ?? "",
        salesOrderLineId: line.salesOrderLineId ?? undefined,
        deliveryLineId: line.id,
        linkLabel: doc.number ?? undefined,
      };
    }),
  };
}

// docs/POS_PLAN.md P6: `/invoicing?salesOrder=<id>[&undelivered=1]` or `?delivery=<id>` opens the
// new-invoice form filled from that order or delivery note.
export function useInvoicePrefill(companyId: string | null, nothingLeft: string) {
  const [params, setParams] = useSearchParams();
  const salesOrderId = params.get("salesOrder");
  const undelivered = params.get("undelivered") === "1";
  const deliveryId = params.get("delivery");
  const active = !!salesOrderId || !!deliveryId;
  const query = useQuery({
    queryKey: ["invoicePrefill", companyId, salesOrderId, undelivered, deliveryId],
    queryFn: () => (salesOrderId
      ? prefillFromSalesOrder(companyId as string, salesOrderId, undelivered)
      : prefillFromDelivery(companyId as string, deliveryId as string, nothingLeft)),
    enabled: !!companyId && active,
    staleTime: 0,
    gcTime: 0,
  });
  const clear = () =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of ["salesOrder", "undelivered", "delivery"]) next.delete(key);
      return next;
    }, { replace: true });
  return { active, prefill: query.data, error: query.error, isPending: active && query.isPending, clear };
}
