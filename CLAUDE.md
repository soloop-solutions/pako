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
5. **Tests still run on EF InMemory** (13 call sites). Moving them to Testcontainers is Phase 0 of
   the current plan; until then, any test involving a unique index, trigger, transaction or row
   lock proves nothing.

## Things that already exist and are easy to rebuild by mistake

- `PostingRuleValidator.ValidatePartnerSubledgerReference` — refuses a manual journal line on a
  partner-subledger account with no partner.
- `IsControl` / `IsPostable` guards in `JournalEntriesController` (posting rules R02, R04).
- `CitDeductibility.Non` — already drives the CIT add-back report.
- `Company.AccountingLockDate` / `TaxLockDate` — enforced on invoices, bills, journal entries and
  payroll. **No endpoint sets them**; `CompaniesController` has one write method.
- `Account` carries ~20 fields; `AccountResponse` returns 7.

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

- An item saved with no default accounts: company fallback, or refuse the save?
- What autofills a manual journal line's description?
- Who may grant a lock exception — owner only, or any firm member?
- Attachments on documents, partners, or both; is OCR expected in the same breath?
- Who may override an invoice number, and what happens to documents already numbered `INV-0001`?
- Does ATK accept a sales return as a nota kreditore? (needs the partner accounting firm)
