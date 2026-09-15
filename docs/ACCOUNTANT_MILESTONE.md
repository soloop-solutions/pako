# One month, closed and filed — the plan of record

Planned 14 Sep 2026 against `main` @ d5b4f59. **Amended the same day after reading
`odoo/addons/account`** — see `ODOO_COMPARISON.md` for the rationale behind every change marked
*(Odoo)* below. Per-developer task lists: `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`.
Readable form: https://claude.ai/code/artifact/d3ff0b0b-d4af-400a-b50b-0c4f7cc13eaa

**Decisions taken.** Chart stays the ATK-aligned COA v2 (233 accounts). Scope is one full month:
enter, close, file. Team is **two developers split by layer** — one backend, one frontend, parallel.

## The acceptance script

One accountant, one company, one month, unaided:

1. Create a company with only a name; the 233-account chart seeds.
2. Shape the chart — add, rename, deactivate. *(impossible today)*
3. Enter partners with fiscal number, VAT status, terms, control account.
4. Enter items with code, unit, barcode, VAT code and three default accounts.
5. Invoice a month — gross-priced, numbered `01/2026`, cash taken at creation.
6. Take later bank payments; see who is past due date plus grace.
7. Post a manual journal entry carrying a partner and an analytic distribution.
8. Attach the scanned supplier invoice to its bill.
9. Close September, then be refused when editing a September invoice.
10. Export VAT return, purchase and sales books, trial balance, P&L, balance sheet to Excel.

## Already built and unreachable — read before estimating

`ValidatePartnerSubledgerReference` (require-partner on subledger accounts) · `IsControl`/
`IsPostable` guards, R02 and R04 · `CitDeductibility.Non` driving the CIT add-back report ·
`AccountingLockDate`/`TaxLockDate` enforced on every posting path with **no endpoint to set them** ·
`AccountResponse` returning 7 of ~20 `Account` fields. The first weeks are exposure, not construction.

## Phase 0 — week 1, both, blocking

Push Track A (12 unpushed commits) · rebase Track C onto it (~36 conflict hunks) · merge
`arnit-imp-1` · **do S0.5 Testcontainers** (198 tests still on EF InMemory; gapless numbering,
post-and-pay atomicity and the lock guard are all unprovable there) · commit the untracked
`V2_PARALLEL_TRACKS.md` · frontend lands its three libraries (grid, query, forms).

## Checkpoint 1 — weeks 2–4 — the accountant owns their chart

**Backend** — B1 account write API + full field exposure (R25, R26) · **B2 hierarchy by
code-prefix `AccountGroup`, membership derived, `ParentAccountId` untouched *(Odoo)*** · B3 cash-flow
classification · **B13 widen `AccountType` toward Odoo's 19, derive `IncludeInitialBalance`, add a
real current-year-earnings account *(Odoo, moved forward — it is account-model work)*** ·
**B4 sale/purchase/hard lock dates + `AccountLockException`, no period table *(Odoo)***.

**Frontend** — F1 grid foundation · F2 chart-of-accounts tree · F3 lock dates and exceptions in
settings · F4 business-list landing.

## Checkpoint 2 — weeks 5–8 — the registers become real

**Backend** — **B5 numbering derived from `max(number)` + partial unique index + retry, no counter
table *(Odoo)*** · B6 item register (goods/service/normative, no quantities) · B7 pagination and
search, target 35,000 items · B8 partner as subledger.

**Frontend** — F5 item register and item picker · F6 partner form · F7 numbering settings and
provisional preview · F8 retro-fit the grid onto every register.

## Checkpoint 3 — weeks 9–12 — the month can be filed

**Backend** — B9 journals per document type (stop hard-coding `JournalType.General`; this is what
blocks the books) · B10 purchase and sales books · B11 ClosedXML exports in ATK column order ·
B12 attachments (no `IFormFile` exists today; also the OCR prerequisite) · **B14 one
`AnalyticDistribution` JSON over analytic plans instead of project and employee columns *(Odoo)*** ·
**B15 hash chain over posted entries — `sha256(prev + record)` + gapless secure sequence *(Odoo,
new)***. If a week must be cut from this checkpoint, B15 is the item — cut it knowingly.

**Frontend** — F9 manual journal grid with the Excel keyboard model · F10 reports with exports ·
F11 attachments · F12 year-end and the analytic distribution editor.

## The contract between the lanes

A layer split leaves the frontend structurally one step behind. Three rules, about half a day per
capability for the backend developer:

1. **Contracts land before implementations** — endpoint, request/response records and a stub
   returning a realistic fixture, in their own commit, NSwag regenerated at that moment.
2. **Fixtures live in the repo** (`apps/web/src/mocks/`) — the web mock now, the test's expected
   payload later, so the two cannot drift.
3. **One migration per day, announced.**

The backend is the critical path in all three checkpoints. If a week slips, slip a frontend item.

## Frontend direction

Visual language is settled: Tailwind v4 + shadcn. The gap is machinery — no grid, no query layer,
no form layer. Recommended: TanStack Table + TanStack Query + react-hook-form/zod.
Inspiration is **Excel** for the keyboard model, Odoo and FINAbit for grid behaviour, Linear for
speed, Stripe for presenting money records, and QuickBooks Online and Xero for the invoice and
reconciliation screens specifically. ~30px rows and `tabular-nums`, not consumer-SaaS spacing.

## Out of scope

Stock quantities and valuation · imports IM4/IM7 and landed cost (FINAbit's class-8 clearing
accounts and the `4101` / `7100` revaluation pair — worth copying, after an ordinary month
validates) · SEF · OCR capture (B12 builds its storage) · POS, production, fixed assets,
construction, mobile · unifying `Invoice`/`Bill`/`JournalEntry` into one document model (the right
design, deliberately deferred — settle it before the next batch of document types is scoped).

## Decisions owed

- **blocks B6/F5** — item with no default accounts: company fallback, or refuse to save?
- **blocks F9** — what autofills the journal description: account name, header description, or the
  line above?
- **blocks B12/F11** — attachments on documents, partners, or both; is OCR expected in the same breath?
- **blocks F3** — who may grant a lock exception: owner only, or any firm member?
- **blocks B5** — D2 who may override an invoice number. *Recommended: company setting, off by
  default, plus owner role.*
- **blocks B5** — D3 existing `INV-0001` numbers. *Recommended: never renumber; seal the old series.*
- **blocks B10** — D4 does ATK accept "kthim i shitjes" as a nota kreditore? Ask the partner firm.

*Answered by the Odoo review and closed: whether the chart grows a tree (yes, by code prefix, no
header rows) and whether closing is chronological (yes — lock dates plus exceptions, not periods).*
