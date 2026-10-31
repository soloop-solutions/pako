using Pako.Domain.Inventory;

namespace Pako.Api.Contracts;

// docs/INVENTORY_PLAN.md — stock & inventory.

// ---- Setup ----

public record WarehouseResponse(Guid Id, string Code, string Name, string? Address, bool IsActive, bool IsDefault);
public record SaveWarehouseRequest(string Code, string Name, string? Address, bool IsActive = true);

public record ItemCategoryResponse(Guid Id, string Name, Guid? InventoryAccountId, Guid? CogsAccountId, Guid? RevenueAccountId,
    Guid? ExpenseAccountId, bool IsActive, int ItemCount);
public record SaveItemCategoryRequest(string Name, Guid? InventoryAccountId, Guid? CogsAccountId, Guid? RevenueAccountId,
    Guid? ExpenseAccountId, bool IsActive = true);

// CostMethodLocked: true once stock has moved — the method can no longer change (D1).
public record StockSettingsResponse(CostMethod CostMethod, DateOnly? CostMethodSince, bool CostMethodLocked,
    NegativeStockPolicy NegativeStock, Guid? DefaultWarehouseId);
public record SaveStockSettingsRequest(NegativeStockPolicy NegativeStock, Guid? DefaultWarehouseId);

// ---- Stock documents ----

public record StockDocumentLineRequest(Guid ItemId, decimal Quantity, decimal? UnitCost = null, string? Note = null);

public record SaveStockDocumentRequest(
    StockDocumentType Type,
    DateOnly Date,
    Guid WarehouseId,
    List<StockDocumentLineRequest> Lines,
    Guid? DestinationWarehouseId = null,
    WriteOffReason? Reason = null,
    DateOnly? AtkNoticeDate = null,
    string? Notes = null);

// Value: what the line moved, once posted (from the stock ledger).
public record StockDocumentLineResponse(Guid Id, Guid ItemId, int ItemCode, string ItemName, string Unit, decimal Quantity,
    decimal? UnitCost, decimal? BookQuantity, decimal? Difference, decimal? Value, string? Note);

// VatRepaymentDue: a write-off whose reason means the input VAT must be paid back (theft, unexplained
// shortage — AI 03/2015 Arts. 61.1.4 and 62); phase 1 records it and warns, phase 2 posts it.
public record StockDocumentResponse(
    Guid Id, StockDocumentType Type, StockDocumentState State, string? Number, DateOnly Date,
    Guid WarehouseId, string WarehouseName, Guid? DestinationWarehouseId, string? DestinationWarehouseName,
    WriteOffReason? Reason, DateOnly? AtkNoticeDate, string? Notes, decimal TotalValue, bool VatRepaymentDue,
    Guid? JournalEntryId, DateTime? PostedAt, List<StockDocumentLineResponse> Lines);

public record StockDocumentSummaryResponse(
    Guid Id, StockDocumentType Type, StockDocumentState State, string? Number, DateOnly Date,
    string WarehouseName, string? DestinationWarehouseName, int LineCount, decimal TotalValue);

// A count sheet row: the book quantity to count against.
public record CountSheetRowResponse(Guid ItemId, int ItemCode, string ItemName, string Unit, decimal BookQuantity);

// ---- Reports ----

// One row per stock-tracked item: quantity per warehouse and in total, average cost and value.
public record StockLevelResponse(Guid ItemId, int ItemCode, string ItemName, string Unit, string? CategoryName,
    decimal Quantity, decimal AverageCost, decimal Value, decimal? MinimumStock, bool BelowMinimum,
    List<WarehouseQuantityResponse> Warehouses);
public record WarehouseQuantityResponse(Guid WarehouseId, string WarehouseName, decimal Quantity);

public record StockOnHandResponse(Guid ItemId, decimal Quantity, decimal Available);

// The item card (kartela e artikullit): every move with the running quantity and value.
public record ItemCardResponse(Guid ItemId, int ItemCode, string ItemName, string Unit, DateOnly? From, DateOnly? To,
    decimal OpeningQuantity, decimal OpeningValue, decimal ClosingQuantity, decimal ClosingValue, List<ItemCardRowResponse> Rows);
public record ItemCardRowResponse(Guid MoveId, DateOnly Date, StockMoveKind Kind, StockMoveSource SourceType, Guid SourceId,
    string? Reference, string FromLocation, string ToLocation, decimal QuantityIn, decimal QuantityOut, decimal UnitCost,
    decimal Value, decimal QtyAfter, decimal AvgCostAfter, decimal ValueAfter);

// Stock at a date and its tie-out to the ledger (docs/INVENTORY_PLAN.md §5.3).
public record StockValuationResponse(DateOnly AsOf, decimal StockValue, decimal LedgerValue, decimal Difference,
    List<StockValuationRowResponse> Items, List<StockValuationAccountResponse> Accounts);
public record StockValuationRowResponse(Guid ItemId, int ItemCode, string ItemName, string Unit, decimal Quantity, decimal AverageCost, decimal Value);
public record StockValuationAccountResponse(Guid AccountId, string Code, string Name, decimal StockValue, decimal LedgerValue);

// Gross margin from invoices: net sales minus the cost of goods sold recorded on their stock moves.
public record MarginRowResponse(string Key, string Label, decimal Quantity, decimal NetSales, decimal Cost, decimal Margin, decimal? MarginPercent);
public record MarginReportResponse(DateOnly From, DateOnly To, string GroupBy, decimal NetSales, decimal Cost, decimal Margin,
    decimal? MarginPercent, List<MarginRowResponse> Rows);
