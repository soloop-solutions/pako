using Pako.Domain.Inventory;

namespace Pako.Api.Contracts;

// docs/INVENTORY_PLAN.md — stock & inventory.

// ---- Setup ----

// docs/POS_PLAN.md P6: IsVan marks a delivery van selling from its own stock; DriverUserId the member who drives it.
public record WarehouseResponse(Guid Id, string Code, string Name, string? Address, bool IsActive, bool IsDefault, bool IsVan = false,
    Guid? DriverUserId = null);
public record SaveWarehouseRequest(string Code, string Name, string? Address, bool IsActive = true, bool IsVan = false, Guid? DriverUserId = null);

public record ItemCategoryResponse(Guid Id, string Name, Guid? InventoryAccountId, Guid? CogsAccountId, Guid? RevenueAccountId,
    Guid? ExpenseAccountId, bool IsActive, int ItemCount);
public record SaveItemCategoryRequest(string Name, Guid? InventoryAccountId, Guid? CogsAccountId, Guid? RevenueAccountId,
    Guid? ExpenseAccountId, bool IsActive = true);

// CostMethodLocked: true once stock has moved — the method can no longer change (D1).
public record StockSettingsResponse(CostMethod CostMethod, DateOnly? CostMethodSince, bool CostMethodLocked,
    NegativeStockPolicy NegativeStock, Guid? DefaultWarehouseId);
public record SaveStockSettingsRequest(NegativeStockPolicy NegativeStock, Guid? DefaultWarehouseId);

// ---- Stock documents ----

// Receipt lines: UnitCost is the net cost per unit; PurchaseOrderLineId links the ordered line.
public record StockDocumentLineRequest(Guid ItemId, decimal Quantity, decimal? UnitCost = null, string? Note = null,
    Guid? PurchaseOrderLineId = null,
    // §12 P8, items tracked by lot: the lot received (with its expiry) or the lot to take from.
    string? LotNumber = null, DateOnly? ExpiryDate = null,
    // docs/POS_PLAN.md P6, deliveries: the sales order line the goods were ordered on.
    Guid? SalesOrderLineId = null,
    // docs/ERP_VERTICALS_PLAN.md §1, site issues: the site cost code charged.
    Guid? CostCodeId = null);

public record SaveStockDocumentRequest(
    StockDocumentType Type,
    DateOnly Date,
    Guid WarehouseId,
    List<StockDocumentLineRequest> Lines,
    Guid? DestinationWarehouseId = null,
    WriteOffReason? Reason = null,
    DateOnly? AtkNoticeDate = null,
    string? Notes = null,
    // Receipts: the vendor. Deliveries: the customer.
    Guid? PartnerId = null,
    // Site issues: the construction site.
    Guid? SiteId = null);

// Value: what the line moved, once posted (from the stock ledger).
// Write-down lines: UnitCost is the net realisable value, Value the allowance change posted, and
// AverageCost/AllowanceAfter what it was computed from.
public record StockDocumentLineResponse(Guid Id, Guid ItemId, int ItemCode, string ItemName, string Unit, decimal Quantity,
    decimal? UnitCost, decimal? BookQuantity, decimal? Difference, decimal? Value, string? Note,
    decimal? AverageCost = null, decimal? AllowanceAfter = null,
    // Receipts: the ordered line, and how much of the line vendor bills have matched so far.
    // Deliveries: how much of the line posted invoices have billed.
    Guid? PurchaseOrderLineId = null, decimal? Billed = null,
    string? LotNumber = null, DateOnly? ExpiryDate = null, Guid? SalesOrderLineId = null, Guid? CostCodeId = null);

// VatRepaymentDue: a write-off whose reason means the input VAT must be paid back (theft, unexplained
// shortage — AI 03/2015 Arts. 61.1.4 and 62); phase 1 records it and warns, phase 2 posts it.
public record StockDocumentResponse(
    Guid Id, StockDocumentType Type, StockDocumentState State, string? Number, DateOnly Date,
    Guid WarehouseId, string WarehouseName, Guid? DestinationWarehouseId, string? DestinationWarehouseName,
    WriteOffReason? Reason, DateOnly? AtkNoticeDate, string? Notes, decimal TotalValue, bool VatRepaymentDue,
    Guid? JournalEntryId, DateTime? PostedAt, List<StockDocumentLineResponse> Lines,
    // Phase 2: the input VAT the posted write-off reversed (null when none is due).
    decimal? VatRepaid = null,
    // Receipts: the vendor.
    Guid? PartnerId = null, string? PartnerName = null,
    // Site issues: the construction site.
    Guid? SiteId = null);

public record StockDocumentSummaryResponse(
    Guid Id, StockDocumentType Type, StockDocumentState State, string? Number, DateOnly Date,
    string WarehouseName, string? DestinationWarehouseName, int LineCount, decimal TotalValue,
    // Receipts and deliveries: the vendor or customer. Site issues: the site.
    string? PartnerName = null, Guid? SiteId = null);

// A count sheet row: the book quantity to count against.
public record CountSheetRowResponse(Guid ItemId, int ItemCode, string ItemName, string Unit, decimal BookQuantity);

// ---- Reports ----

// docs/INVENTORY_PLAN.md phase 2: what year end needs from stock. A physical count is required at
// least once a year (Law 06/L-032 on accounting); WarehousesWithoutCount lists the active warehouses
// holding stock with no posted count dated in the year. StockValue/LedgerValue/Difference are the
// valuation at 31 December.
public record StockYearEndCheckResponse(int Year, bool TracksStock, List<YearEndWarehouseCount> Warehouses,
    List<string> WarehousesWithoutCount, decimal StockValue, decimal LedgerValue, decimal Difference);
public record YearEndWarehouseCount(Guid WarehouseId, string WarehouseName, DateOnly? LastCountDate, string? LastCountNumber);

// One row per stock-tracked item: quantity per warehouse and in total, average cost and value.
// UsualSupplier: the vendor of the item's latest posted purchase bill (only for callers who may see
// purchases), so the low-stock list groups into one reorder per supplier. ShortBy: how far the
// quantity is below the minimum.
public record StockLevelResponse(Guid ItemId, int ItemCode, string ItemName, string Unit, string? CategoryName,
    decimal Quantity, decimal AverageCost, decimal Value, decimal? MinimumStock, bool BelowMinimum,
    List<WarehouseQuantityResponse> Warehouses, Guid? UsualSupplierId = null, string? UsualSupplierName = null,
    decimal? ShortBy = null);
public record WarehouseQuantityResponse(Guid WarehouseId, string WarehouseName, decimal Quantity);

public record StockOnHandResponse(Guid ItemId, decimal Quantity, decimal Available);

// The item card (kartela e artikullit): every move with the running quantity and value.
public record ItemCardResponse(Guid ItemId, int ItemCode, string ItemName, string Unit, DateOnly? From, DateOnly? To,
    decimal OpeningQuantity, decimal OpeningValue, decimal ClosingQuantity, decimal ClosingValue, List<ItemCardRowResponse> Rows);
public record ItemCardRowResponse(Guid MoveId, DateOnly Date, StockMoveKind Kind, StockMoveSource SourceType, Guid SourceId,
    string? Reference, string FromLocation, string ToLocation, decimal QuantityIn, decimal QuantityOut, decimal UnitCost,
    decimal Value, decimal QtyAfter, decimal AvgCostAfter, decimal ValueAfter);

// Stock at a date and its tie-out to the ledger (docs/INVENTORY_PLAN.md §5.3).
// WriteDownAllowance: the 120900 balance (write-downs to net realisable value); NetValue: stock at
// cost less that allowance, the figure for the balance sheet.
public record StockValuationResponse(DateOnly AsOf, decimal StockValue, decimal LedgerValue, decimal Difference,
    List<StockValuationRowResponse> Items, List<StockValuationAccountResponse> Accounts,
    decimal WriteDownAllowance = 0m, decimal NetValue = 0m);
public record StockValuationRowResponse(Guid ItemId, int ItemCode, string ItemName, string Unit, decimal Quantity, decimal AverageCost, decimal Value);
public record StockValuationAccountResponse(Guid AccountId, string Code, string Name, decimal StockValue, decimal LedgerValue);

// Gross margin from invoices: net sales minus the cost of goods sold recorded on their stock moves.
public record MarginRowResponse(string Key, string Label, decimal Quantity, decimal NetSales, decimal Cost, decimal Margin, decimal? MarginPercent);
public record MarginReportResponse(DateOnly From, DateOnly To, string GroupBy, decimal NetSales, decimal Cost, decimal Margin,
    decimal? MarginPercent, List<MarginRowResponse> Rows);

// ---- Goods received, not invoiced (§12 P6) ----

// Each posted receipt line with quantity still waiting for the vendor's bill at the date, valued at
// the receipt cost. OpenValue should equal the credit balance of 120800 (Difference = 0).
public record GrniRowResponse(Guid ReceiptId, string? ReceiptNumber, DateOnly Date, Guid PartnerId, string PartnerName,
    Guid ItemId, int ItemCode, string ItemName, decimal Received, decimal Billed, decimal Open, decimal UnitCost, decimal OpenValue,
    int AgeDays);
public record GrniReportResponse(DateOnly AsOf, decimal OpenValue, decimal LedgerValue, decimal Difference, List<GrniRowResponse> Rows);

// ---- Lots and expiry (§12 P8) ----

// One lot in one warehouse with quantity on hand. Value is the quantity at the item's average cost
// (cost is per item, not per lot). DaysToExpiry is negative once expired.
public record LotStockResponse(Guid LotId, string LotNumber, DateOnly? ExpiryDate, int? DaysToExpiry, Guid ItemId, int ItemCode,
    string ItemName, string Unit, Guid WarehouseId, string WarehouseName, decimal Quantity, decimal Value);

// ---- Price lists and price changes (§12 P4) ----

// WarehouseId null = the company-wide list.
public record PriceListResponse(Guid Id, string Name, Guid? WarehouseId, string? WarehouseName, bool IsActive, int PricedItems, bool IsCustomerList = false);
public record SavePriceListRequest(string Name, Guid? WarehouseId, bool IsActive = true, bool IsCustomerList = false);

// An item's price on a list at a date. Price null = the list has none (the company list or the
// item's own default price applies, shown as FallbackPrice).
public record PriceListItemResponse(Guid ItemId, int ItemCode, string ItemName, string Unit, decimal? Price, DateOnly? ValidFrom,
    decimal? FallbackPrice, List<PriceTierResponse>? Tiers = null);
// docs/POS_PLAN.md P6: a volume tier — Price from MinQuantity (base units) up.
public record PriceTierResponse(decimal MinQuantity, decimal Price, DateOnly ValidFrom);

// The price an invoice line should start from: Source = "warehouse", "company" or "item".
// Price is per base unit; Units gives the same price per the item's sales and purchase units, so a
// line that switches unit takes the server's figure (no multiplying in the browser).
public record ResolvedPriceResponse(Guid ItemId, decimal Price, string Source, Guid? PriceListId, List<ResolvedUnitPriceResponse>? Units = null,
    decimal? TierMinQuantity = null);
public record ResolvedUnitPriceResponse(string UnitName, decimal Factor, decimal Price);

// MinQuantity > 0: a volume tier (docs/POS_PLAN.md P6).
public record PriceChangeLineRequest(Guid ItemId, decimal NewPrice, decimal MinQuantity = 0m);
public record SavePriceChangeRequest(Guid PriceListId, DateOnly Date, List<PriceChangeLineRequest> Lines, string? Notes = null);

// OldPrice/Quantity/Difference are the price in force the day before, the quantity on hand and
// quantity × (new − old). Before posting they are a preview at the document date.
public record PriceChangeLineResponse(Guid Id, Guid ItemId, int ItemCode, string ItemName, string Unit, decimal NewPrice,
    decimal? OldPrice, decimal? Quantity, decimal? Difference, decimal MinQuantity = 0m);
public record PriceChangeResponse(Guid Id, Guid PriceListId, string PriceListName, PriceChangeState State, string? Number, DateOnly Date,
    string? Notes, decimal TotalDifference, DateTime? PostedAt, List<PriceChangeLineResponse> Lines);
public record PriceChangeSummaryResponse(Guid Id, string PriceListName, PriceChangeState State, string? Number, DateOnly Date,
    int LineCount, decimal TotalDifference);
