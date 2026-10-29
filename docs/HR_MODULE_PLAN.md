# HR Module — analysis and plan

Status: phases 1 + 2 built on `feat/hr-module` (2026-10-15), uncommitted pending review. Supersedes
the "full HR stays out of scope" line in `ARCHITECTURE.md` §Payroll once merged.

## 1. What exists today (read from code, not docs)

| Area | State |
| --- | --- |
| `Employee` | 5 fields: `Name`, `MonthlyGrossSalary`, `IsActive`, `CompanyId`, `Id`. API has list + create only — no update, no deactivate. |
| `PayrollRun` / `PayslipLine` | Draft → Posted. A run takes every active employee at their fixed salary. No bonus, overtime, deductions, or per-run edits. Posted runs are immutable (`PakoDbContext` SaveChanges guard). |
| Calculation | `PayrollCalculationService`: pension 5% + 5%, PIT on (gross − employee pension) with annual brackets 0 / 8% / 10% (3,000 / 5,400). Matches Law 08/L-142. No secondary-employer rule, no pension exemption. |
| GL posting | Dr 600100 (gross + employer pension) / Cr 213100 PIT / Cr 221100 pension (both shares) / Cr 220100 net pay. |
| Departments | None. `CostCenter` entity exists (no controller; web uses a mock). `JournalEntryLine.AnalyticDistribution` exists and can carry a department axis later. |
| Access control | `Membership` roles `FirmAdmin`, `FirmAccountant`, `ClientAdmin`, `ClientViewer`. `CompanyAccessFilter` checks read/write/admin per company — **all-or-nothing per company**. No module-level permissions, no row-level scoping, no global query filters. |
| Partners | `Partner` has no owner/assignee. Invoices, bills, reports, ledger and attachments all return every partner's data to anyone with company access. |

## 2. What comparable systems do

| Capability | QuickBooks | Odoo | ERPNext / Frappe HRMS | Dolibarr |
| --- | --- | --- | --- | --- |
| Employee master | Legal data, pay rate, bank, tax setup | Rich: dept, job, manager, linked user, bank, IDs, schedule | Rich: dept, designation, branch, grade, reports-to, linked user, bank, cost center | Employee = user flag + salary, supervisor |
| Org structure | Flat (classes/locations) | Department tree + manager | Department tree per company | Supervisor only |
| Compensation | Pay rate on employee | Contract (wage, dates, state) | Salary Structure + dated Assignment | Salary field |
| Payroll engine | Full (US-centric) | Salary rules + localisation, payslip batch | Salary Components → Payroll Entry → Salary Slips | Records payments only |
| Run workflow | Preview → submit | Draft → verify → done → paid | Draft slips → submit (accrual JE) → bank entry | — |
| Bonuses / one-offs | Bonus pay type, bonus-only run | Payslip "other inputs" | **Additional Salary**, Employee Incentive, Retention Bonus | Manual |
| Leave / attendance | PTO accruals, QB Time | hr_holidays, hr_attendance | Leave policy/allocation/application, attendance | Holidays module |
| Record-level access | Feature-area roles only | **Record rules** (`ir.rule`): "own documents only" vs "all documents" groups | **User Permissions**: (user, Customer = X) filters every doc linking Customer | **Sales representative** on thirdparty + "extend to all thirdparties" right |
| Self-service | Workforce portal | Portal / internal | ESS role + PWA | Own leave/expenses |

**Design lessons we adopt**

1. ERPNext's link-driven model: one assignment row ("employee E may see partner P") filters
   *every* document that references P — invoices, bills, statements, books. Set it up once.
2. Odoo's "own documents vs all documents" is an override. Admins and accountants always see
   everything. Only restricted staff are filtered.
3. Dolibarr's sales representative on a partner is the same idea as our employee ↔ partner
   assignment. It is the closest match to what Kosovo SMEs ask for.
4. Statutory numbers go in dated parameter tables, not code. The Kosovo minimum wage changed in
   Oct 2024 (€350), Jan 2026 (€425) and Jul 2026 (€500).

## 3. Kosovo statutory rules (verify ⚑ with the partner accounting firm)

- **PIT** (Law 08/L-142, from Aug 2024). The monthly bands for the primary employer are
  €0–250 at 0%, €250–450 at 8%, and over €450 at 10%, on gross minus employee pension. This is
  already correct in code.
- **Secondary employer.** ⚑ A flat 10% on the whole amount, with no 0% band. The employee chooses
  the primary employer at hire, so the employee record needs `IsPrimaryEmployer`.
- **Pension (Trusti).** 5% employee + 5% employer, with no cap. Voluntary contributions can go up
  to 15% each (phase 2). Employees past pension age are exempt, so the employee record needs
  `PensionExempt`.
- **Minimum wage.** €500 gross from 1 Jul 2026 (Gov. Decision 10/273). The system should warn
  when a base salary is below it, but never block the save.
- **Labour Law 03/L-212.**
  - Overtime pays +30%. Weekend and holiday work pays +50%. ⚑ Night work is +20% in the private
    sector.
  - Annual leave is at least 20 working days.
  - Sick leave is up to 20 days a year at 100%, paid by the employer.
  - Maternity is 6 months at 70% from the employer, then 3 months at 50% from the state.
- **Filing.**
  - Monthly EDI declaration of wages, tax and pension is due by the 15th of the following month.
    It needs, per employee: personal number, gross, both pension shares, PIT, and the
    primary/secondary flag.
  - Employers give each employee an annual income statement by 31 March.
  - Salaries must be paid through a bank, so the employee record needs an IBAN.

## 4. Target design

### 4.1 Data model

```
Department      Id, CompanyId, Code, Name, ParentId?, ManagerEmployeeId?, IsActive
                + module permissions (see 4.2) + PartnerScope {All, Assigned}

Employee (+)    FirstName, LastName (Name kept, = "First Last"), PersonalNumber (10 digits),
                Email, Phone, Address, BirthDate, HireDate, TerminationDate,
                DepartmentId?, JobTitle, ManagerId?, UserId? (login),
                Iban, BankName, EmploymentType {FullTime, PartTime, FixedTerm},
                IsPrimaryEmployer (default true), PensionExempt (default false)

EmployeePartnerAssignment   EmployeeId, PartnerId   (unique pair)

PayrollAdjustment   EmployeeId, Period (first-of-month), Kind {Bonus, Overtime,
                    Allowance, Commission, Deduction}, Description, Amount,
                    PayrollRunId? (set when a run consumes it)

PayslipLine (+) DepartmentId?, BaseSalary, AdditionsAmount, DeductionsAmount
                (GrossSalary = Base + Additions; NetPay = Gross − PIT − pension − Deductions)
```

### 4.2 Access model

We add a fifth company role, **`ClientStaff`**, for a company's own employees who log in. The
four existing roles keep their behaviour exactly.

- A `ClientStaff` user's rights come from the **department** of the `Employee` linked to that
  user (`Employee.UserId`).
- The department carries a permission level per module: `None`, `Read` or `Write`. Modules are
  `Sales`, `Purchases`, `Partners`, `Accounting`, `Reports` and `Hr`.
- The department's `PartnerScope` decides which partners the user sees:
  - `All`: every partner.
  - `Assigned`: only partners assigned to *that employee*, and only the invoices, bills, book
    lines and attachments that reference those partners.
- A `ClientStaff` user with no linked employee, or with no department, gets no access.
- `FirmAdmin`, `FirmAccountant`, `ClientAdmin` and `ClientViewer` are never partner-scoped.
  Most-permissive-wins still holds across memberships.

Enforcement:

- `CompanyAccessFilter` resolves an `ICompanyAccessContext` per request (roles, employee,
  module permissions, allowed partner IDs or *unrestricted*).
- `[RequireCompanyAccess(module: AccessModule.Sales, writeAccess: true)]` gates by module.
- Controllers call `.VisibleTo(access)` on partner-bearing queries.
- **Default for partner-scoped users: ledger and journal-entry endpoints are denied entirely.**
  Filtering a general ledger by partner is misleading because it hides the contra lines.
- `ck_memberships_scope` is widened to allow `ClientStaff`.

### 4.3 Payroll changes

1. When a run is created, it consumes every unconsumed `PayrollAdjustment` for its period.
   Bonus, overtime, allowance and commission are added to gross, so they are taxed and pensioned.
   `Deduction` is taken from net after tax.
2. Rules added:
   - A secondary employer is taxed at a flat 10% (configurable bands per primary/secondary).
   - `PensionExempt` sets both pension shares to 0.
   - Terminated employees, and employees hired after the period, are excluded.
3. Draft runs can be deleted. When a draft run is deleted, its adjustments are released.
4. Posting: deductions credit an "employee deductions" account. It is a nullable company default
   and falls back to net-pay payable, which is unchanged behaviour when unused.

### 4.4 Web

- New **HR** sidebar category containing Employees, Departments and Payroll. Payroll moves out of
  Registers.
- **Employees:** a DataGrid list and a detail form with tabs: Personal, Employment, Payroll and
  Partner access.
- **Departments:** a list and a form with parent, manager, a module-permission matrix and the
  partner scope.
- **Payroll:** a bonuses & adjustments panel per period. Payslips show base, additions,
  deductions, PIT, pension and net.
- **Company members:** inviting a `ClientStaff` user links the user to an employee.

## 5. Phases

| Phase | Scope |
| --- | --- |
| **1 (this build)** | Departments; full employee master (update, deactivate); partner assignments; `ClientStaff` role, module permissions and partner scoping on Invoices, Bills, Partners, sales/purchase books, debt aging, attachments; payroll adjustments (bonus/overtime/allowance/commission/deduction); secondary-employer and pension-exempt rules; draft run delete; web for all of the above. |
| 2 | Dated contracts / salary history; leave types, allocations, requests and balances; Kosovo holiday calendar; overtime hours × rate premiums; payslip PDF (SQ/EN); EDI export (CSV); annual employee statement; split employer pension to 221200; department → cost-center analytic distribution on payroll JEs; minimum-wage parameter table. |
| 3 | Employee self-service (own payslips, leave); advances/loans; commission auto-calc from assigned partners' invoices; expense claims → bills; firm multi-client payroll dashboard with EDI deadlines. |

## 6. Risks and open questions

- **Partner scoping must be complete or it is a leak.** Phase 1 lists every endpoint that
  returns partner data, as named in §4.2. Any new endpoint that returns partner data must call
  `VisibleTo`. A test asserts that a scoped user gets 403 or filtered results on each one.
- ⚑ The secondary-employer flat 10% and the pension-deductible-before-PIT rule must be confirmed
  with the partner firm.
- Migrations: one migration, `AddHrModule`, announced per the one-per-day rule.

## 7. Build notes (feat/hr-module)

- Not built from phase 2: payslip PDF (the web prints payslips through a print stylesheet
  instead, so no new NuGet package was needed) and a minimum-wage parameter *table*. The minimum
  wage is a dated list in `KosovoPayrollRules`, and it raises warnings.
- Any staff user who is allowed to write HR data can still never change department
  permissions, partner assignments, or an employee's login or department. Only the classic roles
  can.
- Leave types and the Kosovo holiday calendar are seeded per company on first read.
- **Verify before go-live (⚑):**
  - the secondary-employer flat 10%;
  - the night premium of 20%;
  - the 2026/2027 dates for Easter and Eid;
  - the EDI export column order.
- Follow-ups:
  - The cost-center picker on departments: the field exists, but there is no cost-centers API.
  - `LeaveBalanceResponse` doesn't say whether an allocation is the default or an override.
  - Employee pickers load 200 rows; a company with more employees needs a search picker.
