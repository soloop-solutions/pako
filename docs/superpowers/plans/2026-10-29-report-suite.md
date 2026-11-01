# Report Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 12 missing accountant reports (and extend 2 existing ones) so PAKO offers all 16 in-scope reports from the spec, each exportable to Excel, with cross-report reconciliation checks.

**Architecture:** New reports are read-only endpoints under `api/companies/{companyId}/reports`, in new controllers (not the 682-line `ReportsController`). Money math lives in pure static classes in `Pako.Domain/Reporting/`. A shared `LedgerAggregator` service is extracted from `ReportsController` so old and new controllers use one source of sums. Each phase lands a contract commit first (records, stub controller returning a fixture, JSON fixture, regenerated NSwag client), then implementation, then the web page.

**Tech Stack:** ASP.NET Core / .NET 10, EF Core + Npgsql, xUnit on real Postgres (`PostgresTestDatabase`, compose Postgres on :5433), ClosedXML via `ExcelExportService`, React 19 + react-intl + shadcn, NSwag client in `packages/shared`.

**Spec:** `docs/superpowers/specs/2026-10-29-report-suite-design.md`

## Global Constraints

- No `.sln`: build `dotnet build backend/Pako.Api/Pako.Api.csproj`, test `dotnet test backend/Pako.Tests/Pako.Tests.csproj`.
- Never `git add -A` / `git add .` (CRLF churn). Stage by name; run `git diff --cached --ignore-all-space --stat` before each commit.
- Never hand-edit `packages/shared/src/generated/api-client.ts`; run `pnpm generate:api-client` (API running on :5248) and commit the result in the same commit as the contract.
- Never change a response shape after its contract commit without saying so. Extensions are NEW endpoints, not edits to existing records.
- Money math in the domain, never a controller or the browser.
- Localization is additive: backend strings in `Resources/ErrorMessages.resx` AND `.sq.resx`; web strings in `apps/web/src/i18n/messages.ts` EN and SQ. Add keys; never rename or delete.
- Every report endpoint: `[RequireCompanyAccess(module: AccessModule.Reports)]` and returns `ReportNotAvailableForScopedUser()` (403) when `_access.IsPartnerRestricted`, except per-document reports already filtered by `VisibleTo(_access)`.
- Only `JournalEntryState.Posted` entries count. Test names state the rule/check, e.g. `Check2_NetProfitAgreesAcrossStatements`.
- No code comments except a non-obvious data table. Commit messages short, no Co-Authored-By.
- Sample files in `~/Downloads/Raportet_*` are layout specs only; their numbers are wrong. Do not copy figures into tests.
- Stock reports (spec 17-19), inventory and Normative items are out of scope.

## Review Focus

- Empty ledger / company with no postings: every new report returns empty lists and zero totals, never 500s, and exports a header-only workbook.
- `from > to`, or a range crossing a fiscal year: 400 with a localized message, not an empty report.
- Partner with no name, a manual journal line with null `PartnerId`, a reversed/cancelled posting: appears in general ledger and nets correctly in vendor balances.
- Credit-balance vendors (advances, vendor owes us) in vendor synthetic and aging: shown with sign, not dropped; totals still equal the control account.
- Partner-restricted user: general ledger and statements return 403; vendor reports only show visible partners.

---

## Phase 0 — Housekeeping

### Task 1: Extract `LedgerAggregator`

**Files:**
- Create: `backend/Pako.Api/Services/LedgerAggregator.cs`
- Modify: `backend/Pako.Api/Controllers/ReportsController.cs:651-682` (remove `SumsByAccountAsync`, `NetIncome`; delegate), `backend/Pako.Api/Program.cs` (register scoped)
- Test: `backend/Pako.Tests/ReportsControllerTests.cs` (existing tests must stay green)

**Interfaces:**
- Produces:
  ```csharp
  public record AccountSums(Account Account, decimal Debit, decimal Credit);
  public class LedgerAggregator(PakoDbContext db)
  {
      Task<List<AccountSums>> SumsByAccountAsync(Guid companyId, DateOnly? from, DateOnly to);
      static decimal NetIncome(IEnumerable<AccountSums> sums);
  }
  ```

- [ ] **Step 1:** Run `dotnet test backend/Pako.Tests/Pako.Tests.csproj --filter ReportsControllerTests`; record that it passes (baseline).
- [ ] **Step 2:** Implement `LedgerAggregator` by moving the two private methods verbatim (same query, same `Posted` and date filters), returning `AccountSums` instead of the tuple.
- [ ] **Step 3:** Inject it into `ReportsController` and replace all call sites (lines 50, 99, 556 and `NetIncome` uses); update the tuple deconstruction to the record.
- [ ] **Step 4:** Re-run the filter above. Expected: same pass count as Step 1.
- [ ] **Step 5:** Commit `refactor: extract LedgerAggregator from ReportsController`.

### Task 2: Correct stale docs

**Files:** Modify `CLAUDE.md` (hazard 5), `docs/BACKEND_BRIEF.md` (B10, B11), `backend/Pako.Domain/Reporting/README.md`.

- [ ] **Step 1:** In `CLAUDE.md` hazard 5, replace the InMemory claim with: tests run on real Postgres via `PostgresTestDatabase` (compose, :5433); `UseInMemoryDatabase` appears only in a comment. Verify first with `grep -rn UseInMemoryDatabase backend/Pako.Tests`.
- [ ] **Step 2:** In `BACKEND_BRIEF.md` B10/B11, note the books, ClosedXML and the shared writer (`ExcelExportService`, `AtkTaxBookWorkbook`) already exist.
- [ ] **Step 3:** Replace the "Not built this pass" README with one line listing the classes added by this plan (fill in as tasks land).
- [ ] **Step 4:** Commit `docs: correct stale test and export notes`.

---

## Phase 1 — Reports on existing data

### Task 3: Phase 1 contract commit

**Files:**
- Modify: `backend/Pako.Api/Contracts/ReportContracts.cs`
- Create: `backend/Pako.Api/Controllers/StatementReportsController.cs` (stubs), `apps/web/src/mocks/fixtures/{general-ledger,pnl-monthly,balance-sheet-comparative,cash-flow,equity-statement,expense-book,report-checks}.json`
- Regenerate: `packages/shared/src/generated/api-client.ts`

**Interfaces — Produces** (all in `Pako.Api.Contracts`; routes under `api/companies/{companyId}/reports`):
```csharp
record GeneralLedgerLine(Guid EntryId, string? EntryNumber, DateOnly Date, string? Reference, string AccountCode,
    string AccountName, Guid? PartnerId, string? PartnerName, string? Description, decimal Debit, decimal Credit);
// GET general-ledger?from&to&accountId?&partnerId?&page=1&pageSize=50 -> existing paged shape { items,total,page,pageSize } (ItemContracts.cs:45)
// GET general-ledger/export?from&to&accountId?&partnerId? -> xlsx, all rows

record MonthlyReportLine(Guid AccountId, string AccountCode, string AccountName, List<decimal> Months, decimal Total); // Months.Count == 12
record MonthlyProfitAndLossResponse(int Year, List<MonthlyReportLine> Income, List<MonthlyReportLine> CostOfRevenue,
    List<MonthlyReportLine> Expenses, List<decimal> GrossProfitByMonth, List<decimal> NetIncomeByMonth, decimal GrossProfit, decimal NetIncome);
// GET profit-and-loss/monthly?year= ; GET profit-and-loss/monthly/export?year=

record ComparativeLine(Guid AccountId, string AccountCode, string AccountName, decimal Current, decimal Prior, decimal Difference);
record BalanceSheetComparativeResponse(DateOnly AsOf, DateOnly CompareTo, List<ComparativeLine> Assets,
    List<ComparativeLine> Liabilities, List<ComparativeLine> Equity, decimal TotalAssets, decimal TotalLiabilitiesAndEquity);
// GET balance-sheet/comparative?asOf=&compareTo= ; .../export

record CashFlowLine(Guid AccountId, string AccountCode, string AccountName, decimal Amount);
record CashFlowResponse(DateOnly From, DateOnly To, decimal OpeningCash, decimal NetIncome, List<CashFlowLine> Operating,
    List<CashFlowLine> Investing, List<CashFlowLine> Financing, decimal NetChange, decimal ClosingCash, decimal Difference);
// GET cash-flow?from&to ; export

record EquityMovementLine(Guid AccountId, string AccountCode, string AccountName, decimal Amount);
record EquityStatementResponse(DateOnly From, DateOnly To, decimal OpeningEquity, decimal NetIncome,
    List<EquityMovementLine> Movements, decimal ClosingEquity);
// GET equity-statement?from&to ; export

record ExpenseBookRow(Guid EntryId, DateOnly Date, string? DocumentNumber, string? PartnerName, List<decimal> Amounts, decimal Total);
record ExpenseBookResponse(DateOnly From, DateOnly To, List<ExpenseBookColumn> Columns, List<ExpenseBookRow> Rows, List<decimal> ColumnTotals);
record ExpenseBookColumn(Guid AccountId, string AccountCode, string AccountName);
// GET expense-book?from&to ; export

record ReportCheck(string Key, bool Passed, decimal Expected, decimal Actual);
record ReportChecksResponse(DateOnly From, DateOnly To, List<ReportCheck> Checks);
// GET checks?from&to
```
Stubs return the matching fixture content. `ExpenseBookRow.Amounts` is aligned index-for-index with `Columns`.

- [ ] **Step 1:** Add records and stub actions (each stub deserializes nothing; returns a hand-built instance matching its fixture).
- [ ] **Step 2:** Hand-write each fixture JSON with realistic, internally consistent values (assets = liabilities + equity; cash-flow `Difference` 0).
- [ ] **Step 3:** `dotnet build backend/Pako.Api/Pako.Api.csproj`; run the API; `pnpm generate:api-client`; `pnpm --filter web typecheck`. Expected: all pass.
- [ ] **Step 4:** Commit contract, stubs, fixtures and regenerated client together: `feat(contract): phase 1 report endpoints`.

### Task 4: General ledger

**Files:** Create `backend/Pako.Api/Controllers/GeneralLedgerReportController.cs` (replaces the stub action); Test `backend/Pako.Tests/GeneralLedgerReportTests.cs`.

**Interfaces:** Consumes `GeneralLedgerLine`, `LedgerAggregator` (not needed; direct query), `ExcelExportService.BuildWorkbook(string, IReadOnlyList<string>, IReadOnlyList<IReadOnlyList<object?>>)`. Produces the two endpoints from Task 3.

- [ ] **Step 1:** Write failing tests: `GeneralLedger_ReturnsOnlyPostedLinesInRange`, `GeneralLedger_FiltersByAccountAndPartner`, `GeneralLedger_PagesWithTotal`, `GeneralLedger_ForbiddenForPartnerRestrictedUser`, `GeneralLedger_Export_IncludesAllRowsIgnoringPaging`, `GeneralLedger_FromAfterTo_Returns400`. Seed via the helpers in `ReportsControllerTests.SeedMixedScenario` (copy the pattern; do not reuse the private method).
- [ ] **Step 2:** Run `--filter GeneralLedgerReportTests`; expected FAIL.
- [ ] **Step 3:** Implement: query `JournalEntryLines` joined to entry/account/partner, order by `Date`, `SecureSequenceNumber`, then line order; `EntryNumber` is `JournalEntry.SequenceNumber`; description from line, falling back to `Remarks`. Export columns: Date, Entry, Account code, Account name, Partner, Description, Debit, Credit.
- [ ] **Step 4:** Run the filter; expected PASS. Commit `feat: general ledger report`.

### Task 5: Pure domain statements (cash flow, equity, reconciler)

**Files:** Create `backend/Pako.Domain/Reporting/{CashFlowStatement,EquityStatement,ReportReconciler}.cs`; Test `backend/Pako.Tests/ReportingDomainTests.cs`.

**Interfaces — Produces:**
```csharp
public record AccountMovement(Guid AccountId, string Code, string Name, CashFlowCategory Category, decimal Debit, decimal Credit);
public record CashFlowResult(IReadOnlyList<AccountMovement> Operating, IReadOnlyList<AccountMovement> Investing,
    IReadOnlyList<AccountMovement> Financing, decimal NetChange, decimal ClosingComputed, decimal Difference);
public static class CashFlowStatement
{
    public static CashFlowResult Calculate(decimal netIncome, IEnumerable<AccountMovement> nonCashMovements,
        decimal openingCash, decimal closingCashActual);
}
public static class EquityStatement
{
    public static decimal Closing(decimal opening, decimal netIncome, IEnumerable<decimal> movements);
}
public record CheckResult(string Key, bool Passed, decimal Expected, decimal Actual);
public static class ReportReconciler
{
    public const decimal Tolerance = 0.01m;
    public static CheckResult Equal(string key, decimal expected, decimal actual);
}
```
Cash effect of a non-cash movement is `Credit - Debit`. `NetChange = netIncome + Σ effects`; `ClosingComputed = openingCash + NetChange`; `Difference = closingCashActual - ClosingComputed`. Movements with category `None` are excluded.

- [ ] **Step 1:** Failing tests: `CashFlow_ReceivableIncrease_ReducesOperatingCash`, `CashFlow_FixedAssetPurchase_IsInvesting`, `CashFlow_LoanDrawdown_IsFinancing`, `CashFlow_CategoryNone_IsExcluded`, `CashFlow_ClosesToActualCash_WhenBooksBalance` (assert `Difference == 0`), `Equity_ClosingIsOpeningPlusProfitPlusMovements`, `Reconciler_PassesWithinOneCent_FailsBeyond`.
- [ ] **Step 2:** Run `--filter ReportingDomainTests`; expected FAIL.
- [ ] **Step 3:** Implement per the formulas above.
- [ ] **Step 4:** Run; expected PASS. Commit `feat(domain): cash flow, equity and reconciliation calculators`.

### Task 6: Monthly P&L and comparative balance sheet

**Files:** Create `backend/Pako.Api/Controllers/StatementReportsController.cs` (replaces stubs for these two); Test `backend/Pako.Tests/StatementReportsTests.cs`.

**Interfaces:** Consumes `LedgerAggregator.SumsByAccountAsync(companyId, from, to)`, `AccountTypeDerivation.IsIncome/IsExpense`, `AccountType.CostOfRevenue`.

- [ ] **Step 1:** Failing tests: `MonthlyPnl_PlacesEachPostingInItsMonth`, `MonthlyPnl_MonthsSumToExistingYearlyPnl` (compare with `ReportsController.ProfitAndLoss` for the same year), `MonthlyPnl_GrossProfitIsIncomeMinusCostOfRevenue`, `Comparative_PriorColumnEqualsBalanceSheetAtThatDate`, `Comparative_DifferenceIsCurrentMinusPrior`, `Monthly_EmptyYear_ReturnsZeros`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement: twelve calls to the aggregator are not allowed; do one grouped query by account and month in `LedgerAggregator` (add `Task<List<(AccountSums Sums, int Month)>> SumsByAccountAndMonthAsync(Guid, int year)`) . Comparative reuses the balance-sheet logic by calling the existing `BalanceSheet` action twice and zipping by `AccountId`.
- [ ] **Step 4:** Run; expected PASS. Commit `feat: monthly P&L and comparative balance sheet`.

### Task 7: Cash flow and equity statement

**Files:** Modify `StatementReportsController.cs`; Test `StatementReportsTests.cs`.

**Interfaces:** Consumes `CashFlowStatement.Calculate`, `EquityStatement.Closing`, `LedgerAggregator`. Opening cash = Σ(Debit−Credit) of `AccountType.Cash` accounts up to `from - 1 day`; closing = up to `to`. Opening equity = equity balance (excluding current-year earnings) at `from - 1 day` plus net income to that date for closed prior periods.

- [ ] **Step 1:** Failing tests: `CashFlow_ClosesToCashAndBankBalance_Check3`, `CashFlow_UsesAccountCashFlowCategory`, `Equity_ClosingEqualsBalanceSheetEquity`, `Equity_NetIncomeMatchesProfitAndLoss_Check2`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement both endpoints and exports (columns: Section, Account code, Account name, Amount, mirroring the P&L export).
- [ ] **Step 4:** Run; expected PASS. Commit `feat: cash flow and equity statement`.

### Task 8: Expense book

**Files:** Create `backend/Pako.Api/Controllers/ExpenseBookController.cs`; Test `backend/Pako.Tests/ExpenseBookTests.cs`.

- [ ] **Step 1:** Failing tests: `ExpenseBook_OneRowPerPostedEntryWithExpenseLines`, `ExpenseBook_ColumnsAreExpenseAccountsUsedInRange` (ordered by code), `ExpenseBook_AmountsAlignedWithColumns`, `ExpenseBook_ColumnTotalsEqualPnlExpenses`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement: expense-type accounts (`AccountTypeDerivation.IsExpense`) with postings in range become `Columns`; one row per entry that touches them; `DocumentNumber` is the source document number when `SourceDocumentId` is set, else the entry reference.
- [ ] **Step 4:** Run; expected PASS. Commit `feat: expense book`.

### Task 9: Reconciliation checks

**Files:** Create `backend/Pako.Api/Controllers/ReportChecksController.cs`; Test `backend/Pako.Tests/ReportChecksTests.cs`.

**Interfaces:** Consumes `ReportReconciler.Equal`. Checks, with these exact keys: `balance-sheet-balances`, `net-profit-consistent`, `cash-flow-closes`, `books-match-vat-return`, `trial-balance-balances`, `vendor-total-matches-payables`.

- [ ] **Step 1:** Failing tests: one per key on a balanced scenario (all pass), plus `Checks_BalanceSheetImbalance_IsReported` (seed a balance-sheet that cannot balance by posting directly to a line without its counter-entry in the DB, and assert `Passed == false`).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement by calling the underlying calculators/queries, not the HTTP actions. `vendor-total-matches-payables` is skipped (omitted from the list) until Task 15 lands.
- [ ] **Step 4:** Run; expected PASS. Commit `feat: report reconciliation checks`.

### Task 10: Web — split `Reports.tsx`, add Phase 1 tabs

**Files:**
- Create: `apps/web/src/pages/reports/{ReportsPage.tsx,PnlTab.tsx,BalanceSheetTab.tsx,VatTab.tsx,DebtTab.tsx,SalesBookTab.tsx,PurchaseBookTab.tsx,shared.tsx}` (move existing code; `shared.tsx` holds `LockNotice`, `ExportButton`, `DrillAmount`, `downloadFileResponse`, `downloadRows`), then `GeneralLedgerTab.tsx`, `MonthlyPnlTab.tsx`, `CashFlowTab.tsx`, `EquityTab.tsx`, `ExpenseBookTab.tsx`, `ChecksPanel.tsx`
- Delete/redirect: `apps/web/src/pages/Reports.tsx` (re-export `ReportsPage`); move `Reports.test.tsx` to follow
- Modify: `apps/web/src/i18n/messages.ts` (EN + SQ keys `reports.generalLedger`, `reports.monthlyPnl`, `reports.cashFlow`, `reports.equityStatement`, `reports.expenseBook`, `reports.checks*`)
- Test: `apps/web/src/pages/reports/*.test.tsx`

**Interfaces:** Consumes `apiClient.generalLedger/…Export` etc. from the regenerated client (verify exact generated method names with `grep -n "generalLedger" packages/shared/src/generated/api-client.ts`).

- [ ] **Step 1 (split only):** Move each existing tab into its own file with no behaviour change. Run `pnpm --filter web test` and `typecheck`; expected: same results as before the move. Commit `refactor(web): split Reports page by tab`.
- [ ] **Step 2:** Failing tests per new tab, using the fixtures: renders rows, export button calls the `...Export` client method, period selector shows `LockNotice` when the range is on or before `accountingLockDate`. `GeneralLedgerTab` also: paging control changes `page`.
- [ ] **Step 3:** Implement the tabs against the real client (fixtures are the test payloads). `ChecksPanel` shows each `ReportCheck` with pass/fail badge and renders at the top of the page for the selected period.
- [ ] **Step 4:** `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(web): phase 1 report tabs and checks panel`.

---

## Phase 2 — Payables

### Task 11: Phase 2 contract commit

**Files:** Modify `ReportContracts.cs`; Create `backend/Pako.Api/Controllers/PayablesReportsController.cs` (stubs), fixtures `vendor-synthetic.json`, `vendor-statement.json`, `payables-aging.json`, `purchases-by-vendor.json`, `purchases-by-item.json`, `purchase-transactions.json`; regenerate client.

**Interfaces — Produces:**
```csharp
record VendorBalanceLine(Guid PartnerId, string Name, decimal Opening, decimal Debit, decimal Credit, decimal Closing);
record VendorSyntheticResponse(DateOnly From, DateOnly To, List<VendorBalanceLine> Lines, decimal TotalClosing);
// GET vendors/synthetic?from&to&includeZero=false ; /export     (Closing sign: positive = we owe; negative = vendor owes us)

record VendorStatementRow(DateOnly Date, string Type, string? DocumentNumber, string? Description, decimal Debit, decimal Credit, decimal Balance);
record VendorStatementResponse(Guid PartnerId, string Name, DateOnly From, DateOnly To, decimal Opening, List<VendorStatementRow> Rows, decimal Closing);
// GET vendors/{partnerId}/statement?from&to ; /export

record PayablesAgingLine(Guid BillId, string? BillNumber, Guid PartnerId, string PartnerName, DateOnly IssueDate, DateOnly DueDate, decimal Outstanding, string Bucket);
record PayablesAgingResponse(DateOnly AsOf, List<PayablesAgingLine> Lines, List<AgingBucketTotal> Buckets);
record AgingBucketTotal(string Bucket, decimal Total);
// GET payables-aging?asOf ; /export. Buckets: Current, 1-30, 31-45, 46-60, 61-90, 91-180, 181-360, Over360

record PurchaseByVendorLine(Guid PartnerId, string Name, decimal NetAmount, decimal DiscountAmount, decimal VatAmount, decimal GrossAmount);
record PurchaseByItemLine(Guid? ItemId, string? ItemCode, string Description, string? Unit, decimal Quantity, decimal NetAmount, decimal VatAmount, decimal GrossAmount);
record PurchaseTransactionLine(DateOnly Date, string? DocumentNumber, string DocumentType, string PartnerName, string? ItemCode, string Description, decimal Quantity, decimal UnitPrice, decimal NetAmount, decimal VatAmount, decimal GrossAmount);
// GET purchases/by-vendor?from&to ; purchases/by-item?from&to ; purchases/transactions?from&to&partnerId? (paged) ; each + /export
```
- [ ] **Step 1:** Add records, stubs and fixtures (fixture sets include one credit-balance vendor).
- [ ] **Step 2:** Build, regenerate client, typecheck as in Task 3 Step 3.
- [ ] **Step 3:** Commit `feat(contract): phase 2 payables report endpoints`.

### Task 12: Vendor synthetic and statement

**Files:** Modify `PayablesReportsController.cs`; Test `backend/Pako.Tests/VendorReportsTests.cs`.

**Interfaces:** Vendor balance = Σ(Credit−Debit) of journal lines with a `PartnerId` on `AccountType.Payable` accounts (so positive = we owe). Opening = same sum before `from`.

- [ ] **Step 1:** Failing tests: `VendorSynthetic_OpeningDebitCreditClosingReconcile`, `VendorSynthetic_TotalEqualsPayablesControlAccount_Check6`, `VendorSynthetic_KeepsCreditBalanceVendors`, `VendorSynthetic_HidesZeroVendorsByDefault`, `VendorStatement_RunningBalanceEndsAtClosing`, `VendorStatement_IncludesBankPaymentRows`, `VendorReports_OnlyVisiblePartnersForScopedUser`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement and add `vendor-total-matches-payables` to Task 9's checks.
- [ ] **Step 4:** Run; expected PASS. Commit `feat: vendor synthetic and statement reports`.

### Task 13: Payables aging

**Files:** Modify `PayablesReportsController.cs`; Test `VendorReportsTests.cs`.

**Interfaces:** Mirror `ReportsController.DebtAging` for bills: posted `Bill`/debit-note-equivalent documents, outstanding = bill payable amount minus `Reconciliation.Amount` where `BillId` matches. Reuse its bucketing idea but with the bucket set from Task 11; days overdue = `asOf - DueDate`.

- [ ] **Step 1:** Failing tests: `PayablesAging_BucketsByDaysOverdue`, `PayablesAging_PartiallyPaidBillShowsRemainder`, `PayablesAging_FullyPaidBillExcluded`, `PayablesAging_BucketTotalsSumToPayablesBalance`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement (query, no new allocation logic).
- [ ] **Step 4:** Run; expected PASS. Commit `feat: payables aging`.

### Task 14: Purchase analysis reports

**Files:** Modify `PayablesReportsController.cs`; Test `backend/Pako.Tests/PurchaseAnalysisTests.cs`.

- [ ] **Step 1:** Failing tests: `PurchasesByVendor_TotalsMatchPurchaseBook` (net and VAT), `PurchasesByItem_GroupsByItemAndFallsBackToDescription`, `PurchaseTransactions_OneRowPerBillLine`, `PurchaseTransactions_FiltersByPartner`, `PurchaseTransactions_Pages`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement from posted `Bill` + `BillLine` (use `DocumentLineCalculator` for net/VAT/gross; do not recompute in the controller). Credit-note document types are negative-signed, as in the purchase book.
- [ ] **Step 4:** Run; expected PASS. Commit `feat: purchase analysis reports`.

### Task 15: Web — Payables tabs

**Files:** Create `apps/web/src/pages/reports/{VendorsTab,VendorStatementDrawer,PayablesAgingTab,PurchasesTab}.tsx` + tests; Modify `ReportsPage.tsx`, `messages.ts` (EN/SQ).

- [ ] **Step 1:** Failing tests from fixtures: vendor synthetic row click opens the statement; credit-balance vendor renders with a negative sign and distinct styling; aging shows every bucket total; purchases tab switches between by-vendor / by-item / transactions; all export buttons call the matching client method.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `pnpm --filter web test && typecheck && lint && build`; expected pass.
- [ ] **Step 4:** Commit `feat(web): payables report tabs`.

### Task 16: Final verification

- [ ] **Step 1:** Run the full backend suite and all four web commands; expected all green.
- [ ] **Step 2:** In the running app, seed a company, post sales/bills/payments, open the Checks panel; expected all six checks pass, then break one posting directly in the DB and confirm the relevant check fails.
- [ ] **Step 3:** Run the code-reviewer agent on the branch diff before presenting it as done.
- [ ] **Step 4:** When the accountant's real export arrives, diff each report's columns against it and record gaps as follow-ups.
