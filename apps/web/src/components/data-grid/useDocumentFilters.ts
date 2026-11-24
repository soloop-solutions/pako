import { useListFilters, type ListFilterControls } from "@/components/list/useListFilters";

export interface DocumentFilters {
  from: string;
  to: string;
  paymentStatus: string;
  partnerId: string;
}

export interface DocumentFilterControls {
  filters: DocumentFilters;
  setFilter: (name: keyof DocumentFilters, value: string) => void;
  setRange: (from: string, to: string) => void;
  clear: () => void;
  activeCount: number;
  /** The same filters as the list ribbon sees them (components/list/useListFilters). */
  list: ListFilterControls;
}

const NAMES = ["from", "to", "paymentStatus", "partnerId"] as const;

// The invoice and bill lists' filters, now a fixed set over useListFilters (same URL keys).
export function useDocumentFilters(gridId: string): DocumentFilterControls {
  const list = useListFilters(gridId, NAMES);
  const { values } = list;
  return {
    filters: { from: values.from, to: values.to, paymentStatus: values.paymentStatus, partnerId: values.partnerId },
    setFilter: list.set,
    setRange: (from, to) => list.setMany({ from, to }),
    clear: list.clear,
    activeCount: list.activeCount,
    list,
  };
}
