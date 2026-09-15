# Backend brief — "one month, closed and filed"

You own `backend/` and the API contract. Your counterpart owns `apps/web/`. The API is the
only thing between you, which is why rule 1 below is the most important line in this document.

Plan of record: `ACCOUNTANT_MILESTONE.md`. Design rationale: `ODOO_COMPARISON.md`.
Baseline: `main` @ d5b4f59. Stack: ASP.NET Core / .NET 10, EF Core, Npgsql, self-hosted Postgres.

---

## Before task 1 — five things that are already built and that you cannot see

Do not re-implement these. They exist, they are enforced, and they simply have no endpoint:

1. `PostingRuleValidator.ValidatePartnerSubledgerReference` rejects a manual line on a
   partner-subledger account with no partner (this is FINAbit's *Obligo Partnerin*).
2. `IsControl` / `IsPostable` are enforced in `JournalEntriesController` — rules R02 and R04 — and
   seeded from `ChartOfAccountsV2Template.ControlAccountCodes`.
3. `CitDeductibility.Non` already drives the CIT add-back report in `ReportsController`.
4. `Company.AccountingLockDate` / `TaxLockDate` are enforced on invoices, bills, journal entries and
   payroll. Nothing sets them: `CompaniesController` has one write method, `Create`.
5. `Account` carries ~20 fields (Class, Group, Statement, NormalBalance, Subledger, IsControl,
   IsPostable, DefaultVatCode, CitDeductibility, CitLimitRule, Profiles, IsActive, ValidFrom/To,
   NameSq). `AccountResponse` returns 7 of them.

## The eight working rules

1. **Contract before implementation.** For every capability: merge the endpoint, its request/response
   records, and a stub controller returning a realistic fixture — in their own commit — then
   regenerate the NSwag client (`packages/shared/src/generated/api-client.ts`) and tell the frontend
   dev. Save the fixture as JSON under `apps/web/src/mocks/`; it becomes the web mock now and the
   test's expected payload later. Budget half a day per capability. This is what keeps the other
   developer working.
2. **One migration per day, announced.** Rebase on `main` before generating. Never edit a migration
   that has already merged. Model snapshots do not merge.
3. **Tests run on Postgres.** See task 0.5. A test that needs a unique index, a trigger, a
   transaction or a row lock is not allowed to run on InMemory.
4. **Money math lives in the domain,** never in a controller. `DocumentLineCalculator` and
   `TaxComputationService` are where it goes. A controller orchestrates; it does not calculate.
5. **Cite the rule.** Posting rules are R-numbered in `60_Posting_Rules`. A test that enforces one
   names it: `Post_RefusesLineOnControlAccount_R04`.
6. **Errors are localized.** Add a key to `Resources/ErrorMessages.resx` *and* `.sq.resx`, resolve
   through `IStringLocalizer`. Add keys; never rename one.
7. **Every list endpoint is paged** from B7 onwards, and B7 retro-fits the ones that exist.
8. **Accounts are never deleted** (R26: deactivate once posted movement exists) and **codes are never
   edited in place** (R25: renumbering goes through a versioned mapping).

---

## Phase 0 — week 1, shared with the frontend dev, blocking

- **0.1** Push Track A. 12 commits sit on local `main` unpushed; `origin/main` is still at 1b6f092.
  Everything else rebases on this, so it goes first.
- **0.2** Rebase `origin/track-c/price-payment-debt` onto the new `main` and resolve it. Expect ~36
  conflict hunks: `InvoicesController.cs`, `BillsController.cs`, six web pages, `messages.ts`, the
  contracts, and `PakoDbContextModelSnapshot.cs`. Regenerate the snapshot rather than merging it.
- **0.3** Merge `origin/arnit-imp-1` (Albanian terminology, translation-only).
- **0.4** Commit `docs/V2_PARALLEL_TRACKS.md` — the plan of record is still untracked.
- **0.5** **Move the test suite to Testcontainers.** Add `Testcontainers.PostgreSql`, write one
  xUnit collection fixture that starts `postgres:16-alpine`, runs `db.Database.Migrate()`, and hands
  each test a fresh schema. Replace all 13 `UseInMemoryDatabase` call sites. All 198 tests green.
  *Why it is not optional:* B5's gapless numbering, C3's post-and-pay atomicity and B4's lock guard
  are exactly the behaviours InMemory cannot exercise — no unique indexes, no triggers, no locks.

---

## Checkpoint 1 — weeks 2–4 — the accountant owns their chart

### B1 · Account write API and full field exposure
Add POST, PUT and a deactivate endpoint to `AccountsController` (today: one read-only GET).
Widen `AccountResponse` to every v2 field. Enforce R25 (Code immutable after create) and R26
(deactivate, never delete, once the account has posted movement).
*Done when:* an account can be created, edited, deactivated and listed with its full v2 shape; a
test proves editing `Code` is refused; a test proves deleting an account with movement is refused.

### B2 · Hierarchy by code-prefix groups — **not** parent pointers
Add `AccountGroup { Id, CompanyId, Name, CodePrefixStart, CodePrefixEnd, ParentGroupId }`. The
account's group is **derived by prefix match**, not stored as a foreign key on the account. Seed
groups from the v2 CSV's `class` and `group` columns. Leave `Account.ParentAccountId` alone.
*Why:* this is Odoo's design (`account.group` with `code_prefix_start`/`_end`, `group_id` computed).
It touches none of the 233 seeded rows, and a newly created `5xxx` account files itself into the
right branch with no parent to choose.
*Done when:* the account list returns a group for every seeded account without any backfill, and a
new account created under a code range appears in the right group with no extra input.

### B3 · Cash-flow classification
Add `CashFlowCategory { None, Operating, Investing, Financing }` to `Account`, defaulted per account
type in the seed. The only account behaviour flag FINAbit has that PAKO has never modelled.
*Done when:* every seeded account has a category and it round-trips through the API.

### B13 · Account types carry the year-end close *(moved forward — it is account-model work)*
Widen `AccountType` from 5 values towards Odoo's 19 (receivable, cash, current/non-current asset,
prepayment, fixed asset, payable, credit card, current/non-current liability, equity,
**current-year-earnings**, income, other income, expense, other expense, depreciation, cost of
revenue, off-balance). Derive `IncludeInitialBalance` from the type. Introduce a real current-year
earnings account so the reports stop synthesising the line.
*Done when:* the balance sheet balances without a synthetic "Current Earnings" row.

### B4 · Lock dates and exceptions — **not** a period table
Add `SaleLockDate`, `PurchaseLockDate` and `HardLockDate` to `Company` beside the two that exist.
Add `AccountLockException { CompanyId, UserId, LockDateField, LockDate, Reason, EndsAt }`, and
compute the effective lock date per user. Endpoints to set each lock and to grant/revoke an
exception.
Rules, straight from Odoo: the hard lock **cannot be removed and cannot move backwards**; setting it
requires that no draft entries remain in the period; exceptions apply to soft locks only.
*Why not periods:* closing is chronological in practice, and "let one person fix March" is served
far better by a scoped, reasoned, expiring exception than by reopening a month for everyone.
*Done when:* posting into a locked period is refused with a message naming the lock; a user with a
live exception can post; the exception expires; removing a hard lock is refused.

---

## Checkpoint 2 — weeks 5–8 — the registers become real

### B5 · Numbering derived, not counted
**Do not build a counter table.** Derive the next number from the highest existing number matching
the prefix, and let a **partial unique index** serialise concurrent writers:
`UNIQUE (CompanyId, DocumentType, Number) WHERE State = Posted`. On unique violation, increment and
retry inside a savepoint. Keep the per-company pattern (`{seq:00}/{yyyy}`, year reset) as
configuration, not as state.
*Why:* a counter drifts from reality after a delete, a restore or a manual override; `max(number)`
cannot. Manual override then needs no special handling, and gap detection is a query rather than a
reconciliation.
Keep `DocumentNumberAudit` for overrides. Add a preview endpoint (clearly provisional — the number
is only reserved on post) and a gap report.
*Done when:* 50 parallel posts produce 50 consecutive numbers on real Postgres; deleting a draft and
re-posting does not skip; a manually entered number is accepted if free and refused if taken.

### B6 · Item register
Wire up the inert Sprint 0 tables. `Item` gains `ItemType { Goods, Service, Normative }`, a
per-company ordinal, unit, default VAT code and the three default accounts (revenue, expense,
inventory). `ItemBarcode` many-per-item, unique per company. `InvoiceLine.ItemId` /
`BillLine.ItemId` stay nullable so free-text lines keep working. **No quantities, no valuation.**
*Open decision needed from Adonis:* whether an item with no accounts falls back to a company default
or is refused at save. Ask before building the validator.

### B7 · Pagination and search
The first paging in the API. Establish one shape — `?page=&pageSize=&search=&sort=` returning
`{ items, total, page, pageSize }` — on items, then retro-fit partners, invoices, bills and journal
entries. Target is 35,000 items, so the search must be index-backed, not a client-side filter.

### B8 · Partner as subledger
Per-partner control account, `PaymentTermDays`, `CreditLimit`, and the existing `FiscalNumber` /
`IsVatRegistered` pair finally wired to the with-and-without-VAT distinction on documents.

---

## Checkpoint 3 — weeks 9–12 — the month can be filed

### B9 · Journals per document type
Stop hard-coding `JournalType.General` in `CompaniesController` (line ~138). Seed a Sale, Purchase,
Cash and Bank journal per company and route each document to its own. The Sale/Purchase/Cash/Bank
enum has existed and never been read — **this is what structurally blocks the ATK books.**

### B10 · Purchase and sales books
Built on B9's journals and the VAT codes already seeded. Confirm with the partner firm whether ATK
accepts a sales return as a nota kreditore (**D4**) before fixing the mapping.

### B11 · Excel export
Add ClosedXML — the solution has no export library at all today. Export the VAT return, both books,
trial balance, P&L, balance sheet and any journal entry, in ATK's column order. One shared writer,
not six.

### B12 · Document attachments
Upload, storage and a link table. There is no `IFormFile` anywhere in the backend today. Build it
once, generically (`AttachmentOwnerType` + owner id), because this is also the only thing standing
between PAKO and OCR capture.

### B14 · One analytic distribution, not a column per dimension
Replace the plan's project and employee columns with `AnalyticDistribution` as JSON on
`JournalEntryLine` — analytic account id → percentage, across analytic plans. Keep `CostCenterId`
working through a migration into the new shape.
*Why:* same week of work, supports splitting a line 60/40, and needs no schema change for the next
axis someone asks for.

### B15 · Hash chain over posted entries
`InalterableHash = sha256(previousHash + canonicalRecord)` plus a gapless `SecureSequenceNumber`,
per company and journal. Once hashed, block writes to the integrity fields. A "secure up to date X"
endpoint that refuses to run past draft entries or unreconciled statement lines.
*Why now:* this is the mechanism SEF certification will ask you to demonstrate, and it constrains
the write path — retrofitting it after another year of document types is materially dearer.
*If a week has to be cut from this checkpoint, this is the item to cut* — but cut it knowingly.
