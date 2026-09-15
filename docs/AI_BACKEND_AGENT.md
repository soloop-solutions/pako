# Backend agent instructions — PAKO

You are working in the PAKO monorepo as the **backend developer**. A second agent owns
`apps/web/`. Do not edit `apps/web/` except to add API fixtures where this file tells you to.

Read `docs/ACCOUNTANT_MILESTONE.md` for the plan, `docs/BACKEND_BRIEF.md` for the task list, and
`docs/ODOO_COMPARISON.md` for why several tasks are shaped the way they are. This file is the
operating manual: how to work, what never to do, and how to prove a task is finished.

---

## 1. Facts about this repo you must know before you touch anything

- Stack: **ASP.NET Core / .NET 10**, EF Core, Npgsql, self-hosted Postgres. Turborepo + pnpm at the
  root. There is **no `.sln`** — target `.csproj` files directly.
- Projects: `backend/Pako.Api`, `Pako.Domain`, `Pako.Infrastructure`, `Pako.Localization.Xk`,
  `Pako.Tests`.
- **`CLAUDE.md` at the repo root is 183 KB and partially stale.** It describes the repo as a
  scaffold where "everything else is architecture + placeholder". That was true on 2026-08-26 and
  is not true now. Read code before trusting any document, this one included.
- **`git status` lies.** The working tree shows ~348 modified files. `git diff --ignore-all-space
  --stat` is empty — it is pure CRLF line-ending churn. See rule 2.

### Five things that already exist. Do not rebuild them.

1. `PostingRuleValidator.ValidatePartnerSubledgerReference` already refuses a manual journal line on
   a partner-subledger account with no partner.
2. `IsControl` and `IsPostable` are enforced in `JournalEntriesController` (rules R02, R04), seeded
   from `ChartOfAccountsV2Template.ControlAccountCodes`.
3. `CitDeductibility.Non` already drives the CIT add-back report in `ReportsController`.
4. `Company.AccountingLockDate` and `TaxLockDate` are enforced on invoices, bills, journal entries
   and payroll runs. Nothing sets them — `CompaniesController` has exactly one write method.
5. `Account` carries ~20 fields (Class, Group, Statement, NormalBalance, Subledger, IsControl,
   IsPostable, DefaultVatCode, CitDeductibility, CitLimitRule, Profiles, IsActive, ValidFrom/To,
   NameSq, ParentAccountId). `AccountResponse` returns 7 of them.

---

## 2. Hard rules. Breaking any of these is a failed task.

1. **Never commit line-ending churn.** Stage only files you actually edited, by name. Never
   `git add -A`, never `git add .`. Before committing, run `git diff --cached --ignore-all-space
   --stat` and confirm every file listed is one you meant to change.
2. **Never reformat, re-indent or "tidy" a file you were not asked to change.** No drive-by renames,
   no import reordering, no comment cleanup in unrelated files.
3. **Never edit a migration that has already been merged.** Generate a new one.
4. **One migration per commit, and no more than one migration per working day.** Rebase on `main`
   before generating. EF model snapshots do not merge — if you hit a snapshot conflict, take
   `main`'s version and regenerate.
5. **Money arithmetic lives in the domain**, in `DocumentLineCalculator` or `TaxComputationService`.
   A controller orchestrates. If you find yourself writing `*` or `/` on a decimal inside a
   controller, stop and move it.
6. **Every user-facing error string goes in `backend/Pako.Api/Resources/ErrorMessages.resx` *and*
   `ErrorMessages.sq.resx`**, resolved via `IStringLocalizer`. Add keys. Never rename or delete an
   existing key.
7. **Never delete an account, and never edit an account `Code` in place** — R26 and R25. Deactivate;
   renumber through a mapping.
8. **Do not add a NuGet package without saying so in the commit body** and checking it is not
   already referenced.
9. **Do not change `apps/web/` source.** The only exception is writing JSON fixtures into
   `apps/web/src/mocks/` as required by the contract-first workflow below.

---

## 3. The contract-first workflow — follow this for every capability

The frontend agent is blocked until a contract exists. For each capability, in this order:

**Commit 1 — the contract.**
- Request/response records in `backend/Pako.Api/Contracts/`.
- The controller action, returning a hard-coded but *realistic* fixture. Mark it
  `// CONTRACT STUB — replaced in <task id>`.
- The same fixture as JSON at `apps/web/src/mocks/<endpoint-name>.json`.
- Regenerate the API client: `pnpm generate:api-client`. Commit
  `packages/shared/src/generated/api-client.ts` in the same commit.
- Commit message: `contract(<task id>): <endpoint>`.

**Commit 2..n — the implementation.** Replace the stub. The fixture JSON becomes the expected
payload in the test. Never change the response shape after commit 1 without saying so explicitly in
the commit body — the frontend is already building against it.

---

## 4. How to verify. Run these; do not claim a task is done without them.

```bash
# Postgres for tests and local run
docker compose -f backend/docker-compose.yml up -d

# Build and test the backend (no .sln — target the csproj)
dotnet build backend/Pako.Api/Pako.Api.csproj
dotnet test  backend/Pako.Tests/Pako.Tests.csproj

# After any contract change
pnpm generate:api-client
pnpm typecheck          # proves the generated client still compiles against the web app
```

A task is done when: the new tests pass, **all 198+ pre-existing tests still pass**, the build has
no new warnings, and `git diff --cached --ignore-all-space --stat` lists only files you intended.

---

## 5. Stop and ask. Do not guess on these.

- An item saved with no default accounts: company-level fallback, or refuse the save? **(blocks B6)**
- Who may grant a lock exception — owner only, or any firm member? **(blocks B4)**
- Attachments on documents, on partners, or both? **(blocks B12)**
- Does ATK accept a sales return as a nota kreditore? **(blocks B10 — needs the partner firm)**
- Who may override an invoice number, and what happens to documents already numbered `INV-0001`?
  **(blocks B5's override path; the derivation itself is not blocked)**

Also stop if: a task would require changing a response shape another task already shipped; a
migration would drop or rename a column holding data; or you cannot make a test pass without
weakening what it asserts.

---

## 6. Task order

Do these in order. Do not start a checkpoint before the previous one's tasks pass.

### Phase 0 — before anything else

- **P0.1** Push Track A. 12 commits sit on local `main` unpushed; `origin/main` is at `1b6f092`.
- **P0.2** Rebase `origin/track-c/price-payment-debt` onto the new `main`. Expect ~36 conflict
  hunks in `InvoicesController.cs`, `BillsController.cs`, the contracts, `messages.ts`, six web
  pages, and `PakoDbContextModelSnapshot.cs`. Regenerate the snapshot rather than hand-merging it.
  The six web-page conflicts are the frontend agent's — coordinate, do not resolve them alone.
- **P0.3** Merge `origin/arnit-imp-1` (Albanian terminology, translations only).
- **P0.4** Commit the untracked `docs/V2_PARALLEL_TRACKS.md`.
- **P0.5** **Move the test suite to Testcontainers.** Add `Testcontainers.PostgreSql` to
  `Pako.Tests.csproj`. Write one xUnit collection fixture that starts `postgres:16-alpine`, runs
  `db.Database.Migrate()`, and gives each test a clean schema. Replace all **13**
  `UseInMemoryDatabase` call sites. All tests green.
  *Do not skip this.* B5, B4 and the payment-atomicity tests are meaningless on InMemory, which has
  no unique indexes, no triggers, no transactions and no row locks.

### Checkpoint 1 — the accountant owns their chart

- **B1** — Account write API. POST, PUT, deactivate on `AccountsController` (currently one read-only
  GET). Widen `AccountResponse` to every v2 field.
  *Verify:* tests prove create, edit, deactivate and list; editing `Code` is refused (R25); deleting
  an account with posted movement is refused (R26).
- **B2** — Hierarchy by code prefix. Add `AccountGroup { Id, CompanyId, Name, CodePrefixStart,
  CodePrefixEnd, ParentGroupId }`. An account's group is **derived by prefix match**, not stored on
  the account. Seed groups from the `class` and `group` columns of
  `backend/Pako.Localization.Xk/Data/PAKO_COA_v2_seed.csv`. **Leave `Account.ParentAccountId`
  untouched and do not create header accounts.**
  *Why:* this mirrors Odoo's `account.group`, where `group_id` is computed. It touches none of the
  233 seeded rows and a newly created `5xxx` account files itself.
  *Verify:* every seeded account returns a group with no backfill; a new account created in a range
  lands in the right group with no extra input.
- **B3** — `CashFlowCategory { None, Operating, Investing, Financing }` on `Account`, defaulted per
  account type in the seed. *Verify:* every seeded account has a category and it round-trips.
- **B13** — Widen `AccountType` from 5 values toward Odoo's 19 (receivable, cash, current and
  non-current asset, prepayment, fixed asset, payable, credit card, current and non-current
  liability, equity, **current-year-earnings**, income, other income, expense, other expense,
  depreciation, cost of revenue, off-balance). Derive `IncludeInitialBalance` from the type. Add a
  real current-year-earnings account.
  *Verify:* the balance sheet balances without a synthetic "Current Earnings" row.
- **B4** — Lock dates and exceptions. Add `SaleLockDate`, `PurchaseLockDate`, `HardLockDate` to
  `Company`. Add `AccountLockException { CompanyId, UserId, LockDateField, LockDate, Reason,
  EndsAt }`. Compute the effective lock per user. Endpoints to set each lock and grant/revoke an
  exception. **Do not build a period table.**
  Rules: the hard lock cannot be removed and cannot move backwards; setting it requires that no
  draft entries remain in the period; exceptions apply to soft locks only.
  *Verify:* posting into a locked period is refused with a message naming the lock; a user with a
  live exception can post; an expired exception cannot; removing a hard lock is refused.

### Checkpoint 2 — the registers become real

- **B5** — Numbering derived, not counted. **Do not create a counter table.** Derive the next number
  from the highest existing number matching the prefix. Serialise with a partial unique index —
  `UNIQUE (CompanyId, DocumentType, Number) WHERE State = Posted` — and on unique violation,
  increment and retry inside a savepoint. Keep the pattern (`{seq:00}/{yyyy}`, year reset) as
  configuration. Keep `DocumentNumberAudit` for overrides. Add a preview endpoint (label it
  provisional) and a gap report.
  *Verify on real Postgres:* 50 parallel posts produce 50 consecutive numbers; deleting a draft and
  re-posting does not skip; a hand-entered number is accepted if free and refused if taken.
- **B6** — Item register. Wire up the inert Sprint 0 tables. `ItemType { Goods, Service, Normative }`,
  per-company ordinal, unit, default VAT code, three default accounts. `ItemBarcode` many per item,
  unique per company. `InvoiceLine.ItemId` / `BillLine.ItemId` stay nullable. **No quantities, no
  valuation.** *Ask about the empty-accounts case before writing the validator.*
- **B7** — Pagination and search. One shape: `?page=&pageSize=&search=&sort=` returning
  `{ items, total, page, pageSize }`. Prove it on items, then retro-fit partners, invoices, bills
  and journal entries. *Verify:* 35,000 items page and search from an index, not a scan.
- **B8** — Partner as subledger: per-partner control account, `PaymentTermDays`, `CreditLimit`, and
  wire the existing `FiscalNumber` / `IsVatRegistered` to the with/without-VAT distinction.

### Checkpoint 3 — the month can be filed

- **B9** — Journals per document type. Stop hard-coding `JournalType.General` in
  `CompaniesController` (~line 138). Seed Sale, Purchase, Cash and Bank journals per company and
  route each document to its own. This is what structurally blocks the ATK books.
- **B10** — Purchase and sales books, on B9's journals and the seeded VAT codes. *Confirm the sales
  return question first.*
- **B11** — Add ClosedXML (there is no export library in the solution at all) and export the VAT
  return, both books, trial balance, P&L, balance sheet and any journal entry in ATK's column
  order. **One shared writer, not six.**
- **B12** — Attachments: upload, storage, and a generic link table (`AttachmentOwnerType` + owner
  id). There is no `IFormFile` anywhere in the backend today. Build it generically — this is also
  the OCR prerequisite.
- **B14** — Replace the planned project and employee columns with `AnalyticDistribution` as JSON on
  `JournalEntryLine` (analytic account → percentage, across plans). Migrate existing `CostCenterId`
  data into the new shape.
- **B15** — Hash chain. `InalterableHash = sha256(previousHash + canonicalRecord)` plus a gapless
  `SecureSequenceNumber` per company and journal. Freeze integrity fields once hashed. A
  "secure up to date X" endpoint that refuses to run past draft entries or unreconciled statement
  lines. *If a week must be cut from this checkpoint, this is the task to drop — say so rather than
  half-building it.*
