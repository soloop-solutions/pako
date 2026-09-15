// PROVISIONAL — see src/mocks/costCentersHandlers.ts for why this exists and how to remove it.
//
// F9 originally scoped this down to a single cost-center picker per line; F12 upgraded it to a
// real multi-way percentage split (see docs/FRONTEND_BRIEF.md's F12 and
// src/pages/ledger/journal-grid/DistributionEditor.tsx). `CostCenter` is a real domain entity
// (backend/Pako.Domain/Ledger/CostCenter.cs) but has zero API surface — no CostCentersController
// exists, and `CreateJournalEntryLineRequest` has no CostCenterId field at all (confirmed by
// reading backend/Pako.Api/Contracts/JournalEntryContracts.cs directly). So there is nothing real
// to wrap (unlike F6's partner mock, which splices onto a real GET): the whole cost-center list is
// invented, and a line's distribution can never be sent to the real create-journal-entry endpoint —
// it only ever exists client-side, keyed by the *created* journal-entry line's own id once a save
// succeeds (JournalEntryGrid.tsx calls setLineDistribution after apiClient.journalEntries(...)
// returns real line ids, matching request/response order).
//
// Own tiny `msw`-free module, deliberately separate from costCentersHandlers.ts (which imports
// `msw`) — same static-import-must-stay-small discipline as partnersMockFlag.ts/
// itemTypesMockFlag.ts, and the same synchronous mount/unmount flag flip
// (setCostCentersMockActive) to close the mount/unmount race documented on
// accountsMockFlag.ts's header.
//
// In-memory, reset-per-session — explicitly provisional data, not meant to survive a real backend
// reconciliation. Once CostCentersController exists and CreateJournalEntryLineRequest gains a real
// CostCenterId, delete this file and src/mocks/costCentersHandlers.ts, remove both from
// src/mocks/browser.ts / src/mocks/server.ts, delete src/api/cost-centers-client.ts and
// src/mocks/fixtures/cost-centers.json, and replace every call in
// src/pages/ledger/JournalEntryGrid.tsx with the real generated `apiClient.*` methods and the real
// field on the create-line request.

export interface MockCostCenterAllocation {
  costCenterId: string;
  percentage: number;
}

let mockActive = false;
const distributionByLineId = new Map<string, MockCostCenterAllocation[]>();

export function setCostCentersMockActive(active: boolean): void {
  mockActive = active;
}

export function isCostCentersMockActive(): boolean {
  return mockActive;
}

export function setLineDistribution(lineId: string, allocations: MockCostCenterAllocation[]): void {
  if (allocations.length > 0) {
    distributionByLineId.set(lineId, allocations);
  } else {
    distributionByLineId.delete(lineId);
  }
}

export function getLineDistribution(lineId: string): MockCostCenterAllocation[] | undefined {
  return distributionByLineId.get(lineId);
}

export function resetCostCentersMock(): void {
  distributionByLineId.clear();
  mockActive = false;
}
