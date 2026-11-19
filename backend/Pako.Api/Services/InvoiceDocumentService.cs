using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Documents;
using Pako.Domain.Invoicing;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public record InvoiceDocumentCompany(
    string Name, string? VatNumber, string? FiscalNumber, string? BusinessNumber, string? StreetAddress, string? Municipality,
    string? Country, string? Phone, string? Email, string? BankName, string? Iban, string? PaymentInstructions, string? DocumentFooter,
    byte[]? Logo);

public record InvoiceDocumentCustomer(Guid Id, string Name, string? TaxNumber, string? FiscalNumber, string? StreetAddress, string? Email);

public record InvoiceDocumentLine(
    string Description, decimal Quantity, string? UnitName, decimal UnitPrice, decimal DiscountPercent, string? TaxLabel,
    DocumentLineAmounts Amounts);

public record InvoiceDocumentTax(string Label, decimal Rate, decimal Net, decimal Tax);

// Everything a printed or emailed invoice shows, with every amount from DocumentLineCalculator — the
// same calculation that posts the invoice and that the invoice GET returns. Nothing here is computed
// by the renderer.
public record InvoiceDocument(
    Guid Id, Guid CompanyId, DocumentType Type, InvoiceState State, string? Number, DateOnly IssueDate, DateOnly DueDate,
    int? PaymentTermDays, string Currency, string? OriginalNumber, string? Notes,
    InvoiceDocumentCompany Company, InvoiceDocumentCustomer Customer,
    IReadOnlyList<InvoiceDocumentLine> Lines, DocumentLineAmounts Totals, IReadOnlyList<InvoiceDocumentTax> Taxes);

// Email delivery: one loader for the invoice GET's amounts, the invoice PDF and the invoice email, so
// the three can never disagree.
public class InvoiceDocumentService
{
    private readonly PakoDbContext _db;
    private readonly ITaxComputationService _tax;

    public InvoiceDocumentService(PakoDbContext db, ITaxComputationService tax)
    {
        _db = db;
        _tax = tax;
    }

    // Per-line amounts with the posting calculator (the invoice GET's figures).
    public async Task<Func<InvoiceLine, DocumentLineAmounts>> LineAmountsAsync(Invoice invoice)
    {
        var taxes = await TaxesAsync(invoice);
        return line => DocumentLineCalculator.Amounts(
            line.Quantity, line.UnitPrice, line.DiscountPercent,
            line.TaxDefinitionId is { } taxId ? taxes.GetValueOrDefault(taxId) : null,
            _tax, invoice.PriceMode);
    }

    // Null when the invoice is not this company's. The caller decides who may see it (access scope,
    // posted only for the portal).
    public async Task<InvoiceDocument?> LoadAsync(Guid companyId, Guid invoiceId)
    {
        var invoice = await _db.Invoices.AsNoTracking().Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == invoiceId && i.CompanyId == companyId);
        if (invoice is null) return null;

        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
        var partner = await _db.Partners.AsNoTracking().FirstOrDefaultAsync(p => p.Id == invoice.PartnerId && p.CompanyId == companyId);
        var original = invoice.OriginalInvoiceId is { } originalId
            ? await _db.Invoices.AsNoTracking().Where(i => i.Id == originalId && i.CompanyId == companyId).Select(i => i.InvoiceNumber).FirstOrDefaultAsync()
            : null;
        var taxes = await TaxesAsync(invoice);
        DocumentLineAmounts Amounts(InvoiceLine line) => DocumentLineCalculator.Amounts(
            line.Quantity, line.UnitPrice, line.DiscountPercent,
            line.TaxDefinitionId is { } taxId ? taxes.GetValueOrDefault(taxId) : null,
            _tax, invoice.PriceMode);

        var lines = invoice.Lines.Select(l => new InvoiceDocumentLine(
            l.Description, l.Quantity, l.UnitName, l.UnitPrice, l.DiscountPercent,
            l.TaxDefinitionId is { } taxId && taxes.TryGetValue(taxId, out var tax) ? TaxLabel(tax) : null,
            Amounts(l))).ToList();
        var breakdown = invoice.Lines
            .Where(l => l.TaxDefinitionId is { } id && taxes.ContainsKey(id))
            .GroupBy(l => l.TaxDefinitionId!.Value)
            .Select(g => new InvoiceDocumentTax(taxes[g.Key].Name, taxes[g.Key].Rate,
                g.Sum(l => Amounts(l).NetAmount), g.Sum(l => Amounts(l).TaxAmount)))
            .ToList();

        return new InvoiceDocument(
            invoice.Id, companyId, invoice.DocumentType, invoice.State, invoice.InvoiceNumber, invoice.IssueDate, invoice.DueDate,
            invoice.PaymentTermDays, company.FunctionalCurrency, original, invoice.InternalNotes,
            new InvoiceDocumentCompany(
                string.IsNullOrWhiteSpace(company.TradingName) ? company.Name : company.TradingName!,
                company.VatNumber, company.FiscalNumber, company.BusinessNumber, company.StreetAddress, company.Municipality, company.Country,
                company.Phone, company.Email, company.BankName, company.Iban, company.PaymentInstructions, company.DocumentFooter,
                CompanyLogo.Bytes(company.LogoUrl)),
            new InvoiceDocumentCustomer(invoice.PartnerId, partner?.Name ?? string.Empty, partner?.TaxNumber, partner?.FiscalNumber,
                partner?.StreetAddress, partner?.Email),
            lines, DocumentLineAmounts.Sum(lines.Select(l => l.Amounts)), breakdown);
    }

    private static string TaxLabel(TaxDefinition tax) => $"{tax.Rate * 100:0.##}%";

    private async Task<Dictionary<Guid, TaxDefinition>> TaxesAsync(Invoice invoice)
    {
        var ids = invoice.Lines.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        return await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == invoice.CompanyId && ids.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id);
    }
}

// A company's logo as raster bytes for a PDF (Company.LogoUrl holds a data: URI). SVG and anything
// unreadable give null: the document then prints without a logo.
public static class CompanyLogo
{
    public static byte[]? Bytes(string? logoUrl)
    {
        const string marker = ";base64,";
        if (logoUrl is null || !logoUrl.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)
            || logoUrl.StartsWith("data:image/svg", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var at = logoUrl.IndexOf(marker, StringComparison.Ordinal);
        try
        {
            return at < 0 ? null : Convert.FromBase64String(logoUrl[(at + marker.Length)..]);
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
