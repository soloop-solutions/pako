using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;

namespace Pako.Api.Contracts;

// docs/POS_PLAN.md P6 — quotes, sales orders, deliveries from them, invoices from deliveries.
// Prices are VAT-inclusive per UnitName (null = the item's base unit).
public record SalesOrderLineRequest(Guid? ItemId, string? Description, decimal Quantity, decimal UnitPrice, Guid? TaxDefinitionId,
    decimal DiscountPercent = 0m, string? UnitName = null);

public record SaveSalesOrderRequest(Guid PartnerId, DateOnly Date, List<SalesOrderLineRequest> Lines, DateOnly? ValidUntil = null,
    DateOnly? DeliveryDate = null, Guid? WarehouseId = null, string? CustomerReference = null, string? DeliveryAddress = null,
    string? Notes = null, Guid? RouteVisitId = null);

// OverrideReason: confirms despite a credit limit or overdue block (Sales: Approve).
public record ConfirmSalesOrderRequest(string? OverrideReason = null);

// Quantities in the line's unit. Delivered counts goods sent (deliveries, or an invoice that took
// them out itself); for a line that isn't stock-tracked it follows the invoices.
public record SalesOrderLineResponse(Guid Id, Guid? ItemId, string Description, decimal Quantity, string? UnitName, decimal UnitFactor,
    decimal UnitPrice, decimal DiscountPercent, Guid? TaxDefinitionId, decimal Net, decimal Vat, decimal Gross, bool Tracked,
    decimal Delivered, decimal Invoiced, decimal InvoicedDraft, decimal ToDeliver, decimal ToInvoice);

// Kind: "delivery" or "invoice".
public record SalesOrderDocumentResponse(Guid Id, string Kind, string? Number, DateOnly Date, string State);

// Delivery / Invoicing: "none", "partly" or "full".
public record SalesOrderResponse(Guid Id, Guid PartnerId, string PartnerName, SalesOrderState State, string? QuoteNumber, string? Number,
    DateOnly Date, DateOnly? ValidUntil, DateOnly? DeliveryDate, Guid? WarehouseId, string? CustomerReference, string? DeliveryAddress,
    string? Notes, Guid? RouteVisitId, decimal Net, decimal Vat, decimal Total, string Delivery, string Invoicing, string? BlockOverrideReason,
    DateTime? QuotedAt, DateTime? ConfirmedAt, List<SalesOrderLineResponse> Lines, List<SalesOrderDocumentResponse> Documents);

public record SalesOrderSummaryResponse(Guid Id, string? QuoteNumber, string? Number, Guid PartnerId, string PartnerName, DateOnly Date,
    DateOnly? DeliveryDate, SalesOrderState State, decimal Total, string Delivery, string Invoicing, int LineCount);

// The customer's exposure: open receivable, confirmed orders not yet invoiced, what is left under
// the limit, and invoices past due (with the oldest's days overdue).
public record CreditStatusResponse(Guid PartnerId, decimal? CreditLimit, decimal Outstanding, decimal OpenOrders, decimal? Available,
    decimal Overdue, int OldestOverdueDays, int? OverdueBlockDays, bool OverdueBlocked);

// What to put on an invoice for the order: delivered goods not yet invoiced (each naming its
// delivery line), not-tracked lines not yet invoiced and, when asked, goods not delivered yet.
public record SalesInvoiceDraftResponse(Guid PartnerId, Guid? WarehouseId, string? OrderNumber, List<SalesInvoiceDraftLineResponse> Lines);
public record SalesInvoiceDraftLineResponse(Guid? ItemId, string Description, decimal Quantity, string? UnitName, decimal UnitPrice,
    decimal DiscountPercent, Guid? TaxDefinitionId, Guid SalesOrderLineId, Guid? DeliveryLineId, string? DeliveryNumber);
