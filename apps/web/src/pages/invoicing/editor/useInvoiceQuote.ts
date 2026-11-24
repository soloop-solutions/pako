import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { InvoiceQuoteResponse } from "@pako/shared";

import { apiClient } from "@/api/client";

export interface QuoteLineInput {
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxDefinitionId: string;
}

// Client request 2026-11-23: the creation screen's line amounts, totals, VAT per rate and total in
// words come from POST invoices/quote (the posting calculator), never from browser math. The request
// waits 300 ms after the last keystroke; while a new quote loads the previous one stays on screen
// (`isStale`). Lines are quoted in the order given, one quote line per form line.
export function useInvoiceQuote(companyId: string, priceMode: number, lines: QuoteLineInput[]) {
  const request = {
    priceMode,
    lines: lines.map((line) => ({
      quantity: parseFloat(line.quantity) || 0,
      unitPrice: parseFloat(line.unitPrice) || 0,
      // Input sanitising only: a discount being typed ("1", "15", "150") must not fail the quote.
      discountPercent: Math.min(Math.max(parseFloat(line.discountPercent) || 0, 0), 100),
      taxDefinitionId: line.taxDefinitionId || undefined,
    })),
  };
  const key = JSON.stringify(request);
  const [debouncedKey, setDebouncedKey] = useState(key);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKey(key), 300);
    return () => clearTimeout(timer);
  }, [key]);

  const query = useQuery<InvoiceQuoteResponse>({
    queryKey: ["invoice-quote", companyId, debouncedKey],
    queryFn: () => apiClient.quoteInvoice(companyId, JSON.parse(debouncedKey)),
    enabled: !!companyId && lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  return {
    quote: query.data,
    isStale: key !== debouncedKey || query.isPlaceholderData || query.isFetching,
    error: query.error,
  };
}
