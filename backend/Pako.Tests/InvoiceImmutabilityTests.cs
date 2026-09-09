using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

public class InvoiceImmutabilityTests
{
    private static PakoDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<PakoDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new PakoDbContext(options);
    }

    private static async Task<(PakoDbContext Db, Invoice Invoice)> SeedPostedInvoice()
    {
        var db = NewContext();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var invoice = new Invoice
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            PartnerId = Guid.NewGuid(),
            IssueDate = new DateOnly(2026, 8, 26),
            DueDate = new DateOnly(2026, 9, 25),
            Lines =
            {
                new InvoiceLine
                {
                    Id = Guid.NewGuid(),
                    Description = "Consulting",
                    Quantity = 1m,
                    UnitPrice = 100m,
                    RevenueAccountId = Guid.NewGuid()
                }
            }
        };
        invoice.Post(company, Guid.NewGuid(), Guid.NewGuid(), new TaxComputationService(), new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());

        db.Companies.Add(company);
        db.Invoices.Add(invoice);
        await db.SaveChangesAsync();

        return (db, invoice);
    }

    // A5 (v2 release): DueDate is no longer a valid "any field" example — it's the one field,
    // alongside InternalNotes, deliberately still editable on a Posted invoice (see
    // DueDateChange_Succeeds/OnlyDueDateOrInternalNotesChanged below). PartnerId stands in as a
    // field that's genuinely still locked.
    [Fact]
    public async Task ModifyingPostedInvoice_Throws()
    {
        var (db, invoice) = await SeedPostedInvoice();

        invoice.PartnerId = Guid.NewGuid();

        await Assert.ThrowsAsync<PostedInvoiceImmutableException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task DueDateChange_Succeeds()
    {
        var (db, invoice) = await SeedPostedInvoice();

        invoice.DueDate = invoice.DueDate.AddDays(30);

        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task InternalNotesChange_Succeeds()
    {
        var (db, invoice) = await SeedPostedInvoice();

        invoice.InternalNotes = "Called customer, confirmed delivery.";

        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task ModifyingLineOfPostedInvoice_Throws()
    {
        var (db, invoice) = await SeedPostedInvoice();

        invoice.Lines[0].Description = "changed";

        await Assert.ThrowsAsync<PostedInvoiceImmutableException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task DeletingPostedInvoice_Throws()
    {
        var (db, invoice) = await SeedPostedInvoice();

        db.Invoices.Remove(invoice);

        await Assert.ThrowsAsync<PostedInvoiceImmutableException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task ModifyingDraftInvoice_Succeeds()
    {
        var db = NewContext();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var invoice = new Invoice
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            PartnerId = Guid.NewGuid(),
            IssueDate = new DateOnly(2026, 8, 26),
            DueDate = new DateOnly(2026, 9, 25)
        };
        db.Companies.Add(company);
        db.Invoices.Add(invoice);
        await db.SaveChangesAsync();

        invoice.DueDate = invoice.DueDate.AddDays(10);
        await db.SaveChangesAsync();

        Assert.Equal(new DateOnly(2026, 10, 5), invoice.DueDate);
    }
}
