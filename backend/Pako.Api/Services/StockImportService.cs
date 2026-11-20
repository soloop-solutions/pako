using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public class StockImportService
{
    private const int MaxRows = 9000;
    private const long MaxFileSize = 10 * 1024 * 1024; // 10MB

    private readonly PakoDbContext _db;
    private readonly NumberSeriesService _numberSeries;
    private readonly StockDocumentService _stockDocuments;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public StockImportService(PakoDbContext db, NumberSeriesService numberSeries,
        StockDocumentService stockDocuments, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _numberSeries = numberSeries;
        _stockDocuments = stockDocuments;
        _localizer = localizer;
    }

    // ---- Template ----

    private static readonly string[] HeadersEn = { "Name", "Description", "Unit", "Category", "Sale Price",
        "Revenue Account", "Expense Account", "Inventory Account", "VAT Code", "Min Stock",
        "Barcode", "Opening Qty", "Opening Unit Cost", "Purchase Unit", "Purchase Factor",
        "Sales Unit", "Sales Factor" };

    private static readonly string[] HeadersSq = { "Emri", "Pershkrimi", "Njesia", "Kategoria", "Cmimi i Shitjes",
        "Llogaria e te Ardhurave", "Llogaria e Shpenzimeve", "Llogaria e Inventarit", "Kodi i TVSH-se", "Stoku Minimal",
        "Barkodi", "Sasia Fillestare", "Kosto per Njesi", "Njesia e Blerjes", "Faktori i Blerjes",
        "Njesia e Shitjes", "Faktori i Shitjes" };

    private static readonly string[][] ReferenceRowsEn = {
        new[] { "Name", "Required", "Product name" },
        new[] { "Description", "Optional", "Product description" },
        new[] { "Unit", "Required", "Base unit (piece, kg, liter, etc.)" },
        new[] { "Category", "Optional", "Category name - auto-created if not found" },
        new[] { "Sale Price", "Optional", "Default unit sale price" },
        new[] { "Revenue Account", "Optional", "Account code (e.g. 400100). Falls back to dialog setting." },
        new[] { "Expense Account", "Optional", "Account code (e.g. 500100). Falls back to dialog setting." },
        new[] { "Inventory Account", "Optional", "Account code (e.g. 120100). Falls back to dialog setting." },
        new[] { "VAT Code", "Optional", "Tax definition code (e.g. S18)" },
        new[] { "Min Stock", "Optional", "Low-stock warning threshold" },
        new[] { "Barcode", "Optional", "Unique per company, max 64 characters" },
        new[] { "Opening Qty", "Optional", "Quantity on hand at import date" },
        new[] { "Opening Unit Cost", "Conditional", "Required if Opening Qty > 0" },
        new[] { "Purchase Unit", "Optional", "e.g. box" },
        new[] { "Purchase Factor", "Optional", "e.g. 24 (1 box = 24 pieces)" },
        new[] { "Sales Unit", "Optional", "Alternative sales unit" },
        new[] { "Sales Factor", "Optional", "Factor for sales unit" },
    };

    private static readonly string[][] ReferenceRowsSq = {
        new[] { "Emri", "E detyrueshme", "Emri i produktit" },
        new[] { "Pershkrimi", "Opsionale", "Pershkrimi i produktit" },
        new[] { "Njesia", "E detyrueshme", "Njesia baze (cope, kg, liter, etj.)" },
        new[] { "Kategoria", "Opsionale", "Emri i kategorise - krijohet automatikisht nese nuk gjendet" },
        new[] { "Cmimi i Shitjes", "Opsionale", "Cmimi i shitjes per njesi" },
        new[] { "Llogaria e te Ardhurave", "Opsionale", "Kodi i llogarise (p.sh. 400100). Bie ne cilesimet e dialogut." },
        new[] { "Llogaria e Shpenzimeve", "Opsionale", "Kodi i llogarise (p.sh. 500100). Bie ne cilesimet e dialogut." },
        new[] { "Llogaria e Inventarit", "Opsionale", "Kodi i llogarise (p.sh. 120100). Bie ne cilesimet e dialogut." },
        new[] { "Kodi i TVSH-se", "Opsionale", "Kodi i tatimit (p.sh. S18)" },
        new[] { "Stoku Minimal", "Opsionale", "Pragu i paralajmerimit te stokut te ulet" },
        new[] { "Barkodi", "Opsionale", "Unik per kompanine, maks 64 karaktere" },
        new[] { "Sasia Fillestare", "Opsionale", "Sasia ne dore ne daten e importit" },
        new[] { "Kosto per Njesi", "E kushtezuar", "E detyrueshme nese Sasia Fillestare > 0" },
        new[] { "Njesia e Blerjes", "Opsionale", "p.sh. kuti" },
        new[] { "Faktori i Blerjes", "Opsionale", "p.sh. 24 (1 kuti = 24 cope)" },
        new[] { "Njesia e Shitjes", "Opsionale", "Njesia alternative e shitjes" },
        new[] { "Faktori i Shitjes", "Opsionale", "Faktori per njesine e shitjes" },
    };

    private static IReadOnlyList<IReadOnlyList<object?>> ExampleRows() => new List<IReadOnlyList<object?>>
    {
        new object?[] { "Laptop Dell XPS 15", "15-inch laptop", "pc", "Electronics", 1200.00m, "400100", "500100", "120100", "S18", 5m, "1234567890123", 10m, 800.00m, null, null, null, null },
        new object?[] { "Office Chair", null, "pc", "Furniture", 250.00m, null, null, null, null, null, null, null, null, null, null, null, null },
        new object?[] { "Copy Paper A4", "80gsm, 500 sheets", "pack", "Office Supplies", 4.50m, null, null, null, "S18", 20m, null, 100m, 3.20m, "box", 10m, null, null },
    };

    public byte[] GenerateTemplate(bool filled, string language)
    {
        var isSq = language.StartsWith("sq", StringComparison.OrdinalIgnoreCase);
        var headers = isSq ? HeadersSq : HeadersEn;
        var refHeaders = new[] { isSq ? "Kolona" : "Column", isSq ? "Statusi" : "Status", isSq ? "Pershkrimi" : "Description" };
        var refRows = isSq ? ReferenceRowsSq : ReferenceRowsEn;

        var dataRows = filled ? ExampleRows() : (IReadOnlyList<IReadOnlyList<object?>>)Array.Empty<IReadOnlyList<object?>>();
        var refRowsList = refRows.Select(r => (IReadOnlyList<object?>)r.Cast<object?>().ToList()).ToList();

        return ExcelExportService.BuildWorkbook(new[]
        {
            new ExportSheet("Stock", null, headers, dataRows),
            new ExportSheet(isSq ? "Referenca" : "Reference", null, refHeaders, refRowsList),
        });
    }

    // ---- Preview ----

    private sealed class ParsedRow
    {
        public int RowNumber;
        public string? Name, Description, Unit, Category, RevenueAccountCode, ExpenseAccountCode, InventoryAccountCode, VatCode, Barcode;
        public string? PurchaseUnit, SalesUnit;
        public decimal? SalePrice, MinimumStock, OpeningQty, OpeningUnitCost, PurchaseFactor, SalesFactor;
        public Guid? RevenueAccountId, ExpenseAccountId, InventoryAccountId, TaxDefinitionId, CategoryId;
        public List<string> Errors = new();
        public List<string> Warnings = new();
        public string Status => Errors.Count > 0 ? "Error" : Warnings.Count > 0 ? "Warning" : "Ready";
        public bool IsNewCategory;
    }

    public async Task<StockImportPreviewResponse> ParseAndPreviewAsync(Stream file, long fileSize, Guid companyId,
        Guid? fallbackRevenueId, Guid? fallbackExpenseId, Guid? fallbackInventoryId)
    {
        if (fileSize > MaxFileSize)
            throw new InvalidOperationException(_localizer["StockImportFileTooLarge"].Value);

        using var workbook = new XLWorkbook(file);
        var sheet = workbook.Worksheets.FirstOrDefault();
        if (sheet is null)
            throw new InvalidOperationException(_localizer["StockImportParseError"].Value);

        var rows = ParseSheet(sheet);
        if (rows.Count > MaxRows)
            throw new InvalidOperationException(string.Format(_localizer["StockImportRowCap"].Value, MaxRows));

        await ValidateRowsAsync(rows, companyId, fallbackRevenueId, fallbackExpenseId, fallbackInventoryId);

        var newCategories = rows.Where(r => r.IsNewCategory && r.Category != null).Select(r => r.Category!).Distinct().ToList();

        return new StockImportPreviewResponse(
            rows.Select(r => new StockImportPreviewRow(
                r.RowNumber, r.Status, r.Name, r.Unit, r.Category, r.SalePrice,
                r.RevenueAccountCode, r.ExpenseAccountCode, r.InventoryAccountCode,
                r.VatCode, r.MinimumStock, r.Barcode, r.OpeningQty, r.OpeningUnitCost,
                r.PurchaseUnit, r.PurchaseFactor, r.SalesUnit, r.SalesFactor, r.Description,
                r.Errors, r.Warnings)).ToList(),
            new StockImportSummary(
                rows.Count(r => r.Status == "Ready"),
                rows.Count(r => r.Status == "Warning"),
                rows.Count(r => r.Status == "Error")),
            newCategories);
    }

    private static List<ParsedRow> ParseSheet(IXLWorksheet sheet)
    {
        var rows = new List<ParsedRow>();
        var firstRow = sheet.FirstRowUsed();
        if (firstRow is null) return rows;

        var dataStartRow = firstRow.RowNumber() + 1; // skip header
        var lastRow = sheet.LastRowUsed();
        if (lastRow is null) return rows;

        for (var r = dataStartRow; r <= lastRow.RowNumber(); r++)
        {
            var row = sheet.Row(r);
            if (row.IsEmpty()) continue;

            var parsed = new ParsedRow { RowNumber = r };
            parsed.Name = CellString(row, 1);
            parsed.Description = CellString(row, 2);
            parsed.Unit = CellString(row, 3);
            parsed.Category = CellString(row, 4);
            parsed.SalePrice = CellDecimal(row, 5);
            parsed.RevenueAccountCode = CellString(row, 6);
            parsed.ExpenseAccountCode = CellString(row, 7);
            parsed.InventoryAccountCode = CellString(row, 8);
            parsed.VatCode = CellString(row, 9);
            parsed.MinimumStock = CellDecimal(row, 10);
            parsed.Barcode = CellString(row, 11);
            parsed.OpeningQty = CellDecimal(row, 12);
            parsed.OpeningUnitCost = CellDecimal(row, 13);
            parsed.PurchaseUnit = CellString(row, 14);
            parsed.PurchaseFactor = CellDecimal(row, 15);
            parsed.SalesUnit = CellString(row, 16);
            parsed.SalesFactor = CellDecimal(row, 17);
            rows.Add(parsed);
        }

        return rows;
    }

    private static string? CellString(IXLRow row, int col)
    {
        var cell = row.Cell(col);
        if (cell.IsEmpty()) return null;
        var value = cell.GetFormattedString()?.Trim();
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private static decimal? CellDecimal(IXLRow row, int col)
    {
        var cell = row.Cell(col);
        if (cell.IsEmpty()) return null;
        if (cell.Value.IsNumber) return (decimal)cell.Value.GetNumber();
        var text = cell.GetFormattedString()?.Trim();
        return decimal.TryParse(text, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : null;
    }

    private async Task ValidateRowsAsync(List<ParsedRow> rows, Guid companyId,
        Guid? fallbackRevenueId, Guid? fallbackExpenseId, Guid? fallbackInventoryId)
    {
        var accounts = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId)
            .Select(a => new { a.Id, a.Code })
            .ToDictionaryAsync(a => a.Code, a => a.Id);

        var categories = await _db.ItemCategories.AsNoTracking()
            .Where(c => c.CompanyId == companyId)
            .ToDictionaryAsync(c => c.Name, c => c.Id, StringComparer.OrdinalIgnoreCase);

        var taxes = await _db.TaxDefinitions.AsNoTracking()
            .Where(t => t.CompanyId == companyId && t.Code != null)
            .ToDictionaryAsync(t => t.Code!, t => t.Id, StringComparer.OrdinalIgnoreCase);

        var existingItems = await _db.Items.AsNoTracking()
            .Where(i => i.CompanyId == companyId)
            .Select(i => i.Name.ToLower())
            .ToListAsync();
        var existingNames = new HashSet<string>(existingItems, StringComparer.OrdinalIgnoreCase);

        var existingBarcodes = await _db.ItemBarcodes.AsNoTracking()
            .Where(b => b.CompanyId == companyId)
            .Select(b => b.Barcode)
            .ToListAsync();
        var existingBarcodeSet = new HashSet<string>(existingBarcodes);

        var fileNames = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var fileBarcodes = new Dictionary<string, int>();

        foreach (var row in rows)
        {
            if (string.IsNullOrWhiteSpace(row.Name))
            {
                row.Errors.Add(_localizer["StockImportNameRequired"].Value);
            }
            else
            {
                if (fileNames.TryGetValue(row.Name, out var firstRow))
                    row.Errors.Add(string.Format(_localizer["StockImportDuplicateName"].Value, firstRow));
                else
                    fileNames[row.Name] = row.RowNumber;

                if (existingNames.Contains(row.Name))
                    row.Errors.Add(_localizer["StockImportDuplicateNameExisting"].Value);
            }

            if (string.IsNullOrWhiteSpace(row.Unit))
                row.Errors.Add(_localizer["StockImportUnitRequired"].Value);

            row.RevenueAccountId = ResolveAccount(row, row.RevenueAccountCode, fallbackRevenueId, accounts, "Revenue");
            row.ExpenseAccountId = ResolveAccount(row, row.ExpenseAccountCode, fallbackExpenseId, accounts, "Expense");
            row.InventoryAccountId = ResolveAccount(row, row.InventoryAccountCode, fallbackInventoryId, accounts, "Inventory");

            if (row.RevenueAccountId is null || row.ExpenseAccountId is null || row.InventoryAccountId is null)
            {
                if (!row.Errors.Any(e => e.Contains("account", StringComparison.OrdinalIgnoreCase)))
                    row.Errors.Add(_localizer["StockImportAccountsMissing"].Value);
            }

            if (!string.IsNullOrWhiteSpace(row.Category))
            {
                if (categories.TryGetValue(row.Category, out var catId))
                {
                    row.CategoryId = catId;
                }
                else
                {
                    row.IsNewCategory = true;
                    row.Warnings.Add(string.Format(_localizer["StockImportNewCategory"].Value, row.Category));
                }
            }

            if (!string.IsNullOrWhiteSpace(row.VatCode))
            {
                if (taxes.TryGetValue(row.VatCode, out var taxId))
                    row.TaxDefinitionId = taxId;
                else
                    row.Errors.Add(string.Format(_localizer["StockImportVatCodeNotFound"].Value, row.VatCode));
            }

            if (!string.IsNullOrWhiteSpace(row.Barcode))
            {
                if (row.Barcode.Length > 64)
                    row.Errors.Add(_localizer["StockImportBarcodeTooLong"].Value);
                else if (existingBarcodeSet.Contains(row.Barcode))
                    row.Errors.Add(_localizer["StockImportDuplicateBarcodeExisting"].Value);
                else if (fileBarcodes.TryGetValue(row.Barcode, out var firstRow))
                    row.Errors.Add(string.Format(_localizer["StockImportDuplicateBarcode"].Value, firstRow));
                else
                    fileBarcodes[row.Barcode] = row.RowNumber;
            }

            if (row.OpeningQty is > 0 && row.OpeningUnitCost is null or <= 0)
                row.Errors.Add(_localizer["StockImportOpeningCostRequired"].Value);

            if (row.MinimumStock is < 0)
                row.Errors.Add(_localizer["StockDocumentQuantity"].Value);

            ValidateAlternateUnits(row);
        }
    }

    private Guid? ResolveAccount(ParsedRow row, string? code, Guid? fallbackId,
        Dictionary<string, Guid> accounts, string label)
    {
        if (!string.IsNullOrWhiteSpace(code))
        {
            if (accounts.TryGetValue(code, out var id))
                return id;
            row.Errors.Add(string.Format(_localizer["StockImportAccountNotFound"].Value, label, code));
            return null;
        }
        return fallbackId;
    }

    private void ValidateAlternateUnits(ParsedRow row)
    {
        if (string.IsNullOrWhiteSpace(row.Unit)) return;
        foreach (var (name, factor) in new[] { (row.PurchaseUnit, row.PurchaseFactor), (row.SalesUnit, row.SalesFactor) })
        {
            if (string.IsNullOrWhiteSpace(name)) continue;
            if (name.Length > 32 || string.Equals(name.Trim(), row.Unit.Trim(), StringComparison.OrdinalIgnoreCase)
                || factor is not { } f || f <= 0 || f > 1_000_000m)
            {
                row.Errors.Add(_localizer["ItemUnitInvalid"].Value);
                break;
            }
        }
    }

    // ---- Confirm ----

    public async Task<StockImportConfirmResponse> ConfirmAsync(Stream file, long fileSize, Guid companyId,
        Guid warehouseId, DateOnly openingDate, Guid? fallbackRevenueId, Guid? fallbackExpenseId,
        Guid? fallbackInventoryId, Guid userId)
    {
        // Re-parse and re-validate (stateless)
        var preview = await ParseAndPreviewAsync(file, fileSize, companyId, fallbackRevenueId, fallbackExpenseId, fallbackInventoryId);

        var readyRows = preview.Rows.Where(r => r.Status != "Error").ToList();
        if (readyRows.Count == 0)
            return new StockImportConfirmResponse(0, preview.Rows.Count, new List<string>(),
                Errors: preview.Rows.Where(r => r.Status == "Error").Select(r => new StockImportRowError(r.RowNumber, string.Join("; ", r.Errors))).ToList());

        // Re-parse to get internal data (ParsedRow with resolved IDs)
        file.Position = 0;
        using var workbook = new XLWorkbook(file);
        var sheet = workbook.Worksheets.First();
        var parsedRows = ParseSheet(sheet);
        await ValidateRowsAsync(parsedRows, companyId, fallbackRevenueId, fallbackExpenseId, fallbackInventoryId);
        var validRows = parsedRows.Where(r => r.Status != "Error").ToList();

        var existingCategories = await _db.ItemCategories.AsNoTracking()
            .Where(c => c.CompanyId == companyId)
            .ToDictionaryAsync(c => c.Name, c => c.Id, StringComparer.OrdinalIgnoreCase);

        // Auto-create missing categories
        var createdCategories = new List<string>();
        var newCategoryMap = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var catName in validRows.Where(r => r.IsNewCategory && r.Category != null).Select(r => r.Category!).Distinct())
        {
            if (existingCategories.ContainsKey(catName) || newCategoryMap.ContainsKey(catName)) continue;
            var cat = new ItemCategory
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Name = catName.Trim(),
            };
            _db.ItemCategories.Add(cat);
            newCategoryMap[catName] = cat.Id;
            createdCategories.Add(catName);
        }

        // Create items — reserve the first code from the number series, then increment locally
        // so we don't re-query the database for each item (the items are not yet saved).
        var year = openingDate.Year;
        var openingLines = new List<StockDocumentLineRequest>();
        var createdCount = 0;
        var nextCode = int.Parse(await _numberSeries.ReserveNextAsync(companyId, "Item", year));

        foreach (var row in validRows)
        {
            Guid? categoryId = row.CategoryId;
            if (categoryId is null && row.Category != null && newCategoryMap.TryGetValue(row.Category, out var newCatId))
                categoryId = newCatId;

            var code = nextCode++;


            var item = new Item
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Code = code,
                Name = row.Name!.Trim(),
                Description = row.Description?.Trim(),
                Unit = row.Unit!.Trim(),
                Type = ItemType.Goods,
                TrackInventory = true,
                DefaultRevenueAccountId = row.RevenueAccountId,
                DefaultExpenseAccountId = row.ExpenseAccountId,
                DefaultInventoryAccountId = row.InventoryAccountId,
                DefaultTaxDefinitionId = row.TaxDefinitionId,
                DefaultUnitPrice = row.SalePrice,
                CategoryId = categoryId,
                MinimumStock = row.MinimumStock,
                PurchaseUnit = string.IsNullOrWhiteSpace(row.PurchaseUnit) ? null : row.PurchaseUnit.Trim(),
                PurchaseUnitFactor = string.IsNullOrWhiteSpace(row.PurchaseUnit) ? null : row.PurchaseFactor,
                SalesUnit = string.IsNullOrWhiteSpace(row.SalesUnit) ? null : row.SalesUnit.Trim(),
                SalesUnitFactor = string.IsNullOrWhiteSpace(row.SalesUnit) ? null : row.SalesFactor,
            };

            _db.Items.Add(item);

            if (!string.IsNullOrWhiteSpace(row.Barcode))
            {
                _db.ItemBarcodes.Add(new ItemBarcode
                {
                    Id = Guid.NewGuid(),
                    CompanyId = companyId,
                    ItemId = item.Id,
                    Barcode = row.Barcode.Trim(),
                });
            }

            if (row.OpeningQty is > 0 && row.OpeningUnitCost is > 0)
            {
                openingLines.Add(new StockDocumentLineRequest(item.Id, row.OpeningQty.Value, row.OpeningUnitCost.Value));
            }

            createdCount++;
        }

        await _db.SaveChangesAsync();

        // Create opening stock document if there are items with opening quantities
        Guid? openingDocId = null;
        string? openingDocNumber = null;

        if (openingLines.Count > 0)
        {
            var warehouse = await _db.Warehouses.AsNoTracking()
                .FirstOrDefaultAsync(w => w.Id == warehouseId && w.CompanyId == companyId && w.IsActive);
            if (warehouse is null)
                throw new InvalidOperationException(_localizer["WarehouseNotFound"].Value);

            var company = await _db.Companies.FirstAsync(c => c.Id == companyId);

            var stockRequest = new SaveStockDocumentRequest(
                StockDocumentType.Opening,
                openingDate,
                warehouseId,
                openingLines);

            await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
            if (transaction is not null)
                await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");

            try
            {
                var document = await _stockDocuments.SaveDraftAsync(companyId, null, stockRequest);
                await _db.SaveChangesAsync();

                await MonthLockService.EnsureMonthOpenAsync(_db, companyId, openingDate);
                await _stockDocuments.PostAsync(company, document, userId);
                await _db.SaveChangesAsync();

                if (transaction is not null) await transaction.CommitAsync();

                openingDocId = document.Id;
                openingDocNumber = document.Number;
            }
            catch (StockException ex)
            {
                if (transaction is not null) await transaction.RollbackAsync();
                throw new InvalidOperationException(ex.Message, ex);
            }
        }

        var skippedCount = parsedRows.Count - validRows.Count;
        var skippedErrors = parsedRows.Where(r => r.Status == "Error")
            .Select(r => new StockImportRowError(r.RowNumber, string.Join("; ", r.Errors))).ToList();

        return new StockImportConfirmResponse(
            createdCount, skippedCount, createdCategories,
            openingDocId, openingDocNumber, skippedErrors);
    }
}
