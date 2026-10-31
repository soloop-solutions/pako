# Report suite reference

Branch `feat/report-suite`. All routes are `GET` under `api/companies/{companyId}/reports` unless
noted. Exports are `.xlsx`, language-aware (`Accept-Language`, `Export_*` keys in both resx files).
Samples are competitor files in `~/Downloads/Raportet_*` that each report was modelled on.
Stock reports (`Raportet_Artikujt_*`) belong to the inventory module owned by another developer on
`main`; they are not covered here.

| Report | Route | Export route | Fed by | Modelled on |
| --- | --- | --- | --- | --- |
| General ledger | `general-ledger` | `general-ledger/export` | journal lines | `Raportet_Financa_Libri i Madh.xlsx` |
| Trial balance (period) | `api/companies/{id}/ledger/trial-balance?from&to` | `ledger/trial-balance/export` | journal lines, opening/closing per account | `Raportet_Financa_Gjendja e Llogarive.xlsx` |
| P&L (period) | `profit-and-loss` | `profit-and-loss/export` | journal lines by account type; server gross profit | `Raportet_Financa_Bilanci i suksesit.pdf` |
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
| Payables aging | `payables-aging?asOf` | `payables-aging/export` | open bills; per-bill lines plus `VendorMatrix` | `Raportet_Furnitor_Vjetersia e borxheve.xlsx` |
| Debt aging (receivables) | `debt-aging` | `debt-aging/export` | receivable lines | none |
| Purchases by vendor | `purchases/by-vendor` | `purchases/by-vendor/export` | bill lines | `Raportet_Furnitor_Blerjet sipas Furnitorit.xlsx` |
| Purchases by item | `purchases/by-item` | `purchases/by-item/export` | bill lines | `Raportet_Furnitor_Blerjet sipas Artikujve.xlsx` |
| Purchase transactions | `purchases/transactions` | `purchases/transactions/export` | bill lines | `Raportet_Furnitor_Detajet e Transaksioneve.xlsx` |
| Reconciliation checks | `checks?from&to` | none | see below | none |

Web: `apps/web/src/pages/reports/`, fixtures in `apps/web/src/mocks/*.json`. Aging in the web has
both a per-bill view and a vendor-matrix view.

## Checks (`reports/checks`, tolerance 0.01)

| Key | Compares |
| --- | --- |
| `balance-sheet-balances` | total assets vs liabilities + equity at `to` |
| `net-profit-consistent` | net income from period account sums vs net income by identity |
| `cash-flow-closes` | cash flow closing balance vs opening + computed result |
| `trial-balance-balances` | cumulative debit vs credit up to `to` |
| `books-match-vat-return` | output minus input VAT of the VAT return vs sales-book VAT minus purchase-book VAT. Informational on the web: reverse-charge purchases legitimately differ |
| `vendor-total-matches-payables` | payables control-account balance vs sum of per-vendor closing balances |

On real data they need accounts with `CashFlowCategory`, tax definitions with `AtkBook`, and no
payable lines without a partner.

## Known gaps

- VAT declaration boxes that always show 0 (no source data in PAKO): 10a, 20-23 (bad debt, sales),
  24-27 (adjustments up), 32, 39-42 (investment imports), 51-52 (farmers flat rate),
  53-56 (debit/credit notes), 57-60 (bad debt, purchases), 61-64 (adjustments down). Credit notes
  follow their VAT code instead (open ATK question). Box [6] contact name is blank (no Company field).
- VAT declaration is `.xlsx` only: no PDF form; box cells hold values, not live Excel formulas.
- Balance sheet export has no account-group subtotals.
- General ledger lines of one document are not grouped.
- Legacy data keeps duplicate journal numbers (see `CLAUDE.md`, repo hazards).
- Albanian wording has not been reviewed by an accountant.
