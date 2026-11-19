import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

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
}

const NAMES: (keyof DocumentFilters)[] = ["from", "to", "paymentStatus", "partnerId"];

export function useDocumentFilters(gridId: string): DocumentFilterControls {
  const [searchParams, setSearchParams] = useSearchParams();
  const key = (name: string) => `${gridId}.${name}`;

  const from = searchParams.get(key("from")) ?? "";
  const to = searchParams.get(key("to")) ?? "";
  const paymentStatus = searchParams.get(key("paymentStatus")) ?? "";
  const partnerId = searchParams.get(key("partnerId")) ?? "";

  const filters = useMemo(() => ({ from, to, paymentStatus, partnerId }), [from, to, paymentStatus, partnerId]);

  const update = useCallback(
    (changes: Partial<DocumentFilters>) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          for (const [name, value] of Object.entries(changes)) {
            if (value) params.set(`${gridId}.${name}`, value);
            else params.delete(`${gridId}.${name}`);
          }
          params.delete(`${gridId}.page`);
          return params;
        },
        { replace: true },
      );
    },
    [gridId, setSearchParams],
  );

  const setFilter = useCallback((name: keyof DocumentFilters, value: string) => update({ [name]: value }), [update]);
  const setRange = useCallback((nextFrom: string, nextTo: string) => update({ from: nextFrom, to: nextTo }), [update]);
  const clear = useCallback(() => update(Object.fromEntries(NAMES.map((n) => [n, ""]))), [update]);
  const activeCount = NAMES.filter((n) => filters[n]).length;

  return { filters, setFilter, setRange, clear, activeCount };
}
