using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
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

    private static InvoicesController NewController(PakoDbContext db)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"));

        return new InvoicesController(db, TaxService, new DocumentNumberService(), new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
    }

    private static async Task<(PakoDbContext Db, Guid CompanyId, Guid PartnerId, Guid CashAccountId)> SeedAsync()
    {
        var db = new PakoDbContext(new DbContextOptionsBuilder<PakoDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        // IsVatRegistered = false: this fixture's own RequestWithLine helper builds lines with no
        // TaxDefinitionId, and most tests here are about other invariants (quantity/price/total),
        // not C2's "VAT-registered companies require a tax code per line" rule — that rule gets
        // its own dedicated tests below against an explicitly VAT-registered company.
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co", IsVatRegistered = false };
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

    private static CreateInvoiceRequest SalesReturnRequestWithLine(Guid partnerId, decimal quantity, decimal unitPrice, Guid? originalInvoiceId) =>
        new(partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Returned goods", quantity, unitPrice, null, null) },
            DocumentType.SalesReturn, originalInvoiceId);

    private static CreateInvoiceRequest ProformaRequestWithLine(Guid partnerId, decimal quantity, decimal unitPrice) =>
        new(partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Consulting (proforma)", quantity, unitPrice, null, null) },
            DocumentType.Proforma);

    [Fact]
    public async Task Create_ZeroQuantity_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 0m, 100m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_NegativeUnitPrice_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 1m, -50m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_ZeroTotal_RejectedWithCreditNoteGuidance()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 0m));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var message = badRequest.Value!.ToString()!;
        Assert.Contains("positive total", message);
        Assert.Contains("credit note", message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("not yet supported", message);
    }

    // C2: a VAT-registered company must tag every line with a real tax code.
    [Fact]
    public async Task Create_NoTaxCodeOnVatRegisteredCompany_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        (await db.Companies.FindAsync(companyId))!.IsVatRegistered = true;
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("A tax code is required for every line.", badRequest.Value);
    }

    [Fact]
    public async Task Create_NoTaxCodeOnNonVatRegisteredCompany_Allowed()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));

        Assert.IsType<ObjectResult>(result.Result);
    }

    // S0.1: since numbering moved out of Invoice.Post() into IDocumentNumberService, called by
    // this controller only after Post() succeeds, the "a failed post never burns a number"
    // guarantee now lives here rather than in Invoice.Post() itself — see
    // InvoicePostingTests.Post_FailedPost_DoesNotBurnAnInvoiceNumber's updated comment.
    [Fact]
    public async Task Post_UnknownTaxDefinition_LeavesInvoiceNumberCounterUntouched()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Consulting", 1m, 100m, Guid.NewGuid(), null) }));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Post(companyId, invoice.Id);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        var company = await db.Companies.FindAsync(companyId);
        Assert.Equal(1, company!.NextInvoiceNumber);
    }

    [Fact]
    public async Task RecordPayment_FullAmount_CreatesReconciliationAndZeroesOutstandingBalance()
    {
        var (db, companyId, partnerId, cashAccountId) = await SeedAsync();
        var controller = NewController(db);

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
        var controller = NewController(db);

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
        var controller = NewController(db);

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
        var controller = NewController(db);

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
        var controller = NewController(db);

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
        var controller = NewController(db);

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
        var controller = NewController(db);

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
        var controller = NewController(db);

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

    // A1 (v2 release): the meeting's business case — a customer is invoiced 1000 EUR, refuses the
    // goods, seller issues a 1000 EUR return. Two documents exist afterwards, original untouched.
    [Fact]
    public async Task Create_SalesReturn_WithoutOriginalInvoiceId_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, SalesReturnRequestWithLine(partnerId, 1m, 1000m, null));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("originalInvoiceId", badRequest.Value!.ToString());
    }

    [Fact]
    public async Task Post_SalesReturn_AgainstDraftOriginal_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var invoiceCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 1000m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(invoiceCreated.Result).Value);
        // Deliberately not posted — a return against a never-posted invoice has nothing to return.

        var returnCreated = await controller.Create(companyId, SalesReturnRequestWithLine(partnerId, 1m, 1000m, invoice.Id));
        var salesReturn = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(returnCreated.Result).Value);

        var result = await controller.Post(companyId, salesReturn.Id);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("must be Posted", badRequest.Value!.ToString());
    }

    [Fact]
    public async Task Post_SalesReturn_FullAmount_NetsToZeroOnReceivableAccount()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var invoiceCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 1000m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(invoiceCreated.Result).Value);
        await controller.Post(companyId, invoice.Id);

        var returnCreated = await controller.Create(companyId, SalesReturnRequestWithLine(partnerId, 1m, 1000m, invoice.Id));
        var salesReturn = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(returnCreated.Result).Value);

        var result = await controller.Post(companyId, salesReturn.Id);
        Assert.Equal(200, ((ObjectResult)result.Result!).StatusCode);

        // Original invoice is untouched — still Posted, its own balance unaffected by the return
        // (they're independent postings that net out on the shared AR control account only).
        var originalStillPosted = await db.Invoices.AsNoTracking().SingleAsync(i => i.Id == invoice.Id);
        Assert.Equal(InvoiceState.Posted, originalStillPosted.State);

        var receivableAccountId = (await db.CompanyAccountDefaults.AsNoTracking()
            .SingleAsync(d => d.CompanyId == companyId)).ReceivableAccountId;
        var netReceivable = await db.JournalEntryLines.AsNoTracking()
            .Where(l => l.AccountId == receivableAccountId && l.JournalEntry!.CompanyId == companyId && l.JournalEntry.State == JournalEntryState.Posted)
            .SumAsync(l => l.Debit - l.Credit);
        Assert.Equal(0m, netReceivable);
    }

    [Fact]
    public async Task Post_SalesReturn_Partial_ThenSecondReturnExceedingRemainder_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var invoiceCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 1000m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(invoiceCreated.Result).Value);
        await controller.Post(companyId, invoice.Id);

        var firstReturnCreated = await controller.Create(companyId, SalesReturnRequestWithLine(partnerId, 1m, 600m, invoice.Id));
        var firstReturn = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(firstReturnCreated.Result).Value);
        var firstResult = await controller.Post(companyId, firstReturn.Id);
        Assert.Equal(200, ((ObjectResult)firstResult.Result!).StatusCode);

        // Remaining un-returned amount is now 1000 - 600 = 400; a second return of 500 exceeds it.
        var secondReturnCreated = await controller.Create(companyId, SalesReturnRequestWithLine(partnerId, 1m, 500m, invoice.Id));
        var secondReturn = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(secondReturnCreated.Result).Value);

        var secondResult = await controller.Post(companyId, secondReturn.Id);

        var badRequest = Assert.IsType<BadRequestObjectResult>(secondResult.Result);
        var message = badRequest.Value!.ToString()!;
        Assert.Contains("500", message);
        Assert.Contains("400", message);

        // The rejected return never got a number and never posted (no number/journal-entry burn).
        var secondReturnAfter = await db.Invoices.AsNoTracking().SingleAsync(i => i.Id == secondReturn.Id);
        Assert.Null(secondReturnAfter.InvoiceNumber);
        Assert.Null(secondReturnAfter.JournalEntryId);

        // A return of exactly the 400 remainder succeeds.
        var thirdReturnCreated = await controller.Create(companyId, SalesReturnRequestWithLine(partnerId, 1m, 400m, invoice.Id));
        var thirdReturn = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(thirdReturnCreated.Result).Value);
        var thirdResult = await controller.Post(companyId, thirdReturn.Id);
        Assert.Equal(200, ((ObjectResult)thirdResult.Result!).StatusCode);
    }

    // A3 (v2 release): a proforma is an offer, not a legal invoice — most of the work here is
    // what it's forbidden to do, so that's what's tested, per the task's own framing.
    [Fact]
    public async Task Create_Proforma_ProducesZeroJournalEntriesAndLeavesInvoiceCounterUntouched()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, ProformaRequestWithLine(partnerId, 1m, 500m));

        var proforma = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(InvoiceState.Draft.ToString(), proforma.State);
        Assert.Equal("PRO-0001", proforma.InvoiceNumber);
        Assert.Equal(0, await db.JournalEntries.CountAsync());

        var company = await db.Companies.AsNoTracking().SingleAsync(c => c.Id == companyId);
        Assert.Equal(1, company.NextInvoiceNumber);
    }

    [Fact]
    public async Task Post_Proforma_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, ProformaRequestWithLine(partnerId, 1m, 500m));
        var proforma = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Post(companyId, proforma.Id);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("cannot be posted", badRequest.Value!.ToString());
        Assert.Equal(0, await db.JournalEntries.CountAsync());
    }

    [Fact]
    public async Task ConvertToInvoice_CopiesLinesAndLinksBackToProforma()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, ProformaRequestWithLine(partnerId, 2m, 250m));
        var proforma = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.ConvertToInvoice(companyId, proforma.Id);

        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(DocumentType.Invoice, invoice.DocumentType);
        Assert.Equal(InvoiceState.Draft.ToString(), invoice.State);
        Assert.Equal(proforma.Id, invoice.OriginalInvoiceId);
        Assert.Equal(partnerId, invoice.PartnerId);
        var line = Assert.Single(invoice.Lines);
        Assert.Equal(2m, line.Quantity);
        Assert.Equal(250m, line.UnitPrice);

        // Posting the converted invoice works normally and consumes a real invoice number — the
        // proforma's own PRO-#### number was never touched by this.
        var postResult = await controller.Post(companyId, invoice.Id);
        Assert.Equal(200, ((ObjectResult)postResult.Result!).StatusCode);

        // The proforma itself is untouched — still Draft, still has its own number, still exists.
        var proformaAfter = await db.Invoices.AsNoTracking().SingleAsync(i => i.Id == proforma.Id);
        Assert.Equal(InvoiceState.Draft, proformaAfter.State);
        Assert.Equal("PRO-0001", proformaAfter.InvoiceNumber);
    }

    [Fact]
    public async Task ConvertToInvoice_OnNonProformaDocument_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 500m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.ConvertToInvoice(companyId, invoice.Id);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task VatReturn_OverPeriodContainingOnlyAProforma_ReturnsAllZeros()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        await controller.Create(companyId, ProformaRequestWithLine(partnerId, 1m, 500m));

        var reportsController = new ReportsController(db);
        var result = await reportsController.VatReturn(companyId, new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));

        var vatReturn = Assert.IsType<VatReturnResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(0m, vatReturn.TotalOutputVat);
        Assert.Equal(0m, vatReturn.TotalInputVat);
        Assert.Empty(vatReturn.OutputVat);
        Assert.Empty(vatReturn.InputVat);
    }

    // A4 (v2 release): a genuinely blank Draft (never posted, no number, no journal entry) may
    // be discarded — via this dedicated POST action, never a DELETE verb (see
    // NoDeletionGuaranteeTests for the "no delete route exists" half of this guarantee).
    [Fact]
    public async Task Discard_BlankDraft_RemovesIt()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Discard(companyId, invoice.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(0, await db.Invoices.CountAsync(i => i.Id == invoice.Id));
    }

    [Fact]
    public async Task Discard_PostedInvoice_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, invoice.Id);

        var result = await controller.Discard(companyId, invoice.Id);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(1, await db.Invoices.CountAsync(i => i.Id == invoice.Id));
    }

    [Fact]
    public async Task Discard_DraftWithNumberSomehowSet_Rejected()
    {
        // Defensive coverage: a Draft should never have InvoiceNumber/JournalEntryId set (only
        // Post() sets either, and it also flips State to Posted in the same operation) — but the
        // discard guard checks all three explicitly rather than trusting that invariant silently.
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var tracked = await db.Invoices.SingleAsync(i => i.Id == invoice.Id);
        tracked.InvoiceNumber = "INV-9999";
        await db.SaveChangesAsync();

        var result = await controller.Discard(companyId, invoice.Id);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(1, await db.Invoices.CountAsync(i => i.Id == invoice.Id));
    }

    // A5 (v2 release): Draft = fully editable — a full replace, same validation as Create().
    [Fact]
    public async Task Update_DraftInvoice_ReplacesLinesAndFields()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var newDueDate = new DateOnly(2026, 12, 1);
        var result = await controller.Update(companyId, invoice.Id, new UpdateInvoiceRequest(
            partnerId, new DateOnly(2026, 8, 26), newDueDate,
            new List<CreateInvoiceLineRequest> { new("Updated consulting", 3m, 200m, null, null) },
            DocumentType.Invoice, null, "Draft note"));

        var updated = Assert.IsType<InvoiceResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(newDueDate, updated.DueDate);
        Assert.Equal("Draft note", updated.InternalNotes);
        var line = Assert.Single(updated.Lines);
        Assert.Equal("Updated consulting", line.Description);
        Assert.Equal(3m, line.Quantity);
        Assert.Equal(200m, line.UnitPrice);

        // The old line is actually gone, not just orphaned.
        Assert.Equal(1, await db.InvoiceLines.CountAsync(l => l.InvoiceId == invoice.Id));
    }

    [Fact]
    public async Task Update_DraftInvoice_ZeroTotal_RejectedSameAsCreate()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Update(companyId, invoice.Id, new UpdateInvoiceRequest(
            partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Zero", 1m, 0m, null, null) },
            DocumentType.Invoice, null, null));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_PostedInvoice_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, invoice.Id);

        var result = await controller.Update(companyId, invoice.Id, new UpdateInvoiceRequest(
            partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 12, 1),
            new List<CreateInvoiceLineRequest> { new("Consulting", 1m, 100m, null, null) },
            DocumentType.Invoice, null, null));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("due date and internal notes", badRequest.Value!.ToString());
    }

    [Fact]
    public async Task Update_CancelledInvoice_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        // No API path sets Cancelled today (JournalEntry.Reverse() doesn't sync Invoice.State —
        // a documented pre-existing gap), and PakoDbContext's immutability guard would itself
        // reject flipping an already-Posted invoice's State via a direct mutation (State isn't in
        // the DueDate/InternalNotes whitelist either) — so a Cancelled invoice is seeded directly
        // as a brand-new Added entity instead, which bypasses the guard entirely (it only fires
        // on Modified/Deleted, never Added).
        var cancelledId = Guid.NewGuid();
        db.Invoices.Add(new Invoice
        {
            Id = cancelledId,
            CompanyId = companyId,
            PartnerId = partnerId,
            InvoiceNumber = "INV-9998",
            IssueDate = new DateOnly(2026, 8, 26),
            DueDate = new DateOnly(2026, 9, 25),
            State = InvoiceState.Cancelled,
            Lines = { new InvoiceLine { Id = Guid.NewGuid(), Description = "Consulting", Quantity = 1m, UnitPrice = 100m, RevenueAccountId = Guid.NewGuid() } }
        });
        await db.SaveChangesAsync();

        var result = await controller.Update(companyId, cancelledId, new UpdateInvoiceRequest(
            partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 12, 1),
            new List<CreateInvoiceLineRequest> { new("Consulting", 1m, 100m, null, null) },
            DocumentType.Invoice, null, null));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task EditPosted_DueDateOnly_SucceedsAndWritesOneAuditRowWithOnlyDueDateSet()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, invoice.Id);

        var newDueDate = new DateOnly(2026, 12, 1);
        var result = await controller.EditPosted(companyId, invoice.Id, new EditPostedInvoiceRequest(newDueDate, null));

        var updated = Assert.IsType<InvoiceResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(newDueDate, updated.DueDate);

        var audit = Assert.Single(await db.DocumentEditAudits.Where(a => a.DocumentId == invoice.Id).ToListAsync());
        Assert.Equal(newDueDate, audit.NewDueDate);
        Assert.Null(audit.NewInternalNotes);
        Assert.Null(audit.OldInternalNotes);
    }

    [Fact]
    public async Task EditPosted_BothFields_WritesOneAuditRowWithBothSet()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, invoice.Id);

        var newDueDate = new DateOnly(2026, 12, 1);
        await controller.EditPosted(companyId, invoice.Id, new EditPostedInvoiceRequest(newDueDate, "Called customer"));

        var audit = Assert.Single(await db.DocumentEditAudits.Where(a => a.DocumentId == invoice.Id).ToListAsync());
        Assert.Equal(newDueDate, audit.NewDueDate);
        Assert.Equal("Called customer", audit.NewInternalNotes);
        Assert.Equal(1, await db.DocumentEditAudits.CountAsync(a => a.DocumentId == invoice.Id));
    }

    [Fact]
    public async Task EditPosted_OnDraftInvoice_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.EditPosted(companyId, invoice.Id, new EditPostedInvoiceRequest(new DateOnly(2026, 12, 1), null));

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(0, await db.DocumentEditAudits.CountAsync());
    }

    // C3: take the payment while writing the invoice.
    [Fact]
    public async Task Create_WithInlinePayment_PostsInvoiceAndRecordsPaymentAtomically()
    {
        var (db, companyId, partnerId, cashAccountId) = await SeedAsync();
        var paymentMethod = new PaymentMethod { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Cash", Kind = PaymentMethodKind.Cash, LedgerAccountId = cashAccountId };
        db.PaymentMethods.Add(paymentMethod);
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var request = RequestWithLine(partnerId, 1m, 300m) with
        {
            Payment = new CreateInvoicePaymentRequest(200m, paymentMethod.Id, new DateOnly(2026, 8, 26))
        };

        var result = await controller.Create(companyId, request);

        var created = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal("Posted", created.State);
        Assert.NotNull(created.InvoiceNumber);

        var balanceResult = await controller.Balance(companyId, created.Id);
        var balance = Assert.IsType<DocumentBalanceResponse>(Assert.IsType<OkObjectResult>(balanceResult.Result).Value);
        Assert.Equal(300m, balance.Total);
        Assert.Equal(200m, balance.Reconciled);
        Assert.Equal(100m, balance.Outstanding);
    }

    [Fact]
    public async Task Create_WithInlinePayment_InvalidPaymentMethod_RejectedAndNothingPersisted()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var request = RequestWithLine(partnerId, 1m, 300m) with
        {
            Payment = new CreateInvoicePaymentRequest(200m, Guid.NewGuid(), null)
        };

        var result = await controller.Create(companyId, request);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(db.Invoices);
        Assert.Empty(db.JournalEntries);
    }

    // Note: the InMemory provider used by this fixture has no real transactions (see
    // SupportsRowLocking), so this can only prove the over-reconciliation check itself fires
    // correctly — it cannot prove the rollback leaves nothing persisted (that guarantee is only
    // provable against a real Postgres container, same as every other atomic endpoint in this
    // codebase — see CLAUDE.md's RecordPayment/ApplyCreditNote verification history).
    [Fact]
    public async Task Create_WithInlinePayment_ExceedingTotal_Rejected()
    {
        var (db, companyId, partnerId, cashAccountId) = await SeedAsync();
        var paymentMethod = new PaymentMethod { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Cash", Kind = PaymentMethodKind.Cash, LedgerAccountId = cashAccountId };
        db.PaymentMethods.Add(paymentMethod);
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var request = RequestWithLine(partnerId, 1m, 300m) with
        {
            Payment = new CreateInvoicePaymentRequest(301m, paymentMethod.Id, null)
        };

        var result = await controller.Create(companyId, request);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }
}
