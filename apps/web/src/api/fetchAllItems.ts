import type { ItemResponse } from "@pako/shared";
import { apiClient } from "@/api/client";

const PAGE_SIZE = 200;

export async function fetchAllItems(companyId: string): Promise<{ items: ItemResponse[] }> {
  const first = await apiClient.itemsGET(companyId, 1, PAGE_SIZE, undefined, undefined);
  const pages = Math.ceil(first.total / PAGE_SIZE);
  if (pages <= 1) return { items: first.items };
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => apiClient.itemsGET(companyId, i + 2, PAGE_SIZE, undefined, undefined)),
  );
  return { items: [first.items, ...rest.map((page) => page.items)].flat() };
}
