# Employee Registration Feedback — Full-Stack Plan

Accountant feedback received 2026-11-23. Each item is numbered to match the original list.
Reference files: `Employees List_10-2026.xlsx` (Genci's employee register) and `lista-e-pagave-2026-05.xlsx` (Genci's payroll list).

---

## 1. Primary / Secondary employer — radio group

**Current:** Single checkbox "Punëdhënës primar" on Employment tab (line 427, EmployeeDetail.tsx).
**Change:** Replace the checkbox with a two-option Select: "Punëdhënës primar" / "Punëdhënës sekondar".
The backend field `IsPrimaryEmployer` (bool) stays the same — the select just maps true/false more explicitly.

### Backend
No change. `IsPrimaryEmployer = true` already means primary, `false` means secondary.

### Frontend — `EmployeeDetail.tsx`
- Replace the `isPrimaryEmployer` Checkbox (lines 427–433) with a `Select`:
  - Value `"primary"` → `isPrimaryEmployer = true`
  - Value `"secondary"` → `isPrimaryEmployer = false`
- Update the hint text (line 451) accordingly.

### i18n — `messages.hr.ts`
- Add keys:
  - `hr.employee.employerType` — EN: "Employer type", SQ: "Lloji i punëdhënësit"
  - `hr.employee.employerType.primary` — EN: "Primary employer", SQ: "Punëdhënës primar"
  - `hr.employee.employerType.secondary` — EN: "Secondary employer", SQ: "Punëdhënës sekondar"
  - `hr.employee.employerTypeHint` — EN: "Secondary employer: flat 10% PIT, no 0% bracket.", SQ: "Punëdhënës sekondar: tatim i sheshtë 10%, pa fashën 0%."

---

## 2. Invert "Pension exempt" → "Contributions included"

**Current:** `pensionExempt` checkbox labelled "I liruar nga kontributet pensionale" (negative framing, unchecked by default).
**Change:** Invert the display to positive framing: "Përfshihen kontributet" (Contributions included), checked by default. The backend field `PensionExempt` stays unchanged — the frontend inverts.

**Confirmed by Genci's file:** `lista-e-pagave-2026-05.xlsx` column H is "Ka Kontribute" with PO/JO values — exactly this positive framing.

### Backend
No change.

### Frontend — `EmployeeDetail.tsx`
- Line 435: change `checked={form.pensionExempt}` → `checked={!form.pensionExempt}`
- onChange: `set("pensionExempt", !e.target.checked)` (invert)

### i18n — `messages.hr.ts`
- Change existing values (do NOT rename the key):
  - `hr.employee.pensionExempt` — EN: "Contributions included", SQ: "Përfshihen kontributet"
- Update hint:
  - `hr.employee.primaryEmployerHint` — update text to explain the inverted checkbox: "Untick contributions if the employee is past pension age or otherwise exempt."

---

## 3. "Tax applied" toggle on Pay section

**Current:** No tax toggle. PIT is always computed by `PayrollCalculationService`.
**Change:** Add a `TaxExempt` boolean on `Employee`. Display as "Aplikohet tatimi" (Tax applied) on the Pay section, checked by default (meaning tax IS applied, `TaxExempt = false`).

**Confirmed by Genci's file:** `lista-e-pagave-2026-05.xlsx` column I is "Ka Tatim" with PO/JO values — exactly this field.

### Backend

#### Domain — `Employee.cs`
- Add: `public bool TaxExempt { get; set; }` (default `false` = tax applied)

#### EF Config — `EmployeeConfiguration.cs`
- Add: `builder.Property(e => e.TaxExempt).HasDefaultValue(false);`

#### Migration
- New migration: `AddEmployeeTaxExempt` — adds `tax_exempt boolean NOT NULL DEFAULT false` to `employees`.

#### Contracts — `HrContracts.cs`
- `SaveEmployeeRequest`: add `bool TaxExempt = false`
- `EmployeeDetailResponse`: add `bool TaxExempt`

#### Controller — `EmployeesController.cs`
- Map `TaxExempt` in create/update.
- Return `TaxExempt` in detail response.

#### Payroll — `PayrollCalculationService`
- When `employee.TaxExempt == true`, set `PitAmount = 0` (skip PIT calculation).

#### Validation — `EmployeeValidation.cs`
- No special validation needed (simple boolean).

### Frontend — `EmployeeDetail.tsx`
- Add to `FormState`: `taxExempt: boolean`
- Add to `initialState`: `taxExempt: employee?.taxExempt ?? false`
- In the Pay section (after salary field), add a Checkbox:
  - Label: "Aplikohet tatimi" / "Tax applied"
  - `checked={!form.taxExempt}`, onChange inverts (same pattern as pension)
- Wire into `handleSubmit`: `taxExempt: form.taxExempt`

### i18n — `messages.hr.ts`
- `hr.employee.taxApplied` — EN: "Tax applied", SQ: "Aplikohet tatimi"
- `hr.employee.taxAppliedHint` — EN: "Untick if the employee is exempt from personal income tax.", SQ: "Hiqe nëse punonjësi është i liruar nga tatimi në të ardhura personale."

---

## 4. IBAN label → "Llogaria bankare"

**Current:** Label is "IBAN" / "IBAN".
**Change:** Rename to "Llogaria bankare" in SQ, "Bank account" in EN. Keep the IBAN hint.

### Backend
No change.

### Frontend
No code change — just i18n values.

### i18n — `messages.hr.ts`
- `hr.employee.iban` — EN: "Bank account (IBAN)", SQ: "Llogaria bankare (IBAN)"

---

## 5. Manager picker — keep all employees (Odoo default)

**Current:** Shows all employees, excluding self.
**Decision:** Matches Odoo. No change. If the accountant insists, we can add a `jobTitle` search filter later — but filtering to "only managers" is fragile because job titles are free-text.

### Backend
No change.

### Frontend
No change.

---

## 6. Change history — "History" tab on employee detail

**Current:** Audit trail exists (admin-only, `GET /api/companies/{id}/audit?entityType=Employee&entityId={id}`). No per-entity history UI.
**Change:** Add a "History" section tab on EmployeeDetail showing field-level changes (Odoo chatter-style).

### Backend

#### EmployeesController — new endpoint
A thin proxy that queries the audit table scoped to this employee, accessible with HR:Read (not admin-only):

```csharp
[HttpGet("{id:guid}/history")]
[RequireCompanyAccess(module: AccessModule.Hr)]
public async Task<ActionResult<PaginatedResponse<AuditEntryResponse>>> History(
    Guid companyId, Guid id,
    [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
```

Calls the same audit query logic but scoped to `entityType = "Employee"` and `entityId = id`.

### Frontend — new component `EmployeeHistory.tsx`
- New section `"history"` added to `SECTIONS` array.
- Renders a simple chronological list (not a full DataGrid — it's a log):
  - Each entry: timestamp, user name, action (Created/Updated), field changes as "Field: old → new"
  - Paged (load more button or scroll pagination)
- Uses `apiClient.employeeHistory(companyId, employeeId, page, pageSize)` (new generated method).

### i18n — `messages.hr.ts`
- `hr.employee.section.history` — EN: "History", SQ: "Historiku"
- `hr.employee.history.empty` — EN: "No changes recorded.", SQ: "Nuk ka ndryshime të regjistruara."
- `hr.employee.history.created` — EN: "Created", SQ: "U krijua"
- `hr.employee.history.updated` — EN: "Updated", SQ: "U ndryshua"
- `hr.employee.history.fieldChange` — EN: "{field}: {old} → {new}", SQ: "{field}: {old} → {new}"

---

## 7. Payroll register export — localize headers

**Current:** The register export already has 15 columns including PIT. But headers are hardcoded in English (line 383, PayrollRunsController.cs). The EDI export is in Albanian. The report suite convention says exports use `ExportLabels` chosen by `Accept-Language`.

**Change:** Localize the register export headers via `ExportLabels` / resx, so they appear in SQ or EN depending on the request language.

### Backend — `PayrollRunsController.cs`
- Replace hardcoded header array with localized labels:
  ```csharp
  var headers = new[]
  {
      Label("Export_Employee"), Label("Export_PersonalNumber"), Label("Export_Department"),
      Label("Export_WorkingDays"), Label("Export_PaidDays"), Label("Export_BaseSalary"),
      Label("Export_Bonuses"), Label("Export_OtherAdditions"), Label("Export_Gross"),
      Label("Export_EmployeePension"), Label("Export_EmployerPension"), Label("Export_Pit"),
      Label("Export_Deductions"), Label("Export_NetPay"), Label("Export_PrimaryEmployer")
  };
  ```
- The `Label()` helper already exists (line 476: `private string Label(string key) => _localizer[key].Value;`).

### Backend — `Resources/ErrorMessages.resx` + `.sq.resx`
Add 15 new keys with EN and SQ translations:

| Key | EN | SQ |
|-----|----|----|
| `Export_Employee` | Employee | Punonjësi |
| `Export_PersonalNumber` | Personal number | Numri personal |
| `Export_Department` | Department | Departamenti |
| `Export_WorkingDays` | Working days | Ditë pune |
| `Export_PaidDays` | Paid days | Ditë të paguara |
| `Export_BaseSalary` | Base salary | Paga bazë |
| `Export_Bonuses` | Bonuses | Bonuset |
| `Export_OtherAdditions` | Other additions | Shtesat tjera |
| `Export_Gross` | Gross | Bruto |
| `Export_EmployeePension` | Employee pension | Kontributi i punonjësit |
| `Export_EmployerPension` | Employer pension | Kontributi i punëdhënësit |
| `Export_Pit` | PIT | Tatimi në paga |
| `Export_Deductions` | Deductions | Zbritjet |
| `Export_NetPay` | Net pay | Paga neto |
| `Export_PrimaryEmployer` | Primary employer | Punëdhënës primar |
| `Export_HasContributions` | Has contributions | Ka kontribute |
| `Export_HasTax` | Has tax | Ka tatim |

Note: SQ translations for pension and PIT match Genci's file headers exactly ("Kontributi Pensional Punedhenesit/Punetorit", "Tatimi ne Paga").

### Frontend
No change — the export is server-rendered and the web already sends `Accept-Language`.

---

## 8. More HR reports

Based on Odoo's standard set and Kosovo accountant needs, build these in priority order:

### Phase 1 (this sprint)
No new reports yet — clarify with the accountant which of these they need most:

1. **Headcount by department** — employee count per department, with hire/termination trends
2. **Payroll analysis (monthly)** — total gross, pension, PIT, net by month (pivot by department)
3. **Tax liability summary** — PIT + pension totals per month, for ATK declarations
4. **Contract expiration** — contracts ending in the next 30/60/90 days

### Action
Ask the accountant to rank these four. Then build the top 1–2 as the first HR reports under `reports/hr/`.

Each report follows the existing pattern:
- Backend: calculator in `Pako.Domain/Reporting`, controller under `reports/hr/{reportName}` + `/export`
- Frontend: tab under Reports page, using `ReportGrid` or `DataGrid`

---

## 9. Employee list & payroll list — match Genci's column layout

**No longer blocked.** Both reference files are now available.

### 9a. Employee list (`Employees.tsx`) — match `Employees List_10-2026.xlsx`

Genci's file has 12 columns. Our current grid has 8. The difference:

| Genci's column | Our column | Status |
|----------------|-----------|--------|
| A: Emri | name | EXISTS |
| B: Numri personal | personalNumber | EXISTS |
| C: Departamenti | department | EXISTS |
| D: Pozita | jobTitle | EXISTS |
| E: Data e punësimit | hireDate | EXISTS |
| F: Paga aktuale | currentSalary | EXISTS |
| G: Kontributi Pensional Punedhenesit | — | **ADD** (computed: `currentSalary * 0.05`) |
| H: Kontributi Pensional Punetorit | — | **ADD** (computed: `currentSalary * 0.05`) |
| I: Tatimi ne Paga | — | **ADD** (requires backend field or computed) |
| J: Paga NETO | — | **ADD** (requires backend field or computed) |
| K: Statusi | status | EXISTS |
| L: Paralajmërimet | warnings | EXISTS |

**Problem:** Columns G–J are payroll-computed values (PIT depends on brackets, primary/secondary status, exemptions). We MUST NOT compute these in the browser (frontend rule). Two options:

#### Option A — Add computed payroll columns to `EmployeeDetailResponse` (recommended)
Backend computes `estimatedEmployeePension`, `estimatedEmployerPension`, `estimatedPit`, `estimatedNetPay` from the current salary + employee flags, using the same `PayrollCalculationService`. These are estimates (the real values come from an actual payroll run), but match what the accountant expects to see.

#### Option B — Separate endpoint for the employee list with payroll preview
A `GET /employees/payroll-preview` endpoint that returns the list with computed columns. Heavier but keeps the main list lean.

**Recommendation: Option A.** Add 4 optional fields to `EmployeeDetailResponse`:
```csharp
// Estimated monthly payroll breakdown at the current salary. Null when pay data is hidden.
decimal? EstimatedEmployeePension,
decimal? EstimatedEmployerPension,
decimal? EstimatedPit,
decimal? EstimatedNetPay
```

#### Backend — `EmployeesController.cs`
- After building the response, compute estimates for each employee using `PayrollCalculationService.EstimateMonthly(employee)` (new method that takes salary + flags and returns the four figures).
- Only populate when caller has Payroll:Read access.

#### Backend — `PayrollCalculationService`
- Add `EstimateMonthly(decimal grossSalary, bool isPrimary, bool pensionExempt, bool taxExempt)` → returns `(employeePension, employerPension, pit, netPay)`.
- Uses the same brackets and rates as the real payroll, but without adjustments/bonuses/deductions.

#### Frontend — `Employees.tsx`
- Add 4 new columns after `currentSalary`:
  - `estimatedEmployerPension` — "Kon. punëdhënësit"
  - `estimatedEmployeePension` — "Kon. punonjësit"
  - `estimatedPit` — "Tatimi në paga"
  - `estimatedNetPay` — "Paga neto"
- All numeric, right-aligned, tabular-nums, `€` suffix.
- Hidden when `payDataHidden` is true.

#### Frontend — Employee list export
- Update `exportFileName` to follow the new naming pattern (item #10).
- Include the new columns in the client-side CSV/Excel export.

#### i18n — `messages.hr.ts`
- `hr.employee.estimatedEmployerPension` — EN: "Employer pension", SQ: "Kon. punëdhënësit"
- `hr.employee.estimatedEmployeePension` — EN: "Employee pension", SQ: "Kon. punonjësit"
- `hr.employee.estimatedPit` — EN: "PIT", SQ: "Tatimi në paga"
- `hr.employee.estimatedNetPay` — EN: "Net pay", SQ: "Paga neto"

### 9b. Payroll list view — match `lista-e-pagave-2026-05.xlsx`

Genci's payroll list has:
- Row 1: title "Lista e Pagave" + "Periudha 2026-05" (this is just the Excel header row)
- Columns: Nr. Personal, Emri, Paga Bruto, Kon. e Punëtorit, Kon. e Punëdhënësit, Tatimi, Primare, Ka Kontribute, Ka Tatim

Our current `PayrollRunDetail.tsx` grid already has all the numeric columns (gross, pensions, PIT, net).
Missing from the grid: **Primare** (PO/JO), **Ka Kontribute** (PO/JO), **Ka Tatim** (PO/JO).

#### Backend — `PayslipDetailResponse`
- Already has `IsPrimaryEmployer` (shown as Yes/No in export).
- Add: `bool PensionExempt` and `bool TaxExempt` (snapshot from employee at payroll computation time).

**Wait:** These should be snapshots on the payslip line, not live employee fields, since the payroll is a historical record. Check if `PayslipLine` already stores `IsPrimaryEmployer` — yes it does. Need to also snapshot `PensionExempt` and `TaxExempt`.

#### Backend — `PayslipLine.cs`
- Add: `public bool PensionExempt { get; set; }` (snapshotted at payroll compose)
- Add: `public bool TaxExempt { get; set; }` (snapshotted at payroll compose)

#### Backend — `PayrollCalculationService` (compose step)
- When creating payslip lines, snapshot `employee.PensionExempt` and `employee.TaxExempt`.

#### Backend — `PayslipDetailResponse`
- Add: `bool PensionExempt`, `bool TaxExempt`

#### Backend — Payroll register export
- Add two columns after "Primary employer": "Ka Kontribute" (PO/JO), "Ka Tatim" (PO/JO)
- Use the new resx keys `Export_HasContributions` and `Export_HasTax`.

#### Frontend — `PayrollRunDetail.tsx`
- Add 3 columns at the end of the payslips grid:
  - `isPrimaryEmployer` — badge PO/JO
  - `pensionExempt` — displayed inverted as "Ka Kontribute" PO/JO
  - `taxExempt` — displayed inverted as "Ka Tatim" PO/JO

#### i18n
- `payroll.payslip.isPrimary` — EN: "Primary", SQ: "Primare"
- `payroll.payslip.hasContributions` — EN: "Has contributions", SQ: "Ka kontribute"
- `payroll.payslip.hasTax` — EN: "Has tax", SQ: "Ka tatim"
- `common.yes` — EN: "Yes", SQ: "PO" (if not already present)
- `common.no` — EN: "No", SQ: "JO" (if not already present)

---

## 10. Export file naming — `{Period}-{Title}-{BusinessName}`

**Current:**
- Frontend fallback: `payroll-register-2026-10.xlsx`
- Backend `Content-Disposition`: `payroll-register-202610.xlsx`

**Change:** Backend sets the filename to `{Period}-{Title}-{CompanyName}.xlsx`. The frontend fallback follows the same pattern.

### Backend — `PayrollRunsController.cs`

The controller needs the company name. Load it once and use in filenames:

```csharp
var company = await _db.Companies.AsNoTracking()
    .Where(c => c.Id == companyId).Select(c => c.Name).FirstAsync();
```

Then:
- Register: `$"{run.PeriodStart:yyyy-MM}-{Label("Export_PayrollRegister")}-{company}.xlsx"`
- EDI: `$"{run.PeriodStart:yyyy-MM}-EDI-{company}.xlsx"`
- Payslip PDF: `$"{run.PeriodStart:yyyy-MM}-{Label("Export_Payslip")}-{employeeName}.pdf"`
- Payslips ZIP: `$"{run.PeriodStart:yyyy-MM}-{Label("Export_Payslips")}-{company}.zip"`

Sanitize the company name for filenames (replace `/\:*?"<>|` with `-`).

### Backend — resx
- `Export_PayrollRegister` — EN: "Payroll Register", SQ: "Lista e pagave"
- `Export_Payslip` — EN: "Payslip", SQ: "Fletëpagesa"
- `Export_Payslips` — EN: "Payslips", SQ: "Fletëpagesat"
- `Export_EmployeesList` — EN: "Employees List", SQ: "Lista e punonjësve"

### Frontend — `PayrollRunDetail.tsx`
- Update fallback filenames (lines 188, 201, 205) to match the same pattern using `activeCompany.name`.
- Pattern: `` `${month}-${title}-${activeCompany.name}.xlsx` ``

### Frontend — `Employees.tsx`
- Update `exportFileName` to: `` `${intl.formatMessage({ id: "export.employeesList" })}-${activeCompany.name}` ``

### Other exports (scope creep guard)
Apply the same naming convention to other exports (reports, stock, etc.) in a **separate commit** — not in this PR. Document the convention here and apply it uniformly later.

---

## Implementation Order

| Step | Items | Layer | Risk | Depends on |
|------|-------|-------|------|------------|
| 1 | 3 (TaxExempt field) | Backend: migration + domain + EF config | Low | — |
| 2 | 9b (Snapshot PensionExempt/TaxExempt on PayslipLine) | Backend: migration + payroll compose | Low | Step 1 |
| 3 | 9a (EstimateMonthly on employee list) | Backend: PayrollCalculationService + controller | Medium | Step 1 |
| 4 | 7 (Localize register headers) + 7 extra cols | Backend: resx + controller | Low | Step 2 |
| 5 | 10 (File naming) | Backend: controller + resx | Low | Step 4 |
| 6 | 6 (Employee history endpoint) | Backend: controller | Low | — |
| 7 | Regenerate API client | Shared | — | Steps 1–6 |
| 8 | 1, 2, 3, 4, 6, 9a, 9b, 10 (all FE) | Frontend: EmployeeDetail + Employees + PayrollRunDetail + i18n | Medium | Step 7 |

### Not in scope (this PR)
- Item 5: No change (matches Odoo default).
- Item 8: Needs accountant ranking before building.
- Applying the file naming convention to non-payroll exports.

### Commits
1. `feat(be): add Employee.TaxExempt for PIT exemption` — migration, domain, controller, payroll calc, tests
2. `feat(be): snapshot PensionExempt/TaxExempt on payslip lines` — migration, payroll compose, response
3. `feat(be): add estimated payroll columns to employee list` — PayrollCalculationService.EstimateMonthly, controller
4. `fix(be): localize payroll register export headers + add boolean columns` — resx keys, controller
5. `feat(be): export filenames use Period-Title-Company pattern` — controller, resx
6. `feat(be): employee change history endpoint` — EmployeesController proxy to audit
7. `chore: regenerate API client` — pnpm generate:api-client
8. `feat(fe): employee form feedback` — employer type select, contributions inverted, tax applied, IBAN label, history tab, payroll columns on employee list + payslip grid, export filenames
