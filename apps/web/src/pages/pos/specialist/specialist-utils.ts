import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { usePosStores } from "@/hooks/usePos";
import { useUrlParam } from "@/hooks/useUrlParam";
import { todayLocal } from "@/lib/pos-services";

// docs/POS_PLAN.md P7 (specialist retail): helpers shared by the pharmacy, forecourt, parts and
// online-channel screens and the till. Figures are always the server's; these only format them.

/** An amount the API returned, with two decimals. */
export const money = (v: number | undefined | null) => (v ?? 0).toFixed(2);

/** A quantity (litres, units) the API returned, up to three decimals. */
export const qty = (v: number | undefined | null) => (v == null ? "—" : String(Math.round(v * 1000) / 1000));

/** A yyyy-mm-dd date before today in Kosovo time (a string comparison, nothing computed). */
export const isPast = (date: string | undefined | null) => !!date && date.slice(0, 10) < todayLocal();

/** A typed decimal: digits with up to `decimals` places after "." or ",". */
export function parseDecimal(typed: string, decimals: number): number | null {
  const value = typed.trim();
  if (!new RegExp(`^\\d+([.,]\\d{1,${decimals}})?$`).test(value)) return null;
  return Number(value.replace(",", "."));
}

/** The company's partners (cached): payers, couriers and fleet-card companies are customers. */
export function usePartners() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: ["partners", activeCompanyId],
    queryFn: () => apiClient.partnersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  });
}

/** The store a screen works on, kept in ?store= — the first active store until one is picked. */
export function useStoreParam(): [string, (value: string) => void, ReturnType<typeof usePosStores>] {
  const stores = usePosStores();
  const [param, setParam] = useUrlParam("store");
  const list = stores.data ?? [];
  const storeId = list.some((s) => s.id === param) ? param : list.find((s) => s.isActive)?.id ?? list[0]?.id ?? "";
  return [storeId, setParam, stores];
}

/** What a parts search asks: a part number (any maker's), or a vehicle; a warehouse for stock. */
export interface PartsQuery {
  number: string;
  make: string;
  model: string;
  year: string;
  warehouseId: string;
}

export const emptyPartsQuery: PartsQuery = { number: "", make: "", model: "", year: "", warehouseId: "" };

/** Parts matching a number (own code, barcode or cross-reference) or fitting a vehicle. */
export function usePartsSearch(q: PartsQuery) {
  const { activeCompanyId } = useCompany();
  const year = /^\d{4}$/.test(q.year.trim()) ? Number(q.year.trim()) : undefined;
  const asked = !!(q.number.trim() || q.make.trim() || q.model.trim());
  return useQuery({
    queryKey: ["partsSearch", activeCompanyId, q.number.trim(), q.make.trim(), q.model.trim(), year, q.warehouseId],
    queryFn: () =>
      apiClient.searchParts(
        activeCompanyId as string, q.number.trim() || undefined, q.make.trim() || undefined, q.model.trim() || undefined, year, q.warehouseId || undefined,
      ),
    enabled: !!activeCompanyId && asked,
  });
}
