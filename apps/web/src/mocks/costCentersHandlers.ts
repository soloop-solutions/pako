// PROVISIONAL — F9 cost-center ("analytic distribution", scoped to a single picker per line —
// see costCentersMockFlag.ts) mock contract.
//
// Two independent things happen here:
//   - GET .../cost-centers is FULLY INVENTED (closer to src/mocks/handlers.ts's F2 accounts
//     pattern than to F6's partner splice) — no CostCentersController exists on the real backend
//     at all, so this never touches it. The fixture (src/mocks/fixtures/cost-centers.json) is
//     placeholder data, not sourced from any real Kosovo cost-center list.
//   - GET .../journal-entries wraps the REAL endpoint (bypass + real fetch, same technique
//     src/mocks/itemTypesHandlers.ts established) and splices each line's mocked costCenterId
//     (from src/mocks/costCentersMockFlag.ts, keyed by the line's own real id) onto the real
//     response — demonstrating the selection actually "sticks" to the saved line, even though it
//     can never be sent to the real create endpoint (see costCentersMockFlag.ts's header).
//
// This is scaffolding to be torn out, not permanent product code — see costCentersMockFlag.ts's
// header for the removal steps.
//
// **Gated by its own synchronous flag**, same discipline as every other mock in this directory —
// see accountsMockFlag.ts's header for the mount/unmount race this closes.

import { HttpResponse, bypass, http, passthrough } from "msw";

import { API_BASE_URL } from "@/api/client";
import { getLineCostCenter, isCostCentersMockActive } from "@/mocks/costCentersMockFlag";
import costCentersFixture from "@/mocks/fixtures/cost-centers.json";

interface RawLine {
  id: string;
  [key: string]: unknown;
}

interface RawEntry {
  lines?: RawLine[];
  [key: string]: unknown;
}

function withMockCostCenters(entry: RawEntry): RawEntry {
  if (!entry.lines) return entry;
  return { ...entry, lines: entry.lines.map((line) => ({ ...line, costCenterId: getLineCostCenter(line.id) ?? null })) };
}

export const costCentersHandlers = [
  http.get(`${API_BASE_URL}/api/companies/:companyId/cost-centers`, () => {
    if (!isCostCentersMockActive()) return passthrough();
    return HttpResponse.json(costCentersFixture);
  }),

  http.get(`${API_BASE_URL}/api/companies/:companyId/journal-entries`, async ({ request }) => {
    if (!isCostCentersMockActive()) return passthrough();
    const response = await fetch(bypass(request));
    if (!response.ok) return response;
    const data = (await response.json()) as RawEntry[];
    return HttpResponse.json(data.map(withMockCostCenters), { status: response.status });
  }),
];
