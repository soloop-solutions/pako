namespace Pako.Api.Contracts;

// Client feedback phase 5 — the customer portal (api/portal). Every figure is computed on the
// server; the customer never sends a price, a discount or a partner.

// A company this login can open as a customer.
public record PortalCompanyResponse(Guid CompanyId, string CompanyName, Guid PartnerId, string PartnerName, string? LogoUrl);

// The header of the portal: who is buying from whom, and where their account stands.
public record PortalSummaryResponse(
    Guid CompanyId, string CompanyName, string? CompanyEmail, string? CompanyPhone, string? LogoUrl,
    Guid PartnerId, string PartnerName,
    decimal Outstanding, decimal Overdue, decimal OpenOrders, decimal? CreditLimit, decimal? Available, bool OverdueBlocked);

public record PortalCategoryResponse(Guid Id, string Name);

// A unit the item can be ordered in, with this customer's price (VAT included) per that unit.
public record PortalUnitPriceResponse(string UnitName, decimal Factor, decimal Price);

// One catalogue row. Price is this customer's (customer list, wholesale tier, shop or default),
// VAT included, per the base Unit; DiscountPercent is the period discount that applies today and
// PriceAfterDiscount the price with it. InStock is null for items whose stock isn't tracked.
public record PortalCatalogueItemResponse(
    Guid ItemId, int Code, string Name, string? Description, Guid? CategoryId, string? CategoryName, string Unit,
    decimal Price, decimal DiscountPercent, decimal PriceAfterDiscount, bool? InStock, List<PortalUnitPriceResponse> Units);

public record PortalOrderLineRequest(Guid ItemId, decimal Quantity, string? UnitName = null);

public record PortalCartRequest(List<PortalOrderLineRequest> Lines);

public record PortalPricedLineResponse(
    Guid? ItemId, string Description, decimal Quantity, string? UnitName, decimal UnitPrice, decimal DiscountPercent,
    decimal Net, decimal Vat, decimal Gross);

// The cart priced as the order would be: per line and in total.
public record PortalCartResponse(List<PortalPricedLineResponse> Lines, decimal Net, decimal Vat, decimal Gross);

public record PlacePortalOrderRequest(
    List<PortalOrderLineRequest> Lines, string? CustomerReference = null, string? DeliveryAddress = null,
    DateOnly? DeliveryDate = null, string? Notes = null);

// Status as the customer sees it: Submitted (waiting for the company), Quoted, Confirmed,
// Closed (fully delivered or finished), Cancelled.
public record PortalOrderSummaryResponse(
    Guid Id, string Reference, string? Number, DateOnly Date, DateOnly? DeliveryDate, string Status, decimal Gross, int LineCount,
    string? CustomerReference, DateTime CreatedAt);

public record PortalDocumentResponse(Guid Id, string? Number, DateOnly Date);

public record PortalOrderResponse(
    Guid Id, string Reference, string? Number, DateOnly Date, DateOnly? DeliveryDate, string Status,
    string? CustomerReference, string? DeliveryAddress, string? Notes, DateTime CreatedAt, bool CanCancel,
    List<PortalPricedLineResponse> Lines, decimal Net, decimal Vat, decimal Gross, List<PortalDocumentResponse> Invoices);

// Kind: Invoice, CreditNote, DebitNote, DownPayment, SalesReturn. Open is what is still unpaid on
// an invoice or debit note (null for the other kinds).
public record PortalInvoiceSummaryResponse(
    Guid Id, string? Number, string Kind, DateOnly IssueDate, DateOnly DueDate, decimal Gross, decimal? Open, bool Overdue);

public record PortalInvoiceResponse(
    Guid Id, string? Number, string Kind, DateOnly IssueDate, DateOnly DueDate,
    string CompanyName, string? CompanyFiscalNumber, string? CompanyVatNumber, string? CompanyAddress,
    string PartnerName, string? PartnerFiscalNumber, string? PartnerAddress,
    List<PortalPricedLineResponse> Lines, decimal Net, decimal Vat, decimal Gross, decimal? Open, bool Overdue);
