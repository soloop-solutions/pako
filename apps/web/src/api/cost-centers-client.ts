// PROVISIONAL — F9 cost-center list. No generated client method exists (no CostCentersController
// on the real backend at all — see src/mocks/costCentersMockFlag.ts) so this is a small
// hand-written wrapper unblocking JournalEntryGrid.tsx against src/mocks/costCentersHandlers.ts,
// same pattern as src/api/partners-client.ts / src/api/accounts-v2-client.ts.
//
// Delete this file once the backend lands a real CostCentersController and
// `pnpm generate:api-client` produces a real method for it — replace the call site
// (JournalEntryGrid.tsx) with the generated `apiClient.*` equivalent.

import { API_BASE_URL, authorizedFetch } from "@/api/client";

export interface CostCenterOption {
  id: string;
  code: string;
  name: string;
  nameEn: string;
}

export async function fetchCostCenters(companyId: string): Promise<CostCenterOption[]> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/cost-centers`);
  if (!response.ok) {
    throw new Error(`Could not load cost centers (status ${response.status}).`);
  }
  return (await response.json()) as CostCenterOption[];
}
