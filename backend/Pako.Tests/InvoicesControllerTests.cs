using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

public class InvoicesControllerTests
{
    private static readonly TaxComputationService TaxService = new();

    private static async Task<(PakoDbContext Db, Guid CompanyId, Guid PartnerId, Guid CashAccountId)> SeedAsync()
    {
        var db = new PakoDbContext(new DbContextOptionsBuilder<PakoDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var partnerId = Guid.NewGuid();
        var cashAccountId = Guid.NewGuid();

        db.Companies.Add(company);
        db.Partners.Add(new Partner { Id = partnerId, CompanyId = company.Id, Name = "Acme", IsCustomer = true });
        db.Accounts.Add(new Account { Id = cashAccountId, CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.Asset, AccountSubType = AccountSubType.Cash });
        db.Accounts.Add(new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1200", Name = "Accounts Receivable", AccountType = AccountType.Asset, AccountSubType = AccountSubType.Receivable });
        db.Accounts.Add(new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income });
        db.Journals.Add(new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 });
        await db.SaveChangesAsync();

        return (db, company.Id, partnerId, cashAccountId);
    }

    private static CreateInvoiceRequest RequestWithLine(Guid partnerId, decimal quantity, decimal unitPrice) =>
        new(partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Consulting", quantity, unitPrice, null, null) });

    [Fact]
    public async Task Create_ZeroQuantity_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 0m, 100m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_NegativeUnitPrice_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 1m, -50m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_ZeroTotal_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 0m));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("positive total", badRequest.Value!.ToString());
    }

    [Fact]
    public async Task RecordPayment_FullAmount_CreatesReconciliationAndZeroesOutstandingBalance()
    {
        var (db, companyId, partnerId, cashAccountId) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, invoice.Id);

        var result = await controller.RecordPayment(companyId, invoice.Id, new RecordPaymentRequest(100m, cashAccountId, new DateOnly(2026, 8, 27)));

        var response = Assert.IsType<RecordPaymentResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(100m, response.Reconciliation.Amount);
        Assert.Equal(0m, response.Balance.Outstanding);
    }

    [Fact]
    public async Task RecordPayment_InvalidCashAccount_LeavesNoJournalEntryOrphaned()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, invoice.Id);

        var journalEntryCountBefore = await db.JournalEntries.CountAsync();

        var result = await controller.RecordPayment(companyId, invoice.Id, new RecordPaymentRequest(100m, Guid.NewGuid(), new DateOnly(2026, 8, 27)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(journalEntryCountBefore, await db.JournalEntries.CountAsync());
        Assert.Equal(0, await db.Reconciliations.CountAsync());
    }

    [Fact]
    public async Task RecordPayment_OnAlreadyFullyPaidInvoice_RejectedByReconciliationValidator()
    {
        // This is the mid-sequence failure the atomic endpoint exists to make impossible to
        // corrupt: the settlement JournalEntry.Post succeeds (it's internally balanced and valid
        // on its own), but the reconciliation step fails because the invoice has no outstanding
        // balance left. On Postgres this whole call is one transaction, so the settlement entry
        // this second attempt built is rolled back, not left as a Posted orphan — the InMemory
        // provider used here doesn't model real transactions (Pako.Api.Services.DatabaseFacadeExtensions
        // only takes a row lock/transaction for Npgsql), so this asserts the request is rejected;
        // the no-orphan guarantee itself was additionally verified against the real Postgres
        // container (see CLAUDE.md).
        var (db, companyId, partnerId, cashAccountId) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, invoice.Id);
        await controller.RecordPayment(companyId, invoice.Id, new RecordPaymentRequest(100m, cashAccountId, new DateOnly(2026, 8, 27)));

        var second = await controller.RecordPayment(companyId, invoice.Id, new RecordPaymentRequest(50m, cashAccountId, new DateOnly(2026, 8, 28)));

        var badRequest = Assert.IsType<BadRequestObjectResult>(second.Result);
        Assert.Contains("exceeds the outstanding balance", badRequest.Value!.ToString());
    }
}
