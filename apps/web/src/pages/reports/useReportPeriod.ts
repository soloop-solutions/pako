import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import { startOfMonth, today } from "./helpers";

function parseYear(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : new Date().getFullYear();
}

export function useReportPeriod() {
  const [searchParams, setSearchParams] = useSearchParams();

  const setParam = useCallback(
    (name: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (value) params.set(name, value);
          else params.delete(name);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setParams = useCallback(
    (values: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          for (const [name, value] of Object.entries(values)) {
            if (value) params.set(name, value);
            else params.delete(name);
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return {
    from: searchParams.get("from") || startOfMonth(),
    to: searchParams.get("to") || today(),
    year: parseYear(searchParams.get("year")),
    searchParams,
    setParam,
    setParams,
    setFrom: (value: string) => setParam("from", value),
    setTo: (value: string) => setParam("to", value),
    setYear: (value: string) => setParam("year", value),
  };
}

export type ReportPeriod = ReturnType<typeof useReportPeriod>;
