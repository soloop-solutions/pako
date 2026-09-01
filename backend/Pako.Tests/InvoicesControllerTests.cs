using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
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

        var receivableAccountId = Guid.NewGuid();
        var revenueAccountId = Guid.NewGuid();
        var depositsAccountId = Guid.NewGuid();

        db.Companies.Add(company);
        db.Partners.Add(new Partner { Id = partnerId, CompanyId = company.Id, Name = "Acme", IsCustomer = true });
        db.Accounts.Add(new Account { Id = cashAccountId, CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.Asset, AccountSubType = AccountSubType.Cash });
        db.Accounts.Add(new Account { Id = receivableAccountId, CompanyId = company.Id, Code = "1200", Name = "Accounts Receivable", AccountType = AccountType.Asset, AccountSubType = AccountSubType.Receivable });
        db.Accounts.Add(new Account { Id = revenueAccountId, CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income });
        db.Accounts.Add(new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "4001", Name = "Other Revenue", AccountType = AccountType.Income });
        db.Accounts.Add(new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "2100", Name = "VAT Payable", AccountType = AccountType.Liability });
        db.Accounts.Add(new Account { Id = depositsAccountId, CompanyId = company.Id, Code = "2500", Name = "Customer Deposits", AccountType = AccountType.Liability });
        db.Journals.Add(new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 });
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            ReceivableAccountId = receivableAccountId,
            PayableAccountId = Guid.NewGuid(),
            RevenueAccountId = revenueAccountId,
            ExpenseAccountId = Guid.NewGuid(),
            CustomerDepositsAccountId = depositsAccountId
        });
        await db.SaveChangesAsync();

        return (db, company.Id, partnerId, cashAccountId);
    }

    private static CreateInvoiceRequest RequestWithLine(Guid partnerId, decimal quantity, decimal unitPrice) =>
        new(partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Consulting", quantity, unitPrice, null, null) });

    private static CreateInvoiceRequest CreditNoteRequestWithLine(Guid partnerId, decimal quantity, decimal unitPrice) =>
        new(partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Credit", quantity, unitPrice, null, null) },
            DocumentType.CreditNote);

    private static CreateInvoiceRequest DownPaymentRequestWithLine(Guid partnerId, decimal quantity, decimal unitPrice) =>
        new(partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Deposit", quantity, unitPrice, null, null) },
            DocumentType.DownPayment);

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
    public async Task Create_ZeroTotal_RejectedWithCreditNoteGuidance()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

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

    [Fact]
    public async Task ApplyCreditNote_FullAmount_ReducesOutstandingBalance()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

        var invoiceCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 500m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(invoiceCreated.Result).Value);
        await controller.Post(companyId, invoice.Id);

        var creditNoteCreated = await controller.Create(companyId, CreditNoteRequestWithLine(partnerId, 1m, 200m));
        var creditNote = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(creditNoteCreated.Result).Value);
        await controller.Post(companyId, creditNote.Id);

        var result = await controller.ApplyCreditNote(companyId, invoice.Id, new ApplyCreditNoteRequest(creditNote.Id, 200m));

        var response = Assert.IsType<ApplyCreditNoteResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(200m, response.Reconciliation.Amount);
        Assert.Equal(300m, response.Balance.Outstanding);
    }

    [Fact]
    public async Task ApplyCreditNote_BeyondCreditNoteOwnAmount_RejectedBySettlementLineOverConsumptionCheck()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

        var invoiceACreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 500m));
        var invoiceA = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(invoiceACreated.Result).Value);
        await controller.Post(companyId, invoiceA.Id);

        var invoiceBCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 500m));
        var invoiceB = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(invoiceBCreated.Result).Value);
        await controller.Post(companyId, invoiceB.Id);

        var creditNoteCreated = await controller.Create(companyId, CreditNoteRequestWithLine(partnerId, 1m, 100m));
        var creditNote = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(creditNoteCreated.Result).Value);
        await controller.Post(companyId, creditNote.Id);

        var first = await controller.ApplyCreditNote(companyId, invoiceA.Id, new ApplyCreditNoteRequest(creditNote.Id, 100m));
        Assert.Equal(201, ((ObjectResult)first.Result!).StatusCode);

        var second = await controller.ApplyCreditNote(companyId, invoiceB.Id, new ApplyCreditNoteRequest(creditNote.Id, 1m));

        var badRequest = Assert.IsType<BadRequestObjectResult>(second.Result);
        Assert.Contains("would be reconciled against it in total", badRequest.Value!.ToString());
    }

    [Fact]
    public async Task Balance_OnCreditNoteOwnDocument_DropsAsItIsAppliedAgainstAnInvoice()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

        var invoiceCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 500m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(invoiceCreated.Result).Value);
        await controller.Post(companyId, invoice.Id);

        var creditNoteCreated = await controller.Create(companyId, CreditNoteRequestWithLine(partnerId, 1m, 200m));
        var creditNote = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(creditNoteCreated.Result).Value);
        await controller.Post(companyId, creditNote.Id);

        var before = await controller.Balance(companyId, creditNote.Id);
        var beforeBalance = Assert.IsType<DocumentBalanceResponse>(Assert.IsType<OkObjectResult>(before.Result).Value);
        Assert.Equal(200m, beforeBalance.Total);
        Assert.Equal(0m, beforeBalance.Reconciled);
        Assert.Equal(200m, beforeBalance.Outstanding);

        await controller.ApplyCreditNote(companyId, invoice.Id, new ApplyCreditNoteRequest(creditNote.Id, 100m));

        var after = await controller.Balance(companyId, creditNote.Id);
        var afterBalance = Assert.IsType<DocumentBalanceResponse>(Assert.IsType<OkObjectResult>(after.Result).Value);
        Assert.Equal(200m, afterBalance.Total);
        Assert.Equal(100m, afterBalance.Reconciled);
        Assert.Equal(100m, afterBalance.Outstanding);
    }

    [Fact]
    public async Task Balance_OnDownPaymentOwnDocument_ReflectsPartialThenFullApplication()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

        var invoiceCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 500m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(invoiceCreated.Result).Value);
        await controller.Post(companyId, invoice.Id);

        var downPaymentCreated = await controller.Create(companyId, DownPaymentRequestWithLine(partnerId, 1m, 300m));
        var downPayment = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(downPaymentCreated.Result).Value);
        await controller.Post(companyId, downPayment.Id);

        var before = await controller.Balance(companyId, downPayment.Id);
        var beforeBalance = Assert.IsType<DocumentBalanceResponse>(Assert.IsType<OkObjectResult>(before.Result).Value);
        Assert.Equal(300m, beforeBalance.Total);
        Assert.Equal(0m, beforeBalance.Reconciled);
        Assert.Equal(300m, beforeBalance.Outstanding);

        await controller.ApplyDownPayment(companyId, invoice.Id, new ApplyDownPaymentRequest(downPayment.Id, 150m));

        var mid = await controller.Balance(companyId, downPayment.Id);
        var midBalance = Assert.IsType<DocumentBalanceResponse>(Assert.IsType<OkObjectResult>(mid.Result).Value);
        Assert.Equal(300m, midBalance.Total);
        Assert.Equal(150m, midBalance.Reconciled);
        Assert.Equal(150m, midBalance.Outstanding);

        await controller.ApplyDownPayment(companyId, invoice.Id, new ApplyDownPaymentRequest(downPayment.Id, 150m));

        var after = await controller.Balance(companyId, downPayment.Id);
        var afterBalance = Assert.IsType<DocumentBalanceResponse>(Assert.IsType<OkObjectResult>(after.Result).Value);
        Assert.Equal(300m, afterBalance.Total);
        Assert.Equal(300m, afterBalance.Reconciled);
        Assert.Equal(0m, afterBalance.Outstanding);
    }

    [Fact]
    public async Task Balance_OnNormalInvoice_UnaffectedByDocumentTypeBranching()
    {
        var (db, companyId, partnerId, cashAccountId) = await SeedAsync();
        var controller = new InvoicesController(db, TaxService);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 500m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, invoice.Id);

        await controller.RecordPayment(companyId, invoice.Id, new RecordPaymentRequest(200m, cashAccountId, new DateOnly(2026, 8, 27)));

        var result = await controller.Balance(companyId, invoice.Id);
        var balance = Assert.IsType<DocumentBalanceResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(500m, balance.Total);
        Assert.Equal(200m, balance.Reconciled);
        Assert.Equal(300m, balance.Outstanding);
    }
}
