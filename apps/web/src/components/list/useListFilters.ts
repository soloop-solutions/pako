import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

// The list ribbon's filter values (client request 2026-11-24). Each filter lives in the URL as
// `${gridId}.${name}` — the same keys useDocumentFilters always used (`from`, `to`, `partnerId`,
// `paymentStatus`), so existing links and saved views keep working. Changing a filter drops the
// grid's page so the list starts again at page 1.
export interface ListFilterControls {
  gridId: string;
  values: Record<string, string>;
  set: (name: string, value: string) => void;
  setMany: (changes: Record<string, string>) => void;
  clear: () => void;
  /** Filters with a value; a date range counts once. */
  activeCount: number;
  /** The ribbon's part of the URL (`gridId.name=value` pairs), for saving a view. */
  query: string;
}

export function useListFilters(gridId: string, names: readonly string[]): ListFilterControls {
  const [searchParams, setSearchParams] = useSearchParams();
  const namesKey = names.join("|");

  const values = useMemo(() => {
    const result: Record<string, string> = {};
    for (const name of namesKey.split("|")) result[name] = searchParams.get(`${gridId}.${name}`) ?? "";
    return result;
  }, [gridId, namesKey, searchParams]);

  const setMany = useCallback(
    (changes: Record<string, string>) => {
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

  const set = useCallback((name: string, value: string) => setMany({ [name]: value }), [setMany]);
  const clear = useCallback(() => setMany(Object.fromEntries(namesKey.split("|").map((n) => [n, ""]))), [namesKey, setMany]);

  const activeCount = useMemo(() => {
    const filled = Object.entries(values).filter(([, v]) => v).map(([n]) => n);
    const dates = filled.filter((n) => n === "from" || n === "to").length > 0 ? 1 : 0;
    return filled.filter((n) => n !== "from" && n !== "to").length + dates;
  }, [values]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(values)) if (value) params.set(`${gridId}.${name}`, value);
    return params.toString();
  }, [gridId, values]);

  return { gridId, values, set, setMany, clear, activeCount, query };
}
