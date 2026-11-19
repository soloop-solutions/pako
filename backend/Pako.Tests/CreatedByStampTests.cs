using Microsoft.EntityFrameworkCore;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Infrastructure.Audit;

namespace Pako.Tests;

public class CreatedByStampTests
{
    private sealed class Ambient : IAuditContext
    {
        public string? UserId { get; set; }
        public string? IpAddress { get; set; }
        public string? RequestId { get; set; }
        public Guid? SourceDocumentId { get; set; }
    }

    [Fact]
    public async Task NewInvoiceAndBill_AreStampedWithTheCurrentUser_AndKeepAnExplicitCreator()
    {
        var user = Guid.NewGuid();
        var ambient = new Ambient { UserId = user.ToString() };
        await using var db = await PostgresTestDatabase.CreateAsync(ambient);
        var company = new Company { Id = Guid.NewGuid(), Name = "Co" };
        db.Companies.Add(company);
        var invoice = new Invoice { Id = Guid.NewGuid(), CompanyId = company.Id, PartnerId = Guid.NewGuid(), IssueDate = new DateOnly(2026, 11, 1), DueDate = new DateOnly(2026, 11, 30) };
        var bill = new Bill { Id = Guid.NewGuid(), CompanyId = company.Id, PartnerId = Guid.NewGuid(), IssueDate = new DateOnly(2026, 11, 1), DueDate = new DateOnly(2026, 11, 30) };
        var explicitCreator = Guid.NewGuid();
        var other = new Invoice { Id = Guid.NewGuid(), CompanyId = company.Id, PartnerId = Guid.NewGuid(), IssueDate = new DateOnly(2026, 11, 1), DueDate = new DateOnly(2026, 11, 30), CreatedByUserId = explicitCreator };
        db.Invoices.AddRange(invoice, other);
        db.Bills.Add(bill);
        await db.SaveChangesAsync();

        Assert.Equal(user, (await db.Invoices.AsNoTracking().SingleAsync(i => i.Id == invoice.Id)).CreatedByUserId);
        Assert.Equal(user, (await db.Bills.AsNoTracking().SingleAsync(b => b.Id == bill.Id)).CreatedByUserId);
        Assert.Equal(explicitCreator, (await db.Invoices.AsNoTracking().SingleAsync(i => i.Id == other.Id)).CreatedByUserId);
    }

    [Fact]
    public async Task NoAmbientUser_LeavesCreatorEmpty()
    {
        await using var db = await PostgresTestDatabase.CreateAsync(new Ambient());
        var company = new Company { Id = Guid.NewGuid(), Name = "Co" };
        db.Companies.Add(company);
        var invoice = new Invoice { Id = Guid.NewGuid(), CompanyId = company.Id, PartnerId = Guid.NewGuid(), IssueDate = new DateOnly(2026, 11, 1), DueDate = new DateOnly(2026, 11, 30) };
        db.Invoices.Add(invoice);
        await db.SaveChangesAsync();
        Assert.Null((await db.Invoices.AsNoTracking().SingleAsync(i => i.Id == invoice.Id)).CreatedByUserId);
    }
}
