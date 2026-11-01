# Report suite reference

Branch `feat/report-suite`. All routes are `GET` under `api/companies/{companyId}/reports` unless
noted. Exports are `.xlsx`, language-aware (`Accept-Language`, `Export_*` keys in both resx files).
Samples are competitor files in `~/Downloads/Raportet_*` that each report was modelled on.
The stock module (`Inventory*`, purchase orders, price lists, lots, GRNI) is owned by another
developer, see `docs/INVENTORY_PLAN.md`. Only the stock reports listed below were added by the report
suite; they live in separate files (`StockMovementsReportController`, `StockReportExportsController`).

| Report | Route | Export route | Fed by | Modelled on |
| --- | --- | --- | --- | --- |
| General ledger | `general-ledger` | `general-ledger/export` | journal lines | `Raportet_Financa_Libri i Madh.xlsx` |
| Trial balance (period) | `api/companies/{id}/ledger/trial-balance?from&to` (whole-set sums: `ledger/trial-balance/totals`) | `ledger/trial-balance/export` | journal lines, opening/closing per account | `Raportet_Financa_Gjendja e Llogarive.xlsx` |
| P&L (period) | `profit-and-loss` | `profit-and-loss/export` | journal lines by account type; server `CostOfRevenue`/`GrossProfit`/`OperatingExpenses` (legacy `Expenses`/`TotalExpenses` still include cost of revenue) | `Raportet_Financa_Bilanci i suksesit.pdf` |
| P&L (monthly) | `profit-and-loss/monthly` | `profit-and-loss/monthly/export` | same, per month, with gross profit | `Raportet_Financa_Bilanci i suksesit.pdf` |
| Balance sheet | `balance-sheet` | `balance-sheet/export` | cumulative journal lines + synthetic current earnings | `Raportet_Financa_Bilanci i gjendjes.pdf` |
| Balance sheet (comparative) | `balance-sheet/comparative` | `balance-sheet/comparative/export` | two dates side by side | `Raportet_Financa_Bilanci i gjendjes.pdf` |
| Cash flow | `cash-flow` | `cash-flow/export` | lines by account `CashFlowCategory` | `Raportet_Financa_Rrjedha e Keshit.pdf` |
| Equity statement | `equity-statement` | `equity-statement/export` | opening equity, net result, closing | `Raportet_Financa_Ekuiteti i Pronarve.pdf` |
| Expense book | `expense-book` | `expense-book/export` | expense accounts (cost of revenue excluded) | `Raportet_Financa_ATK_Libri i Shpenzimeve.xlsx` |
| Sales book | `sales-book` | `sales-book/export` | tax-book rows (`TaxDefinition.AtkBook`) | `Raportet_Financa_ATK_Libri i Shitjeve.xlsx` (official template, kept cell-for-cell) |
| Purchase book | `purchase-book` | `purchase-book/export` | tax-book rows | `Raportet_Financa_ATK_Libri i Blerjeve.xlsx` (official template) |
| VAT declaration | `vat-declaration?year&month&carriedCredit&refundRequested` | `vat-declaration/export` | same tax-book rows as the books via `AtkBookMapper`; box [68] carried from the previous month (12-month lookback) | `Raportet_Financa_ATK_Deklarata TVSH-se.pdf` |
| VAT return (older) | `vat-return` | `vat-return/export` | output vs input VAT by tax definition | none |
| CIT add-back | `cit-addback` | none | `CitDeductibility` accounts | none |
| Vendor synthetic | `vendors/synthetic` | `vendors/synthetic/export` | partnered lines on payable accounts | `Raportet_Furnitor_sintetika e Furnitorve.xlsx` |
| Vendor statement | `vendors/{partnerId}/statement` | `vendors/{partnerId}/statement/export` | one partner's payable lines | `Raportet_Furnitor_Analitika Furnitorit_specifik(...).xlsx` |
| Payables aging | `payables-aging?asOf` | `payables-aging/export` | open bills; per-bill lines plus `VendorMatrix` and `TotalOutstanding` | `Raportet_Furnitor_Vjetersia e borxheve.xlsx` |
| Debt aging (receivables) | `debt-aging` | `debt-aging/export` (added) | receivable lines | none |
| Purchases by vendor | `purchases/by-vendor` | `purchases/by-vendor/export` | bill lines | `Raportet_Furnitor_Blerjet sipas Furnitorit.xlsx` |
| Purchases by item | `purchases/by-item` | `purchases/by-item/export` | bill lines | `Raportet_Furnitor_Blerjet sipas Artikujve.xlsx` |
| Purchase transactions | `purchases/transactions` | `purchases/transactions/export` | bill lines | `Raportet_Furnitor_Detajet e Transaksioneve.xlsx` |
| Stock movements | `stock/movements?from&to&search&categoryId&warehouseId&page&pageSize&sort` | `stock/movements/export` | per item: opening/in/out/closing qty and value, average cost, sell price ex VAT, markup %; paged, totals cover the whole set (`StockMovementsCalculator`) | `Raportet_Artikujt_*` (Komplet-style) |
| Stock levels | none (JSON is `inventory/stock`) | `stock/levels/export` | same filters as the levels page, plus `belowMinimum` | none |
| Stock valuation | none (JSON is `inventory/valuation`) | `stock/valuation/export?asOf` | stock value vs ledger value | none |
| Item card | none (JSON is `inventory/items/{itemId}/card`) | `stock/items/{itemId}/card/export?from&to` | one item's movements with running qty/cost/value | none |
| Reconciliation checks | `checks?from&to` | none | see below | none |

Web: `apps/web/src/pages/reports/`, fixtures in `apps/web/src/mocks/*.json`. Aging in the web has
both a per-bill view and a vendor-matrix view.

The seven checks below come back from `reports/checks`, tolerance 0.01.

## Checks (`reports/checks`, tolerance 0.01)

| Key | Compares |
| --- | --- |
| `balance-sheet-balances` | total assets vs liabilities + equity at `to` |
| `net-profit-consistent` | net income from period account sums vs net income by identity |
| `cash-flow-closes` | cash flow closing balance vs opening + computed result |
| `trial-balance-balances` | cumulative debit vs credit up to `to` |
| `books-match-vat-return` | output minus input VAT of the VAT return vs sales-book VAT minus purchase-book VAT. Informational on the web: reverse-charge purchases legitimately differ |
| `vendor-total-matches-payables` | payables control-account balance vs sum of per-vendor closing balances |
| `stock-total-matches-inventory-accounts` | stock valuation at `to` vs ledger balance of the inventory accounts; 0 vs 0 when the company has no tracked items |

On real data they need accounts with `CashFlowCategory`, tax definitions with `AtkBook`, and no
payable lines without a partner.

## Click-through

Clicking a report row opens the entity it represents. Row links are plain in-app routes built by
`apps/web/src/lib/entityLinks.ts`; the backend supplies the ids.

Backend: `ReportSourceResolver` (`Pako.Api/Services`) maps journal entries to a business document.
The kind constants are `ReportSourceKinds` (`Pako.Api/Contracts`): `Invoice`, `SalesReturn`, `Bill`,
`PurchaseReturn`, `PayrollRun`, `StockDocument`, `JournalEntry`. Invoice vs SalesReturn and Bill vs
PurchaseReturn follow the document type, the same rule as `SearchController`. Every lookup is scoped
to the company; an entry whose `SourceDocumentId` is not a document of that company (or of a type
above) falls back to `JournalEntry` with the entry's own id. Used by `GeneralLedgerReportController`,
`ExpenseBookController` and `VendorLedgerService`; the sales/purchase books, debt aging and purchase
transactions set the kind straight from the document type, and payables aging always uses `Bill`.

Fields added at the end of the report row records (all optional, default null):

| Record | Added |
| --- | --- |
| `GeneralLedgerLine` | `AccountId`, `SourceKind`, `SourceId` |
| `ExpenseBookRow` | `SourceKind`, `SourceId`, `PartnerId` |
| `VendorStatementRow` | `SourceKind`, `SourceId` |
| `PayablesAgingLine` | `SourceKind`, `SourceId` |
| `DebtAgingLine` | `SourceKind`, `SourceId` |
| `SalesBookLine` | `SourceKind`, `SourceId` |
| `PurchaseBookLine` | `SourceKind`, `SourceId` |
| `PurchaseTransactionLine` | `DocumentId`, `SourceKind`, `SourceId`, `PartnerId`, `ItemId` |

`ContractOpenApiSchemaTests` forbids a non-nullable struct with a default value in any
`Pako.Api.Contracts` record: it breaks `/openapi/v1.json`. `GeneralLedgerLine.AccountId` and
`PurchaseTransactionLine.DocumentId` had to be `Guid?` for that reason.

Web routes (`entityLinks.ts`):

| Helper / kind | Route |
| --- | --- |
| `entityPath` `Invoice` | `/invoicing/:id` |
| `entityPath` `SalesReturn` | `/sales-returns/:id` |
| `entityPath` `Bill` | `/bills/:id` |
| `entityPath` `PurchaseReturn` | `/purchase-returns/:id` |
| `entityPath` `PayrollRun` | `/payroll/:id` |
| `entityPath` `StockDocument` | `/stock-documents/:id` |
| `entityPath` `JournalEntry` | `/ledger?entry=:id` |
| `accountPath` | `/chart-of-accounts?open=:id` |
| `partnerPath(id, "customer")` / `"vendor"` / none | `/customers?open=:id` / `/vendors?open=:id` / `/partners?open=:id` |
| `itemPath` | `/items?open=:id` |
| `employeePath` | `/employees/:id` (helper exists, no report uses it yet) |
| `stockMoveSourcePath(sourceType, sourceId)` | stock move source 0 = `Bill`, 1 = `Invoice`, 2 = `StockDocument`, then `entityPath` |

Every helper returns `null` for a missing id or an unknown kind, and `null` means no link.

Components:

- `DataGrid` takes `getRowLink(row) => string | null` (never for group rows). `ReportGrid` takes
  `rowLink`, defaulting to `ReportRow.href`.
- `EntityLink` / `MaybeEntityLink` (`pages/reports/EntityLink.tsx`) are the secondary links inside a
  cell; they stop propagation so the row link does not fire as well.
- `LinkedRow` (`pages/reports/LinkedRow.tsx`) gives the same behaviour to the hand-written tables of
  the legacy tabs.
- Click semantics live in `components/data-grid/rowLink.ts`: click navigates; Ctrl/Cmd/Shift+click
  or middle click opens a new tab; Enter on the focused row navigates (Ctrl/Cmd+Enter opens a new
  tab). Clicks on inner `a`, `button`, `input`, `select`, `label`, `textarea` are ignored, and so is
  a click that ends a text selection. Rows without a link (totals, footer, section headers) are not
  focusable or clickable.

Deep links: `?open=<id>` opens the editor of that record on `/customers`, `/vendors`, `/partners`,
`/items` and `/chart-of-accounts`; `?entry=<id>` opens the read-only `JournalEntryDialog` on
`/ledger`. Both use `useOpenParam(name = "open")` (`apps/web/src/hooks`), which writes the param with
`replace`. The ledger dialog only finds entries in the list the page has loaded.

Legacy tabs (P&L, balance sheet, VAT return, sales book, purchase book, debt aging) keep their
period in the URL (`from`/`to`, `asOf`/`compareTo`) and run on their own when it is present
(`useAutoRun`), so back and a new tab land on the same report. The newer tabs derive their period
from the URL through `useReportPeriod`.

| Report (tab) | Row click opens | Secondary links in the row |
| --- | --- | --- |
| General ledger | source document, or the journal entry dialog (`entityPath` of `SourceKind`/`SourceId`) | account code and name (`accountPath`), partner (`partnerPath`, no side) |
| Trial balance (Ledger page) | account | none |
| P&L, balance sheet (legacy) | account | none |
| Monthly P&L, comparative balance sheet, cash flow, equity statement | account (line rows only) | none |
| Sales book, debt aging | invoice or sales return | customer |
| Purchase book | bill or purchase return | vendor |
| Expense book | source document or journal entry | vendor |
| Vendors (synthetic) | vendor | statement button in the row |
| Vendor statement drawer | source document or journal entry (opening and closing rows inert) | none |
| Payables aging, per bill | bill | vendor |
| Payables aging, vendor matrix | vendor | none |
| Purchases by vendor | vendor | none |
| Purchases by item | item (only when `ItemId` is set) | none |
| Purchase transactions | source document | vendor, item code |
| Stock movements, stock valuation by item | item | none |
| Item card (stock page and dialog) | stock move source: bill, invoice or stock document | none |
| VAT return lines, VAT declaration boxes, reconciliation checks, all totals and summary rows | no link | none |

Known limitations:

- Ctrl/Cmd+click opens a new tab that lands on `/login`: the app keeps its login in `sessionStorage`
  (`lib/auth-storage.ts`), which is per tab.
- Payment, settlement, reversal and loan entries have no business document id, so their rows open
  the journal entry dialog instead.
- The Vendors report row opens the vendor; the statement is the button inside the row.
- Item-card rows inside the item editor are not links (`ItemCardPanel linkRows={false}` in
  `pages/items/Items.tsx`), so a click cannot discard unsaved edits.
- The balance sheet's synthetic "Current Earnings" line has `AccountId = Guid.Empty`
  (`LedgerAggregator`); the web does not special-case it, so its row links to a non-existent account.
  Not verified in a browser.

## Known gaps

- VAT declaration boxes that always show 0 (no source data in PAKO): 10a, 20-23 (bad debt, sales),
  24-27 (adjustments up), 32, 39-42 (investment imports), 51-52 (farmers flat rate),
  53-56 (debit/credit notes), 57-60 (bad debt, purchases), 61-64 (adjustments down). Credit notes
  follow their VAT code instead (open ATK question). Box [6] contact name is blank (no Company field).
- VAT declaration is `.xlsx` only: no PDF form; box cells hold values, not live Excel formulas.
- VAT declaration carried credit [68] is computed from a 12-month lookback and assumes no refund was
  claimed in any earlier month; pass `carriedCredit` to override it.
- VAT declaration is always evaluated as VAT-registered, whatever the company's registration flag says.
- Partially deductible purchases (for example BV50) put only the deductible VAT on the deductible
  box. The amount is what was actually posted to the deductible repartition accounts (113xxx other
  than 113900) for that document and tax code, carried through `TaxBookRow.PostedDeductibleVat`;
  `AtkBookMapper.ToPurchaseAmount` falls back to round(VAT x deductible %) only when no posted split
  is available. The rest is non-reclaimable and sits in the non-deductible base box [33]/[34] with
  no VAT amount. Credit notes carry negative posted amounts. Box [67] therefore equals the debits on
  the deductible repartition accounts exactly, and TotalVatDeductible matches it.
- The ATK purchase book export has VAT formula columns (`AtkTaxBookWorkbook.cs`: S, AB and AC =
  deductible base x 18% / 8%). They read the deductible base boxes, so they follow the split, with
  cent-level formula rounding as in the official template; the declaration's VAT uses the posted
  amounts instead.
- The legacy `reports/vat-return` (`TaxReportService.VatReturnAsync`) and the JSON purchase book
  still count non-deductible input VAT (for example 113900 and 511200) in their VAT totals; neither
  is the deductible VAT. The VAT declaration is the correct figure for filing.
  `books-match-vat-return` compares like with like.
- Stock movements report with a warehouse filter: values follow each move's recorded value and
  revaluations are skipped, so a warehouse's closing value can differ from levels x current average.
- Stock JSON for levels, valuation and card is served by `InventoryController`; the exports read
  `StockReportDataService`, a copy of those queries. They can drift; tests assert they agree.
- Export routes return 400 on bad input (`[ProducesXlsx]` leaves error results as JSON).
- Balance sheet export has no account-group subtotals.
- General ledger lines of one document are not grouped.
- Legacy data keeps duplicate journal numbers (see `CLAUDE.md`, repo hazards).
- Albanian wording has not been reviewed by an accountant.
