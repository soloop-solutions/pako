using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
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

    private static BillsController NewController(PakoDbContext db)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"));

        return new BillsController(db, TaxService, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
    }

    private static async Task<(PakoDbContext Db, Guid CompanyId, Guid PartnerId, Guid CashAccountId)> SeedAsync()
    {
        var db = new PakoDbContext(new DbContextOptionsBuilder<PakoDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        // IsVatRegistered = false — same reasoning as InvoicesControllerTests.SeedAsync's comment.
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co", IsVatRegistered = false };
        var partnerId = Guid.NewGuid();
        var cashAccountId = Guid.NewGuid();

        var payableAccountId = Guid.NewGuid();
        var expenseAccountId = Guid.NewGuid();

        db.Companies.Add(company);
        db.Partners.Add(new Partner { Id = partnerId, CompanyId = company.Id, Name = "Vendor Inc", IsVendor = true });
        db.Accounts.Add(new Account { Id = cashAccountId, CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.Asset, AccountSubType = AccountSubType.Cash });
        db.Accounts.Add(new Account { Id = payableAccountId, CompanyId = company.Id, Code = "2000", Name = "Accounts Payable", AccountType = AccountType.Liability, AccountSubType = AccountSubType.Payable });
        db.Accounts.Add(new Account { Id = expenseAccountId, CompanyId = company.Id, Code = "6000", Name = "Expenses", AccountType = AccountType.Expense });
        db.Journals.Add(new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 });
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            ReceivableAccountId = Guid.NewGuid(),
            PayableAccountId = payableAccountId,
            RevenueAccountId = Guid.NewGuid(),
            ExpenseAccountId = expenseAccountId,
            CustomerDepositsAccountId = Guid.NewGuid()
        });
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

    private static CreateBillRequest PurchaseReturnRequestWithLine(Guid partnerId, decimal quantity, decimal unitPrice, Guid? originalBillId) =>
        new(partnerId, "VEND-RET-001", new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateBillLineRequest> { new("Returned goods", quantity, unitPrice, null, null) },
            DocumentType.PurchaseReturn, originalBillId);

    [Fact]
    public async Task Create_NegativeUnitPrice_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, RequestWithLine(partnerId, 1m, -10m));

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

    // C2: same rule as InvoicesControllerTests — see its comment.
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

    [Fact]
    public async Task RecordPayment_FullAmount_CreatesReconciliationAndZeroesOutstandingBalance()
    {
        var (db, companyId, partnerId, cashAccountId) = await SeedAsync();
        var controller = NewController(db);

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
        var controller = NewController(db);

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
        var controller = NewController(db);

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
        var controller = NewController(db);

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
        var controller = NewController(db);

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
        var controller = NewController(db);

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

    // A2 (v2 release): AP mirror of InvoicesControllerTests' SalesReturn coverage — goods
    // returned to a supplier reduce the payable, the mirror image of the sales-return journal.
    [Fact]
    public async Task Create_PurchaseReturn_WithoutOriginalBillId_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, PurchaseReturnRequestWithLine(partnerId, 1m, 400m, null));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("originalBillId", badRequest.Value!.ToString());
    }

    [Fact]
    public async Task Post_PurchaseReturn_AgainstDraftOriginal_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var billCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 400m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(billCreated.Result).Value);
        // Deliberately not posted.

        var returnCreated = await controller.Create(companyId, PurchaseReturnRequestWithLine(partnerId, 1m, 400m, bill.Id));
        var purchaseReturn = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(returnCreated.Result).Value);

        var result = await controller.Post(companyId, purchaseReturn.Id);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("must be Posted", badRequest.Value!.ToString());
    }

    [Fact]
    public async Task Post_PurchaseReturn_FullAmount_NetsToZeroOnPayableAccount()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var billCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 400m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(billCreated.Result).Value);
        await controller.Post(companyId, bill.Id);

        var returnCreated = await controller.Create(companyId, PurchaseReturnRequestWithLine(partnerId, 1m, 400m, bill.Id));
        var purchaseReturn = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(returnCreated.Result).Value);

        var result = await controller.Post(companyId, purchaseReturn.Id);
        Assert.Equal(200, ((ObjectResult)result.Result!).StatusCode);

        var originalStillPosted = await db.Bills.AsNoTracking().SingleAsync(b => b.Id == bill.Id);
        Assert.Equal(BillState.Posted, originalStillPosted.State);

        var payableAccountId = (await db.CompanyAccountDefaults.AsNoTracking()
            .SingleAsync(d => d.CompanyId == companyId)).PayableAccountId;
        var netPayable = await db.JournalEntryLines.AsNoTracking()
            .Where(l => l.AccountId == payableAccountId && l.JournalEntry!.CompanyId == companyId && l.JournalEntry.State == JournalEntryState.Posted)
            .SumAsync(l => l.Credit - l.Debit);
        Assert.Equal(0m, netPayable);
    }

    [Fact]
    public async Task Post_PurchaseReturn_Partial_ThenSecondReturnExceedingRemainder_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var billCreated = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 400m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(billCreated.Result).Value);
        await controller.Post(companyId, bill.Id);

        var firstReturnCreated = await controller.Create(companyId, PurchaseReturnRequestWithLine(partnerId, 1m, 250m, bill.Id));
        var firstReturn = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(firstReturnCreated.Result).Value);
        var firstResult = await controller.Post(companyId, firstReturn.Id);
        Assert.Equal(200, ((ObjectResult)firstResult.Result!).StatusCode);

        // Remaining un-returned amount is now 400 - 250 = 150; a second return of 200 exceeds it.
        var secondReturnCreated = await controller.Create(companyId, PurchaseReturnRequestWithLine(partnerId, 1m, 200m, bill.Id));
        var secondReturn = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(secondReturnCreated.Result).Value);

        var secondResult = await controller.Post(companyId, secondReturn.Id);

        var badRequest = Assert.IsType<BadRequestObjectResult>(secondResult.Result);
        var message = badRequest.Value!.ToString()!;
        Assert.Contains("200", message);
        Assert.Contains("150", message);

        // A return of exactly the 150 remainder succeeds.
        var thirdReturnCreated = await controller.Create(companyId, PurchaseReturnRequestWithLine(partnerId, 1m, 150m, bill.Id));
        var thirdReturn = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(thirdReturnCreated.Result).Value);
        var thirdResult = await controller.Post(companyId, thirdReturn.Id);
        Assert.Equal(200, ((ObjectResult)thirdResult.Result!).StatusCode);
    }

    // A4 (v2 release): mirror of InvoicesControllerTests' discard coverage.
    [Fact]
    public async Task Discard_BlankDraft_RemovesIt()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.Discard(companyId, bill.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(0, await db.Bills.CountAsync(b => b.Id == bill.Id));
    }

    [Fact]
    public async Task Discard_PostedBill_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, bill.Id);

        var result = await controller.Discard(companyId, bill.Id);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(1, await db.Bills.CountAsync(b => b.Id == bill.Id));
    }

    // A5 (v2 release): mirror of InvoicesControllerTests' Update/EditPosted coverage.
    [Fact]
    public async Task Update_DraftBill_ReplacesLinesAndFields()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var newDueDate = new DateOnly(2026, 12, 1);
        var result = await controller.Update(companyId, bill.Id, new UpdateBillRequest(
            partnerId, "VEND-002", new DateOnly(2026, 8, 26), newDueDate,
            new List<CreateBillLineRequest> { new("Updated supplies", 3m, 200m, null, null) },
            DocumentType.Bill, null, "Draft note"));

        var updated = Assert.IsType<BillResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(newDueDate, updated.DueDate);
        Assert.Equal("Draft note", updated.InternalNotes);
        Assert.Equal("VEND-002", updated.VendorReference);
        var line = Assert.Single(updated.Lines);
        Assert.Equal("Updated supplies", line.Description);
        Assert.Equal(3m, line.Quantity);

        Assert.Equal(1, await db.BillLines.CountAsync(l => l.BillId == bill.Id));
    }

    [Fact]
    public async Task Update_PostedBill_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, bill.Id);

        var result = await controller.Update(companyId, bill.Id, new UpdateBillRequest(
            partnerId, "VEND-001", new DateOnly(2026, 8, 26), new DateOnly(2026, 12, 1),
            new List<CreateBillLineRequest> { new("Supplies", 1m, 100m, null, null) },
            DocumentType.Bill, null, null));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("due date and internal notes", badRequest.Value!.ToString());
    }

    [Fact]
    public async Task EditPosted_DueDateOnly_SucceedsAndWritesOneAuditRow()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(companyId, bill.Id);

        var newDueDate = new DateOnly(2026, 12, 1);
        var result = await controller.EditPosted(companyId, bill.Id, new EditPostedBillRequest(newDueDate, "Called vendor"));

        var updated = Assert.IsType<BillResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(newDueDate, updated.DueDate);
        Assert.Equal("Called vendor", updated.InternalNotes);

        var audit = Assert.Single(await db.DocumentEditAudits.Where(a => a.DocumentId == bill.Id).ToListAsync());
        Assert.Equal(newDueDate, audit.NewDueDate);
        Assert.Equal("Called vendor", audit.NewInternalNotes);
    }

    [Fact]
    public async Task EditPosted_OnDraftBill_Rejected()
    {
        var (db, companyId, partnerId, _) = await SeedAsync();
        var controller = NewController(db);

        var created = await controller.Create(companyId, RequestWithLine(partnerId, 1m, 100m));
        var bill = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>(created.Result).Value);

        var result = await controller.EditPosted(companyId, bill.Id, new EditPostedBillRequest(new DateOnly(2026, 12, 1), null));

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(0, await db.DocumentEditAudits.CountAsync());
    }
}
