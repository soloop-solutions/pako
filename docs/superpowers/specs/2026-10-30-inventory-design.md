# Inventory (stock) module — design

Date: 2026-10-30 · Status: draft for approval · Supersedes the "Inventory module — DEFERRED" section
of `2026-10-29-report-suite-design.md`.

Calls the user already accepted (from that spec) are restated as **ACCEPTED**. Every judgement call
beyond them is marked **AUTHOR'S CALL**, so it can be checked. Every class, column, route or rule
that does not exist yet is marked *(new)*. Anything not marked new was read in the code at the path
given.

## 1. Intent

Kosovo accountants expect three stock reports: Gjendja e artikujve (summary), Komplet (complete
movement) and Kartela e artikullit (item card). PAKO cannot produce them, because it stores no
quantities and no costs. `backend/Pako.Domain/Companies/Item.cs` says so: `ItemType` and
`DefaultInventoryAccountId` exist "so a later stock feature has something to filter on without a
data migration", and nothing posts against them.

This design adds a perpetual, weighted-average stock ledger. Posting a goods document moves
quantity and value. The general ledger gets the matching inventory and cost-of-goods-sold lines in
the **same journal entry**, so the stock ledger and the inventory accounts reconcile by
construction. A report check proves it.

## 2. Goals, non-goals, anti-goals

**Goals**
- Purchases, imports with landed cost, sales, returns, vendor credit notes, opening stock and count
  adjustments move stock for `ItemType.Goods` items, on companies that opt in.
- COGS is posted at weighted-average cost in the sale's own journal entry.
- Four reports under `api/companies/{companyId}/reports/stock/...`, each with an Excel export: the
  three named above plus the negative-stock exception list (ACCEPTED).
- A new reconciliation check, `stock-total-matches-inventory-accounts`.

**Non-goals (this release)**
- Recipes/BOM. `ItemType.Normative` items stay untracked: they post exactly as they do today
  (revenue only, no COGS). §11 shows how BOM fits in later without rework.
- More than one stock location or warehouse (ACCEPTED). Lots, serials, expiry dates.
- FIFO (ACCEPTED: weighted average only). Standard cost.
- Unit-of-measure conversion. An item has one `Unit`.
- Goods receipts separate from bills (GRNI 120800 stays unused), goods in transit (120600), and
  customs DUD documents (R11/R12 still need their own document type).
- Landed cost arriving on a *separate* bill from a different vendor (see Question 1).

**Anti-goals**
- No retroactive re-costing that rewrites posted entries. Entries are immutable (R16), and
  `PakoDbContext.ValidateImmutability` refuses any change to a posted entry.
- No stock math in the browser. No stock math in controllers.
- No change to companies that have not opted in, or to any document posted before opt-in.

## 3. Data model

### 3.1 Opt-in flag (ACCEPTED: per company)

`Company.InventoryTrackingStartDate DateOnly?` *(new)*. Null means off. **AUTHOR'S CALL:** a date
rather than a bool. A goods line is stock-tracked when the company's start date is set **and** the
document's `IssueDate >= InventoryTrackingStartDate`. Documents dated earlier post as they always
have, even if they are posted after opt-in.

The flag is set through `PUT api/companies/{companyId}/inventory/settings` *(new)*, with the body
`{ trackingStartDate }` and the `AccessModule.Settings` write permission. The endpoint refuses when:
- the start date is on or before `AccountingLockDate` or `HardLockDate`;
- any posted invoice or bill dated on or after the start date already has a line whose item is
  `Goods` (otherwise that stock would be missing);
- the request clears or moves the date while `stock_movements` rows exist. Enabling is one-way once
  stock has moved.

On first enable, the endpoint also resolves the defaults in §3.2 by account code.

### 3.2 Account defaults

These go on `CompanyAccountDefaults` (`backend/Pako.Domain/Companies/CompanyAccountDefaults.cs`).
All of them are nullable `Guid?`, because older companies lack them. The opt-in endpoint fills them
by code, following the `EmployeeAdvancesAccountId` precedent ("resolved by code"). Codes are from
`backend/Pako.Localization.Xk/Data/PAKO_COA_v2_seed.csv`.

| New property | Code | Seed row | Profile |
|---|---|---|---|
| `InventoryAccountId` | 120100 Mallra për shitje / Goods for Sale | class 1, group 12, subledger ITEM | CORE |
| `CostOfGoodsSoldAccountId` | 500100 Kosto e mallrave të shitura | class 5, group 50, ITEM (AccountType `CostOfRevenue` per `AccountTypeDerivation`) | CORE |
| `InventoryShortageAccountId` | 520100 Diferenca inventari - mungesa | class 5, group 52, ITEM | CORE |
| `InventoryOverageAccountId` | 520200 Diferenca inventari - teprica | class 5, group 52, ITEM, normal credit | CORE |
| `LandedCostAbsorbedAccountId` | 510900 Klering i kostos së zhdoganimit (contra) | class 5, group 51 | IMPORT only |

The first four are CORE accounts, so they always exist on a v2 chart. If any of them is missing
(for example on the legacy Stage-0 chart, whose 5000 COGS sits in `DefaultChartOfAccountsTemplate`),
opt-in is refused.

**Per-item inventory account:** `Item.DefaultInventoryAccountId ?? defaults.InventoryAccountId`. On
tracked companies, `ItemsController.ValidateDefaultAccounts` additionally requires it to be class 1,
group 12. Today `apps/web/src/pages/items/Items.tsx` filters the picker to `CurrentAsset`, which is
looser.

**AUTHOR'S CALL:** COGS always goes to the company default in v1. `Item.DefaultExpenseAccountId` is
not reused for COGS, because existing items may hold 661200 there. A per-item COGS override can come
later as its own column.

### 3.3 Item additions

- `Item.ItemGroup string?` *(new, max 100)*. The summary report needs a "group" column, and `Item`
  has no grouping field today. **AUTHOR'S CALL:** free text, not a new entity. It is filterable by
  exact match.
- **Guard:** `ItemsController.Update` refuses to change `Type` away from `Goods` while the item has
  stock movements.

### 3.4 `stock_movements` *(new)* — the stock ledger, insert-only

| Column | Type | Notes |
|---|---|---|
| `Id` | uuid PK | |
| `CompanyId`, `ItemId` | uuid FK | |
| `Sequence` | bigint | per item, from `item_stocks.LastSequence + 1`; costing order |
| `Date` | date | document `IssueDate`; reporting order |
| `MovementType` | int enum `StockMovementType` *(new)* | `Opening, Purchase, Import, PurchaseReturn, PurchaseCreditNote, Sale, SalesReturn, AdjustmentIn, AdjustmentOut, Revaluation` (append-only, never reorder — same rule as `DocumentType`) |
| `SourceDocumentType` | int enum `StockSourceType` *(new)* | `Invoice, Bill, StockDocument` |
| `SourceDocumentId`, `SourceLineId` | uuid | the document and line that caused the movement |
| `JournalEntryId` | uuid FK | the entry carrying its GL lines |
| `PartnerId` | uuid? | for the item card's counterparty column |
| `DocumentNumber` | text? | snapshot: `InvoiceNumber`, `VendorReference` or the stock document number |
| `InventoryAccountId` | uuid | the account its value hit; used by the reconciliation check |
| `QuantityIn`, `QuantityOut` | numeric(18,4) | both ≥ 0, never both > 0 (same spirit as R30/R31) |
| `UnitCost` | numeric(18,6) | cost stamped at posting |
| `ValueIn`, `ValueOut` | numeric(18,2) | both ≥ 0; equal the GL inventory line amounts exactly |
| `LandedCostValue` | numeric(18,2) | part of `ValueIn` that came from capitalised cost lines |
| `SaleNetAmount`, `SaleGrossAmount` | numeric(18,2)? | sales and sales returns only; from `DocumentLineResult.NetAmount/Gross` |
| `QuantityAfter`, `ValueAfter` | numeric | item totals after this movement, in sequence order |
| `WentNegative` | bool | `QuantityAfter < 0` on an outbound movement |
| `ReversesMovementId` | uuid? | stock-document reversals only |
| `CreatedAt` | timestamptz | |

**Indexes:**
- unique `(ItemId, Sequence)`
- `(CompanyId, ItemId, Date, Sequence)` for the item card and per-date sums
- `(CompanyId, Date)`
- `(SourceDocumentId)` and `(JournalEntryId)`
- partial `(CompanyId, ItemId) WHERE "WentNegative"`

`SourceLineId` is **not** unique. That is deliberate, for BOM (§11).

**Check constraints:** non-negative quantities and values, and
`NOT ("QuantityIn" > 0 AND "QuantityOut" > 0)`.

Add `StockMovement` to `PakoDbContext.ValidateImmutability` so any Modified or Deleted row throws,
the same backstop that protects `JournalEntryLine`.

### 3.5 `item_stocks` *(new)* — per-item running state, the lock target

| Column | Type | Notes |
|---|---|---|
| `ItemId` | uuid PK, FK | |
| `CompanyId` | uuid | |
| `Quantity` | numeric(18,4) | may be negative (ACCEPTED) |
| `Value` | numeric(18,2) | may be negative while quantity is negative |
| `AverageCost` | numeric(18,6) | last positive-stock average; this is the "last known cost" |
| `LastSequence` | bigint | |
| `UpdatedAt` | timestamptz | |

**Invariant:** for every item, `Quantity` and `Value` equal Σ(in − out) over its movements. This is
how quantity and value are derived and kept consistent. Both are written in the same
`SaveChangesAsync` as the movement and the journal entry, under the row lock in §6. A test asserts
the invariant after each scenario. The row is created lazily with
`INSERT … ON CONFLICT ("ItemId") DO NOTHING`, so items start at zero (ACCEPTED). Nothing is
backfilled.

### 3.6 `stock_documents` + `stock_document_lines` *(new)*

These carry opening stock (ACCEPTED: an opening-balance document) and count adjustments.

**`StockDocument`:**
- `Id`, `CompanyId`, `Kind` (`Opening`, `Adjustment`)
- `Number`, from `NumberSeriesService.ReserveNextAsync(companyId, "StockDocument", date)`
- `Date`, `State` (`Draft`, `Posted`, `Reversed`)
- `OffsetAccountId` (Opening only), `JournalEntryId`, `ReversalOfId?`, `Notes`

**`StockDocumentLine`:**
- `Id`, `StockDocumentId`, `ItemId`
- `Quantity` (> 0)
- `Direction` (`In`/`Out`; Opening is always `In`)
- `UnitCost?` (required for Opening; for AdjustmentIn, required only when the item has no
  `AverageCost`)

It posts to the `JournalType.General` journal via `JournalResolver.GetAsync`.

### 3.7 Other column additions

- `JournalEntryLine.ItemId uuid?` *(new)*. Set on every generated inventory and COGS line, so the
  ITEM-subledger accounts (120100, 500100, 52x) carry their item reference (R03). The GL report can
  then filter by item. `HashChain.CanonicalRecord` hashes only AccountId/Debit/Credit, so existing
  hashes are unaffected.
- `BillLine.CapitalizeToStock bool` *(new, default false)*. Marks a landed-cost line (§4.2).

## 4. Posting behaviour

The domain calculator `Pako.Domain/Inventory/StockValuation.cs` *(new, pure, no EF)* takes the
current `ItemStock` state and one requested movement. It returns the movement, the new state and
the extra journal lines. All rounding is `MidpointRounding.AwayFromZero` to 2dp, matching
`TaxComputationService`.

The orchestration lives in `Pako.Api/Services/StockPostingService.cs` *(new)*. It locks rows, calls
the calculator, adds the movements and returns the lines. It is called from
`InvoicesController.PostDraftInvoiceAsync` and `BillsController.PostDraftBillAsync`, the shared
paths behind Post, Create-and-post and Create-with-payment, so every entry point is covered.

**AUTHOR'S CALL:** `Invoice.Post` and `Bill.Post` gain an optional
`IReadOnlyList<JournalEntryLine> extraLines` parameter. The extra lines join the entry **before**
`journalEntry.Post(company)`, so the balance check, the lock dates and R30/R31 apply to the whole
entry.

**`PostPreview`** (`BillsController.PostPreview`, `InvoicesController.PostPreview`) calls the same
calculator against an unlocked read of `item_stocks` and writes nothing.

**Common rules (outbound):**
- cost = `round(qty × AverageCost, 2)`;
- if `qty == Quantity` on hand, `ValueOut = Value`, so a residue never strands value at zero
  quantity (**AUTHOR'S CALL**);
- if the movement takes quantity below zero, it is still allowed: the shortfall is costed at
  `AverageCost` (0 if the item was never bought) and `WentNegative = true` is set (ACCEPTED).

**Common rules (inbound):** `AverageCost = Value / Quantity` is recomputed only while
`Quantity > 0` after the movement.

| Document (existing type) | Stock effect | Journal lines added or changed (same entry) |
|---|---|---|
| Bill, `DocumentType.Bill`, Goods line | Purchase in: qty, value = line net | The line's net account is forced to the item's inventory account. `ExpenseAccountId` stores it; an explicit different account is refused with 400. Dr 120100 (ItemId) / VAT per repartition / Cr payable (partner override wins, `Partner.PayableAccountId`) |
| Bill with `CapitalizeToStock` lines (*Import*) | Each goods line's `ValueIn` += its allocated share | The cost line still posts Dr 51xxxx at net (VAT as normal). Plus Dr 120100 (per goods line, ItemId) / Cr 510900, totalling the capitalised net. Group 51 nets to zero inside the entry, which satisfies R13 |
| Bill, goods line into negative stock | Purchase in, then a `Revaluation` row | Settle the negative quantity at the new unit cost. Δ = (new cost − old cost) × negative qty → Dr 500100 / Cr 120100 (or the reverse) |
| `DocumentType.PurchaseReturn` (requires `OriginalBillId`, already enforced) | Out: qty at the **return line's net unit price** | Existing reversal gives Dr payable / Cr 120100 (net) / Cr VAT. If that leaves quantity 0 with value ≠ 0, the residue goes Dr/Cr 500100 vs 120100 |
| Bill `DocumentType.CreditNote`, Goods line | `PurchaseCreditNote`: value-only, qty 0 | Net to Cr 120100 for the on-hand share `min(onHand, lineQty)/lineQty`; the rest to Cr 500100. **AUTHOR'S CALL** (price reductions land on the stock still held) |
| Invoice, `DocumentType.Invoice`, Goods line | Sale out at average cost | Revenue/VAT/AR unchanged, plus Dr 500100 / Cr item inventory account, both with ItemId |
| `DocumentType.SalesReturn` (requires `OriginalInvoiceId`, already enforced) | In at the **original sale's** quantity-weighted `UnitCost` for that item | Dr 120100 / Cr 500100, added to the existing reversal |
| Invoice `CreditNote`, `DebitNote`, `DownPayment` | none | Unchanged. Price corrections do not move goods. `Proforma` never posts (existing rule) |
| StockDocument Opening | In at the entered unit cost | Dr 120100 / Cr `OffsetAccountId` (required; UI default 109900 Suspense) |
| StockDocument Adjustment | Out at average cost / In at average cost | Shortage: Dr 520100 / Cr 120100. Overage: Dr 120100 / Cr 520200 |

**Opening offset, AUTHOR'S CALL.** The suspense default works because R06 already says 109900 must
be zero before a period closes. That forces the accountant to clear it against the GL opening entry
rather than double-count inventory. When the GL opening already carries 120100, the reconciliation
check stays red until this is done.

**Landed-cost allocation (ACCEPTED: by value).**
- Base: the goods lines' net amounts.
- Share: each line gets `round(total × lineNet / ΣlineNet, 2)`; the last goods line takes the
  remainder.
- Validation:
  - a `CapitalizeToStock` line must be on a class-5, group-51 account;
  - the company must have `LandedCostAbsorbedAccountId`, i.e. the IMPORT profile;
  - the bill must contain at least one tracked goods line.
- **AUTHOR'S CALL:** a bill with any capitalised line gets `MovementType.Import` on its goods
  movements. It shows as "Import" on the item card.

### 4.1 Worked examples (one item unless stated; values ex-VAT; inventory = 120100, COGS = 500100)

| # | Event | Movement | Journal lines (stock part) | Qty / Value / Avg after |
|---|---|---|---|---|
| 1 | Buy 10 @ 5 | Purchase in 10, 50.00 | Dr 120100 50.00 (+VAT) / Cr 200100 | 10 / 50.00 / 5.000000 |
| 2 | Buy 10 @ 7 | Purchase in 10, 70.00 | Dr 120100 70.00 / Cr 200100 | 20 / 120.00 / 6.000000 |
| 3 | Sell 4 @ 10 | Sale out 4 × 6 = 24.00 | Dr 500100 24.00 / Cr 120100 24.00 (+ revenue 40, VAT, AR) | 16 / 96.00 / 6.000000 |
| 4 | Customer returns 2 of sale #3 | SalesReturn in 2 × 6 = 12.00 | Dr 120100 12.00 / Cr 500100 12.00 | 18 / 108.00 / 6.000000 |
| 5 | Return 2 of bill #2 to vendor | PurchaseReturn out 2 × 7 = 14.00 | Dr 200100 / Cr 120100 14.00 (+VAT) | 16 / 94.00 / 5.875000 |
| 6 | Import: A 10 × 20 = 200, B 5 × 60 = 300; freight 510500 net 50, duty 510100 net 25, both capitalised | A in 230.00 (landed 30), B in 345.00 (landed 45) | Dr 120100 200 (A), 300 (B); Dr 510500 50, Dr 510100 25; Dr 120100 30 (A), 45 (B) / Cr 510900 75; Cr 200100 gross. Group 51: 50+25−75 = 0 | A unit cost 23.000000, B 69.000000 |
| 7 | Item C: 2 on hand, 12.00, avg 6. Sell 5 | Sale out 5 × 6 = 30.00, WentNegative | Dr 500100 30.00 / Cr 120100 30.00 | −3 / −18.00 / 6.000000 (last known) |
| 8 | Then buy 10 @ 8 = 80 | Purchase in 80.00 + Revaluation: −3 × (8 − 6) = −6.00 | Dr 120100 80.00 / Cr 200100; Dr 500100 6.00 / Cr 120100 6.00 | 7 / 56.00 / 8.000000 |
| 9 | Item D: 3 on hand, 10.00 (avg 3.333333). Sell 3 | Sale out 10.00 (whole value, not 9.99) | Dr 500100 10.00 / Cr 120100 10.00 | 0 / 0.00 / 3.333333 |
| 10 | Vendor credit 1.00/unit on 10 units of an item with 4 on hand | PurchaseCreditNote value-out 4.00 | Cr 120100 4.00, Cr 500100 6.00 / Dr 200100 (+VAT) | qty unchanged, value −4.00 |

**Negative stock, then a purchase: decided, AUTHOR'S CALL.** The later purchase *does* correct the
cost, through the `Revaluation` row in example 8. The correction is posted in the **purchase's**
entry and period, not back-dated to the sale. Without it, the 6.00 under-costing would stay in the
inventory value and leak into later sales at a wrong 8.57 average. Odoo's AVCO posts the same kind
of correction. The original sale's entry is never touched (R16).

### 4.2 Posting rules — interaction and new numbers

Existing rules: R01–R28 come from the `60_Posting_Rules` sheet in
`docs/coa-v2/PAKO_Plani_Kontabel_v2.xlsx`. R30 and R31 are PAKO additions in `JournalEntry.Post`.
**R29 is unused.** **AUTHOR'S CALL:** leave R29 unused rather than fill the gap, and start at
**R32**.

| Rule | Severity | What |
|---|---|---|
| R32 *(new)* | AUTO | On a tracked company, a goods line posts its net to the item's inventory account, and a sale posts Dr COGS / Cr inventory at weighted-average cost in the same entry |
| R33 *(new)* | BLOCK | On a tracked company, no manual journal line may hit an account that any stock movement has used as `InventoryAccountId`, or any class-1 group-12 ITEM account. Enforced next to R04's `IsControl` guard in `JournalEntriesController`. Use a stock document instead |
| R34 *(new)* | BLOCK | `JournalEntriesController.Reverse` refuses an entry that has `stock_movements`. Today it reverses any posted entry, including an invoice's, which would desync stock. Correct through a return, or reverse the stock document |
| R35 *(new)* | WARN | A movement that takes quantity below zero posts and is listed in the negative-stock report |

**Existing rules that interact:**
- **R08:** IN codes are allowed on class 1, so a purchase line on 120100 passes.
- **R09:** untouched.
- **R13:** satisfied by construction.
- **R14:** trivially true for same-bill allocation; it starts to matter only with Question 1.
- **R16:** the reason re-costing is never retroactive.
- **R23 and the `JournalSequencer` gap:** unchanged.
- **R28:** `SourceDocumentId` and `PostedByUserId` are already set on these entries.

## 5. Back-dated documents and period locks

- **Lock dates.** Stock lines live inside the document's own entry, so the existing locks apply
  unchanged:
  - `SaleLockDate` (`Invoice.Post`) and `PurchaseLockDate` (`Bill.Post`);
  - `AccountingLockDate`, `TaxLockDate` and `HardLockDate` inside `JournalEntry.Post`, via the
    caller's effective company from `AccountLockService.GetEffectiveCompanyAsync`;
  - lock exceptions work as today.
  - Stock documents are General-journal entries: Accounting and Hard locks apply; Sale and Purchase
    locks do not. COGS and inventory lines carry no `TaxId`, so `TaxLockDate` never blocks a stock
    document.
- **Back-dating is allowed (AUTHOR'S CALL)** inside the open period. Costing follows posting
  `Sequence`, not date. A bill entered late does not re-cost sales already posted with a later date.
  - Why: firms routinely key bills weeks late, and the alternative (forward re-costing) would have
    to amend immutable, possibly hash-secured (`JournalsController.Secure`) entries.
  - What is still exact: quantity and value as of any date, because both the GL and the stock
    ledger sum by the same document date with identical amounts. The reconciliation check holds on
    every date.
  - What can differ from a strictly chronological re-cost: only the unit cost stamped on an
    individual sale.
- **Refused:** any posting dated before `InventoryTrackingStartDate` is simply untracked, not
  refused. A stock document dated before the start date is refused.

## 6. Concurrency

Two simultaneous sales of the same item are serialised by a Postgres row lock on that item's
`item_stocks` row:
1. inside the posting transaction, `StockPostingService` runs the `INSERT … ON CONFLICT DO NOTHING`
   for each tracked item;
2. then it runs
   `SELECT "ItemId" FROM item_stocks WHERE "ItemId" = ANY({ids}) ORDER BY "ItemId" FOR UPDATE`
   through `ExecuteSqlInterpolatedAsync`, the pattern `BillsController` already uses on `bills` and
   `journal_entry_lines`;
3. it re-reads the rows after locking.

Sorting by `ItemId` prevents deadlocks between multi-item documents. `item_stocks` is always the
last lock taken:
- invoices: company row, then partner row, then item_stocks (`InvoicesController.Post` already
  locks the first two);
- purchase returns: original bill row, then item_stocks;
- bills and stock documents: item_stocks only.

This keeps the lock order acyclic. Every caller of `PostDraftInvoiceAsync`/`PostDraftBillAsync`
already opens a transaction when `SupportsRowLocking()` is true.

**AUTHOR'S CALL:** `BillsController.Post` needs no company lock. The item lock is what matters.

## 7. Item types

- `Goods` is tracked.
- `Service` is never tracked.
- `Normative` is untracked for now: it posts revenue only, with no COGS and no component relief, and
  is excluded from every stock report.
- Free-text lines (`ItemId == null`) are never tracked.

## 8. Edits and reversals

- **Drafts** move nothing. Edit and Discard behave as today.
- **Posted invoices and bills** are immutable apart from DueDate/InternalNotes
  (`InvoicesController.EditPosted`/`BillsController.EditPosted`), which have no stock effect.
  Neither document has a cancel path (`Cancelled` is never set in `Pako.Api`), so a stock
  correction is a SalesReturn, a PurchaseReturn or a stock adjustment.
- **Stock documents** get `POST …/stock-documents/{id}/reverse` *(new)*. It writes mirror movements
  at the **original** unit costs (`ReversesMovementId`), calls `JournalEntry.Reverse`, and sets
  `State = Reversed`. It is subject to lock dates.

## 9. Reports

All four live in `StockReportsController` *(new)* with `[Route("api/companies/{companyId:guid}/reports")]`,
`[RequireCompanyAccess(module: AccessModule.Reports)]`, and the same 403 for `IsPartnerRestricted`
used by `ReportChecksController`. The calculators go in `Pako.Domain/Reporting/` *(new: `StockSummary`,
`StockMovementSummary`, `ItemCard`)*. Each report has an `/export` twin built with
`ExcelExportService.BuildWorkbook`, with `[Produces(ExcelExportService.XlsxContentType)]`, as in
`PayablesReportsController`. All of them return 400 `ReportDateRangeInvalid` when `from > to`, and
409 `InventoryNotEnabled` *(new key)* on untracked companies.

**Conventions:**
- Quantities and values are shown positive in their In/Out columns.
- Closing and running quantity/value may be negative.
- Periods are inclusive `from..to` on movement `Date`.
- Opening means `Date < from`.
- Paging is `?page=&pageSize=&search=&sort=` returning `PaginatedResponse<T>`, as in
  `GeneralLedgerReportController` (clamp 1–200). Totals are computed over the whole filtered set,
  not the page.

1. **`GET reports/stock/summary`** (Gjendja e artikujve)
   - Parameters: `asOf`, `type`, `group`, `search`, `includeZero=false`, paging.
   - Columns: Code, Name, Type, Group, Unit, Quantity, AverageCost, Value, SellPriceNet, MarkupPercent.
   - AverageCost = `Value/Quantity` when Quantity > 0, else the item's last known cost.
   - SellPriceNet = `Item.DefaultUnitPrice` with VAT backed out through
     `TaxComputationService.ComputeFromGross` and `DefaultTaxDefinitionId` (Question 2).
   - MarkupPercent = `(SellPriceNet − AverageCost) / AverageCost × 100` to 2dp; null when the cost
     is 0 or there is no price.
   - Footer: total Value.
2. **`GET reports/stock/movements`** (Komplet)
   - Parameters: `from`, `to`, `type`, `group`, `search`, `includeZero=false`, paging.
   - Columns per item: OpeningQty, OpeningValue, QtyIn, ValueIn, QtyOut, ValueOut, ClosingQty,
     ClosingAvgCost, ClosingValue, SellPriceNet, SalesValue (Σ `SaleGrossAmount`), SalesValueNet
     ("vlera pa TVSH", Σ `SaleNetAmount`).
   - Header totals: period OpeningValue, ValueIn, ValueOut, ClosingValue.
   - **AUTHOR'S CALL:** "VAT-free value out" is read as the net sales value. Confirm against the
     real export.
3. **`GET reports/stock/items/{itemId}/card`** (Kartela e artikullit)
   - Parameters: `from`, `to`, paging.
   - An opening row first. Then movements in `(Date, Sequence)` order, with columns: MovementType
     label (Import, Faturë Blerje, Faturë Shitje, Kthim…), Partner, DocumentNumber, Date, QtyIn,
     QtyOut, UnitCost, ValueIn, ValueOut, SellPriceNet (`SaleNetAmount / QtyOut`), SellValue,
     RunningQty, RunningValue.
   - Running balances are cumulative in date order from the stored values. A page's first running
     balance is seeded by a SUM over the earlier rows.
4. **`GET reports/stock/negative`** (ACCEPTED exception list)
   - Parameter: `asOf`.
   - Columns: items with Quantity < 0, plus the movements with `WentNegative`: Code, Name,
     Quantity, Value, LastKnownCost, first negative Date, DocumentNumber.

**Reconciliation check `stock-total-matches-inventory-accounts`:** added in
`ReportChecksController.Checks` only for tracked companies. Expected = the GL balance (Σ debit −
credit to `to`, via `LedgerAggregator.SumsByAccountAsync(companyId, null, to)`) of the distinct
`InventoryAccountId`s in `stock_movements`. Actual = Σ(`ValueIn − ValueOut`) of movements with
`Date <= to`. The comparison uses `ReportReconciler.Equal`. Labels:
`reports.checksLabel.stock-total-matches-inventory-accounts` in EN and SQ.

## 10. Web changes (frontend lane)

- **Items** (`apps/web/src/pages/items/Items.tsx`, `ItemForm.tsx`):
  - read-only Quantity, AverageCost and Value columns, from new `ItemResponse` fields
    `quantityOnHand`, `averageCost`, `stockValue` (null when untracked; the API computes them, the
    browser never does);
  - an ItemGroup field;
  - the inventory-account picker narrowed to group 12 on tracked companies;
  - a link to the item card.
- **Reports** (`apps/web/src/pages/reports/ReportsPage.tsx`): tabs `stock-summary`,
  `stock-movements`, `stock-negative`, shown only when tracked. The item card opens as a drawer,
  like `VendorStatementDrawer.tsx`. Each tab follows the `use*Report.ts` hook +
  `useReportExport.ts` pattern, keeps filters in URL params, and renders in `ReportGrid`.
- **Settings** (`apps/web/src/pages/Settings.tsx`): an `InventorySettings` card *(new)*, next to
  `LockDatesSettings`, with the start-date picker. It warns that the setting is irreversible once
  stock moves.
- **Documents:** a "Kosto" (capitalise) checkbox on bill lines; Opening/Adjustment stock-document
  screens; posting-preview rows already render whatever lines the API returns.
- **Strings:** EN and SQ in `apps/web/src/i18n/messages.ts`; backend messages in both
  `ErrorMessages.resx` and `ErrorMessages.sq.resx`. Add keys, never rename.

## 11. Designed-in room for recipes/BOM (later)

- A future `ItemComponent(ItemId, ComponentItemId, Quantity)` table explodes a Normative sale line
  into one `Sale` movement **per component**, each with the same `SourceLineId` and its own
  `ItemId`. That is why `SourceLineId` is not unique.
- The COGS lines are already per movement, with an ItemId each.
- `StockValuation` already takes a list of requested movements per document.
- No schema in this release changes for BOM; only `ItemComponent` and a branch in
  `StockPostingService` are added later.

## 12. Migration plan

Follow the one-migration-per-day rule: announce the migration, rebase on `main` first, and never
hand-edit `PakoDbContextModelSnapshot.cs`. The latest migration on `main` is
`20261030152329_AddPlatformAuditLog` (before it: `20261030135004_AddPlatformAdministration` and
`20261030122941_AddDashboardLayouts`).

**AUTHOR'S CALL:** the **entire schema goes in one additive, inert migration, `AddInventory`**, in
phase 1. It covers:
- `Company.InventoryTrackingStartDate`;
- the 5 `CompanyAccountDefaults` columns;
- `Item.ItemGroup`, `JournalEntryLine.ItemId`, `BillLine.CapitalizeToStock`;
- the `item_stocks`, `stock_movements`, `stock_documents` and `stock_document_lines` tables, with
  their indexes and check constraints.

It does no data backfill. Later phases then need no migration and cannot collide with other lanes'
snapshot changes. If a gap is found later, it gets a new migration on a later day, never an edit to
`AddInventory`.

## 13. Test strategy

Tests run on real Postgres via `PostgresTestDatabase.CreateAsync`. For concurrency, use
`PostgresTestDatabase.CreateAdditionalContext` with `Task.WhenAll`, as `InvoicesControllerTests`
already does. Each test names its rule. Proposed tests:
- `StockValuation_*`: pure domain tests, one per row of §4.1, asserting the exact figures.
- `Post_DebitsInventoryForGoodsLine_R32`, `Post_RelievesInventoryAtAverageCost_R32`,
  `Post_ClearsResidueWhenQuantityReachesZero_R32`.
- `Post_CapitalisesLandedCostByValue_R13` (asserts group 51 nets to 0),
  `Post_RefusesCapitalisedLineOffGroup51`.
- `Post_AllowsNegativeStockAndFlagsIt_R35`, `Post_RevaluesNegativeStockOnNextPurchase_R32`.
- `Post_SalesReturnRestoresOriginalCost_R32`, `Post_PurchaseReturnRelievesAtReturnPrice_R32`,
  `Post_VendorCreditNoteSplitsOnHandShare_R32`.
- `Post_RefusesManualLineOnInventoryAccount_R33`, `Reverse_RefusesEntryWithStockMovements_R34`.
- `Post_UntrackedBeforeStartDate`, `Post_ServiceAndNormativeLinesMoveNoStock`,
  `Post_RefusedInsideSaleLockDate_StockUnchanged`.
- `ConcurrentSalesOfSameItem_AreSerialised` (two contexts, final qty/value exact, unique
  `(ItemId, Sequence)` never violated).
- `ItemStock_EqualsSumOfMovements` (invariant after every scenario),
  `StockMovement_IsImmutable`.
- `EnableInventory_RefusesWhenGoodsAlreadyPostedAfterStart`, `EnableInventory_IsOneWayOnceMoved`.
- `Checks_StockTotalMatchesInventoryAccounts`, plus one test per report endpoint and export. The
  contract fixture becomes the expected payload.
- Gate: all pre-existing tests stay green, and `dotnet build`/`dotnet test` and
  `pnpm --filter web typecheck lint test build` pass.

## 14. Phasing (each phase ships independently)

1. **Schema + opt-in** (backend). Covers the `AddInventory` migration, the settings endpoint,
   default resolution, the item guard and `ItemGroup`. Nothing posts yet. Ship gate: existing tests
   green.
2. **Purchases and imports** (backend). Covers `StockValuation`, `StockPostingService`, the
   item_stocks locks, bill goods lines, landed cost, negative-stock revaluation, R32/R33/R34, and
   PostPreview.
3. **Sales/COGS** (backend). Covers invoice goods lines and negative stock (R35).
4. **Returns, credit notes, opening and adjustment stock documents** (backend). Includes reversal.
5. **Reports contract** (backend). Contract records in `Pako.Api/Contracts/`, stub actions marked
   `// CONTRACT STUB — replaced in <task id>`, JSON fixtures `apps/web/src/mocks/stock-summary.json`,
   `stock-movements.json`, `stock-item-card.json`, `stock-negative.json`, the updated
   `report-checks.json`, the `ItemResponse` stock fields, and `pnpm generate:api-client`, all in one
   `contract(...)` commit. This can land right after phase 1, so the web lane starts early.
6. **Reports implementation** (backend). Calculators, exports and the reconciliation check.
7. **Web** (frontend lane, starting against the phase-5 fixtures). Items columns, settings card,
   bill-line checkbox, stock-document screens, report tabs and item-card drawer.

## 15. Risks

- **Non-chronological costing** can surprise an accountant who expects a back-dated bill to re-cost
  later sales. Mitigation: documented here and on the item card ("cost as posted").
- **GL opening balances already holding 120100** produce a double count until the 109900 offset is
  cleared. The check flags it.
- **Landed cost on one bill with one partner:** customs duty and broker fees are usually owed to
  other parties (Question 1).
- **Item-level locking puts throughput under contention** for very hot items. That is acceptable for
  SME volumes.
- **Hidden posting paths.** Every place that calls `Invoice.Post`/`Bill.Post` must go through the
  service. The builder greps for these, and the test above guards it.
- `DefaultUnitPrice` VAT semantics are not defined anywhere in the code (Question 2).

## 16. Left to the builder

- Exact record shapes and enum label keys.
- Fixture contents.
- Excel column styling.
- Stock-document numbering pattern (`NumberSeriesService.DefaultPattern` entry).
- Whether `StockValuation` returns one result per line or per document.
- UI layout of the stock-document screen.
- Ordering inside each phase.

## Questions only Erion can answer

1. **Landed cost from other vendors.** Customs duty (Dogana) and the forwarder normally invoice
   separately from the supplier. The accepted call keeps them on the goods bill as extra lines,
   under one partner and one payable. *Recommended:* ship same-bill lines in v1 as accepted, then
   add a "landed-cost bill" that references the goods bill (`OriginalBillId`, allocating to stock
   still on hand per R14) as the next increment. If firms will not use v1 without it, it moves into
   phase 2.
2. **Is `Item.DefaultUnitPrice` VAT-inclusive?** The markup % in both stock reports depends on the
   answer. *Recommended:* treat it as VAT-inclusive, matching the `PriceMode.GrossInclusive`
   default, and relabel the field "Çmimi me TVSH".
3. **Can a back-dated bill skip re-costing sales already posted?** (§5) *Recommended:* yes,
   posting-order average with no retroactive re-cost. The alternative needs amending immutable
   entries.
4. **Opening-stock offset account.** *Recommended:* the user picks it, defaulting to 109900
   Suspense, cleared against the GL opening entry. The alternative is to post opening stock with no
   GL effect at all, assuming 120100 already came in with the GL opening.

## Decisions made by Erion (2026-10-30)

- Landed cost v1: customs/forwarder charges are extra lines on the goods bill (one supplier, one payable), allocated across the bill's goods lines by value. A separate landed-cost bill that references the goods bill is the next step, not v1.
- `Item.DefaultUnitPrice` is VAT-inclusive; the field is relabelled "Çmimi me TVSH" (EN "Price incl. VAT"); markup % is computed against the price excluding VAT.
- Back-dated purchase bills do not re-cost sales already posted: cost follows posting order; posted entries are never amended.
- Opening stock is offset against 109900 Suspense by default; the accountant may choose another account on the opening-stock document and clears 109900 against the general-ledger opening entry.

## Builder-check resolutions (author's calls — please check)

1. A Goods item on a tracked company with no inventory account of its own posts to the company default inventory account (CompanyAccountDefaults, filled with 120100 when tracking is switched on). Posting is never refused for that reason, and saving an item without default accounts is still never refused.
2. On a tracked company a Goods bill line posts to the inventory account whatever expense account is stored on the line. The stored field is not overwritten and not refused; the posting preview shows the account that will actually post. Revisit if accountants object.
3. A return whose original document predates `InventoryTrackingStartDate` is allowed. A sales return with no recorded unit cost on the original is restored at the item's current average cost; a purchase return is costed at its own price, as designed.
4. R34 already refuses reversing any journal entry that carries stock movements. Reversing a stock document (opening stock, count adjustment) is refused when it would drive any item's quantity negative.
5. R33 (no manual lines on inventory accounts) applies only to entries dated on or after `InventoryTrackingStartDate`, so an existing general-ledger opening entry on 120100 dated before it, and the 109900 clearing flow, stay possible.
6. Enabling tracking checks only POSTED goods documents dated on or after the start date. Drafts dated after the start date are left alone and post as tracked when posted, which is intended.
7. `Invoice.Post` and `Bill.Post` gain an optional extra-lines parameter (signature change on domain methods). Every caller, including both `PostPreview` actions, must pass the same lines so preview and real posting cannot differ; existing tests that call `Post` directly keep compiling because the parameter is optional.
8. The R-number gap claim (R29 unused, R32-R35 free) comes from the posting-rules spreadsheet and must be re-verified by the builder against docs and code before use.
