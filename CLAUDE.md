# PAKO — Repo Overview (SCAFFOLD)

Erion's full accounting/finance platform for Kosovo SMEs and accounting/bookkeeping firms —
competing with ProData, Kubit, Bilanci under the live ATK SEF (Electronic Fiscal Software)
certification regime (AI MF 01/2026). Scaffold started 2026-08-26; the `Ledger`, `Tax`,
`Invoicing`, and `Bills` modules are real and tested, everything else is architecture + placeholder
— see `docs/ROADMAP.md` for build order (note: `Tax`/`Invoicing`/`Bills` were built ahead of that
doc's Phase 2/3 slots, at Erion's direction).

**Product name: PAKO** (final, confirmed by Erion 2026-08-26). Promoted from "Pako," the existing
name of kudofatura's mobile app (`kudofatura-mobile/app.json`) and its `pako-social/` asset
pipeline — this repo takes that brand for the whole platform, not just a mobile app. "Kudo Books"
was an earlier scaffold placeholder and should not appear anywhere further; if you find a
leftover reference, it's stale, fix it.

## Relationship to kudofatura

This is a **separate, new repo**. `/Users/erionavdiu/dev/kudofatura/` is untouched by this work
and keeps operating as-is (own git remotes, own Render deployment, own Supabase projects). PAKO
is not a fork of kudofatura and does not import its code automatically — see
`docs/ARCHITECTURE.md` for exactly what gets reused vs. rebuilt, and why.

## Directory layout

| Dir | What | Status |
|---|---|---|
| `backend/` | ASP.NET Core (.NET 10) API, `Pako.slnx` (not `Pako.sln` — the solution file is the newer XML `.slnx` format; `dotnet build`/`dotnet test Pako.slnx` work identically to a `.sln`) — see "Backend stack" below | Ledger module built for real, rest scaffolded |
| `backend/Pako.Domain/Ledger/` | Chart of accounts, journals, journal entries/lines — the GL core (Odoo `account.move` pattern) | built, real invariants + tests |
| `backend/Pako.Domain/Tax/` | Tax engine (VAT + withholding), data-driven | built: `TaxDefinition`/`TaxRepartitionLine`, `TaxComputationService`, seeded on company creation, `GET .../taxes` |
| `backend/Pako.Domain/Invoicing/` | AR — customer invoices, posts into ledger | built, real invariants + tests |
| `backend/Pako.Domain/Bills/` | AP — vendor bills, posts into ledger | built, real invariants + tests |
| `backend/Pako.Domain/Reconciliation/` | Payment <-> invoice/bill line matching | built: `Reconciliation`, twin-scope CHECK constraint, `ReconciliationsController`, outstanding-balance queries — see "Reconciliation and Payroll modules" below |
| `backend/Pako.Domain/Reporting/` | Balance sheet, P&L, VAT return — computed over ledger, no stored tables | built: `ReportsController` (see "Reports module" below), no `Pako.Domain/Reporting/` folder was needed — plain LINQ in the controller |
| `backend/Pako.Domain/Fiscal/` | Fiscal-bridge/SEF plug-in point | `IFiscalProvider` + `PefBridgeProvider` (real, talks to `fiscal-bridge/` over HTTP) built; `SefProvider` is a Phase 2 stub, see ARCHITECTURE.md |
| `backend/Pako.Domain/Companies/` | Multi-company/multi-tenant + accounting-firm-manages-many-clients model | built: `Company` (+ `Name`, `FirmId`), `Firm`, `Membership` (role-based, firm- or company-scoped) |
| `backend/Pako.Domain/Payroll/` | Payroll-to-GL posting | built: `Employee`/`PayrollRun`/`PayslipLine`, `IPayrollCalculationService`, `EmployeesController`/`PayrollRunsController` — see "Reconciliation and Payroll modules" below (built ahead of ROADMAP's Phase 4 slot, at Erion's direction, same as Tax/Invoicing/Bills earlier) |
| `backend/Pako.Localization.Xk/` | Kosovo chart-of-accounts template, tax rates, withholding rules — seed data records | built, see "Backend stack" below |
| `backend/Pako.Infrastructure/Migrations/` | EF Core migrations (`dotnet ef migrations add`), includes the balance-invariant Postgres trigger | `InitialCreate` migration present |
| `apps/web/` | Admin/dashboard web app (`@pako/web`) — React + Vite + TS + Tailwind v4 + shadcn/ui, matching kudofatura-panel's proven stack | Auth/Companies (incl. Firms/Members)/Ledger/Invoicing/Bills/Reconciliation/Payroll/Reports/Settings/Dashboard all wired to the real backend end-to-end, see "Frontend <-> backend wiring", "Invoicing/Bills/Reconciliation/Payroll/Reports frontend", and "Firm management UI, Settings page, and a real create-flow bug fix" below — no more "Coming soon" pages left |
| `packages/shared/` | Bridge package (`@pako/shared`) — NSwag-generated TS API client + Zod schemas | `src/generated/api-client.ts` is now the real generated client (regenerated against a live `Pako.Api`, not a stub) — see "Frontend <-> backend wiring" below |
| `apps/mobile/` | Mobile companion app (`@pako/mobile`) — Expo Router + React Native + TS, see "Mobile stack" below | Auth/Companies/Dashboard/Invoicing/Bills/Reports wired to the real backend end-to-end, see "Mobile app frontend" below; Payroll and standalone Reconciliation intentionally out of scope, Settings is logout-only |
| `fiscal-bridge/` | Local fiscal-printer bridge, ported essentially unchanged from `kudofatura-fiscal-bridge` | built (ported as-is), see ARCHITECTURE.md |
| `docs/ARCHITECTURE.md` | Full module architecture, ledger schema design, hash-chain reservation | written |
| `docs/ROADMAP.md` | Phased build plan | written |

## Backend stack (superseded the original Node/Express plan, 2026-08-26)

**`backend/` is ASP.NET Core (.NET 10) + EF Core + Npgsql, not Node/Express.** This
overrides the "Conventions" section below, which described the original Node plan before any
code existed. The pivot was made explicitly for this reason: C#'s native `decimal` type gives
compiler-enforced money-math safety for a general ledger (no silent `double`/float drift), which
Node/JS cannot offer without a bignum library disciplined into every code path. This is a real
architectural decision, not a drive-by choice — flag it to Erion if you're a human or agent
picking this repo up expecting the Node plan described elsewhere in this file or in
`docs/ARCHITECTURE.md`/`docs/ROADMAP.md` (those docs have NOT been updated to reflect the pivot).

- Solution: `backend/Pako.slnx`. Projects: `Pako.Api` (ASP.NET Core Web API, controllers,
  built-in `Microsoft.AspNetCore.OpenApi` — NOT Swashbuckle — serving OpenAPI 3.1 JSON at
  `/openapi/v1.json`, feeds an NSwag-generated TS client later), `Pako.Domain` (entities/business
  rules, zero EF Core dependency — the Ledger module is built for real, everything else is a
  folder + `README.md` placeholder per `docs/ROADMAP.md` phasing), `Pako.Infrastructure`
  (`PakoDbContext`, EF Core migrations, Npgsql), `Pako.Localization.Xk` (Kosovo tax/legal
  reference data as seed records, each tagged `SourceConfidence.PrimarySource` or
  `.NeedsLegalVerification` — kept out of `Pako.Domain` so core ledger logic stays
  country-agnostic, same pattern as Odoo's `l10n_xx` modules), `Pako.Tests` (xUnit).
- Ledger invariant (`SUM(debit) == SUM(credit)` before Draft -> Posted) is enforced twice:
  `JournalEntry.Post()` in `Pako.Domain` throws `UnbalancedJournalEntryException` synchronously
  (the non-negotiable app-level guard), AND a Postgres trigger
  (`enforce_journal_entry_balance()`, added via raw SQL in the `InitialCreate` migration) rejects
  it again at the DB layer as defense-in-depth — verified by applying the migration to a real
  disposable Postgres container and provoking both the pass and the rejection.
- Posted-entry immutability is enforced by overriding `SaveChanges`/`SaveChangesAsync` in
  `PakoDbContext` (`Pako.Infrastructure/PakoDbContext.cs`) — it compares `OriginalValues` for any
  tracked `JournalEntry`/`JournalEntryLine` in `Modified`/`Deleted` state against the DB-persisted
  `State`, and throws `PostedJournalEntryImmutableException` if it was `Posted`. This is C# code,
  not a DB trigger, so it's provider-agnostic (same guard applies whether the connection is
  Postgres in prod or `Microsoft.EntityFrameworkCore.InMemory` in `Pako.Tests`).
- No numbering-sequence generation, no hash-chain computation on `EntryHash`/`PrevHash`/
  `SecureSequenceNumber` (columns are reserved and inert, Phase 2+ per ROADMAP), no Company/Tax/
  Invoicing/etc. business logic — this pass is the Ledger schema + invariant + immutability only.
- `dotnet-ef` global tool is pinned at 9.0.8 while the packages are EF Core 10.0.11 — it still
  works (just prints a "tools version is older" warning on every `dotnet ef` command); update via
  `dotnet tool update --global dotnet-ef` if that becomes annoying.

## Auth, Companies/Firm/Membership, and authorization (2026-08-26)

**Fully self-hosted, not Supabase** — resolves the open question `docs/ARCHITECTURE.md`'s
"Database" section used to flag. Postgres is a plain `postgres:16-alpine` container
(`backend/docker-compose.yml`, service `postgres`, **host port 5433**, not 5432 — see gotcha
below), and auth is entirely inside `Pako.Api` via **ASP.NET Core Identity** (`AppUser :
IdentityUser<Guid>`, `Pako.Infrastructure/Identity/AppUser.cs`) issuing **JWT bearer tokens**
(HS256, `Microsoft.AspNetCore.Authentication.JwtBearer`) — no cookies, no Supabase SDK, no RLS.
`PakoDbContext` now extends `IdentityUserContext<AppUser, Guid>` (Users/Claims/Logins/Tokens
tables only — no `IdentityDbContext` role tables, since roles here are scoped to a Firm/Company
via `Membership`, not global ASP.NET Identity roles).

- `AuthController` (`Pako.Api/Controllers/AuthController.cs`): `POST /api/auth/register` and
  `POST /api/auth/login`, both return `{ token, userId, email }` — register logs the user in
  immediately (issues a token) rather than requiring a separate login call after signup, a
  deliberate simplification beyond what was asked. No email verification/password
  reset/2FA/lockout tuning — Identity's default password policy is untouched.
- **Company/Firm/Membership** (`Pako.Domain/Companies/`): `Company` gained `Name` (already
  present) and nullable `FirmId`; `Firm` is `{ Id, Name }`; `Membership` is `{ Id, UserId,
  FirmId?, CompanyId?, Role }` where `Role` is `FirmAdmin | FirmAccountant | ClientAdmin |
  ClientViewer`. Exactly one of `FirmId`/`CompanyId` is set, and `Role` must match that scope
  (Firm* roles need `FirmId`, Client* roles need `CompanyId`) — enforced twice, same
  defense-in-depth pattern as the Ledger balance invariant: `Membership.ForFirm`/`ForCompany`
  factory methods validate in C#, and a Postgres `CHECK` constraint (`ck_memberships_scope`,
  added via raw SQL in the `AddCompaniesFirmsMemberships` migration) re-checks at the DB layer —
  verified against a real container (valid row commits, a `Role`/scope mismatch is rejected).
  A firm-scoped `Membership` cascades access to every `Company` with that `FirmId`. **Update
  2026-08-26 (bug fix + Firm/member-management pass, see its own section below)**: `FirmsController`
  now exists and `POST /api/companies` accepts an optional `firmId` — a company created without one
  is still a direct SME company (`FirmId = null`) with the creating user auto-granted `ClientAdmin`
  on it, same as before.
- **Authorization**: `RequireCompanyAccessAttribute`/`CompanyAccessFilter`
  (`Pako.Api/Authorization/`) — an MVC action filter, not an `IAuthorizationHandler`/policy,
  because it needs the `{companyId}` route value and reading that from a resource-based
  `AuthorizationHandler` depends on framework internals that aren't guaranteed API surface;
  an action filter reads `ActionExecutingContext.RouteData` directly and is simple to reason
  about. It resolves the current user from the JWT's `ClaimTypes.NameIdentifier` claim, loads the
  target `Company`, and checks `Memberships` for either a direct `CompanyId` match or a firm-wide
  match via the company's `FirmId` — 404 if the company doesn't exist, 403 if no membership.
  `[RequireCompanyAccess(writeAccess: true)]` additionally requires the role to be one of
  `FirmAdmin/FirmAccountant/ClientAdmin` (excludes `ClientViewer`) — applied to every
  ledger-writing action (`POST` on journals/journal-entries, `POST .../post`); read-only actions
  (`GET` on accounts/journals/journal-entries, the trial-balance endpoint) only require
  membership, any role. This is the server-side enforcement kudofatura's frontend-only role
  checks never had — verified manually: an authenticated user with no membership on a company
  gets 403 on its `accounts`/`journal-entries` endpoints and it's absent from their
  `GET /api/companies` list; a `ClientViewer` gets 200 on `GET journals` but 403 on
  `POST journal-entries`.
- **API surface**: `CompaniesController` (`POST/GET /api/companies`, seeds the chart of accounts
  from `Pako.Localization.Xk.DefaultChartOfAccountsTemplate` and a default `GEN`/"General"
  journal on creation), `AccountsController` (`GET .../accounts`), `JournalsController`
  (`GET/POST .../journals`), `JournalEntriesController` (`GET/POST .../journal-entries`,
  `POST .../journal-entries/{id}/post` — catches `UnbalancedJournalEntryException`/
  `AccountingLockDateViolationException`/`TaxLockDateViolationException`/
  `InvalidOperationException` from `JournalEntry.Post()` and returns them as 400, not 500),
  `LedgerController` (`GET .../ledger/trial-balance` — sums posted `JournalEntryLine`s grouped by
  `AccountId`, plain LINQ query, not a formal `Reporting` module). Journal-entry creation
  cross-checks that the `JournalId` and every line's `AccountId` actually belong to the target
  company before saving — tenant-isolation defense-in-depth, same spirit as the authorization
  filter. No response-envelope wrapping (`{ statusCode, data, success, errors }`) — none of the
  new C# code uses it; plain typed DTOs/status codes are simpler and what NSwag-generated clients
  expect, and no existing controller in this repo used the envelope to match. Flag this to Erion
  if the frontend team specifically wants the kudofatura envelope shape.
- **Migrations**: `AddIdentity` (Identity tables only) then `AddCompaniesFirmsMemberships`
  (`Firm`, `Membership`, `Company.FirmId`, the CHECK constraint) — two separate migrations,
  generated by temporarily excluding the Companies/Firm/Membership model changes while
  `AddIdentity` was generated (EF otherwise bundles whatever's in the model at generation time
  into one migration, no way to scope a `migrations add` to a subset of pending changes).
- **Local Postgres gotcha, easy to lose an hour to**: **a native (non-Docker) Postgres on this
  Mac already listens on `127.0.0.1:5432`** (likely Postgres.app/homebrew, PID owned by
  `erionavdiu`, unrelated to any project here). Docker's port-publish proxy binds `*:5432`
  (wildcard), and both listeners can coexist — but the OS routes `localhost`/`127.0.0.1`
  connections to the **more specific** bind, i.e. the native Postgres, not the container. This
  silently happened during this work: `dotnet ef database update` against
  `Host=localhost;Port=5432` reported success and looked fine, but every table landed in the
  native Postgres's `pako_dev` database, not `backend/docker-compose.yml`'s container — caught
  only by manually diffing `docker exec ... psql` (empty) against `psql -h 127.0.0.1 -p 5432`
  (populated). Fix applied: `backend/docker-compose.yml` now publishes the container on **host
  port 5433**, and `Pako.Api/appsettings.Development.json`'s `ConnectionStrings:Default` points
  at `Port=5433` — always use 5433 for this project's local Postgres, never 5432, on this
  machine. (A stray `pako_dev` database was left behind in the native Postgres from this
  incident — harmless, but drop it manually with `psql -p 5432` if it's ever confusing.)
- JWT signing key/issuer/audience live under the `Jwt` config section, dev value in
  `appsettings.Development.json` (same pattern as `ConnectionStrings:Default` — real
  environments override via `Jwt__Key`/etc. env vars, never commit a real key).

## Tax module (`backend/Pako.Domain/Tax/`, 2026-08-26)

Built ahead of `docs/ROADMAP.md`'s Phase 2 slot, at Erion's direction — flatter than that doc's
"Tax engine" framing implies, deliberately: Kosovo VAT law only needs standard/reduced/exempt with
a single posting account per rate, so this does not build Odoo's general multi-box tax-repartition
engine.

- **Schema**: `TaxDefinition` (`Id`, `CompanyId`, `Name`, `Rate` decimal, `Type` enum
  `VatStandard|VatReduced|VatExempt|Withholding`, `Scope` enum `Sale|Purchase|Both`, `IsActive`) has
  many `TaxRepartitionLine` (`TaxDefinitionId`, `Percentage` decimal default 100, `AccountId`, `Tag`
  string?). `Percentage`/`Tag`/multi-line support exist for a future VAT-return-box mapping, not
  because anything seeded today uses more than one line per definition.
- **Why Standard/Reduced VAT seed as two `TaxDefinition`s each, not one `Scope.Both`**: a sale's tax
  posts to VAT Payable (liability) and a purchase's posts to VAT Receivable/Input (asset) — two
  different accounts — but `TaxRepartitionLine.AccountId` is a single target per definition, so one
  `Scope.Both` definition can't represent both. `DefaultTaxDefinitionsTemplate`
  (`Pako.Localization.Xk/DefaultTaxDefinitionsTemplate.cs`) seeds `"VAT 18% (Sales)"`/`"VAT 18%
  (Purchases)"` and the same pair for 8%, each with one repartition line at 100%, plus a single
  `"Exempt"` (`Scope.Both`, rate 0, no repartition lines — no tax amount is ever computed for it, so
  there's nothing to post). Rates come from `KosovoVatRates.Rates` by name (`RateFor("Standard")`
  etc.), not duplicated as literals, so the two stay in sync automatically.
- **New CoA account**: `DefaultChartOfAccountsTemplate` gained `"1300" "VAT Receivable"`
  (Asset/None) alongside the pre-existing `"2100" "VAT Payable"` (Liability/None) — Sales-scoped
  definitions' repartition line points at `2100`, Purchases-scoped at `1300`.
- **Seeding**: `CompaniesController.Create` builds a `Dictionary<string, Guid>` of the newly
  generated account IDs by code while creating the chart of accounts, then calls
  `DefaultTaxDefinitionsTemplate.CreateDefaultTaxDefinitions(company.Id, accountIdsByCode)` and adds
  the resulting `TaxDefinition`s (with their `RepartitionLines` already populated on the navigation
  property, same pattern as `JournalEntry.Lines` — EF tracks and inserts the whole graph off one
  `_db.TaxDefinitions.Add(...)` call, no need to `Add` the repartition lines separately). Verified
  end-to-end against the real Postgres container: creating a company seeds exactly 5
  `tax_definitions` with the expected rates/scopes and repartition lines resolving to the right
  account codes.
- **`TaxComputationService : ITaxComputationService`** — the contract other modules (Invoicing/Bills)
  call: `Compute(decimal netAmount, TaxDefinition taxDefinition) : TaxComputationResult` where
  `TaxComputationResult` is `{ NetAmount, TaxAmount, TotalAmount, IReadOnlyList<TaxPostingLine>
  PostingLines }` and `TaxPostingLine` is `{ AccountId, Amount, Tag }` — one posting line per
  `TaxRepartitionLine`, `TaxAmount` is the **sum of the posting lines' amounts** (not independently
  rounded from `NetAmount * Rate`), so a caller posting `PostingLines` into the ledger always finds
  them summing exactly to `TaxAmount` — matters for the debit=credit invariant. A `TaxDefinition`
  with no repartition lines (e.g. `Exempt`) returns `TaxAmount = 0` and an empty `PostingLines`,
  no exception.
- **Rounding assumption, unverified against Kosovo VAT-return guidance**: rounds each posting
  line's amount to 2 decimals with `MidpointRounding.AwayFromZero` (standard "round half up"
  commercial convention) rather than .NET's `Math.Round` default (banker's rounding / round-half-
  to-even), which would give a different result on an exact `.xx5` cent. Flag/replace if Kosovo ATK
  guidance turns up a different rule — the earlier tax-law research didn't pin this down.
- **API**: `TaxesController` (`GET /api/companies/{companyId}/taxes`) — same
  `[RequireCompanyAccess]` (read-only, any role) pattern as `AccountsController`/`JournalsController`,
  returns only `IsActive` definitions, for a tax-rate dropdown.
- **Migration**: `AddTax` (`tax_definitions`, `tax_repartition_lines`, cascade FK on
  `TaxDefinitionId`), applied and verified against the real Postgres container on port 5433.
- **Gotcha hit while verifying this**: a `Pako.Api` process from an earlier session was still
  running and listening on port 5248 in the background, serving the **old** binary (pre-`Tax`
  routes). A fresh `dotnet run` silently failed to bind (`Address already in use`) while `curl`
  against `localhost:5248` kept getting 200s from the stale process, making `GET .../taxes` 404 look
  like a routing bug for a while. Always check `lsof -nP -iTCP:5248 -sTCP:LISTEN` (or just `ps aux |
  grep Pako.Api`) and kill any stale process before trusting `dotnet run` output during manual
  verification in this repo.

## Invoicing (AR) and Bills (AP) modules (`backend/Pako.Domain/Invoicing/`, `backend/Pako.Domain/Bills/`, 2026-08-26)

Built together in one pass (they share the migration surface) — mirror images of each other with
the accounting direction flipped, both posting into the existing Ledger via `JournalEntry.Post()`
rather than duplicating its debit=credit invariant.

- **`Partner`** (`Pako.Domain/Companies/Partner.cs`, already existed) is the single customer/vendor
  entity for both modules — `IsCustomer`/`IsVendor` flags, no separate partner-like type per
  module. `PartnersController` (`POST/GET /api/companies/{companyId}/partners`) is new — nothing
  exposed `Partner` via the API before this pass.
- **`Invoice`**/`InvoiceLine` (AR): `InvoiceNumber` is a **separate legal numbering series** from
  `JournalEntry.SequenceNumber` — Kosovo VAT Law Article 45/56 requires invoice numbers gapless and
  strictly monotonic per company. Implemented as `Company.NextInvoiceNumber` (int) +
  `Company.ReserveNextInvoiceNumber()` (formats `"INV-{n:D4}"` and increments in one call) — minted
  only *after* `JournalEntry.Post(company)` succeeds inside `Invoice.Post(...)`, so a failed post
  (bad tax definition, lock-date violation) never burns a number. **Known gap**: no DB-level
  locking/serializable transaction around the counter read-increment-write — fine for this repo's
  current maturity (same as `Journal.SequenceNextNumber`, itself "not enforced yet, Phase 2" per
  its own doc comment) but not safe under concurrent posts to the same company; revisit with a
  `SELECT ... FOR UPDATE` or a Postgres sequence before this goes to real multi-user usage.
- **`Bill`**/`BillLine` (AP): `VendorReference` is free text (the vendor's own invoice number, not
  ours to sequence), no numbering logic needed.
- **Posting design**: `Invoice.Post(company, journalId, receivableAccountId, taxComputationService,
  taxDefinitionsById)` and the mirror `Bill.Post(...)` are pure domain methods (zero EF dependency,
  fully unit-testable without a DB) — they build a `JournalEntry` in memory (debit AR / credit AP
  as one line with `PartnerId` set, one line per invoice/bill line's net amount, one line per
  `ITaxComputationService.Compute(...)` posting line) and hand it to `JournalEntry.Post(company)`
  for the actual balance/lock-date invariant check — **no second balance check is hand-rolled**.
  Callers (`InvoicesController`/`BillsController`) do all the DB lookups (partner validation,
  account resolution by code, loading active tax definitions into a dictionary) before calling
  `Post(...)`, same division of labor `JournalEntriesController.Post` already used for plain
  journal entries.
- **Account resolution**: `1200 Accounts Receivable` and `2000 Accounts Payable` already existed in
  `DefaultChartOfAccountsTemplate` before this pass (added incidentally by an earlier pass, not
  this one) — no chart-of-accounts migration was needed, only named code constants
  (`AccountsReceivableCode`/`AccountsPayableCode`/`DefaultRevenueAccountCode` `"4000"`/
  `DefaultExpenseAccountCode` `"6000"`) added to `DefaultChartOfAccountsTemplate` so controllers
  don't hardcode magic strings. A line's `RevenueAccountId`/`ExpenseAccountId` is resolved at
  **create time** (Draft), defaulting to `4000`/`6000` if the request omits it, and validated
  against the company's own accounts — not deferred to post time.
- **Tax validation is deferred to post time, not create time** — mirrors how Draft `JournalEntry`s
  can already be saved unbalanced and only get checked on `POST .../post`. A Draft invoice/bill can
  reference any `TaxDefinitionId`; `Post(...)` looks it up in a dict keyed by
  `TaxDefinitionId` (built from the company's tax definitions) and throws a plain
  `InvalidOperationException` ("references unknown or inactive tax definition ...") if it's missing
  or `IsActive == false` — verified against the real API (create succeeds with a
  `00000000-0000-0000-0000-000000000000` tax id, post 400s with that exact message, and a
  subsequent valid invoice still gets `INV-0002`, confirming the failed post didn't burn a number).
- **Immutability**: `PakoDbContext.ValidateImmutability`/`ValidateImmutabilityAsync` (the same
  methods that already guarded `JournalEntry`/`JournalEntryLine`) gained four more loops for
  `Invoice`/`InvoiceLine`/`Bill`/`BillLine`, throwing the new `PostedInvoiceImmutableException`/
  `PostedBillImmutableException` — no parallel mechanism invented.
- **Fiscal extension point, deliberately not wired**: no live fiscal hardware or SEF credentials
  exist in this environment (see `Fiscal` module notes below), so `Invoice.Post(...)` does not call
  `IFiscalProvider` — there's a one-line `TODO(fiscal)` comment at the end of `Invoice.Post(...)`
  marking where a future pass should call `IssueReceiptAsync` after a successful post, without
  restructuring the posting flow.
- **API**: `InvoicesController`/`BillsController`, same `[RequireCompanyAccess]` pattern as every
  other controller (`GET` list/detail = any role, `POST`/`POST .../post` = `writeAccess: true`).
  Both post into the company's single seeded `"GEN"` journal (`Journal.Type == General`) — no
  dedicated Sale/Purchase journal exists yet, only one journal is seeded per company today.
- **Migration**: `AddInvoicingAndBills` (`invoices`, `invoice_lines`, `bills`, `bill_lines`,
  `companies.NextInvoiceNumber`) — applied and verified against the real Postgres container on
  port 5433. `ITaxComputationService` also got registered in DI
  (`ServiceCollectionExtensions.AddPakoInfrastructure`) in this pass — it existed since the Tax
  module but nothing had wired it into the container before Invoicing/Bills needed to inject it.
- **Verified end-to-end** against the real running API (not just unit tests): register → create
  company → create customer + vendor partners → create+post a taxed invoice (AR 118 / Revenue 100 /
  VAT Payable 18) → create+post a taxed bill (AP 236 / Operating Expenses 200 / VAT Receivable 36)
  → trial balance reflects both correctly and stays balanced → posting with an unknown tax
  definition 400s with a clear message and doesn't advance invoice numbering → double-posting an
  already-posted invoice 400s → invoicing a vendor-only partner (or billing a customer-only one)
  400s with "Invalid customer/vendor partner for this company."

## Reports module (`backend/Pako.Api/Controllers/ReportsController.cs`, 2026-08-26)

Built directly as `Pako.Api` controller code, no `Pako.Domain/Reporting/` folder — per
`docs/ARCHITECTURE.md`'s Reporting section, everything here is computed LINQ over
`JournalEntryLine`/`Account`/`TaxDefinition`, no new tables/migrations. Read-only,
`[RequireCompanyAccess]` (any role), scoped `/api/companies/{companyId}/reports/...`.

- **`GET .../reports/profit-and-loss?from=&to=`**: sums Posted `JournalEntryLine`s with
  `JournalEntry.Date` in `[from, to]`, grouped by account, split into `Income`/`Expenses` lists
  (`ReportLine[]`) by `Account.AccountType`. Income lines use `Credit - Debit`, Expense lines use
  `Debit - Credit` (their respective normal balances). Response also carries `TotalIncome`/
  `TotalExpenses`/`NetIncome`.
- **`GET .../reports/balance-sheet?asOf=`**: same grouping restricted to Asset/Liability/Equity
  accounts, Posted entries with `Date <= asOf`. Since there's no ledger account for
  period/retained earnings yet, the endpoint computes the same Income-minus-Expense figure as the
  P&L report (all Posted entries up to `asOf`, unbounded start date) and appends it to the
  `Equity` array as a **synthetic** `ReportLine` (`AccountId = Guid.Empty`, `AccountCode = "3999"`,
  `AccountName = "Current Earnings"`) so `TotalAssets == TotalLiabilities + TotalEquity` always
  holds — this isn't a coincidence of the test data, it's the fundamental accounting identity
  (every `JournalEntry` balances individually by `JournalEntry.Post()`'s invariant, so summing all
  lines by normal-balance sign always yields `Assets - Liabilities - Equity == Income - Expenses`);
  proven with a real mixed scenario (manual capital entry + a taxed invoice + a taxed bill) in
  `ReportsControllerTests.BalanceSheet_AssetsEqualLiabilitiesPlusEquity_ForMixedScenario`, not just
  asserted from the formula.
- **`GET .../reports/vat-return?from=&to=`**: separates Output VAT (`TaxDefinition.Scope.Sale`)
  from Input VAT (`Scope.Purchase`), grouped by tax definition, plus `NetVatDue = OutputVat -
  InputVat` (what's owed on Kosovo's monthly VAT return). **Non-obvious gotcha this endpoint had
  to work around**: `Invoice.Post`/`Bill.Post` set `JournalEntryLine.TaxId` on **two** lines per
  taxed invoice/bill line, not one — the net revenue/expense line itself (e.g. `Credit = 100` on
  the Sales Revenue account) *and* the actual tax-posting line (e.g. `Credit = 18` on VAT
  Payable), both carrying the same `TaxId`. Naively grouping `JournalEntryLine`s by `TaxId` and
  summing `Debit`/`Credit` therefore double-counts — it would report 118 as the tax amount instead
  of 18. The fix: filter to only the lines whose `(TaxId, AccountId)` pair matches one of that
  `TaxDefinition`'s `TaxRepartitionLine`s (`TaxRepartitionLine.AccountId` is the actual tax-posting
  target, distinct from the revenue/expense account), *then* group and sum. Verified end-to-end
  against the real API: a 1000 net / 180 VAT invoice and a 400 net / 72 VAT bill correctly report
  `OutputVat = 180` (not 1180) and `InputVat = 72` (not 472).
- **Testing pattern, new for this repo**: `Pako.Tests.csproj` gained a `ProjectReference` to
  `Pako.Api` (previously only Domain/Infrastructure/Localization.Xk) so
  `Pako.Tests/ReportsControllerTests.cs` can instantiate `ReportsController` directly against an
  `InMemory` `PakoDbContext` and call its action methods without an HTTP layer — same spirit as
  the existing domain-level tests (seed via real `Invoice.Post`/`Bill.Post`/`JournalEntry.Post`,
  not hand-inserted rows) but the first test in this repo to exercise a controller class itself.
  Reuse this pattern for future report/query endpoints rather than only testing at the domain
  layer or spinning up a full `WebApplicationFactory`.
- **Verified end-to-end** against the real running API (not just unit tests): register -> create
  company -> create customer + vendor partners -> post a manual capital journal entry (Cash 1000 /
  Share Capital 1000) -> post a taxed invoice (AR 1180 / Revenue 1000 / VAT Payable 180) -> post a
  taxed bill (Expense 400 / VAT Receivable 72 / AP 472) -> all three report endpoints return
  exactly the hand-computed numbers (P&L net income 600, balance sheet assets 2252 = liabilities
  652 + equity 1600, VAT net due 108).

## Reconciliation and Payroll modules (`backend/Pako.Domain/Reconciliation/`, `backend/Pako.Domain/Payroll/`, 2026-08-26)

Built together in one pass (shared migration surface), both ahead of `docs/ROADMAP.md`'s Phase
3/4 slots, at Erion's direction — same pattern as Tax/Invoicing/Bills earlier.

- **`Reconciliation`**: `{ Id, CompanyId, InvoiceId?, BillId?, JournalEntryLineId, Amount,
  ReconciledAt }`. Twin-scope discipline mirrors `Membership.ForFirm`/`ForCompany`: `Reconciliation.
  ForInvoice`/`.ForBill` factory methods plus a Postgres `ck_reconciliations_scope` CHECK constraint
  (`AddReconciliationAndPayroll` migration) — verified against the real container (both-null and
  both-set rows rejected, a single-scope row commits), same verification style as
  `ck_memberships_scope`.
- **Validation** (`Pako.Domain/Reconciliation/ReconciliationValidator.cs`) is a pure static method
  taking already-loaded primitives (no EF dependency, fully unit-testable) — checks, in order: the
  target invoice/bill is `Posted` (not Draft), the settlement `JournalEntryLine`'s parent
  `JournalEntry` is `Posted`, the line's `AccountId` matches the document's AR/AP control account,
  the line's `PartnerId` matches the document's partner, and the running total (existing
  reconciliations + this amount) never exceeds the document's total. `ReconciliationsController`
  does all the DB lookups (settlement line + its `JournalEntry`, invoice-or-bill, control account by
  code, already-reconciled sum) and calls the validator, same division of labor `Invoice.Post`/
  `Bill.Post` established.
- **Document total, not recomputed from lines/tax**: rather than re-deriving an invoice/bill's total
  independently (duplicating `Invoice.Post`/`Bill.Post`'s tax-computation logic), the total is read
  straight off the already-posted AR/AP control line on that document's own `JournalEntryId` (sum of
  `Debit` for an invoice's AR line, `Credit` for a bill's AP line) — the ledger is the single source
  of truth per `docs/ARCHITECTURE.md`, and this line's amount is exactly what `Post(...)` computed
  and balanced.
- **Outstanding balance**: `GET .../invoices/{id}/balance` and `GET .../bills/{id}/balance` (added to
  `InvoicesController`/`BillsController`, not a new controller — it's a property of that resource)
  return `{ Total, Reconciled, Outstanding }`, computed live, not stored. "Paid" stays derived
  (`Outstanding == 0`); no new state was added to `Invoice`/`Bill`.
- **API**: `ReconciliationsController` — `POST /api/companies/{companyId}/reconciliations` (create),
  plus `GET /api/companies/{companyId}/invoices/{id}/reconciliations` and the bill equivalent using
  `[Route("~/api/companies/{companyId:guid}/invoices/{invoiceId:guid}/reconciliations")]`
  (absolute-route override) so both list endpoints live on `ReconciliationsController` while still
  matching the invoice/bill-nested URL shape asked for.
- **Pre-existing gap this surfaced and fixed**: `JournalEntriesController`'s generic
  `POST .../journal-entries` never accepted or returned `PartnerId` on lines, even though
  `JournalEntryLine.PartnerId` already existed in the schema (used internally by `Invoice.Post`/
  `Bill.Post`). Without it, there was no way to create a settlement journal entry (e.g. a cash
  receipt) with a partner via the public API, which made Reconciliation's partner-match check
  unusable end-to-end. Fixed by adding `PartnerId` to `CreateJournalEntryLineRequest`/
  `JournalEntryLineResponse` and wiring it through `JournalEntriesController.Create`/`ToResponse` —
  a small necessary fix, not scope creep for this pass.
- **`Employee`**: `{ Id, CompanyId, Name, MonthlyGrossSalary, IsActive }` — deliberately separate
  from `Partner` (employees aren't customers/vendors). `IsActive` isn't in the original spec's field
  list but is required to satisfy "auto-generate payslip lines for all active employees."
- **`PayrollRun`**/`PayslipLine`: `PayrollRun.Post(...)` aggregates all its lines into one balanced
  `JournalEntry` (debit Salary Expense for `sum(gross) + sum(employerPension)`, credit PIT Payable
  for `sum(pit)`, credit Pension Payable for `sum(employeePension) + sum(employerPension)`, credit
  Net Pay Payable for `sum(netPay)`) via `JournalEntry.Post(company)` — no second balance check
  hand-rolled, same discipline as `Invoice.Post`/`Bill.Post`. New CoA accounts: `6100 Salary Expense`
  (Expense), `2200 PIT Payable`/`2300 Pension Payable`/`2400 Net Pay Payable` (Liability), added to
  `DefaultChartOfAccountsTemplate`. Immutability guarded the same way as `Invoice`/`Bill`
  (`PostedPayrollRunImmutableException` via `PakoDbContext.ValidateImmutability`).
- **`IPayrollCalculationService`/`PayrollCalculationService`** (`Pako.Domain/Payroll/`) is
  deliberately country-agnostic — same reason `ITaxComputationService`/`TaxComputationService` don't
  reference `Pako.Localization.Xk` directly (`Pako.Infrastructure`, which does the DI registration,
  has no project reference to `Pako.Localization.Xk`; only `Pako.Api` does). It takes
  `IReadOnlyList<PitBracket> annualPitBrackets` + employee/employer pension rates as plain
  parameters; `PayrollRunsController` (in `Pako.Api`, which already references Xk) converts
  `KosovoPersonalIncomeTaxBrackets.Brackets`/`KosovoPensionContribution` into those parameters per
  call — the same "Xk feeds concrete numbers into generic Domain logic" shape
  `DefaultTaxDefinitionsTemplate` already established for `TaxDefinition` rows.
- **Gross-to-net calculation approach**: `KosovoPersonalIncomeTaxBrackets` is denominated
  `EurPerYear` (per its own field names), so this annualizes the monthly taxable salary (×12),
  applies the brackets progressively, then divides the resulting annual PIT by 12 for the month's
  withholding — mathematically identical to scaling the bracket bounds to monthly and applying them
  directly, for a salary constant across the year (which `Employee.MonthlyGrossSalary` already
  assumes: one fixed monthly figure, not a per-run amount). The employee's 5% pension contribution
  is treated as deductible **before** PIT is computed (taxable base = gross − employee pension),
  matching common practice for mandatory pension contributions but **not verified** against ATK's
  primary wage-withholding guidance — same `NeedsLegalVerification` caveat
  `KosovoPensionContribution` already carries; flag/replace if ATK guidance turns up a different
  order. Rounding: 2dp `MidpointRounding.AwayFromZero` at both the pension and PIT steps, matching
  the Tax module's established convention.
- **kudofatura's payroll logic reveals less than expected — a material finding, not silently
  assumed**: `docs/ARCHITECTURE.md` and this file both said to reuse kudofatura's "existing
  payroll/tatimi-në-burim logic." Reading `kudofatura-be/services/payroll-export-service.js`,
  `controllers/payroll-employees-controller.js`, `models/payroll-employees.js`, and
  `database/history/add_payroll_employees_table.sql` shows kudofatura's `payroll_employees` table
  stores `gross_salary`/`employee_contribution`/`employer_contribution`/`tax` as **plain manually-
  entered `DECIMAL` columns** (`DEFAULT 0`, no computed default, no trigger) — there is **no
  gross-to-net bracket calculation anywhere in kudofatura's codebase**. The accountant using
  kudofatura's panel enters the tax/contribution figures by hand (presumably computed externally);
  `payroll-export-service.js` only formats already-entered numbers into the ATK-format `.xlsx`
  exports ("Lista e Punëtorëve"/"Lista e Pagave"). So there was no JS gross-to-net algorithm to
  reimplement, and no code-level confirmation either way on monthly-vs-annualized brackets — the
  annualize-then-divide-by-12 approach above and the pre-tax-pension-deduction order are this pass's
  own defensible choices, not something read off kudofatura, and should be verified against ATK
  guidance before this goes to real payroll use.
- **Migration**: `AddReconciliationAndPayroll` (`reconciliations` + CHECK constraint, `employees`,
  `payroll_runs`, `payslip_lines`), applied and verified against the real Postgres container on port
  5433.
- **Verified end-to-end** against the real running API: post an invoice (AR 100) -> post a matching
  cash-receipt journal entry (Debit Cash 100 / Credit AR 100, `PartnerId` set on the AR line) ->
  reconciling 150 against it 400s ("exceeds the outstanding balance") -> reconciling 60 succeeds,
  balance reports `{100, 60, 40}` -> reconciling another 50 400s -> reconciling the exact 40
  remainder succeeds, balance reports `{100, 100, 0}` -> reconciling a Draft invoice 400s
  ("is not Posted") -> two employees (500 and 200 monthly gross) -> creating a payroll run with zero
  employees 400s -> creating one with both employees produces payslips matching hand-computed
  figures exactly (500 gross: 18.50 PIT crossing both non-zero brackets, 25/25 pension, 456.50 net;
  200 gross: 0 PIT fully inside the zero-rate bracket, 10/10 pension, 190 net) -> posting produces a
  balanced `JournalEntry` (735 debit Salary Expense = 70 Pension + 646.50 Net Pay + 18.50 PIT credit)
  -> trial balance reflects it correctly.

## Frontend stack (`apps/web`, `packages/shared`, 2026-08-26)

- `apps/web` (`@pako/web`): Vite + React 19 + TS ~5.9 + Tailwind v4 (`@tailwindcss/vite`, CSS-first
  `@theme`/`@custom-variant` config, no `tailwind.config.js`) + shadcn/ui (`components.json`,
  `new-york` style, `src/components/ui/`). Routing via `react-router-dom` v7. Sidebar nav + routes
  are both generated from one source of truth, `src/config/nav.ts` — add a module there, not by
  hand-editing `AppLayout.tsx` and `App.tsx` separately. Every module page currently renders the
  shared `ComingSoon` placeholder; no real API calls yet (`src/api/client.ts` is a documented stub
  pointing at `@pako/shared`, wire it up once `Pako.Api` is callable).
- `packages/shared` (`@pako/shared`): no build step — `main`/`exports` point straight at
  `src/index.ts`, consumed as raw TS by Vite (fine for internal-only workspace packages, revisit
  if this ever needs to ship outside the monorepo). `src/generated/api-client.ts` is a stub;
  regenerate via `pnpm generate:api-client` in that package once `Pako.Api`'s OpenAPI endpoint
  (`/openapi/v1.json`, see "Backend stack" above) is reachable — exact NSwag command and flags are
  documented in `packages/shared/README.md`.
- **pnpm build-script approval is required or the build fails with a misleading error.** Root
  `package.json` has `pnpm.onlyBuiltDependencies: ["esbuild", "unrs-resolver"]` — without it,
  `pnpm install` silently skips their postinstall scripts and `vite build`/`vitest` fail with
  native-binding errors that look unrelated (e.g. "Cannot find native binding" from a completely
  different package). If a future dependency needs a postinstall script, add it to that list
  rather than running interactive `pnpm approve-builds` (no TTY in agent sessions).
- **Pin `vite` to `^7`, not `^8`.** Vite 8's default bundler (Rolldown) has no working
  darwin-arm64 native binding in this environment even after build-script approval — `vite build`
  crashes with `Cannot find module '@rolldown/binding-darwin-arm64'`. `^7.1.7` (matching
  kudofatura-panel) works cleanly with `@vitejs/plugin-react ^5`.
- **Pin `jsdom` to `^26`, not `^30`.** `jsdom@30` pulls `html-encoding-sniffer@6` ->
  `@exodus/bytes`, which is ESM-only and breaks under Vitest's CJS `require()` worker startup
  (`ERR_REQUIRE_ESM`), making every test file report "no tests" with an unhandled error instead of
  a clear failure. `jsdom@26` still uses `html-encoding-sniffer@4` and works.
- No `turbo.json` exists yet at the repo root, so root-level `pnpm run build`/`test`/etc. (which
  shell out to `turbo run ...`) won't do anything until one is added. Until then, run each
  package's scripts directly: `pnpm --filter @pako/web <script>` / `pnpm --filter @pako/shared
  <script>`.

## Frontend <-> backend wiring (`apps/web`, `packages/shared`, 2026-08-26)

First real end-to-end vertical slice: `apps/web` now calls the live `Pako.Api` for auth,
companies, and the ledger. Verified by running `Pako.Api` + Postgres for real and driving the
actual flow via curl against the exact endpoints/payloads the generated client sends (register ->
login -> create company -> seeded accounts/journal appear -> create a balanced draft entry -> post
it -> trial balance reflects it -> create an unbalanced draft -> posting it 400s with the
balance-invariant message) — no browser-automation tool was available in this environment, so this
replaced a literal click-through; `pnpm typecheck`/`lint`/`test`/`build` all pass in both
`apps/web` and `packages/shared` on top of it.

- **NSwag regeneration**: the documented command in `packages/shared/README.md` needed one fix,
  not a rewrite — it guessed port `5001`/`https` (from a template, before `Pako.Api` had ever been
  run); the real `http` launch profile in `Pako.Api/Properties/launchSettings.json` binds
  `http://localhost:5248`, and plain `http` avoids the dev HTTPS-cert trust prompt. With that
  fixed, `pnpm generate:api-client` (using the local `nswag` npm devDependency, which bundles its
  own .NET runtime — no `dotnet tool install --global NSwag.ConsoleCore` actually required, though
  that also works identically if present) produces a real `PakoApiClient` in
  `src/generated/api-client.ts` from `Pako.Api`'s live `/openapi/v1.json`. Re-run it after any
  backend contract change.
- **Enum gotcha**: `Pako.Api`'s built-in `Microsoft.AspNetCore.OpenApi` doesn't emit enum member
  names (no Swashbuckle-style `x-enumNames`), so `AccountType`/`AccountSubType`/`JournalType` come
  through the generated client as plain `number`, not string unions. `apps/web/src/lib/ledger-enums.ts`
  hand-maintains the `number -> label` arrays in the same order as the C# enums in
  `Pako.Domain/Ledger/{Account,Journal}.cs` — verified against real seeded data (Cash =
  `accountType:0,accountSubType:4`, Accounts Payable = `accountType:1,accountSubType:2`, etc.).
  Regenerating the client won't catch a backend enum reordering; keep the two in sync by hand, or
  switch the backend to `JsonStringEnumConverter` if this becomes a recurring source of bugs.
  `JournalEntryState` is not affected — the API serializes it via `.ToString()` into a plain
  string (`"Draft"`/`"Posted"`/`"Cancelled"`) already.
- **`packages/shared/tsconfig.json` needed `"DOM"` added to `lib`**: it was `["ES2022"]` only
  (written for the empty `export {}` stub, meant to stay isomorphic). The real NSwag `Fetch`
  template client uses `fetch`/`Response`/`RequestInit`/`window`, so `pnpm --filter @pako/shared
  typecheck` failed with `Cannot find name 'Response'` etc. until DOM lib was added. This package
  is now, in practice, browser-fetch-shaped — `apps/mobile` will need to pass its own
  `http: { fetch }` override (React Native doesn't have `window`) rather than rely on the client's
  `window` fallback, same as `apps/web` already does.
- **Backend had no CORS middleware at all** — a real gap only a browser enforces (curl/server-side
  calls never hit it, which is why it wasn't caught by any prior backend-only testing). Added a
  dev-only allowlist policy in `Pako.Api/Program.cs` (`WebDevCorsPolicy`, origins
  `http://localhost:5173` and `http://127.0.0.1:5173`, `AllowAnyHeader`/`AllowAnyMethod` — not
  `AllowAnyOrigin`, since the API takes a Bearer token and an open CORS policy would let any page
  attempt authenticated calls) — verified via a real preflight `OPTIONS` request returning
  `Access-Control-Allow-Origin`/`-Headers`/`-Methods`. Extend the origins list before any real
  deployed frontend origin exists; this only covers the Vite dev server.
- **Auth**: `apps/web/src/context/AuthContext.tsx` + `src/lib/auth-storage.ts` — JWT + userId +
  email persisted to `sessionStorage` (key `pako.auth`), attached as `Bearer` on every API call via
  a custom `fetch` wrapper in `src/api/client.ts` (`apiClient`, a module-level `PakoApiClient`
  singleton). A `401` response dispatches a `pako:auth-expired` `window` event that `AuthContext`
  listens for and clears session on, rather than coupling `api/client.ts` back to React state
  directly. `src/components/RequireAuth.tsx` gates every route except `/login`/`/register`.
- **Companies**: `src/context/CompanyContext.tsx` holds the company list + `activeCompanyId`
  (persisted to `sessionStorage` under `pako.activeCompanyId`, separate from auth so it survives
  independently). `src/pages/Companies.tsx` lists/creates/switches; `AppLayout`'s header also
  carries a compact company switcher so the active company is visible/changeable from every page,
  not just the Companies page.
- **Ledger**: `src/pages/ledger/Ledger.tsx` (+ `JournalEntryForm.tsx`, `JournalEntriesTable.tsx`)
  — chart of accounts, a dynamic-lines journal-entry-creation form (defaults to the seeded "GEN"
  journal), a Draft/Posted entries table with a per-row Post action, and the trial balance.
  Confirmed against the real `JournalEntry.Post()` invariant: `POST .../journal-entries` (create)
  never checks balance — Draft entries can be saved unbalanced — the check only happens on
  `POST .../post`, which 400s with a plain-text (not JSON) body like `"Journal entry {id} is
  unbalanced: debit 50,00 != credit 30,00."` (note the comma decimal separator — server locale
  formatting, not a frontend bug). `getApiErrorMessage()` in `src/api/client.ts` handles both JSON
  and plain-text `ApiException.response` bodies and surfaces this exact message inline next to the
  row's Post button, not a generic error.
- **`apps/web/src/components/ui/select.tsx`**: a plain native `<select>`, not shadcn's
  Radix-based `Select` (`@radix-ui/react-select` isn't a dependency and wasn't added, to avoid
  introducing a new primitive without asking) — styled to match the existing `input`/`button`
  new-york look. `table.tsx`/`alert.tsx`/`badge.tsx`/`input.tsx`/`label.tsx` are the real shadcn
  source for those components (none need Radix beyond the already-present `react-slot`). Swap
  `select.tsx` for the real Radix-based one if/when that dependency is deliberately added.
- Local dev loop, in order: `docker compose up -d` in `backend/` (Postgres on 5433) ->
  `dotnet run --launch-profile http` in `backend/Pako.Api/` (binds `http://localhost:5248`, migrations
  already applied via `dotnet ef database update` if not already current) -> `pnpm --filter
  @pako/web dev` in the repo root (Vite on `:5173`, binds IPv6 `[::1]` — use `http://localhost:5173`
  in a browser, not `127.0.0.1`, if scripting against it).

## Invoicing/Bills/Reconciliation/Payroll/Reports frontend (`apps/web`, `packages/shared`, 2026-08-26)

Regenerated `packages/shared/src/generated/api-client.ts` (`pnpm generate:api-client`, command
unchanged from "Frontend <-> backend wiring" above — still correct) once Tax/Invoicing/Bills/
Reconciliation/Payroll/Reports existed on the backend, then wired every remaining placeholder page
except Settings.

- **NSwag operation-name collision, a real regression this pass had to fix**: when multiple
  controllers each have a `Post` action, NSwag de-dupes the generated client method names by
  suffixing `2`/`3`/`4` in the order controllers appear in the OpenAPI doc (alphabetical by
  controller name) — it does **not** keep the name stable per controller across regenerations.
  Before this pass only `JournalEntriesController.Post` existed, so `apiClient.post(...)` meant
  "post a journal entry" and `apps/web/src/pages/ledger/JournalEntriesTable.tsx` called it that
  way. After regeneration, `BillsController.Post` (alphabetically first) claimed the bare `post`
  name, bumping journal-entries' post to `post3` (`post` = Bills, `post2` = Invoices, `post3` =
  JournalEntries, `post4` = PayrollRuns) — the Ledger page's existing "Post" button silently
  started hitting `POST .../bills/{id}/post` instead, a 404-by-accident on any real journal entry
  id. Fixed by updating `JournalEntriesTable.tsx` to call `apiClient.post3(...)`. **Re-check every
  `apiClient.postN(...)`/`balanceN(...)`/`reconciliationsAllN(...)` call site after any future
  regeneration** — grep the diff of `api-client.ts` for method signatures that moved, don't assume
  a name still means what it meant before. Same numbering pattern hit `balance`
  (Bills)/`balance2` (Invoices) and `reconciliationsAll` (invoice-scoped list)/`reconciliationsAll2`
  (bill-scoped list) — verified each by reading the generated method's `url_` literal, not by
  guessing from the suffix.
- **`src/lib/tax-enums.ts`**: same hand-maintained-enum-order problem as `ledger-enums.ts`
  (`Pako.Api`'s OpenAPI doesn't emit enum names) — `TaxScope` came through as `0=Sale, 1=Purchase,
  2=Both` and `TaxType` as `0=VatStandard,1=VatReduced,2=VatExempt,3=Withholding`, matching
  `backend/Pako.Domain/Tax/TaxDefinition.cs` enum declaration order; verified against real seeded
  tax rows (`"VAT 18% (Sales)"` came back `scope:0`, `"VAT 18% (Purchases)"` `scope:1`, `"Exempt"`
  `scope:2`). `taxesForSale`/`taxesForPurchase` filter a tax list to `Sale`|`Both` /
  `Purchase`|`Both` for the Invoicing/Bills line-item tax dropdowns. `estimatedTaxAmount` mirrors
  `TaxComputationService.Compute`'s formula (`netAmount * taxDefinition.rate`, rounded to 2dp) so
  the invoice/bill detail page can show a client-side "estimated total" before the server computes
  the authoritative one at post time — `TaxDefinitionResponse.rate` is a fraction (`0.18`, not
  `18`), not a percentage.
- **`src/lib/ledger-enums.ts` gained `isCashOrBankAccountSubType`**: `AccountSubType` order is
  `[None, Receivable, Payable, Bank, Cash]` (already documented), so Bank=3/Cash=4 — used to filter
  the chart of accounts down to payable-from accounts in the Record Payment form.
- **Invoicing (`src/pages/invoicing/`)/Bills (`src/pages/bills/`)**: near-mirror image pages
  (`Invoicing.tsx`/`Bills.tsx` list pages, `InvoiceForm.tsx`/`BillForm.tsx` dynamic-line create
  forms, `InvoiceDetail.tsx`/`BillDetail.tsx` detail pages at new routes `/invoicing/:id` and
  `/bills/:id` added directly in `App.tsx` alongside the `navItems`-driven routes, since detail
  pages aren't nav items). Both list pages create partners inline via the shared
  `src/pages/shared/PartnerForm.tsx` (parameterized `role: "customer" | "vendor"`, sets
  `isCustomer`/`isVendor` accordingly) and filter the company's tax definitions with
  `taxesForSale`/`taxesForPurchase`. List pages fetch every invoice/bill's `.../balance` via
  `Promise.all` (N+1, acceptable at this scale, no aggregate endpoint exists) to show outstanding
  balance per row — Draft documents show `-` rather than `0.00` since balance is only meaningful
  once posted (a Draft's `balance` endpoint legitimately returns `{0,0,0}` since it has no
  `journalEntryId` yet, confirmed by reading `InvoicesController.Balance`/`BillsController.Balance`).
- **Reconciliation UX (`src/pages/shared/RecordPaymentForm.tsx`)** — built as a "Record Payment"
  action on the Invoice/Bill detail page, not a standalone reconciliation-creation form, per
  Erion's explicit direction to avoid making the user hand-build a journal entry first. One form
  submit does three sequential calls: `POST .../journal-entries` (draft, two lines — Cash/Bank
  debit + AR credit with `partnerId` set for an invoice payment, or AP debit with `partnerId` set +
  Cash/Bank credit for a bill payment) -> `POST .../journal-entries/{id}/post` (`post3`, see NSwag
  gotcha above) -> find the posted entry's AR/AP line by matching `accountId` against the
  document's control account, then `POST .../reconciliations` with that line's id and the payment
  amount. `InvoiceDetail.tsx`/`BillDetail.tsx` resolve `controlAccountId` (accounts `1200`/`2000`
  by code) and `journalId` (the seeded `"GEN"` journal) once and pass them down; the form only
  renders when the document is `Posted` and `outstanding > 0`. Verified end-to-end against the
  real API, not just typechecked (see below) — this is the same three-call sequence the curl
  verification below drives directly.
- **Reconciliation nav page (`src/pages/reconciliation/Reconciliation.tsx`)**: an AR/AP
  aging-lite view, not a creation form — lists every Posted invoice/bill with `outstanding > 0`
  (again via `Promise.all` over `.../balance`), each linking to its own detail page where the
  actual payment gets recorded. Matches the "reconciliation nav entry can just route to a simple
  list" instruction.
- **Payroll (`src/pages/payroll/`)**: new nav entry (`src/config/nav.ts`, `Users` icon from
  `lucide-react`, 6th item) — `Payroll.tsx` (employee create/list inline, payroll-run create form
  defaulting to the current calendar month, runs list) and `PayrollRunDetail.tsx` (new route
  `/payroll/:id`, payslip line table with PIT/pension/net-pay columns, Post action using `post4`).
- **Reports (`src/pages/Reports.tsx`)**: three sections behind a plain button-toggle (no tabs
  primitive added — `@radix-ui/react-tabs` isn't a dependency, same "don't introduce a new
  primitive" discipline as `select.tsx`) — P&L (date-range, income/expense tables, net income),
  Balance Sheet (as-of date, assets/liabilities/equity tables, a visible
  `Assets = Liabilities + Equity` line that turns `text-destructive` if the identity doesn't hold
  within a cent), VAT Return (date-range, output/input VAT tables, net VAT due).
- **Dashboard (`src/pages/Dashboard.tsx`)**: kept deliberately light per instruction — a trial
  balance snapshot (posted-account count, total posted debit/credit) reusing the existing
  `trialBalance` endpoint rather than building a new AR/AP aggregate; not a full KPI dashboard.
- **`CreateJournalEntryLineRequest.partnerId` gotcha**: the regenerated interface types it as
  `partnerId: string | undefined` — present-but-possibly-undefined, not optional (`partnerId?:`)
  — so every object literal building a journal-entry line (existing `JournalEntryForm.tsx`
  included) must include the key explicitly (`partnerId: undefined` when there's no partner), or
  `tsc -b` fails with "Property 'partnerId' is missing." Both the pre-existing
  `JournalEntryForm.tsx` and the new `RecordPaymentForm.tsx` needed this.
- **Verified end-to-end** against the real running API + a real `vite` dev server on `:5173`
  (killed a stale dev-server process left over from an earlier session that had drifted to `:5174`
  and would have missed the CORS allowlist), no browser-automation tool available in this
  environment (same constraint as the earlier Ledger pass) — curl drove the exact sequence the UI
  sends: register -> create company -> create a customer + vendor partner -> create+post a taxed
  invoice (1000 net, 18% VAT -> total 1180) -> confirm balance `{1180, 0, 1180}` -> record a 700
  partial payment via the draft-entry/post/reconcile sequence above -> balance updates to
  `{1180, 700, 480}` -> create+post a taxed bill (400 net, 18% VAT -> total 472) -> record a full
  472 payment -> balance `{472, 472, 0}` -> two employees (500/200 monthly gross) -> payroll run
  produces the same hand-computed payslip figures documented in "Reconciliation and Payroll
  modules" above (456.50/190.00 net) -> post the run -> all three report endpoints return
  internally consistent numbers for the combined scenario (P&L net income -135 = 1000 income -
  1135 expenses [400 bill expense + 735 posted-payroll salary expense]; balance sheet assets 780 =
  liabilities 915 + equity -135; VAT return output 180 / input 72 / net due 108) — confirming both
  the reports math and that Draft-vs-Posted state is reflected correctly everywhere. `pnpm
  --filter @pako/web typecheck/lint/test/build` and `dotnet test Pako.slnx` (55/55, untouched by
  this pass) all pass on top of this.

## Mobile stack (`apps/mobile`, 2026-08-26)

- `apps/mobile` (`@pako/mobile`): Expo SDK 57, React Native 0.86 (New Architecture), React 19.2,
  Expo Router (not React Navigation directly) for file-based routing — the current idiomatic
  default for a new Expo TS app. `src/app/_layout.tsx` (root Stack) → `src/app/(tabs)/_layout.tsx`
  (Tabs) → four screens, each just `<PlaceholderScreen title="..." />`. No API calls yet.
  Non-obvious scaffolding gotchas (stale `expo-env.d.ts`/Jest CSS handling/etc.) are documented in
  `apps/mobile/CLAUDE.md`, not repeated here.
- Same root-level gap as `apps/web`: no `turbo.json` yet, so use `pnpm --filter @pako/mobile
  <script>` directly (`dev`, `build`, `lint`, `test`, `typecheck` all verified working).

## Conventions (carried forward from kudofatura, keep consistent — frontend/panel scope only,
see "Backend stack" above for backend)

- User-facing error messages in Albanian (kudofatura convention, keep it).
- Response envelope pattern `{ statusCode, data, success, errors }` — reuse kudofatura-be's
  `api-response.middleware.js` pattern, adapt to ASP.NET Core response conventions.
- A real migration runner from day one (EF Core migrations, not manual SQL) — same reasoning as
  originally stated: Kudofatura has no migration runner, acceptable for an invoicing tool, not for
  a general ledger with a hash-chain integrity requirement.

## Non-obvious things learned about kudofatura while planning this (2026-08-26)

- Kudofatura's fiscal-provider abstraction (`kudofatura-be/services/fiscal-providers/
  base-fiscal-provider.js`) is a clean strategy interface (`issueReceipt/voidReceipt/xReport/
  zReport/getStatus`) already shaped exactly like a plug-in point — worth preserving verbatim
  when extracted into `backend/modules/fiscal/`, not rewriting.
- `sef-provider.js` is a stub whose error message ("ATK e Kosovës nuk e ka hapur API-n e
  SEF-it") is now factually outdated — the SEF API/portal opened June 2026. This needed a real
  implementation, not just a rename — done: PAKO's `SefProvider`
  (`backend/Pako.Domain/Fiscal/SefProvider.cs`) throws `NotImplementedException` stating the
  integration is Phase 2 scope, not that the API is unavailable. The real SEF integration itself
  is still Phase 2, not built.
- Checked `kudofatura/SECURITY_AUDIT_REPORT.md` and `FRONTEND_AUDIT.md` before porting
  `kudofatura-fiscal-bridge` (2026-08-26): no finding in either implicates the bridge service's
  own code (it's a localhost-only printer driver, not part of the auth/Supabase/frontend-role
  findings) — ported as-is, see `fiscal-bridge/CLAUDE.md`.
- Kudofatura has payroll (`payroll-router.js`, `payroll-export-service.js`) and withholding-tax
  (`tatimi-ne-burim-router.js`) routes, but they are **not a gross-to-net calculator** — corrected
  after actually building PAKO's Payroll module (see "Reconciliation and Payroll modules" above):
  `payroll_employees` stores tax/contribution figures as manually-entered columns and
  `payroll-export-service.js` only formats them into ATK `.xlsx` exports. There was nothing to port
  for the actual calculation; PAKO's `IPayrollCalculationService` is independent C#.
- Kudofatura has **no general ledger at all** — no chart of accounts, no journals, no
  double-entry table. It is purely document-centric (invoices, payments, partners, stock). This
  confirms the GL core is 100% new work, not an extraction.

## Global exception handling, company-creation 500 bug fix, Firm/member-management API (2026-08-26)

**Bug found and fixed, root cause confirmed by reproduction, not a guess**: `POST /api/companies`
with a `name` longer than 256 characters threw an uncaught `DbUpdateException` (Postgres `22001:
value too long for character varying(256)`, from `CompanyConfiguration`'s `HasMaxLength(256)`) —
`Pako.Api` had **no global exception handling middleware at all** before this pass, so the
exception surfaced as a raw ASP.NET dev-exception dump to the client, which the NSwag-generated
frontend client can't parse into anything but its generic "An unexpected server error occurred"
fallback — this is almost certainly what Erion hit. Concurrent duplicate submissions (5 parallel
`POST /api/companies` for the same user), Albanian/unicode names (`ë`/`ç`), empty/whitespace names,
and 8 companies created back-to-back for one user were all tried and **did not** reproduce anything
— no shared counter or race exists in company creation (`Company.NextInvoiceNumber` is per-company
and untouched by `CompaniesController.Create`), empty/whitespace names succeeded (201) rather than
erroring, and unicode names worked fine. Only the >256-char name 500'd.
- **Fix, two layers**: (1) `CompaniesController.Create` now rejects `null`/whitespace-only names and
  names over 256 chars with a clean `400 BadRequest`, before ever touching the DB — same manual
  imperative-validation style `EmployeesController.Create` already used (`if
  (string.IsNullOrWhiteSpace(...)) return BadRequest(...)`), not DataAnnotations (no other contract
  in this repo uses them). (2) `Pako.Api/Middleware/GlobalExceptionHandler.cs` (`IExceptionHandler`,
  the .NET 8+ pattern, registered via `builder.Services.AddExceptionHandler<GlobalExceptionHandler>()`
  + `AddProblemDetails()` + `app.UseExceptionHandler()` early in `Program.cs`'s pipeline) — logs the
  full exception (stack trace, request method/path) via `ILogger` on every unhandled exception from
  **any** controller, and returns a `ProblemDetails` JSON body (`title`/`status`/`detail`/`instance`)
  instead of the raw dev-exception page; `detail` includes `exception.Message` only in Development
  (developer convenience), a generic message otherwise — full detail always goes to the log either
  way, never silently swallowed. **Verified this actually covers every controller, not just
  Companies**, by triggering the same class of bug on `PartnersController` (partner name > 256
  chars, which has no per-field length guard added — deliberately left alone, see below) and
  confirming a clean `ProblemDetails` 500 + a full stack trace in the server log, not a raw dump.
- **Systemic gap acknowledged, not fully closed**: `HasMaxLength` constraints exist on several other
  user-input string fields (`Partner.Name`/`TaxNumber`, `Employee.Name` [has a required-check but no
  length check], `Journal.Code`/`Name`, `JournalEntry.Reference`, `Bill.VendorReference`,
  `InvoiceLine`/`BillLine.Description`) that could hit the identical DB-truncation-500 pattern on an
  overlong value — only `CompaniesController` got the explicit length guard in this pass, since that
  was the one actually reported and reproduced. They're no longer a silent-crash risk *for the
  client* (the global handler now returns clean JSON+logs instead of a raw dump either way), just
  still a "500 instead of 400" UX gap on those specific fields. Flag for a follow-up pass if any of
  them gets reported the same way.
- **`FirmsController`** (`Pako.Api/Controllers/FirmsController.cs`, new): `POST /api/firms` (creator
  auto-granted `FirmAdmin`, same pattern `CompaniesController.Create` already used for
  `ClientAdmin`), `GET /api/firms` (firms the user has any membership in, mirrors
  `CompaniesController.List`'s two-query-then-filter shape).
- **Attaching a Company to a Firm — chose to extend `POST /api/companies` with an optional `firmId`
  field, not a separate `POST /api/firms/{firmId}/companies` endpoint**: `CompanyContracts.cs`'s
  `CreateCompanyRequest` gained `Guid? FirmId = null`. Keeps company creation as one endpoint/one
  code path (chart-of-accounts/tax/journal seeding logic isn't duplicated across two controllers)
  rather than forking it. `CompaniesController.Create` checks the caller holds `FirmAdmin` on the
  target `firmId` (404 if the firm doesn't exist, 403 if not `FirmAdmin`) before creating the
  company with that `FirmId` set. **A company created under a firm does NOT get an auto-created
  direct `Membership` row for its creator** (unlike a direct SME company, which still gets the
  creator auto-granted `ClientAdmin` exactly as before) — the creating `FirmAdmin` already has
  cascaded access via their firm-scoped `Membership`, so a redundant company-scoped row would just
  be duplicate state to keep in sync. Verified by asserting no `Membership` row exists for the
  creator's `(UserId, CompanyId)` right after creation, then confirming `CompanyAccessFilter` still
  grants that same user access via the cascade path alone.
- **Member management — `CompanyMembersController`/`FirmMembersController`** (new, nested-resource
  controllers under `api/companies/{companyId:guid}/members` and `api/firms/{firmId:guid}/members`,
  same "separate controller per nested resource" pattern as `PartnersController`/
  `EmployeesController` rather than bolting more actions onto `CompaniesController`/
  `FirmsController`). Both `POST` actions: look up the target user by email via
  `UserManager<AppUser>.FindByEmailAsync` (same lookup `AuthController.Login` already uses, handles
  Identity's email normalization correctly — do NOT query `_db.Users.Where(u => u.Email ==
  ...)` directly, `Email` isn't the normalized/indexed lookup column, `NormalizedEmail` is), return a
  plain `404` with a clear message if no account exists (never silently creates one), reject a role
  that doesn't match the target scope (`ClientAdmin`/`ClientViewer` only for company members,
  `FirmAdmin`/`FirmAccountant` only for firm members) with `400`, reject an already-existing
  membership for that `(user, scope)` pair with `400`. Both `GET` actions join `Membership` rows to
  `AppUser.Email` via a `Dictionary<Guid,string>` lookup (not a SQL join — `AppUser` lives in a
  different logical area, `IdentityUserContext<AppUser,Guid>.Users`, simplest to fetch separately)
  — the company variant includes both direct `Membership.CompanyId` matches and firm-cascaded
  `Membership.FirmId` matches (same union `CompanyAccessFilter` uses), so a company's member list
  correctly shows the firm's admins/accountants alongside any directly-added client-side members.
- **Authorization — extended the existing pattern rather than reusing it as-is, because the ask was
  stricter than the existing `writeAccess` gate**: `[RequireCompanyAccess(writeAccess: true)]`'s
  `WriteCapableRoles` already includes `FirmAccountant`, but member-management is meant to be
  admin-only (`ClientAdmin`/`FirmAdmin`, explicitly excluding `FirmAccountant`) — a strictly smaller
  set than "can write". Rather than add a third parallel filter, `CompanyAccessFilter`/
  `RequireCompanyAccessAttribute` gained an `adminOnly` bool parameter (used as `[RequireCompanyAccess
  (writeAccess: true, adminOnly: true)]` on `CompanyMembersController.Create`) that layers an
  `AdminRoles = { FirmAdmin, ClientAdmin }` check on top of the existing one. For `Firm`-scoped
  routes (`{firmId}` in the route, not `{companyId}`) there was no existing filter — `[RequireCompany
  Access]` literally can't work, it reads a `companyId` route value — so a new, smaller
  `FirmAccessFilter`/`RequireFirmAccessAttribute(adminOnly: false)` pair was added
  (`Pako.Api/Authorization/`), same shape as `CompanyAccessFilter` but **no cascade**: a `Firm`-scoped
  route only ever checks a direct `Membership.FirmId` match (there's nothing "above" a Firm to
  cascade from). `GET` actions on both use the base (non-admin, any-role) check, matching every other
  read-only endpoint's convention in this repo.
- **No new migration** — `Company.FirmId` and every `Membership` shape needed already existed from
  the original Companies/Firm/Membership pass; confirmed by running `dotnet ef migrations add` after
  all these changes and observing an empty `Up()`/`Down()` (then removed it — no need to keep a
  no-op migration file around).
- **Testing pattern extended, not reinvented**: `Pako.Tests/CompaniesControllerTests.cs` and
  `Pako.Tests/FirmsAndMembershipTests.cs` reuse `ReportsControllerTests`' "instantiate the controller
  directly against an `InMemory` `PakoDbContext`" pattern, extended with a `ControllerContext` +
  `ClaimsPrincipal` (needed here since, unlike `ReportsController`, these controllers read
  `User.FindFirstValue(ClaimTypes.NameIdentifier)` in their own body) and a real DI-built
  `UserManager<AppUser>` (`new ServiceCollection().AddIdentityCore<AppUser>()
  .AddEntityFrameworkStores<PakoDbContext>()`, then resolve from the built provider — a raw `new
  UserManager<AppUser>(...)` needs ~8 constructor dependencies, easier to let DI wire it the same way
  `Program.cs` does). **New for this repo**: since `[RequireCompanyAccess]`/`[RequireFirmAccess]` are
  MVC action filters that only run through the real HTTP pipeline (calling a controller method
  directly, as every existing test here does, skips them entirely — confirmed this is why no prior
  test exercised `CompanyAccessFilter`'s cascade logic despite it being verified manually since the
  original Companies/Firm/Membership pass), the new authorization-specific tests instead construct an
  `ActionExecutingContext` by hand (`DefaultHttpContext` + `RouteData` + a dummy `ActionDescriptor`)
  and call `filter.OnActionExecutionAsync(...)` directly — asserts `context.Result` is `null` (access
  granted, `next()` ran) or a `ForbidResult` (denied). Reuse this pattern for testing any future
  authorization filter logic rather than only testing it manually against the live API.
- **Verified end-to-end** against the real running API (register two users -> user A creates a firm
  -> `GET /api/firms` lists it -> user A creates a company with that `firmId` -> user A (cascaded
  `FirmAdmin`, no direct company membership) can read the company's accounts -> user B (no membership
  at all) gets `403` on the same endpoint -> user B tries to add themselves as a firm member and gets
  `403` (not `FirmAdmin`) -> user A adds user B as `ClientViewer` directly on the company -> user B
  can now read accounts (`200`) but gets `403` creating a partner (write action) and `403` adding
  another member (admin-only action) -> `GET .../companies/{id}/members` correctly lists both the
  cascaded `FirmAdmin` and the direct `ClientViewer` with their emails -> `GET .../firms/{id}/members`
  lists only the firm-scoped member -> adding a member by a nonexistent email 404s with a clear
  message) — this is the literal three-user, two-scope flow the task asked to confirm, not a subset
  of it. `dotnet build`/`dotnet test Pako.slnx` both clean (69/69, up from 55).
- **Frontend not touched in this pass** — `packages/shared/src/generated/api-client.ts` was NOT
  regenerated, so `apps/web` has no client methods for `FirmsController`/`CompanyMembersController`/
  `FirmMembersController` yet and `CreateCompanyRequest`'s new `firmId` field isn't in the generated
  TS type either. Backend-only pass per the task; regenerate (`pnpm generate:api-client` per
  "Frontend <-> backend wiring" above) before building any firm-management UI, and re-check every
  `apiClient.postN(...)` call site per that section's NSwag operation-name-collision gotcha — adding
  three new `Post` actions across two new controllers will almost certainly shuffle the existing
  `post`/`post2`/`post3`/`post4` numbering again.

## Firm management UI, Settings page, and a real create-flow bug fix (2026-08-26)

Regenerated `packages/shared/src/generated/api-client.ts` for the Firm/Member API added above, then
built the Firm management UI (folded into the existing Companies page) and a real Settings page.

- **NSwag regeneration this time was a pure append, not a reshuffle**: diffing the old and new
  `api-client.ts` showed zero removed/changed lines, only new methods added
  (`firms`/`firmsAll`/`members`/`membersAll`/`members2`/`membersAll2`). Every previously-numbered
  collision (`post`/`post2`/`post3`/`post4`, `balance`/`balance2`,
  `reconciliationsAll`/`reconciliationsAll2`) was re-verified by reading its `url_` literal in the
  regenerated file and confirmed unchanged from what's documented above — still don't skip this
  check on a future regeneration just because it was clean this time; NSwag's numbering is decided
  by controller alphabetical order among colliding action names, and a controller named earlier in
  the alphabet than `Bills`/`Firms` could still reshuffle everything.
- **Real bug found and fixed: every `POST` "create" endpoint in the entire backend was
  unusable from the actual generated TS client, not just Firms/Members** — discovered while
  wiring firm/company creation into the UI and confirmed with a real running server, not
  guessed. `Pako.Api`'s built-in `Microsoft.AspNetCore.OpenApi` document generator has no way to
  know a controller action calls `StatusCode(StatusCodes.Status201Created, ...)` at runtime (no
  `[ProducesResponseType]` attributes existed anywhere in this repo before this pass), so it
  documented every `ActionResult<T>` action's success response as bare `200` in the OpenAPI spec.
  NSwag generates its `processX` methods strictly off that spec: `if (status === 200) { ...parse
  success... } else if (status !== 200 && status !== 204) { throwException(...) }` — so a real `201`
  response (confirmed via `curl -i`, e.g. `POST /api/companies` actually returns `201`) falls into
  neither branch's happy path and gets thrown as an `ApiException`, surfacing as "An unexpected
  server error occurred." in the UI **even though the resource was created successfully server-side**.
  This affected all 12 create actions across the backend (`CompaniesController`, `FirmsController`,
  `CompanyMembersController`, `FirmMembersController`, `PartnersController`, `EmployeesController`,
  `JournalsController`, `JournalEntriesController`, `InvoicesController`, `BillsController`,
  `PayrollRunsController`, `ReconciliationsController`) — i.e. the existing "Create a company" form
  on the Companies page was already silently broken this way before this pass touched anything;
  prior passes' "verified end-to-end" claims were all curl-driven (replicating the UI's payloads
  directly against the HTTP API, not through the generated client's status-code parsing logic), so
  this never got caught. **Fix**: added `[ProducesResponseType(typeof(XResponse),
  StatusCodes.Status201Created)]` to all 12 `Create` actions (first use of `ProducesResponseType` in
  this repo), then regenerated the client — `processX` methods now correctly branch on `status ===
  201`. `dotnet build`/`dotnet test Pako.slnx` (69/69) both clean on top of this; the `Post` actions
  (journal-entry/invoice/bill/payroll-run posting) were unaffected — they already return `Ok(...)`
  (200), not 201.
- **Firm UI folded into the existing Companies page (`src/pages/Companies.tsx`), not a new nav
  item** — a "Firms" card (create-firm form + firm list) sits below the existing companies list and
  create-company form; the create-company form gained an optional "Firm" `<select>` (native
  `select.tsx`, same as everywhere else in this repo) wired to `CompanyContext.createCompany`'s new
  optional `firmId` param, which passes straight through to `CreateCompanyRequest.firmId` (already
  `firmId?:` optional in the generated type, no `undefined`-key gotcha like `partnerId` had). Each
  company row and firm row gets a "Members" toggle button that expands a shared
  `src/pages/shared/MembersPanel.tsx` inline (a `Set<string>` of expanded row keys in local
  component state, no new context) — kept out of a separate page/route to match the "keep nav simple,
  don't add a redundant top-level item" instruction.
- **`src/pages/shared/MembersPanel.tsx`**: one component parameterized by `{ scope: "company" |
  "firm", scopeId }`, reused on both the Companies page and the new Settings page. Fetches via
  `membersAll`/`membersAll2`, adds via `members`/`members2` depending on `scope`. **Admin-gating done
  entirely client-side off the fetched member list, not a separate "my role" endpoint** (none
  exists): finds the row where `member.userId === auth.userId` (from `useAuth()`) and only renders
  the add-member form if that row's `role` passes `isCompanyAdminRole`/`isFirmAdminRole` — mirrors
  the backend's own `AdminRoles`/`adminOnly` check exactly (`FirmAdmin`/`ClientAdmin` for company
  scope, only `FirmAdmin` for firm scope — `FirmAccountant` is write-capable server-side but
  deliberately excluded from admin actions in both places). Verified against the real API: a
  `FirmAccountant` member sees the members list but not the add-member form, and a direct `403` from
  attempting the POST anyway (confirmed via curl) matches what the hidden-form choice was protecting
  against.
- **`src/lib/membership-enums.ts`**: new hand-maintained enum map, same pattern as
  `ledger-enums.ts`/`tax-enums.ts` (`Pako.Api`'s OpenAPI doesn't emit enum names) —
  `MembershipRole` order `[FirmAdmin, FirmAccountant, ClientAdmin, ClientViewer]` matches
  `Pako.Domain/Companies/MembershipRole.cs` exactly, verified against real seeded membership rows
  (firm creator came back `role:0`, a firm-added `FirmAccountant` came back `role:1`).
- **Settings page (`src/pages/Settings.tsx`)** replaces the `ComingSoon` placeholder (wired into
  `src/config/nav.ts`, which needed the `lucide-react` `Settings` icon import aliased to
  `SettingsIcon` to avoid colliding with the new page component's name): a read-only email field off
  `useAuth()`, and the active company's `MembersPanel` for an at-a-glance "who has access to what
  I'm looking at" view. **No new logout button was added** — `AppLayout.tsx`'s header already has
  one (`auth?.email` + a "Log out" button, visible on every page), so duplicating it on Settings
  would be redundant chrome, not "keep nav simple."
- **Verified end-to-end** against the real running API (not just curl replicating payloads —
  actually re-derived the exact request/response shapes `MembersPanel`/`Companies.tsx` send,
  including the `firmId`-optional create-company body and the `{email, role}` add-member body):
  register two users -> user A creates a firm (`201`, confirms the status-code fix) -> `GET
  /api/firms` lists it -> user A creates a company with that `firmId` (`201`) -> user A adds user B
  as `FirmAccountant` (role `1`, `201`) -> user B's `GET /api/companies` now lists the firm's company
  via cascade -> `GET .../companies/{id}/members` shows both the `FirmAdmin` and cascaded
  `FirmAccountant` with correct emails/roles -> user B (not `FirmAdmin`) gets `403` posting to
  `.../firms/{id}/members` directly -> adding an unknown email `404`s with `"No PAKO account exists
  for {email}."` -> adding a `ClientAdmin`/`ClientViewer`-scoped role to a firm `400`s with a clear
  message. Also ran the full `apps/web` dev server and confirmed `Companies.tsx`/`Settings.tsx`/
  `MembersPanel.tsx` all serve and transform cleanly through Vite (no browser-automation tool
  available in this environment, same constraint as every prior frontend pass, so this is a module
  compile/serve check, not a click-through). `pnpm --filter @pako/web {typecheck,lint,test,build}`,
  `pnpm --filter @pako/shared typecheck`, and `dotnet test Pako.slnx` (69/69) all pass on top of all
  of this.

## Mobile app frontend (`apps/mobile`, 2026-08-26)

Built out the mobile companion app for real — Auth (login/register, JWT in `expo-secure-store`),
Company selection (list/switch/create), Dashboard (trial balance snapshot), Invoicing and Bills
(list/create/detail/post/record-payment, same three-call settlement sequence
`RecordPaymentForm.tsx` established for web), and Reports (P&L/Balance Sheet/VAT Return) — the
tab shell's four placeholders became real screens plus nested stacks for Invoicing/Bills detail
flows. Payroll and standalone Reconciliation are intentionally out of scope on mobile per the
task (Payroll is a monthly desktop-first batch op; Invoicing/Bills' record-payment flow already
covers reconciliation). Full details, gotchas, and verification are in `apps/mobile/CLAUDE.md` —
not repeated here except what's relevant repo-wide.

- **`packages/shared` is now a real workspace dependency of `apps/mobile`** (`"@pako/shared":
  "workspace:*"` added to `apps/mobile/package.json`) — the note in "Frontend <-> backend wiring"
  above about mobile needing to pass its own `http: { fetch }` override (no `window` in RN) turned
  out correct; `apps/mobile/src/api/client.ts` does exactly that, same shape as
  `apps/web/src/api/client.ts`'s `authorizedFetch` but backed by a module-level token variable
  instead of `sessionStorage` (SecureStore is async, the generated client's `fetch` wrapper isn't).
- **The `201`-vs-`200` client bug fixed in the previous section (Firm management UI pass) applies
  identically to every create call this mobile app makes** — confirmed the currently-generated
  `packages/shared/src/generated/api-client.ts` already has the fix (regenerated by that pass,
  landed on disk mid-session while this mobile work was in progress) and re-verified by driving
  the exact mobile call sequence (`register` → `companies` → `partners` → `invoicesPOST` →
  `post2` → `journalEntries` → `post3` → `reconciliations` → `balance2`) through the real
  `PakoApiClient` class via `npx tsx`, not just curl against the raw HTTP API — curl alone
  can't catch a bug that lives in the generated client's response-status branching. See
  `apps/mobile/CLAUDE.md`'s verification section for the full method list and result.
- Expo Router's typed-routes (`app.json`'s `experiments.typedRoutes`) and
  `eslint-plugin-react-hooks@7`'s `set-state-in-effect` rule (new since the original mobile
  scaffold pass, pulled in transitively via `eslint-config-expo`) both had non-obvious gotchas
  that will resurface for any future mobile route/data-fetching work — documented in
  `apps/mobile/CLAUDE.md`, not duplicated here.
- **Verification included a real iOS Simulator run** (via `xcrun simctl` + `expo start --ios`,
  auto-installing the SDK-57-matching Expo Go build), not just bundling — screenshots confirmed
  the Login/Register screens render correctly and the `Stack.Protected` auth guard correctly
  blocks a deep-link into a protected route while unauthenticated. Interactive form-filling
  (typing/tapping) could not be automated in this environment (no `idb`/`cliclick`, and
  AppleScript/System Events UI-scripting timed out — Accessibility automation isn't available
  here), so that part of the flow relies on the curl/`PakoApiClient`-script verification above
  plus code review instead. `pnpm --filter @pako/mobile {typecheck,lint,test,build}` all pass.
