# PAKO Urdheresa: Fields, Numbering & Dimensions Audit and Fix

## 1. Requirement Coverage Matrix

| Requirement | Already Implemented? | Working Correctly? | Action Needed | Status |
|---|---|---|---|---|
| Automatic Urdheresa number | YES - `SequenceNumber` via `NumberSeriesService` | YES - "URD-{seq:D6}" pattern, assigned on Post | None | **ALREADY IMPLEMENTED AND VERIFIED** |
| Description (Pershkrimi) | YES - `Reference` field (256 chars) serves as document-level description | YES - saved, retrieved, displayed | None - UI already labeled "Reference" / "Referenca" | **ALREADY IMPLEMENTED AND VERIFIED** |
| Remarks (Verejtje) | NO | N/A | Added `Remarks` field (1024 chars) to entity, contracts, API, and frontend | **NEW FEATURE -- IMPLEMENTED** |
| Full eligible Account dropdown | YES - searchable PickerCell, R02/R04/R05 enforced | YES - all postable, non-control accounts available | None | **ALREADY IMPLEMENTED AND VERIFIED** |
| Partner selection | YES - optional PickerCell on each journal line | YES - searchable, company-scoped | None | **ALREADY IMPLEMENTED AND VERIFIED** |
| Project dimension | NO - no Project entity existed | N/A | Created Project entity, CRUD controller, line-level FK, frontend picker | **NEW FEATURE -- IMPLEMENTED** |
| Employee dimension | PARTIAL - Employee entity existed in Payroll, not linked to journal lines | N/A | Added `EmployeeId` FK to JournalEntryLine, frontend picker | **NEW FEATURE -- IMPLEMENTED** |
| Data persistence | YES for existing fields | YES | Extended for Remarks, ProjectId, EmployeeId | **NEW FEATURE -- IMPLEMENTED** |
| Detail display | YES for existing fields | YES | Added Remarks column to JournalEntriesTable | **NEW FEATURE -- IMPLEMENTED** |
| EN/SQ localization | YES for existing keys | YES | Added all new i18n keys in EN and SQ | **NEW FEATURE -- IMPLEMENTED** |

## 2. Automatic Numbering (Pre-existing)

Already fully implemented via `NumberSeriesService`:
- **Default pattern**: `URD-{seq:D6}` (e.g., "URD-000001")
- **Configurable**: Admin can change via NumberingSettings
- **Supported formats**: `{yyyy}{mm}{dd}-{seq:D4}` or `PREFIX-{seq:D6}`
- **Concurrency safe**: Postgres row lock on Journal table during post
- **Derived counter**: No stored counter -- derives from highest existing
- **Assigned on Post**: `SequenceNumber` set in `JournalEntriesController.Post()`
- **Immutable after posting**: `PakoDbContext.ValidateImmutability` enforces

No changes needed.

## 3. Description Field (Pre-existing)

The `Reference` field on `JournalEntry` serves as the document-level description:
- **Backend**: `Reference` (string?, max 256 chars) on `JournalEntry` entity
- **Frontend**: Text input labeled "Reference" / "Referenca" in the header form
- **Separate from line descriptions**: Each `JournalEntryLine` has its own `Description` (max 512 chars)
- **Persisted and displayed**: In list view (`JournalEntriesTable`), detail view, and XLSX export

No changes needed. The field already serves the purpose of "Pershkrimi".

## 4. Remarks Field (New)

**Gap**: No separate Remarks/Notes field existed.

**Implementation**:

### Backend
- `JournalEntry.cs`: Added `Remarks` (string?, max 1024 chars)
- `JournalEntryConfiguration.cs`: Added `.HasMaxLength(1024)` config
- `JournalEntryContracts.cs`: Added `Remarks` to `CreateJournalEntryRequest` (optional, default null) and `JournalEntryResponse`
- `JournalEntriesController.cs`: Wired `Remarks` through Create and ToResponse
- `JournalEntry.Reverse()`: Copies `Remarks` to reversal entry
- **Migration**: `AddJournalEntryFieldsAndProjects` adds `Remarks` column to `journal_entries`

### Frontend
- `JournalEntryGrid.tsx`: Added `remarks` state, Remarks input field in header, included in save payload, cleared on success
- `JournalEntriesTable.tsx`: Added Remarks column to the DataGrid
- `messages.ts`: Added `journalGrid.remarks`, `journalGrid.remarksPlaceholder`, `journalEntries.remarks` in EN and SQ

## 5. Account Dropdown (Pre-existing)

Already fully implemented:
- **Searchable PickerCell**: Filters by code or name, case-insensitive
- **Company-scoped**: Only accounts belonging to `companyId` are fetched
- **R02 enforced**: Non-postable (header/group) accounts rejected by controller
- **R04 enforced**: Control accounts rejected for manual journal entries
- **R05 enforced**: System-computed account 304100 rejected
- **Active/inactive**: Inactive accounts excluded from the fetch (via `accountsAll`)
- **Max 50 shown**: Dropdown truncates large lists

No changes needed.

## 6. Partner Selection (Pre-existing)

Already fully implemented at the journal-line level:
- **Optional PickerCell**: On each grid line, labeled "Partner" / "Partneri"
- **Searchable**: By partner name
- **Company-scoped**: `partnersAll(companyId)` fetches only this company's partners
- **Not mandatory**: R03 partner subledger rule NOT enforced on manual entries (by design -- accountant must post adjusting entries without partner)
- **Persisted**: `PartnerId` on `JournalEntryLine`, round-trips through API
- **Copied on reversal**: `JournalEntry.Reverse()` preserves `PartnerId`

No changes needed.

## 7. Project Dimension (New)

**Gap**: No Project entity existed anywhere in the codebase.

**Implementation**:

### Domain
- **New entity**: `Pako.Domain/Ledger/Project.cs` (Id, CompanyId, Code, Name, IsActive)
- **Line-level attribution**: `ProjectId` (Guid?) added to `JournalEntryLine` -- each line can reference a different project

### Backend
- **ProjectConfiguration.cs**: EF config with unique index on (CompanyId, Code)
- **PakoDbContext.cs**: Added `DbSet<Project> Projects`
- **ProjectContracts.cs**: `CreateProjectRequest`, `UpdateProjectRequest`, `ProjectResponse`
- **ProjectsController.cs**: List, Create, Update endpoints at `/api/companies/{companyId}/projects`
- **ErrorMessages.resx/.sq.resx**: Added `ProjectCodeRequired`, `ProjectNameRequired`, `ProjectCodeAlreadyExists` in EN and SQ
- **JournalEntryContracts.cs**: Added `ProjectId` to line request (optional, default null) and response
- **JournalEntriesController.cs**: Wired `ProjectId` through Create and ToResponse
- **JournalEntry.Reverse()**: Copies `ProjectId` to reversal lines
- **Migration**: Creates `projects` table and adds `ProjectId` column + index to `journal_entry_lines`

### Frontend
- `types.ts`: Added `projectId`, `projectLabel` to `GridLine`; "project" to `GRID_COLUMNS`
- `lineFields.ts`: Added project case to `getCellText` and `commitCellValue`
- `JournalEntryGrid.tsx`: Fetches projects via `apiClient.projectsAll()`, searchable PickerCell in grid
- `messages.ts`: Added `journalGrid.colProject`, `journalGrid.projectPlaceholder` in EN and SQ

### Design Decision
**Line-level, not document-level**: A single Urdheresa can allocate amounts across multiple projects (e.g., Expense A to Project A, Expense B to Project B).

### Follow-up Work
- Project management UI (list/create/edit page) -- currently projects can only be managed via API
- Project-based reporting (filter journal entries by project)

## 8. Employee Dimension (New)

**Gap**: Employee entity existed in Payroll (`Pako.Domain/Payroll/Employee.cs`) but was not linked to journal entries.

**Implementation**:

### Backend
- `JournalEntryLine.cs`: Added `EmployeeId` (Guid?) field
- `JournalEntryContracts.cs`: Added `EmployeeId` to line request (optional, default null) and response
- `JournalEntriesController.cs`: Wired `EmployeeId` through Create and ToResponse
- `JournalEntry.Reverse()`: Copies `EmployeeId` to reversal lines
- **Migration**: Adds `EmployeeId` column + index to `journal_entry_lines`

### Frontend
- `types.ts`: Added `employeeId`, `employeeLabel` to `GridLine`; "employee" to `GRID_COLUMNS`
- `lineFields.ts`: Added employee case to `getCellText` and `commitCellValue`
- `JournalEntryGrid.tsx`: Fetches employees via `apiClient.employeesAll()`, searchable PickerCell in grid
- `messages.ts`: Added `journalGrid.colEmployee`, `journalGrid.employeePlaceholder` in EN and SQ

### Design Decision
**Line-level, not document-level**: Reuses the existing `Employee` entity from Payroll. A single Urdheresa can reference multiple employees across its lines.

## 9. Other Analytical Dimensions

**Already exists**: `AnalyticDistribution` (Dictionary<Guid, decimal>?) on `JournalEntryLine` supports percentage-based splits across cost centers. This is a different pattern from Project/Employee (which are single-selection per line).

**Current dimensions**:
| Dimension | Entity | Level | Selection Type |
|---|---|---|---|
| Cost Center | `CostCenter` | Line | Percentage split (0-100%) |
| Project | `Project` (new) | Line | Single selection |
| Employee | `Employee` | Line | Single selection |
| Partner | `Partner` | Line | Single selection |

**Not implemented** (not requested, would need separate tickets):
- Department
- Branch
- Custom dimensions

The architecture supports future dimensions: the jsonb `AnalyticDistribution` field handles percentage-based splits, while foreign key fields handle single-selection dimensions.

## 10. Database Migration

**File**: `backend/Pako.Infrastructure/Migrations/20261016095359_AddJournalEntryFieldsAndProjects.cs`

**Changes**:
1. `journal_entries` table: Added `Remarks` (varchar(1024), nullable)
2. `journal_entry_lines` table: Added `ProjectId` (uuid, nullable) with index
3. `journal_entry_lines` table: Added `EmployeeId` (uuid, nullable) with index
4. New `projects` table: Id (PK), CompanyId, Code (varchar(32)), Name (varchar(256)), IsActive
5. Unique index on `projects(CompanyId, Code)`

All changes are additive. No existing data is modified.

## 11. Files Modified

### Backend
| File | Change |
|---|---|
| `backend/Pako.Domain/Ledger/JournalEntry.cs` | Added `Remarks` property, updated `Reverse()` |
| `backend/Pako.Domain/Ledger/JournalEntryLine.cs` | Added `ProjectId`, `EmployeeId` properties |
| `backend/Pako.Domain/Ledger/Project.cs` | **New** -- Project entity |
| `backend/Pako.Api/Contracts/JournalEntryContracts.cs` | Added fields to request/response records |
| `backend/Pako.Api/Contracts/ProjectContracts.cs` | **New** -- Project CRUD contracts |
| `backend/Pako.Api/Controllers/JournalEntriesController.cs` | Wired new fields in Create and ToResponse |
| `backend/Pako.Api/Controllers/ProjectsController.cs` | **New** -- Project CRUD controller |
| `backend/Pako.Api/Resources/ErrorMessages.resx` | Added 3 Project error messages (EN) |
| `backend/Pako.Api/Resources/ErrorMessages.sq.resx` | Added 3 Project error messages (SQ) |
| `backend/Pako.Infrastructure/Configurations/JournalEntryConfiguration.cs` | Added Remarks config |
| `backend/Pako.Infrastructure/Configurations/ProjectConfiguration.cs` | **New** -- EF config |
| `backend/Pako.Infrastructure/PakoDbContext.cs` | Added `DbSet<Project>` |
| `backend/Pako.Infrastructure/Migrations/20261016095359_*.cs` | **New** -- Migration + Designer |
| `backend/Pako.Infrastructure/Migrations/PakoDbContextModelSnapshot.cs` | Updated by EF |

### Frontend
| File | Change |
|---|---|
| `apps/web/src/pages/ledger/JournalEntryGrid.tsx` | Added Remarks field, Project/Employee pickers, fetch effects |
| `apps/web/src/pages/ledger/JournalEntriesTable.tsx` | Added Remarks column |
| `apps/web/src/pages/ledger/journal-grid/types.ts` | Added project/employee to GridLine and GRID_COLUMNS |
| `apps/web/src/pages/ledger/journal-grid/lineFields.ts` | Added project/employee commit/getCellText cases |
| `apps/web/src/pages/ledger/journal-grid/lineFields.test.ts` | Updated OPTIONS fixture |
| `apps/web/src/pages/ledger/journal-grid/gridNavigation.test.ts` | Updated column count references |
| `apps/web/src/pages/ledger/JournalEntryGrid.test.tsx` | Added projectsAll/employeesAll mocks, updated Tab test |
| `apps/web/src/i18n/messages.ts` | Added 10 new keys (EN + SQ) |
| `packages/shared/src/generated/api-client.ts` | Regenerated from OpenAPI |

## 12. Test Results

### Backend
- **15/15 JournalEntriesControllerTests**: PASS
- **13/13 JournalEntryPostingTests**: PASS
- **10/10 JournalsControllerTests**: PASS
- **5/5 NumberSeriesControllerTests**: PASS
- **13 pre-existing failures**: ItemsControllerTests (11) + InvoicesControllerTests (2) -- unrelated DB migration issue with `20261015120000_AddItemDescription.cs` (missing Designer.cs)

### Frontend
- **146/146 tests**: PASS
- Typecheck: PASS
- Lint: PASS
- Build: PASS

## 13. Remaining Limitations

1. **Project management UI**: Projects can only be created/managed via API. A Settings page for project CRUD would improve usability.
2. **Employee references**: No validation that referenced EmployeeId belongs to the same company (relies on frontend fetching only company-scoped employees). Backend FK validation could be added.
3. **Project references**: Same as Employee -- no backend FK validation. The controller trusts the frontend's company-scoped fetch.
4. **No cascade behavior**: If a Project is deactivated, existing journal lines still reference it. This is intentional (historical data preservation).
5. **Cost center distribution**: Still mocked on frontend (pre-existing -- not part of this ticket).

## 14. Manual Verification Steps

1. Create a new journal entry with all fields populated (Reference, Remarks, lines with accounts, partners, projects, employees)
2. Verify the entry saves and posts successfully
3. Verify the auto-generated sequence number appears (e.g., "URD-000001")
4. Verify Remarks appears in the journal entries list
5. Verify a reversal copies Remarks, ProjectId, and EmployeeId
6. Switch language to Albanian -- verify all new labels display correctly
7. Tab through the grid -- verify Project and Employee columns are reachable
8. Search in the Project/Employee dropdowns -- verify results filter correctly
