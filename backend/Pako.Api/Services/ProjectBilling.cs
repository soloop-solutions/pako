using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/ERP_VERTICALS_PLAN.md — the draft invoices construction, real estate and rentals make: one
// line per charge, priced VAT-inclusive on the item's own VAT code and revenue account (item, then
// its category, then the company default). They are checked and posted on the invoice screen like
// any other invoice.
public static class ProjectBilling
{
    public record Charge(Item Item, string Description, decimal Quantity, decimal GrossUnitPrice);

    public static async Task<Invoice> DraftAsync(PakoDbContext db, Guid companyId, Guid partnerId, DateOnly issueDate, DateOnly dueDate, Guid? projectId,
        IReadOnlyList<Charge> charges, string? notes = null)
    {
        var defaults = await db.CompanyAccountDefaults.AsNoTracking().FirstAsync(d => d.CompanyId == companyId);
        var categoryIds = charges.Where(c => c.Item.CategoryId != null).Select(c => c.Item.CategoryId!.Value).Distinct().ToList();
        var categories = await db.ItemCategories.AsNoTracking().Where(c => categoryIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.RevenueAccountId);
        var invoice = new Invoice
        {
            Id = Guid.NewGuid(), CompanyId = companyId, PartnerId = partnerId, IssueDate = issueDate, DueDate = dueDate, State = InvoiceState.Draft,
            DocumentType = DocumentType.Invoice, ProjectId = projectId, InternalNotes = notes,
        };
        invoice.Lines = charges.Select(c => new InvoiceLine
        {
            Id = Guid.NewGuid(), InvoiceId = invoice.Id, Description = c.Description, Quantity = c.Quantity, UnitPrice = c.GrossUnitPrice,
            TaxDefinitionId = c.Item.DefaultTaxDefinitionId, ItemId = c.Item.Id,
            RevenueAccountId = c.Item.DefaultRevenueAccountId
                ?? (c.Item.CategoryId is { } cat ? categories.GetValueOrDefault(cat) : null) ?? defaults.RevenueAccountId,
        }).ToList();
        db.Invoices.Add(invoice);
        return invoice;
    }

    // A net amount made VAT-inclusive on the item's VAT code, to the cent.
    public static async Task<decimal> GrossAsync(PakoDbContext db, ITaxComputationService tax, Item item, decimal net)
    {
        if (item.DefaultTaxDefinitionId is not { } taxId) return Math.Round(net, 2, MidpointRounding.AwayFromZero);
        var definition = await db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines).FirstAsync(t => t.Id == taxId);
        return tax.Compute(Math.Round(net, 2, MidpointRounding.AwayFromZero), definition).TotalAmount;
    }

    // What is still open on posted invoices: the receivable each put on, less what was matched to it.
    public static async Task<Dictionary<Guid, (decimal Amount, decimal Open)>> OpenAsync(PakoDbContext db, Guid companyId, IReadOnlyCollection<Guid> invoiceIds)
    {
        if (invoiceIds.Count == 0) return new();
        var defaults = await db.CompanyAccountDefaults.AsNoTracking().FirstAsync(d => d.CompanyId == companyId);
        var rows = await db.Invoices.AsNoTracking()
            .Where(i => invoiceIds.Contains(i.Id) && i.State == InvoiceState.Posted && i.JournalEntryId != null)
            .Select(i => new
            {
                i.Id,
                Receivable = db.Partners.Where(p => p.Id == i.PartnerId).Select(p => p.ReceivableAccountId).FirstOrDefault() ?? defaults.ReceivableAccountId,
                i.JournalEntryId,
            })
            .ToListAsync();
        var result = new Dictionary<Guid, (decimal, decimal)>();
        foreach (var r in rows)
        {
            var amount = await db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == r.JournalEntryId && l.AccountId == r.Receivable).SumAsync(l => l.Debit);
            var paid = await db.Reconciliations.AsNoTracking().Where(x => x.InvoiceId == r.Id).SumAsync(x => (decimal?)x.Amount) ?? 0m;
            result[r.Id] = (amount, Math.Max(0m, amount - paid));
        }
        return result;
    }

    // A ledger project for a site or building; its code must be new in the company.
    public static async Task<Project?> NewProjectAsync(PakoDbContext db, Guid companyId, string code, string name)
    {
        code = code.Trim();
        if (code.Length is 0 or > 20 || await db.Projects.AnyAsync(p => p.CompanyId == companyId && p.Code == code)) return null;
        var project = new Project { Id = Guid.NewGuid(), CompanyId = companyId, Code = code, Name = name.Trim() };
        db.Projects.Add(project);
        return project;
    }
}
