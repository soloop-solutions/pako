using Pako.Domain.Invoicing;

namespace Pako.Api.Contracts;

public record CreateInvoiceLineRequest(
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid? RevenueAccountId,
    decimal? DiscountPercent = null,
    Guid? ItemId = null,
    // §12 P7: the item unit the quantity is in (null = its base unit).
    string? UnitName = null,
    // §12 P8, items tracked by lot: the lot to sell from (the earliest expiry first when empty).
    string? LotNumber = null,
    // docs/POS_PLAN.md P6: the sales order line invoiced, and the posted delivery line whose goods
    // the line bills (it then moves no stock).
    Guid? SalesOrderLineId = null,
    Guid? DeliveryLineId = null);

public record CreateInvoiceRequest(
    Guid PartnerId,
    DateOnly IssueDate,
    // Empty = the issue date.
    DateOnly? DueDate,
    List<CreateInvoiceLineRequest> Lines,
    DocumentType DocumentType = DocumentType.Invoice,
    Guid? OriginalInvoiceId = null,
    PriceMode PriceMode = PriceMode.GrossInclusive,
    int? PaymentTermDays = null,
    int? GraceDays = null,
    CreateInvoicePaymentRequest? Payment = null,
    string? InternalNotes = null,
    // docs/INVENTORY_PLAN.md: where stock-tracked goods leave from; null = company default.
    Guid? WarehouseId = null,
    // docs/ERP_VERTICALS_PLAN.md: the ledger project the revenue belongs to.
    Guid? ProjectId = null,
    // User-supplied invoice number override; when null the system auto-generates the next number.
    string? InvoiceNumber = null);

// C3: optional inline payment recorded atomically with the invoice's own creation+posting — see
// InvoicesController.Create's comment for why this must post the invoice (not leave it Draft).
public record CreateInvoicePaymentRequest(decimal Amount, Guid PaymentMethodId, DateOnly? Date = null);

// A5 (v2 release): same shape as CreateInvoiceRequest plus InternalNotes — full replace, Draft
// documents only (InvoicesController.Update, PUT). A Posted document can't reach this at all;
// see EditPostedInvoiceRequest for the separate, narrower path a Posted document actually uses —
// two distinct request shapes rather than one shape with a runtime field-by-field diff, so the
// Posted path is structurally incapable of expressing a partner/line/amount change.
public record UpdateInvoiceRequest(
    Guid PartnerId,
    DateOnly IssueDate,
    // Empty = the issue date.
    DateOnly? DueDate,
    List<CreateInvoiceLineRequest> Lines,
    DocumentType DocumentType,
    Guid? OriginalInvoiceId,
    string? InternalNotes,
    Guid? WarehouseId = null,
    Guid? ProjectId = null,
    // User-supplied invoice number override; when null the existing number is kept.
    string? InvoiceNumber = null);

// A5 (v2 release): the entire editable surface of a Posted invoice — see UpdateInvoiceRequest's
// doc comment for why this is a separate, narrower type rather than reusing UpdateInvoiceRequest
// with a diff check.
public record EditPostedInvoiceRequest(DateOnly DueDate, string? InternalNotes);

public record InvoiceLineResponse(
    Guid Id,
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid RevenueAccountId,
    decimal DiscountPercent,
    Guid? ItemId,
    string? UnitName = null,
    decimal UnitFactor = 1m,
    string? LotNumber = null,
    Guid? SalesOrderLineId = null,
    Guid? DeliveryLineId = null,
    // Server-computed line amounts for the printed document (DocumentLineCalculator.Amounts). Set on
    // the single-invoice GET; null in lists.
    decimal? AmountBeforeDiscount = null,
    decimal? DiscountAmount = null,
    decimal? NetAmount = null,
    decimal? TaxAmount = null,
    decimal? GrossAmount = null,
    // Client request 2026-11-23 (print redesign): the item's code and the entered unit price on both
    // bases (DocumentLineAmounts.UnitPriceNet/Gross). Set on the single-invoice GET; null in lists.
    string? ItemCode = null,
    decimal? UnitPriceNet = null,
    decimal? UnitPriceGross = null);

public record InvoiceResponse(
    Guid Id,
    Guid PartnerId,
    string? PartnerName,
    string? InvoiceNumber,
    DateOnly IssueDate,
    DateOnly DueDate,
    string State,
    DocumentType DocumentType,
    Guid? OriginalInvoiceId,
    Guid? JournalEntryId,
    List<InvoiceLineResponse> Lines,
    string? InternalNotes,
    PriceMode PriceMode,
    int? PaymentTermDays,
    int? GraceDays,
    Guid? WarehouseId = null,
    Guid? ProjectId = null,
    Guid? CreatedByUserId = null,
    string? CreatedByName = null,
    // Document totals and the VAT breakdown per tax code for the printed invoice, from the same
    // server-computed line amounts. Set on the single-invoice GET; null in lists.
    InvoiceAmountTotals? Totals = null,
    List<InvoiceTaxBreakdownLine>? TaxBreakdown = null,
    // Client request 2026-11-23: the grand total in words, in the request's language. Single GET only.
    string? TotalInWords = null);

public record InvoiceAmountTotals(decimal AmountBeforeDiscount, decimal DiscountAmount, decimal NetAmount, decimal TaxAmount, decimal GrossAmount);

// GrossAmount (client request 2026-11-23): the rate's total for the printed VAT table.
public record InvoiceTaxBreakdownLine(Guid TaxDefinitionId, decimal NetAmount, decimal TaxAmount, decimal? GrossAmount = null);

// Client request 2026-11-23: prices an unsaved invoice with the posting calculator so the creation
// screen shows server figures (it never computes money itself). Lines come back in request order.
public record InvoiceQuoteRequest(PriceMode PriceMode, List<InvoiceQuoteLineRequest> Lines);

public record InvoiceQuoteLineRequest(decimal Quantity, decimal UnitPrice, decimal DiscountPercent, Guid? TaxDefinitionId);

public record InvoiceQuoteLineResponse(
    decimal AmountBeforeDiscount, decimal DiscountAmount, decimal NetAmount, decimal TaxAmount, decimal GrossAmount,
    decimal UnitPriceNet, decimal UnitPriceGross);

public record InvoiceQuoteResponse(
    List<InvoiceQuoteLineResponse> Lines, InvoiceAmountTotals Totals, List<InvoiceTaxBreakdownLine> TaxBreakdown, string TotalInWords);
