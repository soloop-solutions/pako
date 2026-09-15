---
paths:
  - "backend/**"
---

# Backend rules

These load when you touch `backend/`. The full task list with acceptance criteria is
`docs/BACKEND_BRIEF.md`; the operating manual is `docs/AI_BACKEND_AGENT.md`. Design rationale for
numbering, account hierarchy, period locking and dimensions is `docs/ODOO_COMPARISON.md`.

## Never

- Never put money arithmetic in a controller. It belongs in `DocumentLineCalculator` or
  `TaxComputationService`. A controller orchestrates.
- Never edit a migration that has already merged. Generate a new one.
- Never delete an account (R26 — deactivate once it has posted movement) and never edit an account
  `Code` in place (R25 — renumber through a versioned mapping).
- Never add a user-facing string without adding the key to **both** `Resources/ErrorMessages.resx`
  and `Resources/ErrorMessages.sq.resx`, resolved through `IStringLocalizer`. Add keys; never
  rename one.
- Never edit `apps/web/` source. The one exception is writing JSON fixtures into
  `apps/web/src/mocks/` as part of a contract commit.
- Never add a NuGet package without saying so in the commit body, and check it is not already
  referenced.

## Always

- **Contract commit first.** Request/response records in `Pako.Api/Contracts/`, the controller
  action returning a realistic fixture marked `// CONTRACT STUB — replaced in <task id>`, the same
  fixture as JSON at `apps/web/src/mocks/<endpoint>.json`, and `pnpm generate:api-client` run and
  its output committed alongside. Message: `contract(<task id>): <endpoint>`.
- **Name the posting rule in the test**: `Post_RefusesLineOnControlAccount_R04`.
- **Page every list endpoint** from task B7 onward: `?page=&pageSize=&search=&sort=` returning
  `{ items, total, page, pageSize }`.
- **Verify before claiming done**: `dotnet build backend/Pako.Api/Pako.Api.csproj` and
  `dotnet test backend/Pako.Tests/Pako.Tests.csproj`, with all 198+ pre-existing tests still green.

## Design decisions already made — do not re-derive these

- **Numbering is derived, not counted.** No counter table. Take the highest existing number for the
  prefix; serialise with a partial unique index (`WHERE State = Posted`); retry on unique violation
  inside a savepoint.
- **Account hierarchy is by code prefix.** `AccountGroup` with `CodePrefixStart`/`CodePrefixEnd`;
  membership is derived. Leave `Account.ParentAccountId` alone and do not synthesise header
  accounts.
- **Period closing is lock dates, not period rows.** Sale, purchase and an irreversible hard lock
  beside the two that exist, plus a per-user, reasoned, expiring `AccountLockException`.
- **One analytic distribution**, JSON, analytic account → percentage — not a column per dimension.
- **Unit is not a dimension.** A second business unit is a second `Company`.

## Stop and ask

An item with no default accounts (fallback or refuse); who may grant a lock exception; attachments
on documents/partners/both; whether ATK accepts a sales return as a nota kreditore; who may
override an invoice number. Do not guess — these change schemas.
