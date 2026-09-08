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
   integration, offline queue) — ported essentially unchanged into `fiscal-bridge/` (built).
   Working, hardware-tested code with no relationship to the security gaps above.
2. **`kudofatura-be/services/fiscal-providers/`** strategy interface
   (`BaseFiscalProvider.issueReceipt/voidReceipt/xReport/zReport/getStatus`) — the shape is
   already right. Ported into `backend/Pako.Domain/Fiscal/` as the plug-in contract (C#
   reimplementation of the same interface shape, not a literal JS port); `PefBridgeProvider` is
   real, `SefProvider` is still a stub — see `Fiscal` below.
3. **Payroll + withholding-tax business logic** (`payroll-export-service.js`,
   `tatimi-ne-burim-router.js`) — turned out to hold no gross-to-net calculator to reuse (see
   `Payroll` below); `backend/Pako.Domain/Payroll/`'s GL-posting logic is independent work.
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
lives in `Pako.Infrastructure`). Status as of 2026-09-08 noted per module.

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
  `Company`, validated in `JournalEntry.Post()` (currently unreachable through the API — nothing
  sets a lock date yet, see `Companies` below).
- Not yet implemented: numbering-sequence generation (gapless/monotonic per journal), hash
  computation. Reserved, inert, per below.

**Plani Kontabel v2.0 (Kosovo standard chart of accounts, 233 accounts) — all four stages landed
2026-09-01 (schema; chart seeding + account-role resolution; VAT/withholding codes; posting
rules).** See `docs/COA_V2_IMPLEMENTATION_BRIEF.md` for the full staged plan, and `docs/coa-v2/`
for its two source files (`PAKO_Plani_Kontabel_v2.xlsx`, `PAKO_COA_v2_seed.csv`) — the workbook
and CSV that are the actual source of truth for every account/code value referenced below.
`Account`
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
`RC18`'s actual R10 AUTO dual-line posting was deferred to Stage 4 — its `TaxDefinition` is
seeded (rate, `IsReverseCharge=true`) but has no ordinary repartition lines. Full rationale in
CLAUDE.md's Stage 3 section.

**Stage 4 (2026-09-01)**: implements `60_Posting_Rules`' "implementable now" rules
(R01-05/R07-10/R16/R19-21/R23/R25/R26), each with its own exception type
(`Pako.Domain.Ledger.PostingRuleValidator` + `Exceptions.cs`). R10's actual RC18 dual-line
posting landed here (`Invoice.Post`/`Bill.Post` gained
`reverseChargeInputVatAccountId`/`reverseChargeOutputVatAccountId` parameters, sourced from two
new `CompanyAccountDefaults` fields). R16 (storno): `JournalEntry.Reverse()` + `POST
.../journal-entries/{id}/reverse`, with a narrow `PakoDbContext` immutability carve-out for the
one Posted→Cancelled transition it needs. R23: `JournalEntry.SequenceNumber` now populated on
every posting path via `Pako.Api.Services.JournalSequencer`. R28: `JournalEntry` gained
`PostedByUserId`/`PostedFromIp`/`SourceDocumentId` (IP left unpopulated per the brief's own
explicit allowance). R20/R21 became a new `GET .../reports/cit-addback` report, not a
posting-time block. Rules needing a prerequisite this repo doesn't have yet (fiscal periods,
import documents, landed cost, fixed-asset subledger, bank statement import) are left as
documented TODOs, not faked — full rationale, including R24's deliberate non-enforcement (it
would reverse an earlier explicit product decision), is in CLAUDE.md's Stage 4 section.

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

### `Tax` — tax engine — **built, real**

- `TaxDefinition` (`account.tax` pattern: name, rate, type — VAT standard/reduced/exempt/
  withholding, scope sale/purchase, plus v2.0's `Direction`/`DeductiblePercent`/`IsReverseCharge`/
  `AtkBook`/`Code`) and `TaxRepartitionLine` (how a tax amount splits across GL accounts, multi-
  line capable — e.g. the dual-use-vehicle `BV50` code's 50/50 deductible/non-deductible split).
- **Entirely data-driven, by design.** No Kosovo VAT/withholding number lives in this module's
  code — it reads from `Pako.Localization.Xk`, seeded per company at creation time (the real 20
  VAT codes + 6 withholding codes as of the Plani Kontabel v2.0 Stage 3 migration, profile-gated —
  an Import-scoped code is only seeded if the company has the Import profile enabled). Each figure
  is tagged `SourceConfidence.PrimarySource` or `.NeedsLegalVerification`.
- `ITaxComputationService`/`TaxComputationService` compute both from a net amount and (the
  actually-used path, since line entry is gross/brutto) from a gross amount, backing VAT out as an
  exact remainder so posting lines always sum back to what was entered, to the cent.

### `Invoicing` (AR) and `Bills` (AP) — **built, real**

- `Invoice`/`InvoiceLine` and `Bill`/`BillLine` stay separate from the ledger tables — the ledger
  is the single source of financial truth. `Post()` builds a balanced `JournalEntry` (via the
  shared `DocumentLineCalculator` for the per-line gross/discount/VAT/net math, and `Tax` for the
  computation itself) and hands it to the Ledger's own `JournalEntry.Post()` for the actual
  balance/lock-date invariant — no second balance check is hand-rolled.
- Beyond a plain invoice/bill: credit notes and debit notes (own legal numbering series per
  Kosovo VAT Law Article 47), down-payment invoices (post to a deposits liability, later
  reclassified to revenue on application), per-line discounts, and reverse-charge (RC18)
  self-assessment posting (R10). Settlement is a single atomic `record-payment` endpoint
  (draft + post + reconcile in one transaction, replacing an earlier 3-call sequence that could
  orphan a posted journal entry on a mid-sequence failure).
- `Invoicing` will call into `Fiscal` at the point a customer invoice needs a fiscal receipt
  issued (POS-style) or SEF-reported (B2B e-invoicing) — not wired yet, see `Fiscal` below.

### `Reconciliation` — **built, real**

- Links a settlement `JournalEntryLine` to an invoice/bill, partial or full, with a hard cap on
  over-consuming a single settlement line across multiple documents (enforced twice: app-level row
  lock + a Postgres trigger as defense-in-depth, same discipline as the Ledger balance invariant).
  A credit note/down payment settling *another* document reuses the same mechanism — its own AR/AP
  control line is just another settlement source.

### `Reporting` — **built, real**

- `ReportsController`: P&L, balance sheet (with a synthetic "Current Earnings" line so
  Assets == Liabilities + Equity always holds, proven not just asserted), VAT return (output vs.
  input VAT), and a CIT add-back report (non-deductible/limited expense accounts). All computed
  queries over `JournalEntryLine` grouped by `AccountType`/`TaxDefinition` and date range — no
  stored/duplicated report tables, no separate `Pako.Domain/Reporting/` folder was needed.

### `Fiscal` — **plug-in point built, `SefProvider` still a stub**

- `IFiscalProvider` carries the same `BaseFiscalProvider`-shaped contract as kudofatura
  (`IssueReceiptAsync/VoidReceiptAsync/XReportAsync/ZReportAsync/GetStatusAsync`), reimplemented
  in idiomatic C# (records for the DTOs, not a literal JS port). Two implementations:
  `PefBridgeProvider` (real — talks to the local `fiscal-bridge/` service over HTTP,
  `http://127.0.0.1:7878` by default) and `SefProvider` (stub — throws `NotImplementedException`
  stating the real SEF integration isn't built yet, not that ATK's API is unavailable; ATK's SEF
  API/portal has been open since June 2026, so that's the accurate reason to give). The real SEF
  integration is the main remaining item on the path to certification.
- Fiscal receipt issuance is the trigger point that will post the corresponding `JournalEntry`
  and advance that journal's hash chain once the hash chain is activated.

### `Companies` — **built, real**: multi-tenant + firm model, self-hosted JWT auth

- `Company` (one row per client business, its own chart of accounts/journals/ledger instance),
  `Firm` (an accounting/bookkeeping firm), `Membership` (`{ UserId, FirmId? XOR CompanyId?, Role }`
  where `Role` is `FirmAdmin | FirmAccountant | ClientAdmin | ClientViewer`) — a firm-scoped
  membership cascades access to every company under that firm, so a bookkeeper doesn't need N
  separate logins for N clients. Enforced twice: `Membership.ForFirm`/`ForCompany` factory methods
  in C#, a Postgres CHECK constraint at the DB layer.
- `CompanyAccessFilter`/`RequireCompanyAccessAttribute` is the server-side enforcement — every
  ledger-writing endpoint is backend-mediated (`Pako.Api` controllers), no
  direct-frontend-to-database writes anywhere. This is the actual mechanism that fixes
  kudofatura's frontend-only role enforcement problem.
- Auth is ASP.NET Core Identity issuing JWT bearer tokens — no Supabase, no cookies. See
  "Database" below for why.

### `Payroll` — **built, real** (bundled at launch, matching ProData/Kubit/Bilanci)

`Employee`/`PayrollRun`/`PayslipLine`: a payroll run aggregates active employees' payslip lines
into one balanced `JournalEntry` (salary expense debit, PIT/pension payable credit, net pay
payable credit). `IPayrollCalculationService` is country-agnostic C# (annualize-then-divide-by-12
gross-to-net, Kosovo's progressive PIT brackets applied via `Pako.Localization.Xk`) — kudofatura's
own payroll code turned out to hold no gross-to-net algorithm to reuse (its `payroll_employees`
table stores manually-entered figures, only formatting them into ATK `.xlsx` exports), so this is
independent work, not a port. Full HR (contracts, leave, benefits) beyond payroll-to-GL stays out
of scope unless market demand justifies it.

## Frontend / mobile

`apps/web` (`@pako/web`, Vite+React+TS+Tailwind v4+shadcn/ui) and `apps/mobile` (`@pako/mobile`,
Expo Router+RN+TS) are both **wired end-to-end to the live `Pako.Api`** — Auth, Companies/Firms/
Members, Ledger, Invoicing, Bills, Reconciliation, Reports, and (web only; deliberately out of
mobile's scope) Payroll and Settings. No "Coming soon" placeholders remain on web; mobile's scope
is intentionally narrower (no standalone Payroll/Reconciliation screens — invoicing/bills' own
record-payment flow already covers reconciliation) and Settings is logout-only. `packages/shared`
(`@pako/shared`) holds a real NSwag-generated TS API client (`src/generated/api-client.ts`,
regenerated from `Pako.Api`'s live OpenAPI doc after backend contract changes) plus hand-maintained
enum-order maps for the handful of enums the backend's OpenAPI generator doesn't emit names for.
`apps/web` additionally has English/Albanian i18n infrastructure (`react-i18next`), with
translation content filled in incrementally per page. See root `CLAUDE.md`'s "Frontend <-> backend
wiring" / mobile sections for the full detail and non-obvious gotchas (an NSwag operation-name
collision across `post`/`post2`/`post3`/`post4`-style methods that reshuffles on regeneration is
the one worth knowing before touching either app) — not repeated here since those are
implementation details, not architecture.

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

### Migration rule (from `docs/V2_PARALLEL_TRACKS.md`'s Sprint 0, in force for the v2 release)

With three tracks branching in parallel off the same schema, EF migrations are the one artifact
that can't be reconciled by an ordinary merge conflict once two people have generated one against
a stale model. The rule:

- **One migration per day, announced** — say in the team channel before generating one, so nobody
  else is mid-generation against the same base.
- **Rebase on `main` before generating** — never generate a migration against a branch that's
  behind; `dotnet ef migrations add` bakes in whatever the model looked like at that moment,
  including anyone else's already-merged columns.
- **Never edit a migration that has already merged.** If it's wrong, write a new migration that
  corrects it — editing history that another branch may have already applied breaks that branch's
  `__EFMigrationsHistory` bookkeeping.
