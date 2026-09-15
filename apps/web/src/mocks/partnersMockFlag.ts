// PROVISIONAL — see src/mocks/partnersHandlers.ts for why this exists and how to remove it.
//
// F6's mocked `controlAccountId`/`paymentTermDays`/`creditLimit` fields for Partner — the real
// `Partner` entity has no such fields at all (backend/Pako.Domain/Companies/Partner.cs), and
// `PartnersController` has no PUT (edit) action of any kind. Partners.tsx calls the real
// apiClient.partners (POST, create) directly for the 6 real writable fields, then stores just the
// 3 new fields here for that partner's id — same technique src/mocks/itemTypesMockFlag.ts already
// established for F5. Editing an existing partner has no real endpoint to wrap at all, so
// src/mocks/partnersHandlers.ts's PUT handler is fully mocked (closer to F2's accounts
// create/update mock than F5's item-type splice) and stores the FULL 8-field record here, which
// then wins entirely over the real GET response's stale values for that partner — see
// withMockFields in partnersHandlers.ts.
//
// Own tiny `msw`-free module, deliberately separate from partnersHandlers.ts (which imports `msw`)
// — Partners.tsx needs to flip the activation flag SYNCHRONOUSLY on mount/unmount (see
// accountsMockFlag.ts's header for the mount/unmount race this fixes), which means importing it
// statically; keeping the map/flag here means that static import stays a few bytes, not the whole
// mock contract.
//
// In-memory, reset-per-session — explicitly provisional data, not meant to survive a real backend
// reconciliation (see partnersHandlers.ts's removal steps).

export interface PartnerMockFields {
  name?: string;
  taxNumber?: string | null;
  isCustomer?: boolean;
  isVendor?: boolean;
  fiscalNumber?: string | null;
  isVatRegistered?: boolean;
  controlAccountId?: string | null;
  paymentTermDays?: number | null;
  creditLimit?: number | null;
}

let mockActive = false;
const fieldsByPartnerId = new Map<string, PartnerMockFields>();

export function setPartnersMockActive(active: boolean): void {
  mockActive = active;
}

export function isPartnersMockActive(): boolean {
  return mockActive;
}

export function setPartnerMockFields(partnerId: string, fields: PartnerMockFields): void {
  fieldsByPartnerId.set(partnerId, { ...fieldsByPartnerId.get(partnerId), ...fields });
}

export function getPartnerMockFields(partnerId: string): PartnerMockFields | undefined {
  return fieldsByPartnerId.get(partnerId);
}

export function resetPartnersMock(): void {
  fieldsByPartnerId.clear();
  mockActive = false;
}
