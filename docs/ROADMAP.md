# Roadmap

Realistic pace for a solo founder + AI dev team, not a big-company timeline. Sequencing is
driven by three constraints: (1) kudofatura's existing security/architecture gaps are cheapest to
fix at extraction time, before new code depends on the old patterns; (2) SEF certification is a
live, time-limited opportunity — the sooner PAKO can actually issue/report through SEF, the
sooner it has a real compliance story to sell against ProData/Kubit/Bilanci; (3) a full GL is
inherently a multi-month build even scoped tightly — sequencing can't shortcut that, only avoid
wasting the months.

**2026-09-01 note**: this doc's phasing predates `Tax`/`Invoicing`/`Bills`/`Reconciliation`/
`Payroll` all being built ahead of their Phase 2-4 slots (see `CLAUDE.md`) — treat phase numbers
as historical, not current status. A new, unphased workstream is now in progress: migrating the
`Ledger` module's `Account`/`JournalEntryLine`/`Company`/`TaxDefinition` schema and seed data to
Kosovo's Plani Kontabel v2.0 (233 accounts, replacing the 16-account placeholder chart below) —
see `docs/ARCHITECTURE.md`'s "Plani Kontabel v2.0" note and
`downloads/COA_V2_IMPLEMENTATION_BRIEF.md` for the staged plan. Stage 1 (additive schema) and
Stage 2 (seed the real 233-account chart, replace the hardcoded-account-code lookups with
`CompanyAccountDefaults`) are both done; Stages 3-4 (VAT/withholding codes, posting rules) are
not started.

## Phase 0 — done (2026-08-26)

- Repo scaffolded, renamed Kudo Books -> **PAKO** (final name, matches kudofatura-mobile's
  existing "Pako" brand).
- Stack finalized: ASP.NET Core (.NET) + EF Core + Npgsql backend (pivoted from the original
  Node/Express plan — see `ARCHITECTURE.md`), Vite+React+TS+Tailwind+shadcn/ui web, Expo
  Router+RN+TS mobile, Turborepo+pnpm for the JS/TS side.
- Kosovo tax-law research landed and is seeded in `backend/Pako.Localization.Xk/` (VAT, CIT,
  withholding, pension, PIT brackets, default chart-of-accounts template), each figure tagged
  primary-source or needs-legal-verification.
- **`Ledger` module built for real** (not just scaffolded): `Account`/`Journal`/`JournalEntry`/
  `JournalEntryLine`, the debit=credit invariant (app-level + Postgres trigger), posted-entry
  immutability (EF Core `SaveChanges` override), hash-chain columns reserved/inert. 8 passing
  xUnit tests. Verified against a real Postgres container.
- `apps/web`, `apps/mobile`, `packages/shared` scaffolded — app shells with placeholder
  navigation, no business logic/API wiring yet.

Still open from Phase 0: SEF certification legal-entity decision (business/legal, doesn't block
engineering), and the Postgres-hosting/auth-provider question flagged in `ARCHITECTURE.md`'s
Database section.

## Phase 1 — remaining: fiscal extraction + multi-tenant auth (next)

- Extract `kudofatura-fiscal-bridge` into `fiscal-bridge/`, and reimplement the
  `BaseFiscalProvider` contract in C# under `backend/Pako.Domain/Fiscal/` — fix the
  security-audit findings that apply to this code path *during* extraction, not after.
- Build the `Companies`/`Firm` multi-tenant model for real (currently just a minimal `Company`
  entity with lock dates) — firm-manages-many-clients roles, backend-mediated auth end to end.
- Resolve the Postgres hosting + auth-provider question (Supabase Auth reused vs. fully
  self-hosted auth behind `Pako.Api`) before building on top of it.
- Wire `apps/web`'s `Ledger` pages to real `Pako.Api` endpoints (currently placeholder-only) —
  first real vertical slice: create a company, post a manual journal entry, see it on a trial
  balance.

## Phase 2 — Tax engine + AR + real SEF

- `Tax` module wired to `Ledger`, reading from the already-seeded `Pako.Localization.Xk` data.
- `Invoicing` (AR) module, posting into the ledger.
- Real `SefProvider` implementation — this is the actual path to SEF certification and a
  sellable compliance story.

## Phase 3 — AP + reconciliation + reporting

- `Bills` (AP) module.
- `Reconciliation` module.
- `Reporting`: trial balance, P&L, balance sheet, VAT return export.

## Phase 4 — Payroll-to-GL + firm UX polish

- `Payroll` module: reuse kudofatura's payroll-export/tatimi-në-burim logic, wire to ledger
  postings.
- Firm-facing UX: multi-client switching, firm dashboard, mobile app filled in beyond placeholder
  screens.
- Mobile stays placeholder-scope until this phase — a GL/accounting platform's primary users
  (bookkeepers, accounting firms) work desktop-first; mobile is a convenience feature (expense
  capture, approvals), not core.

## Later, not scheduled

- Kudofatura customer-data ETL into PAKO, only if/when Erion decides to sunset or merge the
  product lines.
- Full HR/payroll (contracts, leave, benefits) beyond payroll-to-GL, only if market demand
  justifies the scope.

## Estimate

Roughly 4-5 months from Phase 0 to a v1 that is SEF-certifiable and covers GL + tax + AR + AP +
reporting + payroll-lite. Phase 0 landed the highest-risk piece (the ledger core's correctness
model) on day one, slightly ahead of the original Node-based estimate for that slice — but
Phase 1's remaining scope (fiscal extraction, real multi-tenant auth) is still substantial, so
the overall timeline holds rather than shrinks.
