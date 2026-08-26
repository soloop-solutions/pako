# @pako/mobile — Expo app (2026-08-26)

Expo Router (SDK 57, RN 0.86, React 19.2, New Architecture) TypeScript app. Auth, company
selection, Dashboard, Invoicing, Bills, and Reports are real and wired to the live `Pako.Api`
backend, mirroring `apps/web`'s screens adapted for mobile. Payroll and standalone Reconciliation
are intentionally **out of scope** for mobile — Payroll is a desktop-first monthly batch operation,
and Invoicing/Bills' "Record payment" flow already covers the reconciliation use case. Settings is
deliberately thin (logout + company switch) since firm/member management is still evolving on the
backend.

## Directory layout

- `src/app/(auth)/{login,register}.tsx` — unauthenticated screens, gated by `Stack.Protected` in
  `src/app/_layout.tsx`.
- `src/app/companies.tsx` — company list/switch/create, presented as a root-level modal screen
  (reachable from any "select a company" prompt or from Settings).
- `src/app/(tabs)/index.tsx` — Dashboard (trial balance snapshot, mirrors `apps/web`'s Dashboard).
- `src/app/(tabs)/invoicing/{index,new,[id]}.tsx` — Invoicing list/create/detail, nested `Stack`.
- `src/app/(tabs)/bills/{index,new,[id]}.tsx` — Bills, near-mirror of Invoicing with the
  accounting direction flipped (same relationship as the backend/web modules).
- `src/app/(tabs)/reports.tsx` — P&L, Balance Sheet, VAT Return behind a tab toggle.
- `src/app/(tabs)/settings.tsx` — logout + company switch only.
- `src/api/client.ts` — `PakoApiClient` singleton from `@pako/shared`, `fetch` wrapper attaches
  `Authorization: Bearer` from a module-level token variable and calls an `unauthorizedHandler` on
  401 (set by `AuthProvider`) instead of a `window` event (RN has no `window`) — this is the direct
  mobile analog of `apps/web/src/api/client.ts`'s `authorizedFetch`/`pako:auth-expired` pattern.
- `src/context/auth-context.tsx` / `src/context/company-context.tsx` — same shape as
  `apps/web/src/context/{AuthContext,CompanyContext}.tsx`, adapted for async storage (see below).
  `AuthProvider` exposes a `ready` flag so `RootNavigator` doesn't flash the wrong screen while
  `expo-secure-store` is still being read on cold start.
- `src/components/ui/` — small RN primitives (`Button`, `TextField`, `SelectField`, `Card`,
  `Badge`, `ErrorBanner`, `Screen`) standing in for `apps/web`'s shadcn components; there is no
  shadcn/Tailwind equivalent on RN, so these are hand-rolled against `constants/theme.ts`'s
  `Colors`/`Spacing` tokens. `SelectField` replaces the web's native `<select>` with a bottom-sheet
  `Modal` + `FlatList` (RN has no native select element).
- `src/components/shared/` — `partner-form.tsx`, `record-payment-form.tsx`,
  `document-lines-editor.tsx` (the dynamic line-item editor shared by Invoicing/Bills' `new.tsx`
  screens) — direct RN ports of `apps/web/src/pages/shared/{PartnerForm,RecordPaymentForm}.tsx` and
  `InvoiceForm.tsx`/`BillForm.tsx`'s line-editing logic respectively.
- `src/lib/ledger-enums.ts` / `src/lib/tax-enums.ts` — same hand-maintained enum-order values as
  `apps/web/src/lib/{ledger-enums,tax-enums}.ts` (see root `CLAUDE.md`'s "Enum gotcha" — the
  backend's OpenAPI doesn't emit enum member names). Mobile only needed
  `isCashOrBankAccountSubType`/`taxesForSale`/`taxesForPurchase`/`taxRatePercentLabel`/
  `estimatedTaxAmount` — no ledger/chart-of-accounts screen exists on mobile in this pass, so
  `accountTypeLabel`/`accountSubTypeLabel` weren't ported.

## Record payment flow (atomic, superseded the old 3-call sequence)

`record-payment-form.tsx` now calls a single atomic backend endpoint —
`apiClient.recordPayment2(companyId, invoiceId, body)` for invoices, `apiClient.recordPayment(companyId,
billId, body)` for bills (`{ amount, cashOrBankAccountId, date }`, both return `{ reconciliation, balance
}`) — instead of the old client-driven `journal-entries` create → `post3` → `reconciliations` sequence.
The backend endpoint builds the settlement entry, posts it, and reconciles it inside one Postgres
transaction, so a failure partway through leaves nothing written (verified live: an invalid
`cashOrBankAccountId` 400s and the `journal_entries` row count is unchanged, vs. the old sequence which
could orphan a posted, unreconciled, un-deletable journal entry and double-book cash on retry — see root
`CLAUDE.md`'s "Adversarial QA pass" and "Backend fixes pass" sections for the full story). Because the
backend now resolves the receivable/payable account and journal internally,
`InvoiceDetailScreen`/`BillDetailScreen` no longer need to fetch `journals` or find the AR/AP
`controlAccount` just to feed the form — `RecordPaymentForm` only takes `companyId`, `documentKind`,
`documentId`, `cashAccounts`, `outstanding`, `onRecorded`. The mentions of the old 3-call sequence
elsewhere in this file (under "Verification performed") describe that day's original build, before this
fix landed — kept as-is for historical accuracy, not current behavior.

## Auth token storage

`expo-secure-store` (Keychain-backed on iOS, Keystore-backed on Android), **not**
`AsyncStorage`/plain storage — `src/lib/auth-storage.ts` stores `{ token, userId, email }` as one
JSON blob under key `pako.auth`. Since `SecureStore` is async and the generated `PakoApiClient`'s
`fetch` wrapper needs synchronous access to the current token on every call, `src/api/client.ts`
keeps a module-level `currentToken` variable that `AuthProvider` sets on cold-start load
(`getStoredAuth()`), login, register, and logout — the same "read once into memory, keep in sync"
shape `apps/web`'s `sessionStorage`-backed version gets for free (sync storage API), just made
explicit here.

The active company id (`pako.activeCompanyId`) also uses `expo-secure-store`, even though it isn't
sensitive — deliberate: it avoids adding a second storage dependency (`@react-native-async-storage/
async-storage`) for one small string, at the cost of SecureStore's iOS Keychain overhead for a
non-secret value. Revisit if that overhead ever matters; functionally it works fine at this scale.

## API base URL and platform networking gotcha

`src/api/client.ts` defaults to `http://127.0.0.1:5248` (override via `EXPO_PUBLIC_API_BASE_URL`,
picked up automatically by Expo's built-in `.env` support, no extra config needed). This only
reaches the backend from an **iOS simulator** (shares the Mac host's network namespace) or when
running Metro directly with `expo start --web`. It does **not** work from an **Android
emulator** (needs `http://10.0.2.2:5248`) or a **physical device** (needs the Mac's LAN IP, e.g.
`http://192.168.x.x:5248`, and the backend's CORS/allowlist plus firewall must allow it). Set
`EXPO_PUBLIC_API_BASE_URL` in a `.env` file per platform/environment before testing on
Android or a real device.

## Verification performed (2026-08-26)

- `pnpm --filter @pako/mobile typecheck/lint/test/build` all pass (`build` = `expo export`,
  bundles iOS + Android + Web successfully, 25 static routes).
- **Real device/simulator check, not just bundling**: booted a real iOS Simulator (iPhone 17 Pro,
  iOS 26.2) via `xcrun simctl`, ran `expo start --ios`, which auto-installed the SDK-57-matching
  Expo Go build (57.0.9, the simulator's stock Expo Go was 54.0.6 and incompatible) and loaded the
  real JS bundle from Metro. Confirmed by screenshot: the Login screen renders correctly (title,
  subtitle, real theming), `exp://<lan-ip>:8081/--/register` deep-links to the Register screen
  correctly, and `exp://<lan-ip>:8081/--/companies` (a protected route) correctly stayed on the
  auth flow instead of showing Companies content — proving `Stack.Protected`'s guard logic works
  for real, not just in code review. Could **not** go further into authenticated flows
  (typing email/password, tapping buttons) — `xcrun simctl` has no tap/keyboard-input subcommand,
  and AppleScript/System Events UI-scripting timed out (`AppleEvent timed out (-1712)`), meaning
  Accessibility automation permission isn't available to this environment. `idb`/`cliclick` are
  also not installed. So: real render + real navigation verified, real form-submission interaction
  was not.
  - **Note for a future pass with GUI automation available**: `expo run:ios` (a real native build,
    as opposed to `expo start --ios` which uses Expo Go) generates a persistent `ios/` directory
    and rewrites `package.json`'s `android`/`ios` scripts to `expo run:android`/`expo run:ios` as a
    side effect of "prebuild" — this was tried first, then deliberately reverted (`rm -rf ios/
    android/`, scripts restored to `expo start --android`/`expo start --ios`) since it's a much
    bigger, persistent footprint change than this task called for. `expo start --ios` (Expo Go) was
    used instead and is sufficient for this managed-workflow app; only reach for `expo run:ios` if
    a native module that Expo Go can't host is ever added.
- **Full backend flow driven via curl**, matching the exact request payloads the mobile screens
  construct (same verification technique used for `apps/web` in earlier passes, since no
  browser/simulator automation covers form submission here either): register → login → create
  company → create customer + vendor partners → create+post a taxed invoice (1000 net, 18% VAT →
  1180 total) → confirm balance `{1180, 0, 1180}` → record a 700 partial payment via the exact
  3-call sequence `record-payment-form.tsx` sends (`POST journal-entries` → `POST
  journal-entries/{id}/post` → `POST reconciliations`) → balance updates to `{1180, 700, 480}` →
  create+post a taxed bill (400 net, 18% VAT → 472 total) → record a full 472 payment → balance
  `{472, 472, 0}` → dashboard trial balance and all three report endpoints (P&L, Balance Sheet, VAT
  Return) return internally consistent numbers matching hand-computed figures (net income 600,
  assets 780 = liabilities 180 + equity 600, VAT net due 108). Also confirmed a bare `401` on a
  request with an invalid Bearer token, exercising the same path `unauthorizedHandler` reacts to.
- **Also re-verified through the real generated `PakoApiClient` class itself, not just curl** —
  important because a concurrent pass on this same day found and fixed a real bug (see root
  `CLAUDE.md`'s "Firm management UI, Settings page, and a real create-flow bug fix" section): every
  `POST` create action returned `201`, but NSwag's generated `processX` methods only branched on
  `200`, so every create call (`apiClient.companies(...)`, `.partners(...)`,
  `.invoicesPOST(...)`, `.journalEntries(...)`, `.reconciliations(...)`, etc. — every one of these
  is used by this mobile app) threw `ApiException("An unexpected server error occurred.")` **even
  though the resource was created successfully server-side**. Raw curl against the HTTP API (as
  above) can't catch that class of bug — it's purely in the generated client's response-parsing
  logic. Ran `npx tsx` against a standalone script that imports the real
  `packages/shared/src/generated/api-client.ts` and drives `register` → `companies` (create) →
  `partners` (create) → `invoicesPOST` → `post2` → `journalEntries` → `post3` →
  `reconciliations` → `balance2`, i.e. the exact method sequence this app's screens call, and
  confirmed every step resolves correctly (no thrown `ApiException`) against the live backend —
  positive confirmation the fix is in place and this app isn't exposed to that bug.
- **Not verified**: Android (no emulator/device in this environment), a physical iOS device, push
  notifications (not requested), and interactive form-filling on the simulator (see above).

## eslint-plugin-react-hooks v7 gotcha, new since the scaffold pass

`eslint-config-expo` here pulls in `eslint-plugin-react-hooks@7` (the React Compiler-era rule set),
which includes `react-hooks/set-state-in-effect` — much stricter than the old `exhaustive-deps`
rule. It flags `useEffect(() => { void someCallback(); }, [someCallback])` as an error whenever
`someCallback` is a locally-defined function (e.g. a `useCallback`-wrapped async fetcher) that
itself calls `setState`, **even though the call site itself doesn't call `setState` directly** —
the rule's static analysis traces into the referenced function. The fix used throughout this app:
wrap the call in an inline async IIFE instead of calling the named function directly —
```ts
useEffect(() => {
  void (async () => {
    await refresh();
  })();
}, [refresh]);
```
— this reliably avoids the false-positive (confirmed by isolated test cases during this pass) and
is the same shape `auth-context.tsx`'s initial-load effect already used. For a genuinely-derived
piece of state (not a data fetch) that used to live in its own reactive effect —
`company-context.tsx`'s "clear the stored active company id if it's no longer in the company
list" — the correct fix per the rule's own guidance was different: that logic moved *into* the
`refresh()` callback itself (computed right after the authoritative company list arrives) instead
of a second effect watching `[activeCompanyId, companies]`, since a `setState` call that directly,
synchronously depends on two pieces of already-rendered state inside a bare effect body is exactly
the "derived state via effect" anti-pattern the rule is designed to catch, not a false positive.

## Typed routes regeneration gotcha

`app.json`'s `experiments.typedRoutes: true` generates `apps/mobile/.expo/types/router.d.ts`, which
`tsc` uses to type-check every `<Link href="...">`/`router.push(...)` call against the actual
route tree. This file is **not** regenerated by `expo export` (tried it — file's mtime didn't
change) — only by the **dev server** (`expo start`, including `CI=1 expo start --web` for a
non-interactive one-shot regeneration). After adding/removing/renaming any route file, run `expo
start` briefly (or `CI=1 npx expo start --web`, which exits cleanly once Metro is listening) before
`tsc --noEmit`, or typecheck fails with confusing `Type '"/new-route"' is not assignable to type
...` errors that look like a real bug but are just a stale generated file.

## Non-obvious things found while scaffolding (2026-08-26, original scaffold pass)

- The official SDK 57 `create-expo-app` default template ships a nested `.git`, `.claude/`,
  `AGENTS.md`, and `LICENSE`/`README.md` — all removed here since this app lives inside the
  `pako` pnpm workspace, not as its own repo.
- `tsconfig.json`'s `include` references `expo-env.d.ts`, which is normally auto-generated by
  `expo start`/`expo customize` on first run and is gitignored. On a fresh clone/`pnpm install`
  with no prior `expo start`, `tsc --noEmit` fails on the `@/global.css` side-effect import
  (`Cannot find module or type declarations`) because the ambient `declare module '*.css'` from
  `expo/types` only gets pulled in through that generated file. If `expo-env.d.ts` is ever
  deleted and typecheck breaks with that error, just run `expo start` once (or recreate it with
  `/// <reference types="expo/types" />`).
- `tsconfig.json` needs an explicit `"types": ["jest"]` in `compilerOptions` — without it, `tsc`
  does not pick up `@types/jest`'s ambient globals (`test`, `expect`, ...) even though the
  package is installed and resolvable, seemingly because `moduleResolution: "bundler"` (set in
  `expo/tsconfig.base`) changes the default typeRoots auto-inclusion behavior.
- Jest needs a `moduleNameMapper` for `\.css$` (see `package.json` → `jest.moduleNameMapper`,
  backed by `src/__mocks__/style-mock.js`) — `jest-expo`'s preset does not stub CSS imports on
  its own, and the raw `@/global.css` import in `src/constants/theme.ts` otherwise crashes Jest's
  parser (it tries to parse CSS as JS).
- With RN 0.86 (New Architecture) + `@testing-library/react-native` 14.x, `render()` returns a
  **Promise** — it must be `await`ed in tests, or `screen.getByText(...)` throws `"render
  function has not been called"` with no other clue why.
- Repo root has no `turbo.json` yet, even though root `package.json` scripts all shell out to
  `turbo run <script>`. `pnpm --filter @pako/mobile <script>` works fine (verified: `dev`,
  `build`, `lint`, `test`, `typecheck` all pass), but `pnpm build`/`pnpm test`/etc. from repo root
  will fail until a `turbo.json` pipeline config exists — that's root-level monorepo config, out
  of this app's scope.
- `app.json` `ios.bundleIdentifier`/`android.package` are placeholders (`com.pako.mobile`) —
  the product name "PAKO" is final (see root `CLAUDE.md`), but the reverse-DNS bundle
  id/package name itself still needs Erion's call before any real store submission.

## Scripts

`start`/`dev` (`expo start`), `build` (`expo export` — bundles iOS/Android/Web, verified working),
`test` (`jest`, preset `jest-expo`), `typecheck` (`tsc --noEmit`), `lint` (`expo lint`), plus
`android`/`ios`/`web` for platform-specific dev server launches (Expo Go, managed workflow — no
native `ios/`/`android/` directories are checked in; see the `expo run:ios` note above).
