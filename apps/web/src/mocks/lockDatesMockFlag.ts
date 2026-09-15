// PROVISIONAL — see src/mocks/lockDatesHandlers.ts for why this exists and how to remove it.
//
// Own flag for the F3 (lock dates in settings) mock, parallel to src/mocks/accountsMockFlag.ts —
// deliberately NOT the same flag as the accounts mock, so the two mocked domains can never bleed
// into each other (see accountsMockFlag.ts's own header for the mount/unmount race this pattern
// fixes). Same reasoning: LockDatesSettings.tsx needs to flip this flag SYNCHRONOUSLY on
// mount/unmount, so it is a tiny `msw`-free module imported statically, kept separate from
// lockDatesHandlers.ts (which imports `msw`) so the production bundle only pays for a few bytes.

let mockActive = false;

export function setLockDatesMockActive(active: boolean): void {
  mockActive = active;
}

export function isLockDatesMockActive(): boolean {
  return mockActive;
}
