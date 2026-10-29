# Report suite — design

Date: 2026-10-29 · Status: draft for approval

## Intent

Kosovo accountants judge an ERP by whether the reports they already produce every month come out of
it, in the layout ATK and their clients expect. A competitor's export (DOLCEZZA SH.P.K., 17 files,
Oct 2026) shows the set an accounting firm treats as table stakes. PAKO has about a third of it.
This work makes PAKO offer all of it, correct and reconciled.

The sample files are **layout and column specs only**. The accountant who produced them keyed
placeholder data; the figures are internally inconsistent and must not be used as expected values.
A final, real export is expected later and becomes the acceptance fixture for each report.

## Scope — 16 reports now, 3 stock reports deferred

| # | Report (SQ) | Status in PAKO | Work |
|---|---|---|---|
| 1 | Bilanci i gjendjes (Balance sheet) | exists | add comparative column vs prior year-end + difference |
| 2 | Bilanci i suksesit (P&L) | exists, period total only | add by-month columns, gross profit, below-the-line items |
| 3 | Gjendja e llogarive (Trial balance) | exists | none beyond new reconciliation checks |
| 4 | Libri i madh (General ledger) | missing | new: flat journal-line report, filter by account/partner/date, export |
| 5 | Rrjedha e keshit (Cash flow) | missing | new: from `Account.CashFlowCategory` (already on the entity) |
| 6 | Ekuiteti i pronarëve (Owners' equity) | missing | new: opening, profit, movements, closing |
| 7 | Deklarata TVSH (VAT return) | exists | none |
| 8 | Libri i shitjeve (Sales book) | exists | none |
| 9 | Libri i blerjeve (Purchase book) | exists | none |
| 10 | Libri i shpenzimeve (Expense book) | missing | new: one column per expense account, ATK-style |
| 11 | Sintetika e furnitorëve | missing | new: opening, debit, credit, balance, closing per vendor |
| 12 | Analitika e furnitorit | missing | new: statement for one vendor |
| 13 | Vjetërsia e borxheve | exists, receivables only | extend to payables (bills) |
| 14 | Blerjet sipas furnitorit | missing | new |
| 15 | Blerjet sipas artikujve | missing | new |
| 16 | Detajet e transaksioneve (furnitor) | missing | new: purchase lines with qty/price/VAT |
| 17-19 | Gjendja e artikujve (summary, complete, item card) | missing | DEFERRED with the inventory module |

## Inventory module — DEFERRED (decided 2026-10-29: stock and Normative come later)

Nothing in this section is built in this release. It is kept as the record of what the sample implies, so the later stock work starts from it.

PAKO has no stock today. `Item.cs` states quantities and valuation were "explicitly out of scope for
this release" and that `ItemType`/`DefaultInventoryAccountId` exist so stock could be added without a
data migration. This design reverses that scope decision. Behaviour observed in the sample, to be
confirmed against the real export:

- Perpetual inventory. Goods purchases and imports post to inventory accounts (materials 1000,
  products 1001 in the sample chart); a sale posts cost of goods sold (6000) against inventory at
  the item's current average cost, in the same journal entry as the revenue.
- Weighted-average costing.
- `Normative` items (recipes/BOM) relieve component stock when sold.
- Imports carry landed cost: customs, transport and similar are allocated across the import's lines
  by a uniform factor, so inventory cost exceeds invoice price.
- Reports: stock summary (qty, average cost, value, markup % against ex-VAT sell price), complete
  movement report (opening / in / out / closing, qty and value), and an item card (every movement
  for one item with running balance).

## Goals

- Every one of the 16 in-scope reports available in the web app and exportable to Excel in ATK/accountant
  column order, through the one shared writer the backend brief already calls for.
- Reports reconcile with each other and the app proves it (see below).
- Albanian and English labels for every report, added not renamed.

## Non-goals

- Mobile. Fiscal-bridge. OCR. Warehouses beyond a single default location (a location dimension is
  left for later unless the real export shows several).
- Reproducing the sample's numbers. They are wrong.

## Anti-goals

- A report that disagrees with another report. A balance sheet that does not balance, or a net
  profit that differs between statements, is a failure even if every report renders.
- Money math in controllers or the browser. It lives in the domain, per repo convention.

## Reconciliation checks (the differentiator)

Tests, and a visible "checks" panel on the Reports page, asserting for any period:

1. Balance sheet assets = liabilities + equity.
2. P&L net profit = balance-sheet current-earnings line = equity statement profit line.
3. Cash flow closing = cash + bank accounts on the balance sheet.
4. Sales and purchase books, summed, equal the VAT return boxes.
5. Trial balance debits = credits; vendor synthetic total = payables control account.

## Constraints from the repo

- Contract before implementation: records, stub controller, fixture JSON under
  `apps/web/src/mocks/`, NSwag client regenerated, all in one commit; then implementation.
- One EF migration per day, announced; rebase on `main` first. The in-scope reports are read-only
  and should need no migration; if one does, announce it.
- Tests run on real Postgres via `PostgresTestDatabase` (CLAUDE.md saying InMemory is stale).
- Period locks (`AccountingLockDate` / `TaxLockDate`) apply to anything that posts.
- `ReportsController` is 682 lines and the web `Reports.tsx` is one tabbed file; both split before
  they absorb 14 more reports.
- Parallel lanes: backend (`pako-backend`) and frontend (`pako-frontend`) work from the contract.

## Proposed phases (builder may reorder)

0. Housekeeping: split `ReportsController` and `Reports.tsx` by report; fix stale docs
   (`BACKEND_BRIEF.md` B10/B11 say things that no longer hold).
1. Reports on existing data: general ledger, monthly P&L, comparative balance sheet, cash flow,
   equity, expense book, reconciliation checks.
2. Payables: vendor synthetic/analytic, payables aging, purchases by vendor/item/transaction.
3. (Deferred) Inventory and the three stock reports, in a later release.

## Left to the builder

Exact record shapes, page/tab structure, export styling, how the checks panel is laid out, test
fixtures, ordering inside phases.

## Facts from the repo (builder check, answered)

- The sample has 19 reports: 1-16 are in scope, 17-19 (stock) are deferred.
- Sample files live in `~/Downloads/Raportet_*` (Oct 29 2026); the official ATK sales/purchase book
  templates are separate (`Libri-i-*-FINAL-MOSTRA*.xlsx`).
- Excel export already exists: ClosedXML is referenced in `Pako.Api`, and exports exist for the
  trial balance, P&L, balance sheet, VAT return and both books. New reports reuse that writer.
- Payments are allocated to specific bills (`Reconciliation.ForBill`), so payables aging is a query,
  not new allocation logic.
- `Account.CashFlowCategory` is defaulted per account type in the seed, so cash flow needs no
  backfill for seeded charts.
- Correction: tests already run on real Postgres (`PostgresTestDatabase`, compose Postgres on :5433), not InMemory; Testcontainers itself is not used. CLAUDE.md hazard 5 is stale.

## Calls made by the author (check these)

The first five bullets concern the deferred stock work and are recorded for later.

- Costing is weighted average; FIFO is out. Single stock location.
- Inventory posting is opt-in per company, so existing companies and documents are unaffected.
  Existing items start at zero quantity; opening stock enters through an opening-balance document.
- A sale that would take stock negative is allowed at the last known cost and listed in a
  "negative stock" exception report. It is not blocked.
- Landed cost is allocated across an import's lines by value. Modelled as a bill with extra cost
  lines, not a new document type.
- Comparative and by-month columns are computed live from the ledger, not from snapshots.
- ATK-official reports follow the official template exactly; the rest use the sample's columns and
  order, not its pixel layout.
- Inventory spans both lanes (item screens need quantity and cost).

## Decisions made by Erion

- Stock and Normative (recipes) are out of this release; they come later.
- Testcontainers: no change. Moot for this release; tests already use real Postgres.
