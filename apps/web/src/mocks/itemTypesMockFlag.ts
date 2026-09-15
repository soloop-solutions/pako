// PROVISIONAL — see src/mocks/itemTypesHandlers.ts for why this exists and how to remove it.
//
// F5's mocked `type` field (goods/service/normative) for Item — the real `Item` entity has no
// such field at all (backend/Pako.Domain/Companies/Item.cs), unlike the F2/F3 mocks this repo
// already has, where the whole endpoint was missing. Items.tsx calls the real
// apiClient.itemsPOST/itemsPUT directly (not through an intercepted URL) — the six real fields
// genuinely persist to the real backend — and then calls setMockItemType with the real
// created/updated item's own id. itemTypesHandlers.ts's GET interceptors read that same map to
// splice `type` onto the real response. Both sides need this map, which is why it lives here,
// in a tiny `msw`-free module, rather than only inside the msw-importing handlers file — Items.tsx
// calls setItemTypesMockActive synchronously on mount/unmount (same discipline as
// accountsMockFlag.ts/lockDatesMockFlag.ts — see those files' headers for the mount/unmount race
// this fixes) and that static import must not pull `msw` into the production bundle.
//
// In-memory, reset-per-session — explicitly provisional data, not meant to survive a real backend
// reconciliation (see itemTypesHandlers.ts's removal steps).

let mockActive = false;
const typeByItemId = new Map<string, number>();

export function setItemTypesMockActive(active: boolean): void {
  mockActive = active;
}

export function isItemTypesMockActive(): boolean {
  return mockActive;
}

export function setMockItemType(itemId: string, type: number): void {
  typeByItemId.set(itemId, type);
}

export function getMockItemType(itemId: string): number | undefined {
  return typeByItemId.get(itemId);
}

export function resetItemTypesMock(): void {
  typeByItemId.clear();
  mockActive = false;
}
