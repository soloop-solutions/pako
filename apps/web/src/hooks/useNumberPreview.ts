import { useEffect, useState } from "react";

import { apiClient } from "@/api/client";

/**
 * Fetches the provisional next document number from the number-series preview endpoint.
 * Returns the formatted number string, or an empty string while loading / on error.
 *
 * Re-fetches whenever `companyId` or `documentType` changes. Pass an empty/undefined
 * `documentType` to skip the fetch (e.g. when the type hasn't been chosen yet).
 */
export function useNumberPreview(companyId: string | undefined, documentType: string | undefined): string {
  const [number, setNumber] = useState("");

  useEffect(() => {
    if (!companyId || !documentType) {
      setNumber("");
      return;
    }
    let cancelled = false;
    apiClient
      .preview(companyId, documentType)
      .then((result) => {
        if (!cancelled) setNumber(result.number);
      })
      .catch(() => {
        if (!cancelled) setNumber("");
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, documentType]);

  return number;
}
