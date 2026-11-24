using System.Globalization;
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
    byte[]? Logo,
    // Client request 2026-11-23: every bank account the company lists (default first), and the stamp
    // printed in the signature area. Empty / null when the company has none.
    IReadOnlyList<InvoiceDocumentBank>? BankAccounts = null,
    byte[]? Stamp = null,
    // Client request 2026-11-23 (print redesign): the registered name when it differs from the trading
    // name above, its legal form ("SH.P.K."), postal code and website.
    string? LegalName = null,
    string? LegalForm = null,
    string? PostalCode = null,
    string? Website = null);

public record InvoiceDocumentBank(string BankName, string? AccountHolder, string? Iban, string? SwiftBic);

public record InvoiceDocumentCustomer(Guid Id, string Name, string? TaxNumber, string? FiscalNumber, string? StreetAddress, string? Email, string? VatNumber = null,
    // Client request 2026-11-23 (print redesign): the rest of the buyer's address and contact.
    string? City = null, string? PostalCode = null, string? Country = null, string? Phone = null, string? ContactPerson = null,
    bool IsVatRegistered = false);

public record InvoiceDocumentLine(
    string Description, decimal Quantity, string? UnitName, decimal UnitPrice, decimal DiscountPercent, string? TaxLabel,
    DocumentLineAmounts Amounts,
    // The item's code (Item.Code), null on a line without an item.
    string? ItemCode = null);

public record InvoiceDocumentTax(string Label, decimal Rate, decimal Net, decimal Tax, decimal Gross = 0m);

// Everything a printed or emailed invoice shows, with every amount from DocumentLineCalculator — the
// same calculation that posts the invoice and that the invoice GET returns. Nothing here is computed
// by the renderer.
public record InvoiceDocument(
    Guid Id, Guid CompanyId, DocumentType Type, InvoiceState State, string? Number, DateOnly IssueDate, DateOnly DueDate,
    int? PaymentTermDays, string Currency, string? OriginalNumber, string? Notes,
    InvoiceDocumentCompany Company, InvoiceDocumentCustomer Customer,
    IReadOnlyList<InvoiceDocumentLine> Lines, DocumentLineAmounts Totals, IReadOnlyList<InvoiceDocumentTax> Taxes,
    // Whether the printed unit price includes VAT (its column header says so).
    PriceMode PriceMode = PriceMode.GrossInclusive);

public record InvoiceQuoteLine(decimal Quantity, decimal UnitPrice, decimal DiscountPercent, Guid? TaxDefinitionId);
public record InvoiceQuoteTax(Guid TaxDefinitionId, decimal NetAmount, decimal TaxAmount, decimal GrossAmount);
public record InvoiceQuote(IReadOnlyList<DocumentLineAmounts> Lines, DocumentLineAmounts Totals, IReadOnlyList<InvoiceQuoteTax> TaxBreakdown);

// Email delivery: one loader for the invoice GET's amounts, the invoice PDF and the invoice email, so
// the three can never disagree.
public class InvoiceDocumentService
{
    private readonly PakoDbContext _db;
    private readonly ITaxComputationService _tax;
    private readonly UploadStorage? _uploads;

    public InvoiceDocumentService(PakoDbContext db, ITaxComputationService tax, UploadStorage? uploads = null)
    {
        _db = db;
        _tax = tax;
        _uploads = uploads;
    }

    // Item codes of the invoice's items (Item.Code), for the printed "Code" column.
    public async Task<Dictionary<Guid, string>> ItemCodesAsync(Guid companyId, IEnumerable<Guid?> itemIds)
    {
        var ids = itemIds.Where(i => i != null).Select(i => i!.Value).Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<Guid, string>();
        return await _db.Items.AsNoTracking()
            .Where(i => i.CompanyId == companyId && ids.Contains(i.Id))
            .ToDictionaryAsync(i => i.Id, i => i.Code.ToString(CultureInfo.InvariantCulture));
    }

    // Client request 2026-11-23: an unsaved invoice priced with the posting calculator, so the creation
    // screen never computes money. Null when a line names a tax that is not this company's.
    public async Task<InvoiceQuote?> QuoteAsync(Guid companyId, PriceMode priceMode, IReadOnlyList<InvoiceQuoteLine> lines)
    {
        var ids = lines.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == companyId && ids.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id);
        if (taxes.Count != ids.Count) return null;

        var amounts = lines.Select(l => DocumentLineCalculator.Amounts(
            l.Quantity, l.UnitPrice, l.DiscountPercent,
            l.TaxDefinitionId is { } taxId ? taxes[taxId] : null, _tax, priceMode)).ToList();
        var breakdown = lines.Select((l, index) => (l.TaxDefinitionId, Amounts: amounts[index]))
            .Where(x => x.TaxDefinitionId != null)
            .GroupBy(x => x.TaxDefinitionId!.Value)
            .Select(g => new InvoiceQuoteTax(g.Key, g.Sum(x => x.Amounts.NetAmount), g.Sum(x => x.Amounts.TaxAmount), g.Sum(x => x.Amounts.GrossAmount)))
            .ToList();
        return new InvoiceQuote(amounts, DocumentLineAmounts.Sum(amounts), breakdown);
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
        // The company's bank accounts list, default first; the single bank fields on the company
        // stand in when the list is empty.
        var banks = await _db.CompanyBankAccounts.AsNoTracking()
            .Where(b => b.CompanyId == companyId)
            .OrderByDescending(b => b.IsDefault).ThenBy(b => b.SortOrder).ThenBy(b => b.BankName)
            .Select(b => new InvoiceDocumentBank(b.BankName, b.AccountHolder, b.Iban, b.SwiftBic))
            .ToListAsync();
        if (banks.Count == 0 && (!string.IsNullOrWhiteSpace(company.BankName) || !string.IsNullOrWhiteSpace(company.Iban)))
        {
            banks.Add(new InvoiceDocumentBank(company.BankName ?? string.Empty, company.BankAccountHolder, company.Iban, company.SwiftBic));
        }
        DocumentLineAmounts Amounts(InvoiceLine line) => DocumentLineCalculator.Amounts(
            line.Quantity, line.UnitPrice, line.DiscountPercent,
            line.TaxDefinitionId is { } taxId ? taxes.GetValueOrDefault(taxId) : null,
            _tax, invoice.PriceMode);

        var itemCodes = await ItemCodesAsync(companyId, invoice.Lines.Select(l => l.ItemId));
        var lines = invoice.Lines.Select(l => new InvoiceDocumentLine(
            l.Description, l.Quantity, l.UnitName, l.UnitPrice, l.DiscountPercent,
            l.TaxDefinitionId is { } taxId && taxes.TryGetValue(taxId, out var tax) ? TaxLabel(tax) : null,
            Amounts(l),
            l.ItemId is { } itemId ? itemCodes.GetValueOrDefault(itemId) : null)).ToList();
        var breakdown = invoice.Lines
            .Where(l => l.TaxDefinitionId is { } id && taxes.ContainsKey(id))
            .GroupBy(l => l.TaxDefinitionId!.Value)
            .Select(g => new InvoiceDocumentTax(taxes[g.Key].Name, taxes[g.Key].Rate,
                g.Sum(l => Amounts(l).NetAmount), g.Sum(l => Amounts(l).TaxAmount), g.Sum(l => Amounts(l).GrossAmount)))
            .ToList();

        return new InvoiceDocument(
            invoice.Id, companyId, invoice.DocumentType, invoice.State, invoice.InvoiceNumber, invoice.IssueDate, invoice.DueDate,
            invoice.PaymentTermDays, company.FunctionalCurrency, original, invoice.InternalNotes,
            new InvoiceDocumentCompany(
                string.IsNullOrWhiteSpace(company.TradingName) ? company.Name : company.TradingName!,
                company.VatNumber, company.FiscalNumber, company.BusinessNumber, company.StreetAddress, company.Municipality, company.Country,
                company.Phone, company.Email, company.BankName, company.Iban, company.PaymentInstructions, company.DocumentFooter,
                CompanyLogo.Bytes(company.LogoUrl, _uploads), banks, CompanyLogo.Bytes(company.StampUrl, _uploads),
                !string.IsNullOrWhiteSpace(company.TradingName) && company.TradingName != company.Name ? company.Name : null,
                LegalFormAbbreviation((LegalFormType?)company.LegalForm), company.PostalCode, company.Website),
            new InvoiceDocumentCustomer(invoice.PartnerId, partner?.Name ?? string.Empty, partner?.TaxNumber, partner?.FiscalNumber,
                partner?.StreetAddress, partner?.Email, partner?.VatNumber,
                partner?.City, partner?.PostalCode, partner?.Country, partner?.Phone, partner?.ContactPerson, partner?.IsVatRegistered ?? false),
            lines, DocumentLineAmounts.Sum(lines.Select(l => l.Amounts)), breakdown, invoice.PriceMode);
    }

    private static string TaxLabel(TaxDefinition tax) => $"{tax.Rate * 100:0.##}%";

    // The abbreviation printed after a company's name (the official ARBK forms, see LegalFormType);
    // forms without a customary one, and individual businesses, print nothing.
    public static string? LegalFormAbbreviation(LegalFormType? form) => form switch
    {
        LegalFormType.Shpk => "SH.P.K.",
        LegalFormType.Sha => "SH.A.",
        LegalFormType.OrtakeriPergjithshme => "O.P.",
        LegalFormType.OrtakeriKufizuar => "O.K.",
        LegalFormType.ShoqeriaHuajTregtare => "D.K.",
        LegalFormType.ZyraPerfaqesise => "Z.P.K.",
        _ => null,
    };

    private async Task<Dictionary<Guid, TaxDefinition>> TaxesAsync(Invoice invoice)
    {
        var ids = invoice.Lines.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        return await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == invoice.CompanyId && ids.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id);
    }
}

// A company image (logo or stamp) as raster bytes for a PDF. Company.LogoUrl/StampUrl hold either a
// data: URI or, since the upload endpoint, a "/uploads/companies/{id}/logo.png" path read from the
// upload storage. SVG and anything unreadable give null: the document then prints without it.
public static class CompanyLogo
{
    public static byte[]? Bytes(string? logoUrl, UploadStorage? uploads = null)
    {
        if (logoUrl is not null && logoUrl.StartsWith(UploadStorage.RequestPath + "/", StringComparison.Ordinal))
        {
            return UploadedFile(logoUrl, uploads ?? UploadStorage.From(new Pako.Api.Desktop.DesktopOptions()));
        }

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

    private static byte[]? UploadedFile(string url, UploadStorage uploads)
    {
        if (url.EndsWith(".svg", StringComparison.OrdinalIgnoreCase)) return null;
        var root = Path.GetFullPath(uploads.Root);
        var relative = url[(UploadStorage.RequestPath.Length + 1)..].Replace('/', Path.DirectorySeparatorChar);
        var path = Path.GetFullPath(Path.Combine(root, relative));
        // Never read outside the upload root, whatever the stored URL says.
        if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal)) return null;
        try
        {
            return File.Exists(path) ? File.ReadAllBytes(path) : null;
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }
}
