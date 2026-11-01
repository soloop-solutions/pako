import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ItemResponse } from "@pako/shared";

import { apiClient } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";

// docs/INVENTORY_PLAN.md — the company's warehouses (cached), for the warehouse pickers.
export function useWarehouses() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: ["warehouses", activeCompanyId],
    queryFn: () => apiClient.listWarehouses(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  });
}

// Quantity on hand per stock-tracked item in one warehouse (null = the default warehouse), for the
// invoice and bill line pickers. Quantities only — never cost.
export function useStockOnHand(itemIds: string[], warehouseId: string | null) {
  const { activeCompanyId } = useCompany();
  const ids = [...new Set(itemIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["stockOnHand", activeCompanyId, warehouseId, ids.join(",")],
    queryFn: async () => {
      const rows = await apiClient.getStockOnHand(activeCompanyId as string, ids, warehouseId ?? undefined);
      return new Map(rows.map((r) => [r.itemId, r.quantity]));
    },
    enabled: !!activeCompanyId && ids.length > 0,
    staleTime: 15_000,
  });
}

// Item pickers on stock documents, purchase orders and price changes. The items list is paged
// (the server caps a page at 200), so the picker searches the server as the user types instead of
// filtering one page. Every item seen is kept, so a line keeps its label and flags (trackLots,
// unit) after the search moves on. trackedOnly keeps stock-tracked items: the server has no such
// filter, so it is applied to each page of results.
export function useItemSearch({ trackedOnly = false }: { trackedOnly?: boolean } = {}) {
  const { activeCompanyId } = useCompany();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [seen, setSeen] = useState<Map<string, ItemResponse>>(() => new Map());

  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ["items", activeCompanyId, "search", term],
    queryFn: async () => (await apiClient.itemsGET(activeCompanyId as string, 1, 200, term || undefined, undefined)).items,
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!query.data) return;
    setSeen((prev) => {
      const next = new Map(prev);
      for (const item of query.data) if (!trackedOnly || item.trackInventory) next.set(item.id, item);
      return next;
    });
  }, [query.data, trackedOnly]);

  const items = useMemo(() => [...seen.values()], [seen]);
  return { items, onSearchChange: setSearch, isPending: query.isPending };
}
