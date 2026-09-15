// PROVISIONAL — see src/mocks/handlers.ts for why this exists and how to remove it.
//
// Deliberately its own tiny, `msw`-free module. ChartOfAccounts.tsx needs to flip this flag
// SYNCHRONOUSLY on mount/unmount (see handlers.ts's header for why synchronous timing is the
// actual fix for the race a code review caught) — which means importing it statically, not via
// the dynamic `import()` every other mock file uses to stay out of the production bundle.
// Keeping the flag here, separate from handlers.ts (which does import `msw` and the 233-row
// fixture), means ChartOfAccounts.tsx's static import pulls in a few bytes instead of the whole
// mock contract — confirmed via `grep msw dist/assets/*.js` after this split.

let mockActive = false;

export function setAccountsMockActive(active: boolean): void {
  mockActive = active;
}

export function isAccountsMockActive(): boolean {
  return mockActive;
}
