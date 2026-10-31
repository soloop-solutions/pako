# HR Module — master plan for the remaining features

Status: draft, 2026-10-15. Builds on `feat/hr-sys-ado` (commit `7dc26a2`), which delivered phases
1 and 2 of `docs/HR_MODULE_PLAN.md`. This plan covers everything that branch does not yet do, in the
order we should build it.

## Build status (2026-10-30)

Every item except A1 is built on `feat/hr-sys-ado` (uncommitted). J15 is built as option 2,
the partner statement. Each item has backend tests, and `scripts/e2e/hr.py` checks them through
the running API (39 checks). Migrations, in order: `AddHrPhase3`, `AddNotificationOutbox`,
`AddEmployeeSelfService`, `AddLoansAndCommission`, `AddExpenseClaims`, `AddTimesheets`. These
are six migrations in one go, so announce them before merging.

Still open, and needing people:
- **A1:** the statutory rules sign-off with the partner accounting firm. The EDI due-date roll
  (15th → next working day, `EdiDeadline`) is on the same list.
- **D6:** confirm Soloop qualifies for the QuestPDF Community licence (under USD 1M revenue).
- **E7:** SMTP settings for production (`Email:Mode=Smtp`, `Email:Host`, `Email__Password`).
  Development writes `.eml` files to `backend/Pako.Api/dev-mail/`.
- **H13 design choice:** approving a claim creates a **draft** bill, and the accountant posts it
  through the normal Bills flow. This keeps R07 and the purchase-book rules intact. The receipt
  supplier and NUI are copied onto the bill lines for that review.
- **Playwright walk-through** (`apps/web/e2e/hr.spec.ts`) is not written. The web screens have
  vitest coverage only.

## 0. Where we are

Delivered: departments with module access, a full employee master, contracts, employee ↔ partner
scoping, the `ClientStaff` role, payroll adjustments, payroll runs (Draft → Approved → Posted →
Paid), EDI/register exports, print payslips, annual statements, and leave (types, allocations,
requests, balances, calendar, holidays).

Missing, grouped into workstreams:

| # | Feature | Workstream | Size |
| --- | --- | --- | --- |
| 1 | Go-live verification of statutory rules | A. Go-live | S |
| 2 | Employee search picker (pickers capped at 200) | B. Polish | S |
| 3 | Leave balance: default vs override flag | B. Polish | S |
| 4 | Cost-center API + picker on departments | B. Polish | M |
| 5 | Minimum wage + statutory parameters as data | C. Parameters | M |
| 6 | Payslip PDF (SQ/EN) | D. Documents | M |
| 7 | Email notifications | E. Infrastructure | M |
| 8 | Background jobs (reminders, deadlines) | E. Infrastructure | S |
| 9 | Employee self-service (own payslips, leave) | F. Self-service | L |
| 10 | Salary advances and loans | G. Payroll+ | M |
| 11 | Commission auto-calculated from assigned partners' invoices | G. Payroll+ | M |
| 12 | Attendance / timesheets feeding overtime | G. Payroll+ | L |
| 13 | Expense claims → bills | H. Expenses | M |
| 14 | Firm multi-client payroll dashboard + EDI deadlines | I. Firm | M |
| 15 | Scoped read access to ledger/reports for staff (decision first) | J. Access | M |

Sizes are rough: **S** ≈ 1–2 dev-days, **M** ≈ 3–5, **L** ≈ 6–10, including tests.

## 1. Guiding rules (apply to every item)

- Follow `CLAUDE.md` and `.claude/rules/*`:
  - one migration per day, announced;
  - resx keys in EN and SQ;
  - no money math in the browser;
  - regenerate the NSwag client in the same commit as a contract change;
  - stage files by name.
- **Partner scoping is a security boundary.** Any new endpoint that returns invoices, bills,
  partners, payments or attachments must call `.VisibleTo(access)` and get a case in
  `PartnerScopingTests`.
- **Staff never raise their own access.** Self-service endpoints act only on the caller's own
  `Employee` (resolved from `CompanyAccessContext`), never on an `employeeId` the caller sends.
- **Statutory numbers live in data with a `SourceConfidence`, not in code** (see workstream C).
- **Posted payroll stays immutable.** New payroll features may only add Draft-time inputs.
- **Definition of done** for every item:
  - backend tests;
  - a case in the end-to-end API script, extending `e2e_hr.py` or its committed successor;
  - web tests for new forms;
  - a check in the UI walk-through;
  - `dotnet build` with 0 warnings;
  - web typecheck, lint and build all clean.

## 2. Milestones

| Milestone | Contents | Goal |
| --- | --- | --- |
| **M0 — Merge & go-live** | A1, B2, B3 | `feat/hr-sys-ado` reviewed, merged, safe for a first real client |
| **M1 — Finishing phase 2** | B4, C5, D6 | All phase 2 items in `HR_MODULE_PLAN.md` closed |
| **M2 — Infrastructure** | E7, E8 | Email and scheduled jobs available to every module |
| **M3 — Self-service** | F9 | Employees log in and see their own payslips and leave |
| **M4 — Payroll extras** | G10, G11 | Advances/loans and automatic commission |
| **M5 — Operations** | H13, I14 | Expense claims and the firm dashboard |
| **M6 — Optional** | G12, J15 | Timesheets; scoped reports (only if clients ask) |

Order rationale:
- M0 unblocks real use.
- M1 closes promised scope.
- M2 comes before M3–M5 because notifications and reminders are what make self-service, expenses
  and deadlines useful.
- G11 (commission) is the payoff of the partner-assignment model, so it comes early in M4.

---

## Workstream A — Go-live

### A1. Statutory verification (S)
Confirm these with the partner accounting firm and record the answer and source in
`KosovoPayrollRules.cs` (set `SourceConfidence` accordingly):

| Rule | Current value | Where |
| --- | --- | --- |
| Secondary-employer PIT | flat 10% | `KosovoPayrollRules`, `PayrollCalculationService` |
| Night-work premium | +20% | `KosovoPayrollRules` premiums |
| Easter / Eid dates 2026–2027 | seeded list | `KosovoPayrollRules` holidays |
| EDI export column order | our layout | `PayrollRunsController` EDI export |
| Pension deducted before PIT | yes | `PayrollCalculationService` |

Also:
- Run `AddHrModule` against a copy of a production-like database, and check the BaseSalary and
  account-default backfills.
- Open the PR and get a review.

## Workstream B — Polish

### B2. Employee search picker (S)
- **Backend:** `GET /employees` already pages and searches. Add `?active=true` and a
  `?departmentId=` filter if one is missing.
- **Web:** an `EmployeePicker` combobox that searches as you type (debounced) and loads 20
  results per page. Replace every 200-row employee `<select>`:
  - adjustments form;
  - leave request form;
  - department manager;
  - MembersPanel staff link;
  - partner access.
- **Tests:** a picker unit test, and a test that the 201st employee can be found.

### B3. Leave balance default vs override (S)
- **Backend:** add `IsOverride` (bool) to `LeaveBalanceResponse`. It is true when a
  `LeaveAllocation` row exists for the employee, type and year. Add
  `DELETE /leave/allocations/{employeeId}/{typeId}/{year}` to go back to the default.
- **Web:** a badge "Custom" plus a "Reset to default" action in the Balances tab.
- **No migration.**

### B4. Cost centers (M)
- **Backend:** a `CostCentersController` (list, create, update, deactivate) over the existing
  `Ledger/CostCenter` entity, gated on `AccessModule.Accounting`. Validate that a department's
  `CostCenterId` belongs to the same company.
- **Web:**
  - replace the cost-center mock with the real API;
  - add a cost-center select on `DepartmentForm`;
  - add a cost-center column on the payroll run detail.
- **Tests:**
  - the payroll JE carries the department's cost center in `AnalyticDistribution` (already
    built, now testable end to end);
  - a cross-company cost center is rejected.

## Workstream C — Statutory parameters as data

### C5. Payroll parameter table (M)
Move the dated values out of `KosovoPayrollRules` into a table that admins can maintain.

```
StatutoryParameter   Id, CountryCode ("XK"), Key, EffectiveFrom, Value (decimal), Source,
                     Confidence, CreatedByUserId, CreatedAt
                     unique (CountryCode, Key, EffectiveFrom)
Keys: MinimumWage, PensionEmployeeRate, PensionEmployerRate, PitBand1Upper, PitBand2Upper,
      PitRate1, PitRate2, PitRate3, SecondaryEmployerRate, OvertimePremium, NightPremium,
      WeekendPremium, HolidayPremium
```

- The table is global, not per company, and only firm admins can edit it.
- Seed it from the current `KosovoPayrollRules` values in the migration.
- `PayrollCalculationService` receives a resolved `PayrollParameters` snapshot for the period.
  It still has no DB access, so domain tests keep passing.
- Snapshot the parameter values on `PayrollRun` at creation (JSON column), so a later edit
  never changes a posted run's explanation.
- **Web:** Settings → Statutory parameters lists the dated values per key and lets an admin add a
  future value.
- **Risk:** this changes core payroll math. Before switching, run a regression test that
  computes every existing test case with both the old constants and the table.

## Workstream D — Documents

### D6. Payslip PDF (M)
- **Decision:** add a server-side PDF library. QuestPDF is recommended (community licence, check
  the revenue threshold). No PDF library is in the solution today, so this choice also covers
  invoices later.
- **Backend:**
  - a `PayslipPdfRenderer` service in `Pako.Api/Services`, which reads the payslip line's
    snapshot fields only and recomputes nothing;
  - SQ and EN versions, using the user's or company's language;
  - `GET /payroll-runs/{id}/payslips/{lineId}.pdf`;
  - `GET /payroll-runs/{id}/payslips.zip` for the whole run.
- **Annual statement PDF** uses the same renderer.
- **Web:** "Download PDF" next to Print, and "Download all payslips (ZIP)" on the run.
- **Tests:** the PDF is not empty, page count is 1, and the text contains the net amount (QuestPDF
  can render to text in tests).

## Workstream E — Infrastructure

### E7. Email notifications (M)
- **Backend:**
  - an `IEmailSender` abstraction with an SMTP implementation (MailKit) and a no-op/log
    implementation for dev and tests;
  - config in `appsettings`, with secrets from the environment.
- `Notification` outbox table: Id, CompanyId, RecipientEmail, Template, PayloadJson, State
  {Pending, Sent, Failed}, Attempts, CreatedAt, SentAt.
  - Code writes to the outbox in the same transaction as the business change.
  - E8 delivers it.
- **First templates (SQ/EN):**
  - leave request submitted → approver;
  - leave approved / rejected → employee;
  - payslip ready → employee, with the PDF from D6 attached, only if the employee has an email
    and opted in;
  - staff invitation.
- **Company settings:** an on/off switch for each template.

### E8. Background jobs (S)
- A `BackgroundService` in the API that every minute:
  - delivers pending outbox emails, with retry and backoff;
  - runs daily jobs once a day, with a database row lock so only one instance runs them.
- **Daily jobs:**
  - EDI deadline reminder: the 10th of each month, for runs not yet posted;
  - contract end reminder: 30 days ahead;
  - probation end;
  - year-end leave carry-over (see F9).
- If the deployment runs more than one API instance, use a `JobLock` row. Avoid Hangfire unless
  scheduling becomes more complex.

## Workstream F — Self-service

### F9. Employee self-service (L)
Every employee who has a login gets an "My HR" area, whatever their department access.

- **Access:**
  - A `ClientStaff` user who has a linked `Employee` always gets "self" access, even when the
    department has `Hr = None`.
  - Endpoints live under `/api/companies/{companyId}/me/…` and resolve the employee from
    `CompanyAccessContext`. They never accept an employee id.
- **Endpoints:**
  - `GET me/profile`, and `PUT me/profile` (phone, address, IBAN). An IBAN change needs HR
    approval: store it as a pending change and notify HR.
  - `GET me/payslips`: posted and paid runs only.
  - `GET me/payslips/{lineId}.pdf`
  - `GET me/annual-statement?year=`
  - `GET me/leave/balances`
  - `GET me/leave/requests`
  - `POST me/leave/requests`
  - `POST me/leave/requests/{id}/cancel`
- **Manager approvals:**
  - An employee's `ManagerId` can approve that employee's leave requests even without HR Write.
  - Add an `approver` rule to `LeaveController`: HR Write, or being the direct manager.
  - `GET me/team/leave` lists requests waiting for my approval.
- **Leave carry-over:** a per-type setting for maximum days carried over and the expiry date.
  The E8 year-end job creates next year's allocations.
- **Web:**
  - a "My HR" sidebar group: My payslips, My leave, My profile;
  - mobile-friendly layouts (these users are often on phones).
- **Tests:**
  - an employee can't read another employee's payslip (403);
  - a Draft run is invisible to employees;
  - a manager approves only their own reports;
  - an IBAN change stays pending until HR approves it.
- **Migration:** `EmployeeProfileChange` (pending IBAN changes) and the carry-over fields on
  `LeaveType`.

## Workstream G — Payroll extras

### G10. Salary advances and loans (M)
```
EmployeeLoan   Id, CompanyId, EmployeeId, Kind {Advance, Loan}, Principal, IssuedOn,
               InstallmentAmount, FirstPeriod, State {Active, Settled, Cancelled},
               DisbursementJournalEntryId?
```
- **Issuing:** posts Dr 1xx "Advances to employees" / Cr bank, through a new nullable account
  default that falls back on a code lookup, like the other payroll defaults.
- **Payroll runs:** each run adds a `LoanRepayment` deduction (a new `PayrollAdjustment.Kind`) of
  `min(installment, outstanding)`. It is after tax, credits the advances account, and is linked
  back to the loan.
- **When a draft run is deleted,** its repayments are released, the same way adjustments are.
- **Overview:** the outstanding balance per employee, shown on the employee detail page.
- **Tests:**
  - the last installment is capped at the outstanding balance;
  - the loan settles automatically;
  - a posted repayment is immutable.

### G11. Commission from assigned partners (M)
This is the payoff of employee ↔ partner assignments.

```
CommissionPlan   Id, CompanyId, Name, Basis {InvoicedNet, PaidNet}, Rate, MinThreshold?,
                 IsActive
Employee.CommissionPlanId?
```

- **Period total:** invoices of the employee's assigned partners in the period.
  - `InvoicedNet` sums posted invoices by invoice date.
  - `PaidNet` sums payments allocated in the period, which is safer for cash collection.
  - Both exclude VAT and subtract credit notes.
- **Basis depends on assignment dates:**
  - give `EmployeePartnerAssignment` `AssignedFrom` and `AssignedTo` dates (migration);
  - when a partner moves between employees, commission follows the dates.
- **Workflow:**
  - "Calculate commissions" on the adjustments page creates `Commission` adjustments, which HR
    reviews and edits before the run is created;
  - each adjustment has a drill-down that lists the invoices behind it.
- **Tests:**
  - a credit note reduces the commission;
  - a partner reassigned mid-month is split by date;
  - only posted invoices count;
  - recalculating doesn't duplicate a commission that's already been used by a run.

### G12. Attendance / timesheets (L, optional)
- `TimeEntry`: EmployeeId, Date, Hours, Kind {Regular, Overtime, Night, Weekend, Holiday}, Source
  {Manual, Import}, ApprovedBy?.
- Kind is derived from the holiday calendar and the weekday when possible.
- Monthly approval turns the totals into the premium-hours adjustments that HR now types by hand.
- CSV import from a clock system.
- Build it only if clients ask. Manual hours entry works today.

## Workstream H — Expenses

### H13. Expense claims → bills (M)
```
ExpenseClaim      Id, CompanyId, EmployeeId, Period, State {Draft, Submitted, Approved,
                  Rejected, Posted, Reimbursed}, Total
ExpenseClaimLine  Description, Date, ExpenseAccountId, Amount, VatAmount?, AttachmentId?
```
- **Employees** submit claims through self-service (F9) with receipt attachments, using the
  existing attachments module.
- **Approval:** the manager or HR approves.
- **Posting:** creates a purchase `Bill` to the employee, as an auto-created Partner flagged
  employee (or a dedicated payable account). It goes through the existing bill posting, so VAT
  and the purchase book work.
- **Reimbursement** goes one of two ways:
  - a payment on the bill;
  - a payroll addition. This is untaxed, so it needs a new `Reimbursement` kind that is excluded
    from gross.
- **Tests:**
  - the posted bill matches the claim;
  - VAT goes to the purchase book;
  - a payroll reimbursement isn't taxed.

## Workstream I — Firm dashboard

### I14. Firm multi-client payroll dashboard (M)
- **Endpoint:** `GET /api/firms/{firmId}/payroll-overview?month=` returns, for every client
  company where the user is a FirmAdmin or FirmAccountant:
  - the state of the latest run;
  - employee count;
  - total gross;
  - the EDI due date (the 15th);
  - days remaining.
- **Web:**
  - a firm-level page with traffic lights: red if overdue, amber if due within 5 days and the
    run isn't posted;
  - links go into each company's run.
- **Uses E8** to send a weekly digest email to firm accountants.
- **Tests:**
  - only companies where the user is a firm member appear;
  - the due date rolls to the next working day when the 15th is a holiday or weekend (to
    verify with the firm).

## Workstream J — Access (decision first)

### J15. Scoped reports for partner-restricted staff (M, needs product decision)
Today partner-scoped staff get 403 on the ledger, P&L, balance sheet and VAT return. That is
deliberate: a ledger filtered by partner hides the contra lines. Options:

1. Keep the 403. This is the current behaviour, and the recommended one unless clients push back.
2. Add a **partner statement** report for scoped staff: per assigned partner, opening balance,
   invoices, payments, closing balance. This is safe because it is partner-centric by nature.
3. Add sales-only analytics (revenue by partner and by month) limited to assigned partners.

Recommendation: build option 2 when the first client asks, and never filter the GL by partner.

---

## 3. Migrations plan

Each milestone needs at most one migration per day, in this order:

| Milestone | Migration | Contents |
| --- | --- | --- |
| M1 | `AddStatutoryParameters` | table + seed; `PayrollRun.ParametersSnapshot` |
| M2 | `AddNotificationOutbox` | `Notification`, `JobLock`, company notification settings |
| M3 | `AddEmployeeSelfService` | `EmployeeProfileChange`, leave carry-over fields |
| M4 | `AddLoansAndCommission` | `EmployeeLoan`, `CommissionPlan`, assignment dates, adjustment kinds |
| M5 | `AddExpenseClaims` | `ExpenseClaim`, `ExpenseClaimLine` |

B2, B3, B4 and I14 need no migration.

## 4. Dependencies

```
A1 ─▶ merge ─▶ everything
B4 (cost centers) ── independent
C5 (parameters) ─▶ G10/G11 use the parameter snapshot
D6 (PDF) ─▶ E7 payslip email attachment ─▶ F9 my payslips download
E7 + E8 ─▶ F9 notifications, H13 approvals, I14 digest
F9 (self-service) ─▶ H13 (employees submit claims)
G10 adds a deduction kind ─┐
G11 adds assignment dates  ├─▶ same migration in M4
```

## 5. Testing strategy

- **Domain:** pure unit tests in the style of `HrPayrollDomainTests` (calculation, loans,
  commission splitting, parameter resolution).
- **Controllers:** the pattern in `HrControllersTests` / `PartnerScopingTests`. Every new
  endpoint gets an "other employee → 403" case and, if it is partner-bearing, a scoping case.
- **Real Postgres:** `CLAUDE.md` warns that EF InMemory proves nothing for unique indexes, locks
  or transactions. The outbox, `JobLock`, unique parameter keys and loan concurrency must be
  tested on Postgres:
  - with the end-to-end script against a scratch database;
  - or with Testcontainers once Phase 0 of the main plan lands.
- **End-to-end:**
  - commit the HR end-to-end API script to `scripts/e2e/hr.py`;
  - commit the playwright walk-through to `apps/web/e2e/hr.spec.ts`;
  - so every milestone extends them rather than rebuilding them.

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Moving rates into a table changes payroll results | Regression test that runs old constants and the table side by side; snapshot per run |
| Self-service leaks another employee's payslip | `me/*` endpoints take no ids; dedicated 403 tests |
| Commission double-counted after recalculation | Recalc replaces unconsumed commission adjustments only; consumed ones are locked |
| Email sent twice by two API instances | Outbox + `JobLock` row lock; tested on Postgres |
| QuestPDF licence | Confirm the revenue threshold before adoption, or fall back to the print view |
| EDI format changes by ATK | Column order kept in one exporter; ⚑ verified each January |

## 7. Suggested first sprint (≈ 2 weeks)

1. A1: verify the rules, open the PR for `feat/hr-sys-ado` and merge it.
2. B2 employee picker and B3 leave override flag (one PR, no migration).
3. B4 cost centers.
4. D6 payslip PDF, after the QuestPDF licence check.
5. Start C5, keeping its migration to its own day.
