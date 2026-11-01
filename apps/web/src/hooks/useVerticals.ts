import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";

// docs/ERP_VERTICALS_PLAN.md (POS plan P8) — construction sites, buildings and units, sale
// contracts and leases. Every figure comes from the API as-is.

export const vxKeys = {
  sites: (c: string | null) => ["constructionSites", c] as const,
  site: (c: string | null, id: string | undefined) => ["constructionSite", c, id] as const,
  progressBills: (c: string | null, siteId: string | undefined) => ["progressBills", c, siteId] as const,
  siteProgress: (c: string | null, siteId: string | undefined) => ["siteProgress", c, siteId] as const,
  siteIssues: (c: string | null, siteId: string | undefined) => ["siteIssues", c, siteId] as const,
  buildings: (c: string | null) => ["buildings", c] as const,
  units: (c: string | null) => ["propertyUnits", c] as const,
  reservations: (c: string | null) => ["unitReservations", c] as const,
  contracts: (c: string | null) => ["unitSaleContracts", c] as const,
  contract: (c: string | null, id: string | undefined) => ["unitSaleContract", c, id] as const,
  leases: (c: string | null) => ["leases", c] as const,
  lease: (c: string | null, id: string | undefined) => ["lease", c, id] as const,
};

export function useConstructionSites(state?: number) {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: [...vxKeys.sites(activeCompanyId), state ?? "all"],
    queryFn: () => apiClient.listConstructionSites(activeCompanyId as string, state),
    enabled: !!activeCompanyId,
    staleTime: 30_000,
  });
}

export function useConstructionSite(siteId: string | undefined) {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: vxKeys.site(activeCompanyId, siteId),
    queryFn: () => apiClient.getConstructionSite(activeCompanyId as string, siteId as string),
    enabled: !!activeCompanyId && !!siteId && siteId !== "new",
  });
}

export function useBuildings() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: vxKeys.buildings(activeCompanyId),
    queryFn: () => apiClient.listBuildings(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 30_000,
  });
}

// Units of one building (or every building), filtered by the server.
export function usePropertyUnits(buildingId?: string, state?: number) {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: [...vxKeys.units(activeCompanyId), buildingId ?? "all", state ?? "all"],
    queryFn: () => apiClient.listPropertyUnits(activeCompanyId as string, buildingId, state),
    enabled: !!activeCompanyId,
  });
}

export function useProjects() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: ["projects", activeCompanyId],
    queryFn: () => apiClient.projectsAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  });
}

// The cost codes of the construction site whose ledger project is projectId (bill lines charge a
// code). A project with no site has none. The site list carries the project code, not its id, so
// the project's code links the two.
export function useProjectCostCodes(projectId: string | undefined) {
  const projects = useProjects().data ?? [];
  const sites = useConstructionSites().data ?? [];
  const code = projects.find((p) => p.id === projectId)?.code;
  const siteId = code ? sites.find((s) => s.projectCode === code)?.id : undefined;
  const site = useConstructionSite(siteId).data;
  return projectId && site && site.projectId === projectId ? site.costCodes : [];
}
