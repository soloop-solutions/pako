import { useEffect, useState } from "react";

import { apiClient } from "@/api/client";

type NumberPreviewOptions = {
  /** Document date (yyyy-MM-dd). Year-scoped patterns preview against this date's year. */
  date?: string;
  /** Change this (e.g. a save counter) to fetch again after a number has been used. */
  refreshKey?: unknown;
};

/**
 * Fetches the provisional next document number from the number-series preview endpoint.
 * Returns the formatted number string, or an empty string while loading / on error.
 *
 * Re-fetches whenever `companyId`, `documentType`, `options.date` or `options.refreshKey`
 * changes. Pass an empty/undefined `documentType` to skip the fetch (e.g. when the type hasn't
 * been chosen yet).
 */
export function useNumberPreview(
  companyId: string | undefined,
  documentType: string | undefined,
  options: NumberPreviewOptions = {},
): string {
  const [number, setNumber] = useState("");
  const { date, refreshKey } = options;
  // Only a complete date is sent; a half-typed one keeps the last preview.
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;

  useEffect(() => {
    if (!companyId || !documentType) {
      setNumber("");
      return;
    }
    let cancelled = false;
    apiClient
      .preview(companyId, documentType, validDate)
      .then((result) => {
        if (!cancelled) setNumber(result.number);
      })
      .catch(() => {
        if (!cancelled) setNumber("");
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, documentType, validDate, refreshKey]);

  return number;
}
