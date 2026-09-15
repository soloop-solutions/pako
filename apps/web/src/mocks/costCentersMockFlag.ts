// PROVISIONAL — see src/mocks/costCentersHandlers.ts for why this exists and how to remove it.
//
// F9's "analytic distribution" column, scoped down to a single cost-center picker per line (the
// real multi-way percentage-split editor is F12's job, not this one — see
// docs/FRONTEND_BRIEF.md's F12). `CostCenter` is a real domain entity
// (backend/Pako.Domain/Ledger/CostCenter.cs) but has zero API surface — no CostCentersController
// exists, and `CreateJournalEntryLineRequest` has no CostCenterId field at all (confirmed by
// reading backend/Pako.Api/Contracts/JournalEntryContracts.cs directly). So there is nothing real
// to wrap (unlike F6's partner mock, which splices onto a real GET): the whole cost-center list is
// invented, and a line's chosen cost center can never be sent to the real create-journal-entry
// endpoint — it only ever exists client-side, keyed by the *created* journal-entry line's own id
// once a save succeeds (JournalEntryGrid.tsx calls setLineCostCenter after
// apiClient.journalEntries(...) returns real line ids, matching request/response order).
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

let mockActive = false;
const costCenterIdByLineId = new Map<string, string>();

export function setCostCentersMockActive(active: boolean): void {
  mockActive = active;
}

export function isCostCentersMockActive(): boolean {
  return mockActive;
}

export function setLineCostCenter(lineId: string, costCenterId: string | null): void {
  if (costCenterId) {
    costCenterIdByLineId.set(lineId, costCenterId);
  } else {
    costCenterIdByLineId.delete(lineId);
  }
}

export function getLineCostCenter(lineId: string): string | undefined {
  return costCenterIdByLineId.get(lineId);
}

export function resetCostCentersMock(): void {
  costCenterIdByLineId.clear();
  mockActive = false;
}
