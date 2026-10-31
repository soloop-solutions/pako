using Pako.Domain.Bills;
using PriceMode = Pako.Domain.Invoicing.PriceMode;

namespace Pako.Api.Contracts;

public record CreateBillLineRequest(
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid? ExpenseAccountId,
    decimal? DiscountPercent = null,
    Guid? ItemId = null,
    // docs/INVENTORY_PLAN.md §12 P5: the purchase order line this line bills.
    Guid? PurchaseOrderLineId = null,
    // §12 P7: the item unit the quantity is in (null = its base unit).
    string? UnitName = null,
    // §12 P8, items tracked by lot: the lot received and its expiry (purchase returns: the lot sent back).
    string? LotNumber = null,
    DateOnly? ExpiryDate = null);

public record CreateBillRequest(
    Guid PartnerId,
    string? VendorReference,
    DateOnly IssueDate,
    DateOnly DueDate,
    List<CreateBillLineRequest> Lines,
    DocumentType DocumentType = DocumentType.Bill,
    Guid? OriginalBillId = null,
    PriceMode PriceMode = PriceMode.GrossInclusive,
    CreateBillPaymentRequest? Payment = null,
    // docs/INVENTORY_PLAN.md: where stock-tracked goods arrive; null = company default.
    Guid? WarehouseId = null);

// C5: cash-only at bill-create time — BillsController.Create rejects a non-Cash PaymentMethod
// here; a bank payment is only ever recorded later, once it appears on the bank statement,
// through the existing .../record-payment route.
public record CreateBillPaymentRequest(decimal Amount, Guid PaymentMethodId, DateOnly? Date = null);

// A5 (v2 release): mirror of UpdateInvoiceRequest — see its doc comment for the full rationale.
public record UpdateBillRequest(
    Guid PartnerId,
    string? VendorReference,
    DateOnly IssueDate,
    DateOnly DueDate,
    List<CreateBillLineRequest> Lines,
    DocumentType DocumentType,
    Guid? OriginalBillId,
    string? InternalNotes,
    Guid? WarehouseId = null);

// A5 (v2 release): mirror of EditPostedInvoiceRequest.
public record EditPostedBillRequest(DateOnly DueDate, string? InternalNotes);

public record BillLineResponse(
    Guid Id,
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid ExpenseAccountId,
    decimal DiscountPercent,
    Guid? ItemId,
    Guid? PurchaseOrderLineId = null,
    string? UnitName = null,
    decimal UnitFactor = 1m,
    string? LotNumber = null,
    DateOnly? ExpiryDate = null);

public record BillResponse(
    Guid Id,
    Guid PartnerId,
    string? VendorReference,
    DateOnly IssueDate,
    DateOnly DueDate,
    string State,
    DocumentType DocumentType,
    Guid? OriginalBillId,
    Guid? JournalEntryId,
    List<BillLineResponse> Lines,
    string? InternalNotes,
    PriceMode PriceMode,
    Guid? WarehouseId = null);

// ---- Purchase orders (docs/INVENTORY_PLAN.md §12 P5) ----

public record PurchaseOrderLineRequest(Guid? ItemId, string Description, decimal Quantity, decimal UnitPrice, Guid? TaxDefinitionId);
public record SavePurchaseOrderRequest(Guid PartnerId, DateOnly Date, DateOnly? ExpectedDate, List<PurchaseOrderLineRequest> Lines,
    Guid? WarehouseId = null, string? VendorReference = null, string? Notes = null);

// Billed: quantity on posted bills; InDraftBills: on draft bills not yet posted; Remaining: ordered
// less billed (never below zero). OverBilled flags a line billed beyond what was ordered.
public record PurchaseOrderLineResponse(Guid Id, Guid? ItemId, string Description, decimal Quantity, decimal UnitPrice,
    Guid? TaxDefinitionId, decimal Billed, decimal InDraftBills, decimal Remaining, bool OverBilled,
    // §12 P6: quantity on posted receipts (goods counted in), and what is still to be received.
    decimal Received = 0m, decimal ToReceive = 0m);
// Progress: "none", "partly" or "full" — how much of the order is billed.
public record PurchaseOrderResponse(Guid Id, Guid PartnerId, string PartnerName, string? Number, DateOnly Date, DateOnly? ExpectedDate,
    Guid? WarehouseId, PurchaseOrderState State, string Progress, string? VendorReference, string? Notes, DateTime? ConfirmedAt,
    List<PurchaseOrderLineResponse> Lines, List<PurchaseOrderBillResponse> Bills);
public record PurchaseOrderBillResponse(Guid BillId, string? VendorReference, DateOnly IssueDate, string State);
public record PurchaseOrderSummaryResponse(Guid Id, string? Number, Guid PartnerId, string PartnerName, DateOnly Date, DateOnly? ExpectedDate,
    PurchaseOrderState State, string Progress, int LineCount);

// The low-stock reorder: one draft order per usual supplier.
public record LowStockOrdersResponse(List<Guid> PurchaseOrderIds, int Items, int ItemsWithoutSupplier);
