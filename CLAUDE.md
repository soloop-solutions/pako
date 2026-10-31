# PAKO

Accounting and ERP platform for Kosovo SMEs and accounting firms, by Soloop. Competing with
FINAbit, Kubit, ProData and Bilanci under ATK's SEF regime (AI MF 01/2026).

<!-- Keep this file short. It loads into every session. Detail belongs in docs/ (read on demand)
     or .claude/rules/ (loads only when Claude touches matching files). -->

## Stack

- **Backend** `backend/` — ASP.NET Core / .NET 10, EF Core, Npgsql, self-hosted Postgres.
  Projects: `Pako.Api`, `Pako.Domain`, `Pako.Infrastructure`, `Pako.Localization.Xk`, `Pako.Tests`.
  **There is no `.sln`** — target `.csproj` files directly.
- **Web** `apps/web/` — Vite 7, React 19, TypeScript 5.9, Tailwind v4, shadcn/ui, react-intl,
  react-router 7.
- **Mobile** `apps/mobile/` — Expo Router + React Native. Out of scope for current work.
- **Shared** `packages/shared/` — Zod schemas and the **generated** NSwag API client at
  `packages/shared/src/generated/api-client.ts`. Never hand-edit it.
- Turborepo + **pnpm 10**. `fiscal-bridge/` is legacy PEF hardware-printer code, not in scope.

## Commands

```bash
pnpm install
docker compose -f backend/docker-compose.yml up -d   # Postgres on :5433

dotnet build backend/Pako.Api/Pako.Api.csproj
dotnet test  backend/Pako.Tests/Pako.Tests.csproj

pnpm generate:api-client        # after any API contract change; commit the result
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
pnpm --filter web build
```

## Repo hazards — read before your first commit

1. **`git status` lies.** ~348 files show as modified; `git diff --ignore-all-space --stat` is
   empty. It is pure CRLF line-ending churn. **Never `git add -A` or `git add .`** — stage files by
   name, and check `git diff --cached --ignore-all-space --stat` before every commit.
2. **`docs/BUILD_LOG.md` is history, not documentation.** It is the old 184 KB CLAUDE.md: a dated
   build journal through 2026-09-08. Read it for *why*, never for *what the code is now*.
3. **Read code before trusting any document**, this one included.
4. **Branch state (as of 2026-09-14):** Track A is merged into `main`. Track C is complete but
   unmerged on `origin/track-c/price-payment-debt` and conflicts with Track A (~36 hunks).
   `origin/arnit-imp-1` holds Albanian terminology fixes, unmerged.
5. **Tests run on real Postgres** via `backend/Pako.Tests/PostgresTestDatabase.cs` (compose Postgres
   on :5433; override with `PAKO_TEST_POSTGRES_CONNECTION`). The compose Postgres defaults
   (64MB shm, max_connections=100) make the full suite flaky. `backend/docker-compose.yml` now sets
   `shm_size: 256mb`; it only applies after `docker compose -f backend/docker-compose.yml up -d`.
   For a reliable full run use a throwaway container:
   `docker run -d --name pako-test-pg --shm-size=512m -e POSTGRES_PASSWORD=postgres -p 5434:5432 postgres:16-alpine -c max_connections=300`,
   create database `pako_dev`, then
   `PAKO_TEST_POSTGRES_CONNECTION="Host=localhost;Port=5434;Database=pako_dev;Username=postgres;Password=postgres"`.
6. **Regenerating the API client:** port 5248 (the nswag input) is often held by another worktree's
   API. Run the API on another port (e.g. 5398) against a scratch database, run the nswag command
   from `packages/shared/package.json` with that input URL, then restore the default baseUrl
   `http://127.0.0.1:5248/` in the generated file, stop the API by PID, drop the scratch DB.
7. **Journal numbering bug (fixed):** journals loaded `AsNoTracking` never saved their counter, so
   older data has many entries sharing `SAL-0001`/`PUR-0001` and bank/settlement entries with no
   number. Posted entries are immutable and hash-chained, so they were **not** renumbered.
   Migration `20261031140000_RepairJournalSequenceCounters` only lifts counters past the highest
   suffix found.
8. **Long test runs fail when the laptop sleeps.** Use a plain `dotnet test` and re-run failures
   alone before assuming a regression.

## Things that already exist and are easy to rebuild by mistake

- `PostingRuleValidator.ValidatePartnerSubledgerReference` — refuses a manual journal line on a
  partner-subledger account with no partner.
- `IsControl` / `IsPostable` guards in `JournalEntriesController` (posting rules R02, R04).
- `CitDeductibility.Non` — already drives the CIT add-back report.
- `Company.AccountingLockDate` / `TaxLockDate` — enforced on invoices, bills, journal entries and
  payroll. **No endpoint sets them**; `CompaniesController` has one write method.
- `Account` carries ~20 fields; `AccountResponse` returns 7.
- **Report suite** under `api/companies/{companyId}/reports` (most with an Excel `/export`): general
  ledger, monthly P&L, comparative balance sheet, cash flow, equity statement, expense book, VAT
  declaration in the ATK form (boxes 1-72, from the same rows as the ATK sales/purchase books),
  vendor synthetic and statement, payables aging (bill lines plus by-vendor matrix), purchases by
  vendor / item / transactions, and `reports/checks` (seven reconciliation checks, the seventh is stock valuation vs inventory accounts).
  Trial balance with a period is `ledger/trial-balance` (`/totals` for whole-set sums). Plus the older P&L, balance sheet, VAT return, books,
  CIT add-back and debt aging. Reference: `docs/REPORTS.md`.
- **Stock reports** under `reports/stock` (ours, additive): period `movements` (+ `/export`) and the
  exports `levels/export`, `valuation/export`, `items/{itemId}/card/export`. Web: Reports > Stock
  movements tab, Export buttons on the stock pages. `StockReportDataService` duplicates the JSON
  queries of `InventoryController`; tests assert the two agree, so change both together.
- The stock module itself (`Inventory*`, purchase orders, price lists, lots, GRNI) is owned by another
  developer and merged into this branch; plan in `docs/INVENTORY_PLAN.md`. Do not rework it from here.
- Report money math: pure calculators in `Pako.Domain/Reporting`; shared services
  `LedgerAggregator`, `TaxReportService`, `VendorLedgerService`, `ExportLabels` in
  `Pako.Api/Services`. Controllers only orchestrate.

## Conventions

- **Money math lives in the domain** (`DocumentLineCalculator`, `TaxComputationService`), never in
  a controller and never in the browser.
- **Posting rules are R-numbered** (`60_Posting_Rules`). Name the rule in the test:
  `Post_RefusesLineOnControlAccount_R04`.
- **Localization is additive.** Backend strings go in `Resources/ErrorMessages.resx` *and*
  `.sq.resx`; web strings go in `apps/web/src/i18n/messages.ts` in EN and SQ. **Add keys; never
  rename or delete one.**
- **One EF migration per day, announced.** Rebase on `main` before generating. Never edit a merged
  migration — model snapshots do not merge.
- **Accounts are deactivated, never deleted** (R26), and account codes are never edited in place
  (R25).

## Report suite conventions

- Exports are language-aware: labels come from `ExportLabels` (`Export_*` keys in both resx files),
  chosen by `Accept-Language`; the web sends it (`apps/web/src/api/client.ts`). Enum cell values
  (document type, journal, aging bucket) are translated under `sq`.
- Export actions carry `[ProducesXlsx]`; errors on export routes return 400 JSON, not a file.
- `reports/checks` needs real-data setup to pass: accounts with `CashFlowCategory`, tax definitions
  with `AtkBook`, no payable lines without a partner. The opening-balance-clearing account `390100`
  resolves to Operating for cash flow. `books-match-vat-return` is informational on the web:
  reverse-charge purchases legitimately differ.
- Contract changes: additive where possible; where a shape changed it was announced and the client
  regenerated in the same commit.

## Where the plan lives

Read these on demand — they are not loaded automatically.

| File | What |
| --- | --- |
| `docs/ACCOUNTANT_MILESTONE.md` | Plan of record: "one month, closed and filed", 12 weeks, 3 checkpoints |
| `docs/BACKEND_BRIEF.md` | Backend lane — tasks B1–B15 with acceptance criteria |
| `docs/FRONTEND_BRIEF.md` | Frontend lane — tasks F1–F12 with acceptance criteria |
| `docs/AI_BACKEND_AGENT.md` | Full operating manual for an agent working the backend lane |
| `docs/AI_FRONTEND_AGENT.md` | Full operating manual for an agent working the frontend lane |
| `docs/ODOO_COMPARISON.md` | Why numbering, account hierarchy, period locking and dimensions are designed the way they are |
| `docs/ARCHITECTURE.md` | Module breakdown (current as of 2026-09-08) |
| `docs/V2_PARALLEL_TRACKS.md` | The previous release plan — Tracks A/B/C |
| `docs/BUILD_LOG.md` | Archive. History only. |

Lane-specific rules load automatically when you touch `backend/` or `apps/web/` — see
`.claude/rules/`.

## Working in parallel

Two developers, split by layer. The API is the contract between them:

1. **Contract before implementation.** Records + a stub controller returning a realistic fixture,
   merged in their own commit, with the fixture saved as JSON at `apps/web/src/mocks/` and the
   NSwag client regenerated in the same commit.
2. The fixture becomes the web mock now and the test's expected payload later.
3. Never change a response shape after its contract commit without saying so explicitly.

## Stop and ask — open decisions

- Attachments on documents, partners, or both; is OCR expected in the same breath? *(F11 built
  document-level attachments only, fully mocked pending a real backend — see feat/fe-mvp.)*
- Who may override an invoice number, and what happens to documents already numbered `INV-0001`?
- Does ATK accept a sales return as a nota kreditore? (needs the partner accounting firm)

## Frontend-lane decisions made (worth confirming, not silently final)

Made on `feat/fe-mvp` where `ACCOUNTANT_MILESTONE.md`/`FRONTEND_BRIEF.md` gave no house
recommendation — each documented with its reasoning in the relevant commit, not picked silently:

- **Item saved with no default accounts**: the form falls through to the existing company-default
  behavior for that field (same as "no item selected"), never refuses the save.
- **Manual journal line description autofill**: defaults to the *previous line's* description —
  `FRONTEND_BRIEF.md` names a specific person to consult on this one ("ask Adonis from what"), so
  treat this as a default awaiting explicit sign-off, not settled.
- **Lock exception grantor**: gated the same way `MembersPanel.tsx` already gates admin-only
  actions (`FirmAdmin`/`ClientAdmin`, excluding `FirmAccountant`) — no narrower role model exists
  in this repo to draw a tighter line.
