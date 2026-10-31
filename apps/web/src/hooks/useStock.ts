import { useQuery } from "@tanstack/react-query";

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
