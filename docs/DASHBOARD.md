# Home dashboard

Status: built on `feat/hr-sys-ado`, 2026-10-30, uncommitted.
- **Tests:** 12 backend tests in `DashboardTests`, plus web tests in `pages/Dashboard.test.tsx` and
  `pages/dashboard/period.test.ts`.
- **Migration:** `AddDashboardLayouts`.

## What it does

- **Period** (kept in the URL):
  - Month, Quarter, Year (pick which one, or step with ‹ ›), or Custom dates.
  - Quick ranges: year to date, last 30 or 90 days, last 12 months.
  - The step (days, weeks, months, quarters) is automatic, or chosen.
- **Compare with:**
  - none;
  - the previous period of the same shape;
  - the same period last year, or two years ago;
  - or months the user picks.
- **Widgets:** 29 in the catalogue (`apps/web/src/pages/dashboard/catalog.ts`). Each one has:
  - a description;
  - a recommended chart, with the reason;
  - other ways to draw it;
  - a width of 1–4 columns;
  - a comparison toggle.
- **Presets:** Owner overview (the default), Sales, Cash & debts, Accountant, People & payroll.
- **Suggestions** appear above the dashboard, based on the data:
  - overdue customers, when there's no aging chart;
  - a loss, when there's no expense breakdown;
  - no comparison chosen;
  - cash missing from the dashboard.
- **One layout per company.** Anyone with Settings: Edit can customise it. Each person only sees
  the widgets their role allows.

## Where the numbers come from

`GET api/companies/{id}/dashboard?from&to&compareFrom&compareTo&granularity` (`DashboardService`):

| Figure | Source |
| --- | --- |
| Revenue, expenses, profit, margin, account breakdowns | Posted journal lines: the same basis as the P&L |
| Cash, receivables, payables | Ledger balances of Cash, Receivable and Payable accounts at the period end |
| Customers, vendors, items, invoice count | Posted documents, net of VAT per line, through `DocumentLineCalculator`. Credit notes and returns subtract |
| Aging | The document's partner line minus reconciliations, at the period end or today, whichever is earlier |
| Payroll cost | Gross plus employer pension of posted or paid runs, by period end |
| Headcount | Hire and termination dates at the period end |

Sections are filled per role:

| Section | Who sees it |
| --- | --- |
| Finance | Reports: View, and not partner-scoped |
| Sales | Sales: View |
| Purchases | Purchases: View |
| Payroll | Payroll: View |
| HR | HR: View |

The browser does no money math: change percentages and margins also come from the API.

## Charts

The charts are plain SVG and HTML in `pages/dashboard/charts.tsx`, with colour tokens in
`index.css`:
- **Colour:** categorical slots 1–2 mark the period and its comparison; aging uses a one-hue
  ordinal ramp.
- **Validation:** the palette was validated against PAKO's own light and dark card surfaces. Three
  light-mode slots fall below 3:1 contrast, so every chart has a table view.
- **Marks:** a single y-axis; 2px lines; bars at most 24px wide.
- **Interaction:** hover and keyboard tooltips. While data refetches, the previous chart stays on
  screen, dimmed.
