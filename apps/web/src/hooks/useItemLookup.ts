import { useQuery } from "@tanstack/react-query";
import type { ItemResponse } from "@pako/shared";

import { apiClient } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { useItemSearch } from "@/hooks/useStock";

// docs/POS_PLAN.md P3: the item pickers of the menu setup and the recipe tab. The items list is
// paged, so pickers search the server (useItemSearch); items already referenced that no search has
// shown yet are fetched one by one so a line keeps its name and unit.
export function useItemLookup(ids: (string | undefined)[]) {
  const { activeCompanyId } = useCompany();
  const search = useItemSearch();
  const known = new Set(search.items.map((i) => i.id));
  const missing = [...new Set(ids.filter((id): id is string => !!id && !known.has(id)))].sort();
  const fetched = useQuery({
    queryKey: ["items", activeCompanyId, "byIds", missing.join(",")],
    queryFn: async () => Promise.all(missing.map((id) => apiClient.itemsGET2(activeCompanyId as string, id))),
    enabled: !!activeCompanyId && missing.length > 0,
    staleTime: 60_000,
  }).data ?? [];
  const find = (id: string | undefined): ItemResponse | undefined =>
    id ? search.items.find((i) => i.id === id) ?? fetched.find((i) => i.id === id) : undefined;
  return { search, find };
}

export type ItemLookup = ReturnType<typeof useItemLookup>;
