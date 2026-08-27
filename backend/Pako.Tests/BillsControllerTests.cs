using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Bills;
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

    private static CreateBillRequest CreditNoteRequestWithLine(Guid partnerId, decimal quantity, decimal unitPrice) =>
        new(partnerId, "VEND-CN-001", new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateBillLineRequest> { new("Credit", quantity, unitPrice, null, null) },
            DocumentType.CreditNote);

    [Fact]
    public async Task Create_NegativeUnitPrice_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new BillsController(db, TaxService);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 1m, -10m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_ZeroTotal_RejectedWithCreditNoteGuidance()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new BillsController(db, TaxService);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 0m));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var message = badRequest.Value!.ToString()!;
        Assert.Contains("positive total", message);
        Assert.Contains("credit note", message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("not yet supported", message);
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

    [Fact]
    public async Task ApplyCreditNote_FullAmount_ReducesOutstandingBalance()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new BillsController(db, TaxService);

        var billCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 400m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(billCreated.Result).Value);
        await controller.Post(companyId, bill.Id);

        var creditNoteCreated = await controller.Create(companyId, CreditNoteRequestWithLine(partnerId, 1m, 150m));
        var creditNote = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(creditNoteCreated.Result).Value);
        await controller.Post(companyId, creditNote.Id);

        var result = await controller.ApplyCreditNote(companyId, bill.Id, new ApplyCreditNoteRequest(creditNote.Id, 150m));

        var response = Assert.IsType<ApplyCreditNoteResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(150m, response.Reconciliation.Amount);
        Assert.Equal(250m, response.Balance.Outstanding);
    }

    [Fact]
    public async Task ApplyCreditNote_BeyondCreditNoteOwnAmount_RejectedBySettlementLineOverConsumptionCheck()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new BillsController(db, TaxService);

        var billACreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 400m));
        var billA = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(billACreated.Result).Value);
        await controller.Post(companyId, billA.Id);

        var billBCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 400m));
        var billB = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(billBCreated.Result).Value);
        await controller.Post(companyId, billB.Id);

        var creditNoteCreated = await controller.Create(companyId, CreditNoteRequestWithLine(partnerId, 1m, 100m));
        var creditNote = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(creditNoteCreated.Result).Value);
        await controller.Post(companyId, creditNote.Id);

        var first = await controller.ApplyCreditNote(companyId, billA.Id, new ApplyCreditNoteRequest(creditNote.Id, 100m));
        Assert.Equal(201, ((ObjectResult)first.Result!).StatusCode);

        var second = await controller.ApplyCreditNote(companyId, billB.Id, new ApplyCreditNoteRequest(creditNote.Id, 1m));

        var badRequest = Assert.IsType<BadRequestObjectResult>(second.Result);
        Assert.Contains("would be reconciled against it in total", badRequest.Value!.ToString());
    }

    [Fact]
    public async Task Balance_OnCreditNoteOwnDocument_DropsAsItIsAppliedAgainstABill()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new BillsController(db, TaxService);

        var billCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 400m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(billCreated.Result).Value);
        await controller.Post(companyId, bill.Id);

        var creditNoteCreated = await controller.Create(companyId, CreditNoteRequestWithLine(partnerId, 1m, 150m));
        var creditNote = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(creditNoteCreated.Result).Value);
        await controller.Post(companyId, creditNote.Id);

        var before = await controller.Balance(companyId, creditNote.Id);
        var beforeBalance = Assert.IsType<DocumentBalanceResponse>(Assert.IsType<OkObjectResult>(before.Result).Value);
        Assert.Equal(150m, beforeBalance.Total);
        Assert.Equal(0m, beforeBalance.Reconciled);
        Assert.Equal(150m, beforeBalance.Outstanding);

        await controller.ApplyCreditNote(companyId, bill.Id, new ApplyCreditNoteRequest(creditNote.Id, 75m));

        var after = await controller.Balance(companyId, creditNote.Id);
        var afterBalance = Assert.IsType<DocumentBalanceResponse>(Assert.IsType<OkObjectResult>(after.Result).Value);
        Assert.Equal(150m, afterBalance.Total);
        Assert.Equal(75m, afterBalance.Reconciled);
        Assert.Equal(75m, afterBalance.Outstanding);
    }

    [Fact]
    public async Task Balance_OnNormalBill_UnaffectedByDocumentTypeBranching()
    {
        var (db, companyId, partnerId, cashAccountId) = await SeedAsync();
        var controller = new BillsController(db, TaxService);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 400m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, bill.Id);

        await controller.RecordPayment(companyId, bill.Id, new RecordPaymentRequest(150m, cashAccountId, new DateOnly(2026, 8, 27)));

        var result = await controller.Balance(companyId, bill.Id);
        var balance = Assert.IsType<DocumentBalanceResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(400m, balance.Total);
        Assert.Equal(150m, balance.Reconciled);
        Assert.Equal(250m, balance.Outstanding);
    }
}
