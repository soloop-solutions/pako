import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import type { Pack } from "@/lib/business-types";

export interface Features {
  /** The company's business type (BusinessType), or null while loading / unknown. */
  businessType: number | null;
  /** The packs on for the active company; null while loading or when the answer has none. */
  features: string[] | null;
  isLoading: boolean;
  /** True when the pack (or any of the packs) is on for the active company. */
  hasFeature: (feature: Pack | readonly Pack[]) => boolean;
}

/**
 * The vertical packs on for the active company, from the same my-access query `useMyAccess`
 * uses (same key, so one request serves both). Display only — a pack's endpoints answer 403 when
 * it is off. While the answer loads nothing extra shows; if it fails, or carries no `features`
 * (an older server), every pack is treated as on so the UI never hides what the server allows.
 *
 * Kept in its own module (not in useMyAccess.ts) so tests that mock useMyAccess still get it.
 */
export function useFeatures(): Features {
  const { activeCompanyId } = useCompany();
  const query = useQuery({
    // Must match myAccessQueryKey in useMyAccess.ts.
    queryKey: ["myAccess", activeCompanyId] as const,
    queryFn: () => apiClient.getMyAccess(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 15_000,
  });

  const loading = !!activeCompanyId && query.isPending;
  const features = query.data?.features ?? null;
  const allOn = !activeCompanyId || query.isError || (!!query.data && !Array.isArray(query.data.features));

  function hasFeature(feature: Pack | readonly Pack[]): boolean {
    if (loading) return false;
    if (allOn) return true;
    const wanted: readonly string[] = typeof feature === "string" ? [feature] : feature;
    return wanted.some((f) => features?.includes(f));
  }

  return {
    businessType: typeof query.data?.businessType === "number" ? query.data.businessType : null,
    features,
    isLoading: loading,
    hasFeature,
  };
}
