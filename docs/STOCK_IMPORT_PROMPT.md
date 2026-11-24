# Stock Excel Import — Full Implementation Prompt

You are implementing a **Stock Excel Import** feature for the PAKO accounting platform. This is a migration tool: users upload an Excel file to bulk-create stock items (Goods only, not services) with their opening quantities and costs. The feature spans backend (ASP.NET Core) and frontend (React).

Read the full CLAUDE.md at the project root before starting — it contains critical repo hazards (especially #1: never `git add -A`), conventions, and architecture rules.

---

## Decision Summary

| # | Decision |
|---|----------|
| 1 | **Category** is an Excel column. If the name doesn't match an existing category, **auto-create it**. |
| 2 | **Stock-only** — all imported items are `Type=Goods`, `TrackInventory=true`. Services are excluded from this import. Opening Qty + Unit Cost columns are included. |
| 3 | **Preview before commit** — upload parses & validates server-side, returns a preview table with per-row status (ready/warning/error). User reviews the table, then confirms to finalize. Nothing is persisted until confirm. |
| 4 | **Warehouse picker** in the import dialog — user selects which warehouse receives the opening stock. |
| 5 | **Row cap**: 9,000 rows max. |
| 6 | **Fallback accounts** (revenue, expense, inventory) are **optional** in the dialog. Rows without account codes that also have no fallback will error. |
| 7 | **No export** in this feature — export existing items is a separate task. |

---

## User Flow (3-Step Dialog)

```
┌─────────────────────────────────────────────────────┐
│  STEP 1: Setup                                       │
│  • Download template / Download with examples        │
│  • Pick warehouse (dropdown, default = company main) │
│  • Optional: pick fallback accounts (revenue,        │
│    expense, inventory) for rows that omit them       │
│  • Drag-and-drop .xlsx upload zone (max 10MB)        │
│  • [Parse & Preview] button                          │
├─────────────────────────────────────────────────────┤
│  STEP 2: Preview & Fix                               │
│  • Table showing all parsed rows with columns:       │
│    Row#, Status, Name, Unit, Category, Sale Price,   │
│    Opening Qty, Unit Cost, Accounts, Errors          │
│  • Status column: ✓ Ready / ⚠ Warning / ✗ Error     │
│  • Errors inline per row (duplicate name, missing    │
│    required field, bad account code, etc.)           │
│  • Summary bar: "247 ready, 3 warnings, 5 errors"   │
│  • Error rows are skipped on import                  │
│  • [Import N items] / [Re-upload] / [Cancel]         │
├─────────────────────────────────────────────────────┤
│  STEP 3: Results                                     │
│  • Created: N items                                  │
│  • Opening stock document created (with link)        │
│  • Categories auto-created: list                     │
│  • Skipped rows: count with reasons                  │
│  • [Done] button closes dialog & refreshes item list │
└─────────────────────────────────────────────────────┘
```

---

## Excel Template Structure

**Sheet 1: "Stock"** — the data sheet

| Column | Header (EN) | Header (SQ) | Required | Type | Notes |
|--------|-------------|-------------|----------|------|-------|
| A | Name | Emri | YES | string | Product name |
| B | Description | Përshkrimi | no | string | Optional |
| C | Unit | Njësia | YES | string | Base unit ("piece", "kg", "liter") |
| D | Category | Kategoria | no | string | Category name — auto-created if not found |
| E | Sale Price | Çmimi i Shitjes | no | decimal | Default unit price |
| F | Revenue Account | Llogaria e të Ardhurave | no | string | Account code (e.g. "601000") |
| G | Expense Account | Llogaria e Shpenzimeve | no | string | Account code (e.g. "501000") |
| H | Inventory Account | Llogaria e Inventarit | no | string | Account code (e.g. "120100") |
| I | VAT Code | Kodi i TVSH-së | no | string | Tax definition name |
| J | Min Stock | Stoku Minimal | no | decimal | Low-stock threshold |
| K | Barcode | Barkodi | no | string | Unique per company, max 64 chars |
| L | Opening Qty | Sasia Fillestare | no | decimal | Quantity on hand at import date |
| M | Opening Unit Cost | Kosto për Njësi | conditional | decimal | Required if Opening Qty > 0 |
| N | Purchase Unit | Njësia e Blerjes | no | string | e.g. "box" |
| O | Purchase Factor | Faktori i Blerjes | no | decimal | e.g. 24 (1 box = 24 pieces) |
| P | Sales Unit | Njësia e Shitjes | no | string | |
| Q | Sales Factor | Faktori i Shitjes | no | decimal | |

**Sheet 2: "Reference"** — help sheet explaining each column with examples. Not parsed during import.

**Template with examples** (`?filled=true`): includes 3 sample rows showing different scenarios (item with all fields, item with minimal fields, item with opening stock).

---

## Backend Endpoints

All under `api/companies/{companyId}/items/import`.

### 1. `GET /template?filled={bool}`

Returns an .xlsx file with the two sheets above. Use `ExcelExportService.BuildWorkbook(sheets)` with the multi-sheet overload. Headers should be localized based on `Accept-Language` (EN or SQ).

### 2. `POST /preview`

**Input**: multipart form with:
- `file` — the .xlsx file
- `fallbackRevenueAccountId` (optional Guid)
- `fallbackExpenseAccountId` (optional Guid)
- `fallbackInventoryAccountId` (optional Guid)

**Logic**:
1. Validate file size (≤ 10MB) and format (.xlsx)
2. Parse "Stock" sheet (or first sheet) with ClosedXML
3. Enforce 9,000 row cap
4. For each row, validate:
   - Name required, non-empty
   - Unit required, non-empty
   - If account codes provided, resolve them against company accounts by `Code` field
   - If account codes NOT provided, use fallback IDs (if given). If still missing → error
   - Category: look up by name in company. Mark as "new" if not found (not an error)
   - Barcode: check uniqueness within the file and against existing company barcodes
   - Duplicate name: check within the file and against existing company items
   - Opening Qty > 0 requires Opening Unit Cost > 0
   - Unit validation (purchase/sales unit rules from ItemsController)
   - VAT code: match by name against company's TaxDefinitions
5. Return `StockImportPreviewResponse`

**Response contract**:
```csharp
public record StockImportPreviewResponse(
    List<StockImportPreviewRow> Rows,
    StockImportSummary Summary,
    List<string> NewCategories);

public record StockImportPreviewRow(
    int RowNumber,
    string Status,  // "Ready", "Warning", "Error"
    string? Name,
    string? Unit,
    string? Category,
    decimal? SalePrice,
    string? RevenueAccountCode,
    string? ExpenseAccountCode,
    string? InventoryAccountCode,
    string? VatCode,
    decimal? MinimumStock,
    string? Barcode,
    decimal? OpeningQty,
    decimal? OpeningUnitCost,
    string? PurchaseUnit,
    decimal? PurchaseFactor,
    string? SalesUnit,
    decimal? SalesFactor,
    string? Description,
    List<string> Errors,
    List<string> Warnings);

public record StockImportSummary(int Ready, int Warnings, int ErrorCount);
```

### 3. `POST /confirm`

**Input**: same as preview (file + fallback account IDs) plus:
- `warehouseId` (required Guid)
- `openingDate` (DateOnly — the date for the opening stock document)

**Logic** (all in one transaction):
1. Re-parse and re-validate (server is stateless)
2. Skip error rows
3. Auto-create missing `ItemCategory` entries (name only, no default accounts)
4. Create `Item` entities:
   - `Type = ItemType.Goods`
   - `TrackInventory = true`
   - `Code` assigned via `NumberSeriesService.ReserveNextAsync(companyId, "Item", year)` — called once per item
   - All three default accounts required (from row or fallback)
   - Other fields mapped from Excel columns
5. If any rows have Opening Qty > 0:
   - Create one `StockDocument` with `Type = Opening`, `Date = openingDate`, `WarehouseId = warehouseId`
   - Add a `StockDocumentLine` per item with opening stock: `ItemId`, `Quantity`, `UnitCost`
   - Save as draft via `StockDocumentService.SaveDraftAsync`
   - Post via `StockDocumentService.PostAsync` (creates journal entries: Dr Stock / Cr 390100)
6. Return result

**Response contract**:
```csharp
public record StockImportConfirmResponse(
    int Created,
    int Skipped,
    List<string> CreatedCategories,
    Guid? OpeningDocumentId,
    string? OpeningDocumentNumber,
    List<StockImportRowError> Errors);

public record StockImportRowError(int RowNumber, string Message);
```

---

## Frontend Implementation

### File: `apps/web/src/pages/items/StockImportDialog.tsx`

A new component rendered from `Items.tsx`, replacing the "coming soon" toast on the import button.

**Key requirements**:
- Use `FormDialog` (from `@/components/shared/FormDialog`) with `size="full"` for the preview step
- 3-step wizard: Setup → Preview → Results
- **Warehouse selector**: use existing warehouse list endpoint, default to company's default warehouse
- **Account pickers**: 3 optional `SearchableSelect` components filtered by account type (like ItemForm does)
- **File drop zone**: accept .xlsx only, max 10MB, drag-and-drop + click to browse
- **Preview table**: simple `<table>` (not DataGrid — this is a one-time preview, not a persistent list). Color-code rows: green for ready, yellow for warning, red for error. Show error messages inline.
- **Summary bar**: "N ready, N warnings, N errors" with colored badges
- **Import button**: disabled if 0 ready rows. Shows count: "Import 247 items"
- **Results step**: show created count, link to opening stock document, list of auto-created categories, list of skipped rows with reasons

### Wire into Items.tsx

Replace line 551's toast with:
```tsx
<Button variant="outline" onClick={() => setImportOpen(true)}>
  {intl.formatMessage({ id: "items.import.title" })}
</Button>
```

Add state: `const [importOpen, setImportOpen] = useState(false);`

Render: `{importOpen && <StockImportDialog open={importOpen} onOpenChange={setImportOpen} onComplete={() => itemsQuery.refetch()} />}`

### i18n

Add these keys to `apps/web/src/i18n/messages.inventory.ts` (both EN in `inventoryEn` and SQ in `inventorySq`):

```
items.import.step.setup
items.import.step.preview
items.import.step.results
items.import.downloadTemplate
items.import.downloadFilled
items.import.warehouse
items.import.warehouse.description
items.import.fallbackAccounts
items.import.fallbackAccounts.description
items.import.fallbackRevenue
items.import.fallbackExpense
items.import.fallbackInventory
items.import.parsePreview
items.import.preview.ready
items.import.preview.warnings
items.import.preview.errors
items.import.preview.summary
items.import.confirm
items.import.confirm.count
items.import.reupload
items.import.results.created
items.import.results.skipped
items.import.results.categories
items.import.results.openingDoc
items.import.results.done
items.import.error.nameRequired
items.import.error.unitRequired
items.import.error.accountsMissing
items.import.error.duplicateName
items.import.error.duplicateBarcode
items.import.error.openingCostRequired
items.import.error.rowCap
items.import.error.fileTooLarge
items.import.error.parseError
```

---

## Existing Code Reference

### ExcelExportService.cs (the shared XLSX builder)

```csharp
using ClosedXML.Excel;

namespace Pako.Api.Services;

public record ExportSheet(
    string Name, IReadOnlyList<(string Label, object? Value)>? HeaderBlock, IReadOnlyList<string> Headers, IReadOnlyList<IReadOnlyList<object?>> Rows);

public static class ExcelExportService
{
    public const string XlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public static byte[] BuildWorkbook(string sheetName, IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<object?>> rows) =>
        BuildWorkbook(sheetName, null, headers, rows);

    public static byte[] BuildWorkbook(
        string sheetName, IReadOnlyList<(string Label, object? Value)>? headerBlock, IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<object?>> rows) =>
        BuildWorkbook(new[] { new ExportSheet(sheetName, headerBlock, headers, rows) });

    public static byte[] BuildWorkbook(IReadOnlyList<ExportSheet> sheets)
    {
        using var workbook = new XLWorkbook();
        foreach (var spec in sheets) WriteSheet(workbook, spec);
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    private static void WriteSheet(XLWorkbook workbook, ExportSheet spec) { /* ... writes headers, rows, freezes, auto-fits */ }
    private static void WriteCell(IXLCell cell, object? value) { /* handles string, DateOnly, DateTime, decimal, int, bool */ }
    private static string SanitizeSheetName(string name) { /* max 31 chars, no special chars */ }
}
```

### Item.cs (Domain entity — 105 lines)

```csharp
namespace Pako.Domain.Companies;

public enum ItemType { Goods, Service, Normative }

[Pako.Domain.Shared.Audited]
public class Item
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public int Code { get; set; }                          // auto-assigned ordinal
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Unit { get; set; } = string.Empty;
    public ItemType Type { get; set; } = ItemType.Goods;
    public Guid? DefaultTaxDefinitionId { get; set; }
    public Guid? DefaultRevenueAccountId { get; set; }     // REQUIRED on create
    public Guid? DefaultExpenseAccountId { get; set; }     // REQUIRED on create
    public Guid? DefaultInventoryAccountId { get; set; }   // REQUIRED on create
    public decimal? DefaultUnitPrice { get; set; }
    public bool IsActive { get; set; } = true;
    public Guid? CategoryId { get; set; }
    public bool TrackInventory { get; set; }
    public decimal? MinimumStock { get; set; }
    public uint RowVersion { get; set; }
    public List<ItemBarcode> Barcodes { get; set; } = new();
    public bool TrackLots { get; set; }
    public string? PurchaseUnit { get; set; }
    public decimal? PurchaseUnitFactor { get; set; }
    public string? SalesUnit { get; set; }
    public decimal? SalesUnitFactor { get; set; }
    // ... POS, variant, service, pharmacy, agency fields (not relevant for stock import)
}
```

### ItemCategory.cs (Domain entity)

```csharp
namespace Pako.Domain.Inventory;

public class ItemCategory
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid? InventoryAccountId { get; set; }   // stock valuation (120100)
    public Guid? CogsAccountId { get; set; }         // cost of goods sold (500100)
    public Guid? RevenueAccountId { get; set; }
    public Guid? ExpenseAccountId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
```

### StockDocument.cs (Domain entity)

```csharp
namespace Pako.Domain.Inventory;

public enum StockDocumentType { Opening, Transfer, Count, WriteOff, WriteDown, Receipt, Delivery, SiteIssue }
public enum StockDocumentState { Draft, Posted }

[Pako.Domain.Shared.Audited]
public class StockDocument
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public StockDocumentType Type { get; set; }
    public StockDocumentState State { get; set; } = StockDocumentState.Draft;
    public string? Number { get; set; }
    public DateOnly Date { get; set; }
    public Guid WarehouseId { get; set; }
    public Guid? DestinationWarehouseId { get; set; }
    public Guid? PartnerId { get; set; }
    public Guid? SiteId { get; set; }
    public WriteOffReason? Reason { get; set; }
    public DateOnly? AtkNoticeDate { get; set; }
    public string? Notes { get; set; }
    public Guid? JournalEntryId { get; set; }
    public Guid? PostedByUserId { get; set; }
    public DateTime? PostedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<StockDocumentLine> Lines { get; set; } = new();
    public bool IsPosted => State == StockDocumentState.Posted;
}

public class StockDocumentLine
{
    public Guid Id { get; set; }
    public Guid StockDocumentId { get; set; }
    public Guid ItemId { get; set; }
    public decimal Quantity { get; set; }
    public decimal? UnitCost { get; set; }         // Opening: cost per unit
    public decimal? BookQuantity { get; set; }
    public decimal? Difference { get; set; }
    public decimal? AverageCost { get; set; }
    public decimal? AllowanceAfter { get; set; }
    public decimal? Amount { get; set; }
    public Guid? PurchaseOrderLineId { get; set; }
    public Guid? SalesOrderLineId { get; set; }
    public Guid? CostCodeId { get; set; }
    public string? LotNumber { get; set; }
    public DateOnly? ExpiryDate { get; set; }
    public string? Note { get; set; }
    public StockDocument? StockDocument { get; set; }
}
```

### ItemsController.cs — Create method (the validation pattern to replicate)

```csharp
[HttpPost]
[RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
public async Task<ActionResult<ItemResponse>> Create(Guid companyId, CreateItemRequest request)
{
    if (string.IsNullOrWhiteSpace(request.Name))
        return BadRequest("Item name is required.");
    if (string.IsNullOrWhiteSpace(request.Unit))
        return BadRequest("Unit is required.");

    if (request.DefaultRevenueAccountId is null || request.DefaultExpenseAccountId is null || request.DefaultInventoryAccountId is null)
        return BadRequest(_localizer["ItemDefaultAccountsRequired"].Value);
    var accountError = await ValidateDefaultAccounts(companyId, request.DefaultRevenueAccountId, request.DefaultExpenseAccountId, request.DefaultInventoryAccountId);
    if (accountError is not null) return accountError;
    var stockError = await ValidateStockFieldsAsync(companyId, null, request.Type, request.CategoryId, request.TrackInventory, request.MinimumStock)
        ?? ValidateUnits(request.Unit, request.PurchaseUnit, request.PurchaseUnitFactor, request.SalesUnit, request.SalesUnitFactor);
    if (stockError is not null) return BadRequest(stockError);

    var year = DateTime.UtcNow.Year;
    var codeStr = await _numberSeries.ReserveNextAsync(companyId, "Item", year);
    var code = int.Parse(codeStr);

    var item = new Item
    {
        Id = Guid.NewGuid(),
        CompanyId = companyId,
        Code = code,
        Name = request.Name.Trim(),
        Unit = request.Unit.Trim(),
        Type = request.Type,
        TrackInventory = request.TrackInventory && request.Type == ItemType.Goods,
        // ... all other fields
    };
    _db.Items.Add(item);
    await _db.SaveChangesAsync();
    return StatusCode(StatusCodes.Status201Created, ToResponse(item));
}
```

### Validation methods from ItemsController

```csharp
private async Task<ActionResult?> ValidateDefaultAccounts(Guid companyId, Guid? revenueAccountId, Guid? expenseAccountId, Guid? inventoryAccountId)
{
    var accountIds = new[] { revenueAccountId, expenseAccountId, inventoryAccountId }
        .Where(id => id.HasValue).Select(id => id!.Value).Distinct().ToList();
    if (accountIds.Count == 0) return null;
    var validCount = await _db.Accounts.AsNoTracking()
        .CountAsync(a => accountIds.Contains(a.Id) && a.CompanyId == companyId);
    if (validCount != accountIds.Count)
        return BadRequest(_localizer["ItemDefaultAccountNotBelongToCompany"].Value);
    return null;
}

private async Task<string?> ValidateStockFieldsAsync(Guid companyId, Item? item, ItemType type, Guid? categoryId, bool track, decimal? minimum)
{
    if (categoryId is { } c && !await _db.ItemCategories.AnyAsync(k => k.Id == c && k.CompanyId == companyId))
        return _localizer["ItemCategoryNotFound"].Value;
    if (minimum is < 0) return _localizer["StockDocumentQuantity"].Value;
    if (track && type != ItemType.Goods) return _localizer["StockOnlyForGoods"].Value;
    return null;
}

private string? ValidateUnits(string baseUnit, string? purchaseUnit, decimal? purchaseFactor, string? salesUnit, decimal? salesFactor)
{
    foreach (var (name, factor) in new[] { (purchaseUnit, purchaseFactor), (salesUnit, salesFactor) })
    {
        if (string.IsNullOrWhiteSpace(name)) continue;
        var unit = name.Trim();
        if (unit.Length > 32 || string.Equals(unit, baseUnit.Trim(), StringComparison.OrdinalIgnoreCase)
            || factor is not { } f || f <= 0 || f > 1_000_000m)
            return _localizer["ItemUnitInvalid"].Value;
    }
    return null;
}
```

### StockDocumentsController — Create and Post (the pattern for opening stock)

```csharp
[HttpPost]
public async Task<ActionResult<StockDocumentResponse>> Create(Guid companyId, SaveStockDocumentRequest request)
{
    await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
    if (transaction is not null)
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
    try
    {
        var document = await _documents.SaveDraftAsync(companyId, null, request);
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return StatusCode(StatusCodes.Status201Created, await _documents.ToResponseAsync(document));
    }
    catch (StockException ex) { return BadRequest(ex.Message); }
}

[HttpPost("{id:guid}/post")]
public async Task<ActionResult<StockDocumentResponse>> Post(Guid companyId, Guid id)
{
    // ... transaction setup, company lock ...
    var company = await _db.Companies.FirstAsync(c => c.Id == companyId);
    var document = await Load(companyId, id, tracking: true);
    await MonthLockService.EnsureMonthOpenAsync(_db, companyId, document.Date);
    await _documents.PostAsync(company, document, CurrentUserId);
    await _db.SaveChangesAsync();
    // ... commit ...
}
```

### InventoryContracts.cs — Stock document request/response

```csharp
public record StockDocumentLineRequest(Guid ItemId, decimal Quantity, decimal? UnitCost = null, string? Note = null,
    Guid? PurchaseOrderLineId = null, string? LotNumber = null, DateOnly? ExpiryDate = null,
    Guid? SalesOrderLineId = null, Guid? CostCodeId = null);

public record SaveStockDocumentRequest(
    StockDocumentType Type,
    DateOnly Date,
    Guid WarehouseId,
    List<StockDocumentLineRequest> Lines,
    Guid? DestinationWarehouseId = null,
    WriteOffReason? Reason = null,
    DateOnly? AtkNoticeDate = null,
    string? Notes = null,
    Guid? PartnerId = null,
    Guid? SiteId = null);
```

### ItemContracts.cs — CreateItemRequest

```csharp
public record CreateItemRequest(
    string Name,
    string Unit,
    ItemType Type = ItemType.Goods,
    Guid? DefaultTaxDefinitionId = null,
    Guid? DefaultRevenueAccountId = null,
    Guid? DefaultExpenseAccountId = null,
    Guid? DefaultInventoryAccountId = null,
    decimal? DefaultUnitPrice = null,
    string? Description = null,
    Guid? CategoryId = null,
    bool TrackInventory = false,
    decimal? MinimumStock = null,
    bool TrackLots = false,
    string? PurchaseUnit = null,
    decimal? PurchaseUnitFactor = null,
    string? SalesUnit = null,
    decimal? SalesUnitFactor = null,
    // ... POS, service, pharmacy, agency fields not relevant for stock import
    );
```

### InventoryController — Category creation

```csharp
[HttpPost("categories")]
public async Task<ActionResult<ItemCategoryResponse>> CreateCategory(Guid companyId, SaveItemCategoryRequest request)
{
    var category = new ItemCategory { Id = Guid.NewGuid(), CompanyId = companyId };
    var error = await ApplyCategoryAsync(companyId, category, request);
    if (error is not null) return BadRequest(error);
    _db.ItemCategories.Add(category);
    await _db.SaveChangesAsync();
    return StatusCode(StatusCodes.Status201Created, ToResponse(category, 0));
}

// Validation: name 1-120 chars, unique per company, accounts belong to company
```

### SaveItemCategoryRequest

```csharp
public record SaveItemCategoryRequest(string Name, Guid? InventoryAccountId, Guid? CogsAccountId, Guid? RevenueAccountId,
    Guid? ExpenseAccountId, bool IsActive = true);
```

### Warehouse entity

```csharp
public class Warehouse
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Address { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsVan { get; set; }
    public Guid? DriverUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
```

### StockSettings entity

```csharp
public class StockSettings
{
    public Guid CompanyId { get; set; }
    public CostMethod CostMethod { get; set; } = CostMethod.Average;
    public DateOnly? CostMethodSince { get; set; }
    public NegativeStockPolicy NegativeStock { get; set; } = NegativeStockPolicy.Block;
    public Guid? DefaultWarehouseId { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
```

### FormDialog.tsx (the dialog component to use)

```tsx
interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  dirty?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}
```

### Items.tsx — current import button (line 551)

```tsx
<Button variant="outline" onClick={() => toast.info(intl.formatMessage({ id: "items.import.title" }) + " — coming soon")}>
  {intl.formatMessage({ id: "items.import.title" })}
</Button>
```

### Existing i18n keys (messages.inventory.ts)

**EN:**
```
"items.import.title": "Import items"
"items.import.description": "Upload an Excel file (.xlsx) to create or update items in bulk."
"items.import.download": "Download template"
"items.import.upload": "Upload file"
"items.import.dragDrop": "Drag and drop your Excel file here, or click to browse."
"items.import.processing": "Processing..."
"items.import.success": "{created} created, {updated} updated."
"items.import.errors": "{count} rows had errors."
"items.import.noFile": "No file selected."
"items.import.invalidFormat": "Only .xlsx files are accepted."
```

**SQ:**
```
"items.import.title": "Importo artikujt"
"items.import.description": "Ngarko një skedar Excel (.xlsx) për të krijuar ose përditësuar artikujt në masë."
"items.import.download": "Shkarko shabllonin"
"items.import.upload": "Ngarko skedarin"
"items.import.dragDrop": "Tërhiq dhe lësho skedarin Excel këtu, ose kliko për të shfletuar."
"items.import.processing": "Duke procesuar..."
"items.import.success": "{created} krijuar, {updated} përditësuar."
"items.import.errors": "{count} rreshta kishin gabime."
"items.import.noFile": "Asnjë skedar i zgjedhur."
"items.import.invalidFormat": "Vetëm skedarë .xlsx pranohen."
```

---

## Implementation Order

### Phase 1: Backend Contracts & Service

1. **Add contract records** to `backend/Pako.Api/Contracts/ItemContracts.cs`:
   - `StockImportPreviewResponse`, `StockImportPreviewRow`, `StockImportSummary`
   - `StockImportConfirmResponse`, `StockImportRowError`
   - `StockImportConfirmRequest` (warehouseId, openingDate, fallback account IDs)

2. **Create `StockImportService`** at `backend/Pako.Api/Services/StockImportService.cs`:
   - `GenerateTemplate(bool filled, string language)` → `byte[]`
   - `ParseAndPreview(Stream file, Guid companyId, Guid? fallbackRevenue, Guid? fallbackExpense, Guid? fallbackInventory)` → `StockImportPreviewResponse`
   - `ConfirmImport(Stream file, Guid companyId, Guid warehouseId, DateOnly openingDate, Guid? fallbackRevenue, Guid? fallbackExpense, Guid? fallbackInventory, Guid userId)` → `StockImportConfirmResponse`
   - Inject: `PakoDbContext`, `NumberSeriesService`, `StockDocumentService`, `IStringLocalizer<ErrorMessages>`

3. **Add controller actions** to `ItemsController.cs` (or a new `StockImportController.cs` — either works, but keeping it on ItemsController is simpler since the route is already `api/companies/{companyId}/items`):
   - `GET import/template`
   - `POST import/preview`
   - `POST import/confirm`

4. **Add localization keys** to `Resources/ErrorMessages.resx` and `Resources/ErrorMessages.sq.resx` for any new error messages.

### Phase 2: Backend Tests

5. **Create `StockImportTests.cs`** in `backend/Pako.Tests/`:
   - Test template generation (both empty and filled)
   - Test preview with valid file → all rows Ready
   - Test preview with missing required fields → errors
   - Test preview with duplicate names → errors
   - Test preview with unknown account codes → errors
   - Test preview with new categories → listed in NewCategories
   - Test preview with fallback accounts → rows without codes use fallbacks
   - Test preview with > 9000 rows → rejected
   - Test confirm creates items + categories + opening stock document
   - Test confirm posts the opening stock document (journal entries created)
   - Test confirm skips error rows
   - Test confirm with no opening quantities → no stock document created

   **Generate a test .xlsx file programmatically** using ClosedXML in the test setup.

### Phase 3: Frontend

6. **Create `StockImportDialog.tsx`** at `apps/web/src/pages/items/StockImportDialog.tsx`

7. **Wire into Items.tsx** — replace toast with dialog

8. **Add i18n strings** — both EN and SQ

9. **Regenerate API client**: `pnpm generate:api-client`

### Phase 4: Verification

10. **Run all checks**:
    ```bash
    dotnet build backend/Pako.Api/Pako.Api.csproj
    dotnet test backend/Pako.Tests/Pako.Tests.csproj
    pnpm --filter web typecheck
    pnpm --filter web lint
    pnpm --filter web build
    ```

11. **Provide a filled example .xlsx** at `docs/stock-import-example.xlsx` (generated via a test or script) with ~20 rows covering all scenarios:
    - Items with all fields populated
    - Items with minimal fields (name + unit only, using fallback accounts)
    - Items with opening stock
    - Items with new categories
    - Items with barcodes
    - Items with purchase/sales units
    - A duplicate name row (to show it errors)
    - A row missing required fields (to show it errors)

---

## Critical Rules

1. **Never `git add -A` or `git add .`** — stage files by name. Check `git diff --cached --ignore-all-space --stat` before every commit.
2. **Localization is additive** — add keys, never rename or delete.
3. **Money math in domain/service, not controller** — the import service handles all parsing and validation.
4. **Three default accounts are REQUIRED** per item — the import must resolve all three (from row or fallback) or error.
5. **NumberSeriesService assigns codes** — never manually set `Item.Code`.
6. **Opening stock document uses `StockDocumentService`** — don't bypass it; it handles the journal entry, stock moves, and cost updates.
7. **Account codes in Excel are resolved by `Account.Code`** (the string code like "601000"), not by GUID.
8. **Category auto-creation**: if a category name from the Excel doesn't match any existing category for the company, create a new `ItemCategory` with just the name (no default accounts).
9. **All items created as `Type = Goods`, `TrackInventory = true`** — this is a stock import, not a general item import.
10. **Records in Contracts must not have non-nullable struct with default** (`Guid X = default` breaks OpenAPI) — use `Guid? X = null`.
11. **Test on real Postgres** — the test suite uses `PostgresTestDatabase.cs` with Postgres on :5433.

---

## What "Done" Means

- [ ] All 3 backend endpoints work (template, preview, confirm)
- [ ] Template downloads with correct columns in both EN and SQ
- [ ] Preview correctly validates all fields and returns per-row errors
- [ ] Confirm creates items, auto-creates categories, creates+posts opening stock document
- [ ] All backend tests pass (minimum 10 test cases covering the scenarios above)
- [ ] Frontend dialog works with 3 steps (setup, preview, results)
- [ ] i18n strings added in both EN and SQ
- [ ] API client regenerated
- [ ] `dotnet build`, `dotnet test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass
- [ ] Example .xlsx file provided at `docs/stock-import-example.xlsx`
- [ ] All pre-existing tests still green (198+)
