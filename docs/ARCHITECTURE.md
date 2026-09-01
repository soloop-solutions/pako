# Architecture

## Repo strategy decision

**New top-level repo (this one), not a transform of kudofatura in place.**

Reasoning:

- The GL core (chart of accounts, journals, double-entry journal entries, hash-chained
  immutability) is where correctness matters most, and it did not exist in kudofatura at all —
  there was nothing to "transform," it was 100% new schema and new logic either way.
- Kudofatura's existing gaps — `SECURITY_AUDIT_REPORT.md`'s 12 critical/high findings (hardcoded
  Supabase project ID, auth tokens in localStorage, missing input validation, insecure error
  handling), `FRONTEND_AUDIT.md`'s frontend-only role enforcement and no session idle timeout, no
  migration runner — are tolerable in an invoicing tool and not tolerable in a ledger that firms
  will use to file VAT returns and payroll withholding. Building fresh means these get designed
  out from day one instead of retrofitted under a live schema.
- Panel and mobile currently call Supabase directly for auth/storage, with the backend REST API
  as a second, parallel path — RLS policies are the only enforcement layer for the direct path.
  That's an acceptable tradeoff for a POS/invoicing app; it's the wrong default for a GL where
  authorization logic (firm-manages-many-clients, role scoping) needs to be centrally auditable.
  PAKO's ledger-writing paths are backend-mediated only (see Companies module below).
- Cost of the decision: none of kudofatura's invoicing/partner/stock code is reused verbatim.
  That's accepted — it's not where the hard new work is anyway.

**What IS reused, deliberately, not rebuilt:**

1. **`kudofatura-fiscal-bridge`** (Windows-local fiscal printer bridge, Datecs/Tremol serial
   integration, offline queue) — extraction target for `fiscal-bridge/` (Phase 1, not yet
   extracted). Working, hardware-tested code with no relationship to the security gaps above.
2. **`kudofatura-be/services/fiscal-providers/`** strategy interface
   (`BaseFiscalProvider.issueReceipt/voidReceipt/xReport/zReport/getStatus`) — the shape is
   already right. Ports into `backend/Pako.Domain/Fiscal/` as the plug-in contract (C#
   reimplementation of the same interface shape, not a literal JS port); `sef-provider` gets a
   real implementation now that ATK's SEF API is live (Phase 2).
3. **Payroll + withholding-tax business logic** (`payroll-export-service.js`,
   `tatimi-ne-burim-router.js`) — Kosovo-specific rules already built. Reused as the starting
   point for `backend/Pako.Domain/Payroll/`'s GL-posting logic (Phase 4), not rebuilt from a
   tax-code reading.
4. **Frontend stack choices**: React + Vite + TS + Tailwind, matching kudofatura-panel — same
   language/stack family, team already has the muscle memory.

**What changed from the original plan (2026-08-26, same day):** the backend was originally
planned as Node/Express (matching kudofatura's language) but **pivoted to ASP.NET Core (.NET) +
EF Core + Npgsql** before any backend code was written. Reason: C#'s native `decimal` type gives
compiler-enforced money-math safety for a general ledger — Node/TS requires disciplined use of a
Decimal library everywhere, with nothing stopping an accidental plain-`number` slip, which is a
realistic bug class when a lot of the code is written by AI agents moving fast across many files.
Secondary reasons: Erion already runs .NET in production for beli-travel's backend (portfolio
fit), and a named competitor (Kubit) builds its ERP on .NET/C# (regional/hiring fit). Cost:
backend and frontend/mobile no longer share a language — type-sharing across the boundary goes
through an NSwag-generated TS client from the backend's OpenAPI spec (`packages/shared`) instead
of native shared TS types.

**What is explicitly NOT reused:** invoice/partner/stock schema and services (superseded by the
ledger-backed invoicing/bills modules), direct-frontend-to-Supabase writes for anything that
touches the ledger, the no-migration-runner pattern, the Node/Express backend language choice.

**Existing kudofatura customers:** no migration needed now. Kudofatura keeps running as-is. A
one-time ETL (kudofatura invoices/partners/payments -> PAKO ledger + AR documents) is a
later-phase task, only if/when Erion decides to sunset or merge the product line — not before
PAKO's invoicing module has reached feature parity.

## Module breakdown

Backend modules live under `backend/Pako.Domain/<Module>/` (C#, EF Core-agnostic — persistence
lives in `Pako.Infrastructure`). Status as of 2026-08-26 noted per module.

### `Ledger` — the GL core (Odoo `account.move` reference pattern) — **built, not just spec'd**

- `Account` (chart of accounts, `account.account` pattern): Code, Name, AccountType (enum:
  Asset/Liability/Equity/Income/Expense + Receivable/Payable/Bank/Cash subtypes), ParentAccountId
  (hierarchy), CompanyId, IsReconcilable. Seeded per-company from `Pako.Localization.Xk`'s default
  chart-of-accounts template — never hardcoded in the domain layer.
- `Journal` (`account.journal` pattern): Type (Sale/Purchase/Cash/Bank/General/Miscellaneous),
  Code, Name, default debit/credit accounts, numbering sequence config, per company.
- `JournalEntry` (`account.move` pattern): CompanyId, JournalId, Date, Reference, State
  (Draft/Posted/Cancelled), SequenceNumber, PostedAtUtc, plus the reserved hash-chain fields (see
  below).
- `JournalEntryLine` (`account.move.line` pattern): JournalEntryId, AccountId, PartnerId
  (nullable), Debit, Credit (both `decimal`), Description, TaxId (nullable), reconciled flag,
  reconciliation id (nullable).
- **Hard invariant — implemented and tested**: `SUM(Debit) == SUM(Credit)` per JournalEntry,
  enforced twice: `JournalEntry.Post(Company)` throws `UnbalancedJournalEntryException`
  synchronously (the non-negotiable app-level guard, no EF Core dependency), and a Postgres
  trigger (`enforce_journal_entry_balance()`, added in the `InitialCreate` EF Core migration)
  re-checks the same sum at the DB layer as defense-in-depth. Verified against a real Postgres
  container, not just unit tests.
- **Posted-entry immutability — implemented and tested**: `PakoDbContext.SaveChanges`/
  `SaveChangesAsync` reject any `Modified`/`Deleted` change to a `JournalEntry`/`JournalEntryLine`
  whose persisted `State` was `Posted`, throwing `PostedJournalEntryImmutableException`. Reversal
  entries only, never edits/deletes, once posted.
- **No discrete fiscal-period table** — lock-date fields (`AccountingLockDate`, `TaxLockDate`) on
  `Company`, validated in `JournalEntry.Post()`. Minimal `Company` entity exists now (lock dates
  only); the full multi-tenant/firm model is still to build (see Companies below).
- Not yet implemented: numbering-sequence generation (gapless/monotonic per journal), hash
  computation. Reserved, inert, per below.

**Plani Kontabel v2.0 (Kosovo standard chart of accounts, 233 accounts) — Stages 1-3 landed
2026-09-01 (schema, chart seeding + account-role resolution, VAT/withholding codes); Stage 4 not
started.** See `downloads/COA_V2_IMPLEMENTATION_BRIEF.md` for the full staged plan (this
repo's copy: not yet moved into `docs/`, still in the user's Downloads folder alongside the two
source files it names — the workbook and CSV that are its actual source of truth). `Account`
gained `NameSq`, `Class`/`Group` (6-digit-code class/group, with a DB CHECK constraint enforcing
`Code`'s first digit/two digits match them — NULL-tolerant, since the old 16-account legacy
template has none of this data), `Statement`, `NormalBalance`, `Subledger`, `IsControl`,
`IsPostable`, `DefaultVatCode`, `CitDeductibility`, `CitLimitRule`, `Profiles`, `IsActive`,
`ValidFrom`/`ValidTo`. `JournalEntryLine` gained `CostCenterId` (new company-scoped `CostCenter`
entity, not yet seeded) and `OriginalCurrency`/`OriginalAmount`/`ExchangeRate` for multi-currency
lines (`Debit`/`Credit` stay in functional currency). `Company` gained `FunctionalCurrency`
(default EUR) and `EnabledProfiles` (default Core, settable via `CreateCompanyRequest` since
Stage 2). `TaxDefinition` gained `Direction`/`DeductiblePercent`/`IsReverseCharge`/`AtkBook`/
`Code` **alongside** the existing `TaxScope` — deliberately not a replacement yet, since
`ReportsController.VatReturn` and the frontend's `tax-enums.ts` still key off `Scope`, and the 5
existing seeded `TaxDefinition` rows have no v2.0 code data until Stage 3 reseeds from
`20_VAT_Codes`/`21_WHT_Codes`.

**Stage 2 (2026-09-01)**: `CompaniesController.Create` now seeds the real 233-row chart (embedded
CSV, `Pako.Localization.Xk.ChartOfAccountsV2Template`, profile-filtered per company — CORE plus
whatever's requested) instead of the old 16-account `DefaultChartOfAccountsTemplate` above, which
is now only a smaller fixture some domain tests still build against, not what real companies get.
`AccountType`/`AccountSubType` are now derived at seed time via
`Pako.Domain.Ledger.AccountTypeDerivation` (Class+NormalBalance → AccountType, Subledger →
AccountSubType for Bank/Cash only — Stage 1 designed this, Stage 2 is its first caller). A new
`CompanyAccountDefaults` table (one row per company) replaces the old hardcoded-account-code
lookup pattern in `InvoicesController`/`BillsController`/`PayrollRunsController`/
`ReconciliationCreator` — 5 required roles (Receivable/Payable/Revenue/Expense/CustomerDeposits,
all CORE-profile) plus 4 Payroll-profile-gated nullable ones
(SalaryExpense/PitPayable/PensionPayable/NetPayPayable). Full rationale for the domestic-vs-
foreign AR/AP default, the 400100/661200 revenue/expense defaults, and the known
combined-employee-employer-pension-posting imprecision (Stage 4 to properly split) is in
CLAUDE.md's Stage 2 section, not repeated here.

**Stage 3 (2026-09-01)**: `CompaniesController.Create` now seeds the real 20 VAT codes
(`20_VAT_Codes`) + 6 withholding codes (`21_WHT_Codes`) via
`Pako.Localization.Xk.VatWithholdingTemplate`, replacing the old 5-entry
`DefaultTaxDefinitionsTemplate` seed (kept only as a smaller fixture some tests still build
directly). Each VAT code's tax-amount repartition target is `10_COA_Master`'s own rate-specific
account (e.g. `S18`→210110, not the old flat 210100); Import-scoped codes (`I18`/`I08`/`IND`) are
skipped for a company without the Import profile, same discipline as `CompanyAccountDefaults`.
`RC18`'s actual R10 AUTO dual-line posting is deferred to Stage 4 — its `TaxDefinition` is
seeded (rate, `IsReverseCharge=true`) but has no ordinary repartition lines yet. Full rationale
in CLAUDE.md's Stage 3 section.

### Hash-chain / immutability reservation (per Odoo's `inalterable_hash` pattern) — **columns
reserved, computation not yet active**

`JournalEntry` has `EntryHash` (string, nullable), `PrevHash` (string, nullable),
`SecureSequenceNumber` (long, nullable) — present in the schema now, not computed/verified yet.

- `EntryHash` — will hash the canonical posted fields (CompanyId, JournalId, Date, lines'
  account/debit/credit, SequenceNumber) chained with `PrevHash`.
- `PrevHash` — the previous posted entry's `EntryHash` in the same sequence (per company +
  journal).
- `SecureSequenceNumber` — a strictly-increasing integer per company+journal, separate from the
  human-facing `SequenceNumber`, assigned only at posting time.

Why reserved now, unused: Croatia and Albania already require tamper-evident sequential posted
records; Kosovo's SEF regime is trending the same direction. Retrofitting a hash chain onto years
of already-posted entries later is far more painful than reserving three columns now.
Immutability of posted entries (the actual enforcement) is already live, independent of whether
the hash itself is ever activated.

### `Tax` — tax engine — **placeholder folder, data source now available**

- Will hold `TaxDefinition` (`account.tax` pattern: name, rate, type — VAT
  standard/reduced/exempt/withholding, scope sale/purchase) and `TaxRepartitionLine` (how a tax
  amount splits across GL accounts).
- **Entirely data-driven, by design.** No Kosovo VAT/withholding number will live in this
  module's code — it reads from `Pako.Localization.Xk`, which is already built and seeded (VAT
  18%/8%, CIT 10%, withholding rates, pension 5%/5%, PIT brackets, default IFRS-category chart of
  accounts template) with each figure tagged `SourceConfidence.PrimarySource` or
  `.NeedsLegalVerification`. Phase 2 build target.

### `Invoicing` (AR) and `Bills` (AP) — **placeholder, Phase 2/3**

- Customer-facing/vendor-facing document tables (due dates, line items) stay separate from the
  ledger tables — the ledger is the single source of financial truth. On confirm/post, each
  generates its corresponding balanced `JournalEntry` via `Tax` for line splitting.
- `Invoicing` calls into `Fiscal` at the point a customer invoice needs a fiscal receipt issued
  (POS-style) or SEF-reported (B2B e-invoicing).

### `Reconciliation` — **placeholder, Phase 3**

- Links `JournalEntryLine`s (a payment line to an invoice/bill line), partial or full — same
  shape as Odoo's reconciliation model.

### `Reporting` — **placeholder, Phase 3**

- Balance sheet, P&L, VAT return: computed queries over `JournalEntryLine` grouped by
  AccountType and date range. No stored/duplicated report tables until there's a proven
  performance reason to.

### `Fiscal` — **built, Phase 1** (`SefProvider` real implementation deferred to Phase 2)

- `IFiscalProvider` carries the same `BaseFiscalProvider`-shaped contract as kudofatura
  (`IssueReceiptAsync/VoidReceiptAsync/XReportAsync/ZReportAsync/GetStatusAsync`), reimplemented
  in idiomatic C# (records for the DTOs, not a literal JS port). Two implementations:
  `PefBridgeProvider` (real — talks to the local `fiscal-bridge/` service over HTTP,
  `http://127.0.0.1:7878` by default) and `SefProvider` (stub — throws `NotImplementedException`
  stating the SEF integration is Phase 2 scope, not that ATK's API is unavailable; that claim is
  now false, ATK's SEF API/portal has been open since June 2026).
- Fiscal receipt issuance is the trigger point that will post the corresponding `JournalEntry`
  and advance that journal's hash chain once the hash chain is activated.

### `Companies` — **minimal `Company` entity built (lock dates only), multi-tenant/firm model
not yet built**

- Will hold: one row per client business (SME or firm's client), each with its own chart of
  accounts/journals/ledger instance — matches kudofatura's `X-Company-ID` scoping pattern.
- New vs. kudofatura: a `Firm` concept — an accounting/bookkeeping firm has staff who need access
  to many client `Company` records. Plan: a nullable `FirmId` on `Company` (an SME using the
  product directly has no firm) plus a role table spanning firm_admin/firm_accountant/
  client_admin/client_viewer, so a firm's bookkeeper can be granted access to N clients without N
  separate logins. Not yet built — Phase 1 remaining work.
- All ledger-writing endpoints are backend-mediated (`Pako.Api` controllers), no
  direct-frontend-to-database writes for anything under Ledger/Invoicing/Bills/
  Reconciliation/Payroll. This is the actual mechanism that fixes kudofatura's frontend-only role
  enforcement problem.

### `Payroll` — **placeholder, deferred to Phase 4, scope call**

Competitors (ProData, Kubit, Bilanci) all bundle payroll. Full HR/payroll (contracts, leave
management, benefits) is a large scope addition and is **deferred**, not committed to for v1.
What's reused early: kudofatura's existing payroll-export and tatimi-në-burim (withholding tax)
logic, repositioned as "payroll run posts a journal entry" (salary expense debit, withholding tax
payable credit, net pay payable credit) rather than a ground-up HR system.

## Frontend / mobile

`apps/web` (`@pako/web`, Vite+React+TS+Tailwind v4+shadcn/ui) and `apps/mobile` (`@pako/mobile`,
Expo Router+RN+TS) both exist as app-shell scaffolds — routed/tabbed navigation with "Coming
soon" placeholders per module, no API wiring yet (`Pako.Api` isn't feature-complete enough to
call). `packages/shared` (`@pako/shared`) holds the Zod schemas describing ledger shapes and a
stub for the NSwag-generated TS API client, to be regenerated once `Pako.Api` is further along.
See root `CLAUDE.md`'s "Frontend stack" / "Mobile stack" sections for exact versions and the
non-obvious tooling gotchas hit while scaffolding (dependency pins, lint fixes, etc.) — not
repeated here since those are implementation details, not architecture.

## Database

PostgreSQL via EF Core + Npgsql, migrations via `dotnet ef migrations` (decided and built — not
an open question anymore).

**Resolved (2026-08-26): fully self-hosted, not Supabase.** Postgres is a plain
`postgres:16-alpine` container (`backend/docker-compose.yml`), and authentication is handled
entirely within `Pako.Api` via ASP.NET Core Identity issuing JWT bearer tokens — no Supabase SDK,
no Supabase Auth, no RLS. Reasoning: the backend-mediated-writes decision above already means
every ledger-writing path goes through `Pako.Api`, so a second, parallel Supabase-direct auth
path would just reintroduce the same frontend-trust problem this repo exists to avoid; a
stateless JWT API also serves the web app and the mobile app identically, which cookie-based
Supabase Auth sessions don't do as cleanly. See root `CLAUDE.md`'s "Auth, Companies, Firms, and Membership" section for the concrete schema
(`AppUser`, `Company`, `Firm`, `Membership`) and the authorization mechanism that enforces it
server-side.
