import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import type { SavedViewCountSource } from "@/config/nav";
import { useCompany } from "@/context/CompanyContext";

// Client request 2026-11-24: how many documents a built-in saved view (All / Drafts / Posted) holds,
// from the server's view-counts endpoint. Fetched only while the views are open in the sidebar;
// one request serves all three views (same query key).
export function SavedViewCount({ source, viewId }: { source: SavedViewCountSource; viewId: string }) {
  const { activeCompanyId } = useCompany();
  const counts = useQuery({
    queryKey: ["savedViewCounts", activeCompanyId, source.source, source.documentType, source.excludeDocumentType],
    queryFn: () =>
      source.source === "invoices"
        ? apiClient.invoiceViewCounts(activeCompanyId as string, source.documentType, source.excludeDocumentType)
        : apiClient.billViewCounts(activeCompanyId as string, source.documentType, source.excludeDocumentType),
    enabled: !!activeCompanyId,
    staleTime: 30_000,
  });
  const value = viewId === "all" ? counts.data?.all : viewId === "draft" ? counts.data?.draft : viewId === "posted" ? counts.data?.posted : undefined;
  if (value === undefined) return null;
  return (
    <span className="ml-auto pl-2 text-[11px] text-muted-foreground tabular-nums" data-testid={`saved-view-count-${viewId}`}>
      {value}
    </span>
  );
}
