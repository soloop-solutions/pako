Pure report calculators (cash flow, equity, reconciliation), added by the report-suite plan.
- `CashFlowStatement` — indirect-method cash flow from net income and categorised non-cash movements.
- `EquityStatement` — closing equity from opening, net income and period movements.
- `ReportReconciler` — one-cent tolerance equality check producing a `CheckResult`.

## Why the balance sheet is built the way it is

- `CurrentYearEarnings` is excluded from the equity accounts and the computed net income is added back in its place. Posting rule R05 blocks manual postings to that account, so its own ledger balance is always zero. The figure that belongs on the balance sheet is the real net income, attributed to the real `CurrentYearEarnings` account. A synthetic 3999 "Current Earnings" row is used only for legacy charts that lack such an account.
- `LedgerAggregator.BalanceSheetAsync` is the single source for the balance sheet, the comparative balance sheet and report checks 1 and 2. Do not rebuild these figures elsewhere.
- Check `net-profit-consistent` compares P&L net income with `LedgerAggregator.NetIncomeByIdentityAsync`, an independent path through the accounting identity (change in assets less liabilities, minus equity-account movements). It turns red when the ledger is unbalanced, which is the point.
