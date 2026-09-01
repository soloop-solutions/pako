using Microsoft.EntityFrameworkCore;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

public class BillImmutabilityTests
{
    private static PakoDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<PakoDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new PakoDbContext(options);
    }

    private static async Task<(PakoDbContext Db, Bill Bill)> SeedPostedBill()
    {
        var db = NewContext();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var bill = new Bill
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            PartnerId = Guid.NewGuid(),
            VendorReference = "SUPPLIER-INV-1",
            IssueDate = new DateOnly(2026, 8, 26),
            DueDate = new DateOnly(2026, 9, 25),
            Lines =
            {
                new BillLine
                {
                    Id = Guid.NewGuid(),
                    Description = "Office supplies",
                    Quantity = 1m,
                    UnitPrice = 100m,
                    ExpenseAccountId = Guid.NewGuid()
                }
            }
        };
        bill.Post(company, Guid.NewGuid(), Guid.NewGuid(), new TaxComputationService(), new Dictionary<Guid, TaxDefinition>(), Guid.NewGuid(), Guid.NewGuid());

        db.Companies.Add(company);
        db.Bills.Add(bill);
        await db.SaveChangesAsync();

        return (db, bill);
    }

    [Fact]
    public async Task ModifyingPostedBill_Throws()
    {
        var (db, bill) = await SeedPostedBill();

        bill.DueDate = bill.DueDate.AddDays(30);

        await Assert.ThrowsAsync<PostedBillImmutableException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task ModifyingLineOfPostedBill_Throws()
    {
        var (db, bill) = await SeedPostedBill();

        bill.Lines[0].Description = "changed";

        await Assert.ThrowsAsync<PostedBillImmutableException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task DeletingPostedBill_Throws()
    {
        var (db, bill) = await SeedPostedBill();

        db.Bills.Remove(bill);

        await Assert.ThrowsAsync<PostedBillImmutableException>(() => db.SaveChangesAsync());
    }
}
