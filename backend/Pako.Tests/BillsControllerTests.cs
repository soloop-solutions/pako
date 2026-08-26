using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

public class BillsControllerTests
{
    private static readonly TaxComputationService TaxService = new();

    private static async Task<(PakoDbContext Db, Guid CompanyId, Guid PartnerId, Guid CashAccountId)> SeedAsync()
    {
        var db = new PakoDbContext(new DbContextOptionsBuilder<PakoDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var partnerId = Guid.NewGuid();
        var cashAccountId = Guid.NewGuid();

        db.Companies.Add(company);
        db.Partners.Add(new Partner { Id = partnerId, CompanyId = company.Id, Name = "Vendor Inc", IsVendor = true });
        db.Accounts.Add(new Account { Id = cashAccountId, CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.Asset, AccountSubType = AccountSubType.Cash });
        db.Accounts.Add(new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "2000", Name = "Accounts Payable", AccountType = AccountType.Liability, AccountSubType = AccountSubType.Payable });
        db.Accounts.Add(new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "6000", Name = "Expenses", AccountType = AccountType.Expense });
        db.Journals.Add(new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 });
        await db.SaveChangesAsync();

        return (db, company.Id, partnerId, cashAccountId);
    }

    private static CreateBillRequest RequestWithLine(Guid partnerId, decimal quantity, decimal unitPrice) =>
        new(partnerId, "VEND-001", new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateBillLineRequest> { new("Supplies", quantity, unitPrice, null, null) });

    [Fact]
    public async Task Create_NegativeUnitPrice_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new BillsController(db, TaxService);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 1m, -10m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_ZeroTotal_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new BillsController(db, TaxService);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 0m));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("positive total", badRequest.Value!.ToString());
    }

    [Fact]
    public async Task RecordPayment_FullAmount_CreatesReconciliationAndZeroesOutstandingBalance()
    {
        var (db, companyId, partnerId, cashAccountId) = await SeedAsync();
        var controller = new BillsController(db, TaxService);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 200m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, bill.Id);

        var result = await controller.RecordPayment(companyId, bill.Id, new RecordPaymentRequest(200m, cashAccountId, new DateOnly(2026, 8, 27)));

        var response = Assert.IsType<RecordPaymentResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(200m, response.Reconciliation.Amount);
        Assert.Equal(0m, response.Balance.Outstanding);
    }

    [Fact]
    public async Task RecordPayment_InvalidCashAccount_LeavesNoJournalEntryOrphaned()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new BillsController(db, TaxService);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 200m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, bill.Id);

        var journalEntryCountBefore = await db.JournalEntries.CountAsync();

        var result = await controller.RecordPayment(companyId, bill.Id, new RecordPaymentRequest(200m, Guid.NewGuid(), new DateOnly(2026, 8, 27)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(journalEntryCountBefore, await db.JournalEntries.CountAsync());
        Assert.Equal(0, await db.Reconciliations.CountAsync());
    }
}
