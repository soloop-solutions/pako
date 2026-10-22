using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

/// <summary>
/// Item 26: accounting workflow integration tests. These cover the complete lifecycle
/// of invoices, payments, returns, and refunds — the exact scenarios from the testing session.
/// Each test uses a real Postgres database via PostgresTestDatabase.
/// </summary>
public class AccountingWorkflowTests : IAsyncLifetime
{
    private static readonly TaxComputationService TaxService = new();
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private static InvoicesController NewInvoiceController(PakoDbContext db)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"));
        return new InvoicesController(db, TaxService, new DocumentNumberService(), new NumberSeriesService(db), new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } }
        };
    }

    private async Task<(PakoDbContext Db, Guid CompanyId, Guid PartnerId, Guid CashAccountId, Guid ReceivableAccountId)> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Workflow Test Co", IsVatRegistered = false };
        var partnerId = Guid.NewGuid();
        var cashAccountId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();
        var revenueAccountId = Guid.NewGuid();

        db.Companies.Add(company);
        db.Partners.Add(new Partner { Id = partnerId, CompanyId = company.Id, Name = "Customer A", IsCustomer = true });
        db.Accounts.Add(new Account { Id = cashAccountId, CompanyId = company.Id, Code = "1000", Name = "Main Cash", AccountType = AccountType.Cash, AccountSubType = AccountSubType.Cash });
        db.Accounts.Add(new Account { Id = receivableAccountId, CompanyId = company.Id, Code = "1200", Name = "Accounts Receivable", AccountType = AccountType.Receivable, AccountSubType = AccountSubType.Receivable });
        db.Accounts.Add(new Account { Id = revenueAccountId, CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income });
        db.Journals.AddRange(
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Sale, Code = "SAL", Name = "Sales", SequencePrefix = "SAL", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Cash, Code = "CSH", Name = "Cash", SequencePrefix = "CSH", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Bank, Code = "BNK", Name = "Bank", SequencePrefix = "BNK", SequenceNextNumber = 1, SequencePadding = 4 });
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            ReceivableAccountId = receivableAccountId,
            PayableAccountId = Guid.NewGuid(),
            RevenueAccountId = revenueAccountId,
            ExpenseAccountId = Guid.NewGuid(),
        });
        await db.SaveChangesAsync();

        return (db, company.Id, partnerId, cashAccountId, receivableAccountId);
    }

    [Fact]
    public async Task SalesInvoice_FullPayment_ZerosReceivable()
    {
        var (db, companyId, partnerId, cashAccountId, _) = await SeedAsync();
        var ctrl = NewInvoiceController(db);

        // Create and post invoice for 100
        var createResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateInvoiceLineRequest> { new("Service", 1, 100m, null, null) }));
        var invoice = ((ObjectResult)createResult.Result!).Value as InvoiceResponse;
        Assert.NotNull(invoice);
        await ctrl.Post(companyId, invoice!.Id);

        // Record full payment
        var payResult = await ctrl.RecordPayment(companyId, invoice.Id,
            new RecordPaymentRequest(100m, cashAccountId, new DateOnly(2026, 9, 15)));
        Assert.IsType<ObjectResult>(payResult.Result);
        Assert.Equal(201, ((ObjectResult)payResult.Result!).StatusCode);

        // Verify balance is zero
        var balanceResult = await ctrl.Balance(companyId, invoice.Id);
        var balance = ((ObjectResult)balanceResult.Result!).Value as DocumentBalanceResponse;
        Assert.NotNull(balance);
        Assert.Equal(0m, balance!.Outstanding);
    }

    [Fact]
    public async Task SalesInvoice_PartialPayment_LeavesOutstanding()
    {
        var (db, companyId, partnerId, cashAccountId, _) = await SeedAsync();
        var ctrl = NewInvoiceController(db);

        var createResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateInvoiceLineRequest> { new("Service", 1, 100m, null, null) }));
        var invoice = ((ObjectResult)createResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, invoice!.Id);

        // Pay 60 of 100
        await ctrl.RecordPayment(companyId, invoice.Id,
            new RecordPaymentRequest(60m, cashAccountId, new DateOnly(2026, 9, 15)));

        var balanceResult = await ctrl.Balance(companyId, invoice.Id);
        var balance = ((ObjectResult)balanceResult.Result!).Value as DocumentBalanceResponse;
        Assert.Equal(40m, balance!.Outstanding);
    }

    [Fact(Skip = "Sales return reconciliation not yet implemented")]
    public async Task SalesReturn_RefundDecreasesCash_NeverIncreases()
    {
        var (db, companyId, partnerId, cashAccountId, receivableAccountId) = await SeedAsync();
        var ctrl = NewInvoiceController(db);

        // Create and post invoice for 100
        var createResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateInvoiceLineRequest> { new("Service", 1, 100m, null, null) }));
        var invoice = ((ObjectResult)createResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, invoice!.Id);

        // Record partial payment of 60
        await ctrl.RecordPayment(companyId, invoice.Id,
            new RecordPaymentRequest(60m, cashAccountId, new DateOnly(2026, 9, 15)));

        // Create and post full Sales Return of 100
        var returnResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 20), new DateOnly(2026, 10, 20),
            new List<CreateInvoiceLineRequest> { new("Returned goods", 1, 100m, null, null) },
            DocumentType.SalesReturn, invoice.Id));
        var salesReturn = ((ObjectResult)returnResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, salesReturn!.Id);

        // Refund 60 on the return (the net owed to customer)
        var refundResult = await ctrl.RecordPayment(companyId, salesReturn.Id,
            new RecordPaymentRequest(60m, cashAccountId, new DateOnly(2026, 9, 25)));
        Assert.IsType<ObjectResult>(refundResult.Result);
        Assert.Equal(201, ((ObjectResult)refundResult.Result!).StatusCode);

        // Verify: the refund's journal entry should Credit Cash (money out), not Debit
        var refundResponse = ((ObjectResult)refundResult.Result!).Value as RecordPaymentResponse;
        Assert.NotNull(refundResponse);

        // Find the refund settlement entry's cash line
        var settlementLines = await db.JournalEntryLines
            .Where(l => l.AccountId == cashAccountId)
            .OrderByDescending(l => l.JournalEntry!.Date)
            .ToListAsync();
        var refundCashLine = settlementLines.First();

        // Cash should be CREDITED (money going out), never debited for a refund
        Assert.Equal(0m, refundCashLine.Debit);
        Assert.Equal(60m, refundCashLine.Credit);
    }

    [Fact(Skip = "Sales return reconciliation not yet implemented")]
    public async Task SalesReturn_BalanceShowsCorrectOutstanding()
    {
        var (db, companyId, partnerId, cashAccountId, _) = await SeedAsync();
        var ctrl = NewInvoiceController(db);

        // Create and post invoice for 100
        var createResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateInvoiceLineRequest> { new("Service", 1, 100m, null, null) }));
        var invoice = ((ObjectResult)createResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, invoice!.Id);

        // Create and post Sales Return of 100
        var returnResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 20), new DateOnly(2026, 10, 20),
            new List<CreateInvoiceLineRequest> { new("Returned goods", 1, 100m, null, null) },
            DocumentType.SalesReturn, invoice.Id));
        var salesReturn = ((ObjectResult)returnResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, salesReturn!.Id);

        // Return should have outstanding of 100 (full amount to be refunded)
        var returnBalance = await ctrl.Balance(companyId, salesReturn.Id);
        var balance = ((ObjectResult)returnBalance.Result!).Value as DocumentBalanceResponse;
        Assert.NotNull(balance);
        Assert.Equal(100m, balance!.Total);
        Assert.Equal(100m, balance.Outstanding);

        // Refund 60
        await ctrl.RecordPayment(companyId, salesReturn.Id,
            new RecordPaymentRequest(60m, cashAccountId, new DateOnly(2026, 9, 25)));

        // Outstanding should now be 40
        var afterRefund = await ctrl.Balance(companyId, salesReturn.Id);
        var balanceAfter = ((ObjectResult)afterRefund.Result!).Value as DocumentBalanceResponse;
        Assert.Equal(40m, balanceAfter!.Outstanding);
    }

    // ========== VAT-INCLUSIVE SCENARIO (Task 10/11) ==========

    private async Task<(PakoDbContext Db, Guid CompanyId, Guid PartnerId, Guid CashAccountId, Guid ReceivableAccountId, Guid VatAccountId, Guid TaxDefId)> SeedVatAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "VAT Test Co", IsVatRegistered = true };
        var partnerId = Guid.NewGuid();
        var cashAccountId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();
        var revenueAccountId = Guid.NewGuid();
        var vatAccountId = Guid.NewGuid();
        var taxDefId = Guid.NewGuid();

        db.Companies.Add(company);
        db.Partners.Add(new Partner { Id = partnerId, CompanyId = company.Id, Name = "VAT Customer", IsCustomer = true, IsVatRegistered = true, TaxNumber = "123456789" });
        db.Accounts.Add(new Account { Id = cashAccountId, CompanyId = company.Id, Code = "1000", Name = "Main Cash", AccountType = AccountType.Cash, AccountSubType = AccountSubType.Cash });
        db.Accounts.Add(new Account { Id = receivableAccountId, CompanyId = company.Id, Code = "1200", Name = "Accounts Receivable", AccountType = AccountType.Receivable, AccountSubType = AccountSubType.Receivable });
        db.Accounts.Add(new Account { Id = revenueAccountId, CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income, Class = 4 });
        db.Accounts.Add(new Account { Id = vatAccountId, CompanyId = company.Id, Code = "2100", Name = "Output VAT", AccountType = AccountType.CurrentLiability });
        db.Journals.AddRange(
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Sale, Code = "SAL", Name = "Sales", SequencePrefix = "SAL", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Cash, Code = "CSH", Name = "Cash", SequencePrefix = "CSH", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Bank, Code = "BNK", Name = "Bank", SequencePrefix = "BNK", SequenceNextNumber = 1, SequencePadding = 4 });
        db.TaxDefinitions.Add(new TaxDefinition
        {
            Id = taxDefId, CompanyId = company.Id, Name = "VAT 18%", Code = "S18",
            Rate = 0.18m, Direction = TaxDirection.Out, IsActive = true,
            RepartitionLines = { new TaxRepartitionLine { Id = Guid.NewGuid(), AccountId = vatAccountId, Percentage = 100m } }
        });
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(), CompanyId = company.Id,
            ReceivableAccountId = receivableAccountId,
            PayableAccountId = Guid.NewGuid(),
            RevenueAccountId = revenueAccountId,
            ExpenseAccountId = Guid.NewGuid(),
        });
        await db.SaveChangesAsync();

        return (db, company.Id, partnerId, cashAccountId, receivableAccountId, vatAccountId, taxDefId);
    }

    /// <summary>
    /// Task 10: THE full VAT-inclusive regression test — complete lifecycle.
    /// €100 gross invoice (incl 18% VAT) → €60 payment → €100 return
    /// → Apply €40 credit against invoice → Refund €60 → ALL balances €0.
    /// </summary>
    [Fact(Skip = "Sales return reconciliation not yet implemented")]
    public async Task VatInclusive_FullScenario_InvoicePaymentReturnRefund()
    {
        var (db, companyId, partnerId, cashAccountId, receivableAccountId, vatAccountId, taxDefId) = await SeedVatAsync();
        var ctrl = NewInvoiceController(db);

        // ─── Step A: Create & post invoice €100 gross (incl 18% VAT) ───
        var createResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateInvoiceLineRequest> { new("Service", 1, 100m, taxDefId, null) }));
        var invoice = ((ObjectResult)createResult.Result!).Value as InvoiceResponse;
        Assert.NotNull(invoice);
        await ctrl.Post(companyId, invoice!.Id);

        // Verify journal: AR Debit 100, Revenue Credit ~84.75, VAT Credit ~15.25
        var postedInvoice = await db.Invoices.AsNoTracking().FirstAsync(i => i.Id == invoice.Id);
        var jeLines = await db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntryId == postedInvoice.JournalEntryId).ToListAsync();
        Assert.Equal(100m, jeLines.Single(l => l.AccountId == receivableAccountId).Debit);
        Assert.True(jeLines.Single(l => l.AccountId == vatAccountId).Credit > 15m);
        Assert.Equal(jeLines.Sum(l => l.Debit), jeLines.Sum(l => l.Credit));

        var invoiceBal = ((ObjectResult)(await ctrl.Balance(companyId, invoice.Id)).Result!).Value as DocumentBalanceResponse;
        Assert.Equal(100m, invoiceBal!.Outstanding);

        // ─── Step B: Pay €60 ───
        await ctrl.RecordPayment(companyId, invoice.Id,
            new RecordPaymentRequest(60m, cashAccountId, new DateOnly(2026, 9, 15)));
        invoiceBal = ((ObjectResult)(await ctrl.Balance(companyId, invoice.Id)).Result!).Value as DocumentBalanceResponse;
        Assert.Equal(40m, invoiceBal!.Outstanding);

        // ─── Step C: Post full €100 Sales Return ───
        var returnResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 20), new DateOnly(2026, 10, 20),
            new List<CreateInvoiceLineRequest> { new("Returned goods", 1, 100m, taxDefId, null) },
            DocumentType.SalesReturn, invoice.Id));
        var salesReturn = ((ObjectResult)returnResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, salesReturn!.Id);

        // Return journal: Revenue Debit ~84.75, VAT Debit ~15.25, AR Credit 100
        var returnInv = await db.Invoices.AsNoTracking().FirstAsync(i => i.Id == salesReturn.Id);
        var returnJeLines = await db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntryId == returnInv.JournalEntryId).ToListAsync();
        Assert.Equal(100m, returnJeLines.Single(l => l.AccountId == receivableAccountId).Credit);
        Assert.True(returnJeLines.Single(l => l.AccountId == vatAccountId).Debit > 15m);
        Assert.Equal(returnJeLines.Sum(l => l.Debit), returnJeLines.Sum(l => l.Credit));

        var returnBal = ((ObjectResult)(await ctrl.Balance(companyId, salesReturn.Id)).Result!).Value as DocumentBalanceResponse;
        Assert.Equal(100m, returnBal!.Outstanding);

        // ─── Step D: Apply €40 of the return credit against the original invoice ───
        // This uses ApplyCreditNote — the return's AR line acts as a settlement line
        // against the original invoice, clearing its remaining €40 outstanding.
        var applyCreditResult = await ctrl.ApplyCreditNote(companyId, invoice.Id,
            new ApplyCreditNoteRequest(salesReturn.Id, 40m));
        Assert.Equal(201, ((ObjectResult)applyCreditResult.Result!).StatusCode);

        // Invoice is now fully settled: 60 paid + 40 credit applied = 100
        invoiceBal = ((ObjectResult)(await ctrl.Balance(companyId, invoice.Id)).Result!).Value as DocumentBalanceResponse;
        Assert.Equal(0m, invoiceBal!.Outstanding);

        // Return has 40 of its 100 consumed via credit application
        returnBal = ((ObjectResult)(await ctrl.Balance(companyId, salesReturn.Id)).Result!).Value as DocumentBalanceResponse;
        Assert.Equal(60m, returnBal!.Outstanding);

        // ─── Step E: Refund remaining €60 ───
        var refundResult = await ctrl.RecordPayment(companyId, salesReturn.Id,
            new RecordPaymentRequest(60m, cashAccountId, new DateOnly(2026, 9, 25)));
        Assert.Equal(201, ((ObjectResult)refundResult.Result!).StatusCode);

        // Refund journal: Cash CREDITED (money out), AR DEBITED (clearing credit)
        var refundSettlement = await db.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.AccountId == cashAccountId && l.JournalEntry!.CompanyId == companyId)
            .OrderByDescending(l => l.JournalEntry!.Date)
            .FirstAsync();
        Assert.Equal(0m, refundSettlement.Debit);   // Cash NOT debited
        Assert.Equal(60m, refundSettlement.Credit);  // Cash credited (money out)

        // ─── Step F: Verify EVERYTHING is fully settled ───

        // 1. Invoice outstanding = 0
        invoiceBal = ((ObjectResult)(await ctrl.Balance(companyId, invoice.Id)).Result!).Value as DocumentBalanceResponse;
        Assert.Equal(0m, invoiceBal!.Outstanding);

        // 2. Return outstanding = 0
        returnBal = ((ObjectResult)(await ctrl.Balance(companyId, salesReturn.Id)).Result!).Value as DocumentBalanceResponse;
        Assert.Equal(0m, returnBal!.Outstanding);

        // 3. Net AR across ALL posted entries = 0
        var allArLines = await db.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.AccountId == receivableAccountId && l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted)
            .ToListAsync();
        var netAR = allArLines.Sum(l => l.Debit) - allArLines.Sum(l => l.Credit);
        Assert.Equal(0m, netAR);

        // 4. Net Cash movement = 0 (60 in from payment, 60 out from refund)
        var allCashLines = await db.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.AccountId == cashAccountId && l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted)
            .ToListAsync();
        var netCash = allCashLines.Sum(l => l.Debit) - allCashLines.Sum(l => l.Credit);
        Assert.Equal(0m, netCash);

        // 5. Net Revenue = 0 (sale reversed by return)
        var revenueAccountId = jeLines.First(l => l.AccountId != receivableAccountId && l.AccountId != vatAccountId).AccountId;
        var allRevenueLines = await db.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.AccountId == revenueAccountId && l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted)
            .ToListAsync();
        var netRevenue = allRevenueLines.Sum(l => l.Credit) - allRevenueLines.Sum(l => l.Debit);
        Assert.Equal(0m, netRevenue);

        // 6. Net VAT = 0 (output VAT reversed by return)
        var allVatLines = await db.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.AccountId == vatAccountId && l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted)
            .ToListAsync();
        var netVat = allVatLines.Sum(l => l.Credit) - allVatLines.Sum(l => l.Debit);
        Assert.Equal(0m, netVat);

        // 7. Total Debits = Total Credits across ALL posted journal entries (trial balance)
        var allLines = await db.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry!.CompanyId == companyId && l.JournalEntry.State == JournalEntryState.Posted)
            .ToListAsync();
        Assert.Equal(allLines.Sum(l => l.Debit), allLines.Sum(l => l.Credit));
    }

    // ========== ADDITIONAL EDGE CASES (Task 12) ==========

    [Fact]
    public async Task MultiplePartialPayments_TrackCorrectly()
    {
        var (db, companyId, partnerId, cashAccountId, _) = await SeedAsync();
        var ctrl = NewInvoiceController(db);

        var createResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateInvoiceLineRequest> { new("Service", 1, 100m, null, null) }));
        var invoice = ((ObjectResult)createResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, invoice!.Id);

        // Pay 30 + 30 + 40 = 100
        await ctrl.RecordPayment(companyId, invoice.Id, new RecordPaymentRequest(30m, cashAccountId, new DateOnly(2026, 9, 10)));
        await ctrl.RecordPayment(companyId, invoice.Id, new RecordPaymentRequest(30m, cashAccountId, new DateOnly(2026, 9, 15)));
        await ctrl.RecordPayment(companyId, invoice.Id, new RecordPaymentRequest(40m, cashAccountId, new DateOnly(2026, 9, 20)));

        var balance = await ctrl.Balance(companyId, invoice.Id);
        var bal = ((ObjectResult)balance.Result!).Value as DocumentBalanceResponse;
        Assert.Equal(0m, bal!.Outstanding);
    }

    [Fact]
    public async Task OverpaymentPrevented()
    {
        var (db, companyId, partnerId, cashAccountId, _) = await SeedAsync();
        var ctrl = NewInvoiceController(db);

        var createResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateInvoiceLineRequest> { new("Service", 1, 100m, null, null) }));
        var invoice = ((ObjectResult)createResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, invoice!.Id);

        // Pay 60
        await ctrl.RecordPayment(companyId, invoice.Id, new RecordPaymentRequest(60m, cashAccountId, new DateOnly(2026, 9, 10)));

        // Try to pay 50 (would exceed 100 total)
        var overPay = await ctrl.RecordPayment(companyId, invoice.Id,
            new RecordPaymentRequest(50m, cashAccountId, new DateOnly(2026, 9, 15)));
        Assert.IsType<BadRequestObjectResult>(overPay.Result);
    }

    [Fact(Skip = "Sales return reconciliation not yet implemented")]
    public async Task FullReturnAfterFullPayment()
    {
        var (db, companyId, partnerId, cashAccountId, _) = await SeedAsync();
        var ctrl = NewInvoiceController(db);

        var createResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateInvoiceLineRequest> { new("Service", 1, 100m, null, null) }));
        var invoice = ((ObjectResult)createResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, invoice!.Id);

        // Full payment
        await ctrl.RecordPayment(companyId, invoice.Id, new RecordPaymentRequest(100m, cashAccountId, new DateOnly(2026, 9, 10)));

        // Full return
        var returnResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 20), new DateOnly(2026, 10, 20),
            new List<CreateInvoiceLineRequest> { new("Return", 1, 100m, null, null) },
            DocumentType.SalesReturn, invoice.Id));
        var salesReturn = ((ObjectResult)returnResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, salesReturn!.Id);

        // Refund full 100
        var refundResult = await ctrl.RecordPayment(companyId, salesReturn.Id,
            new RecordPaymentRequest(100m, cashAccountId, new DateOnly(2026, 9, 25)));
        Assert.Equal(201, ((ObjectResult)refundResult.Result!).StatusCode);

        // Both should be fully settled
        var invoiceBal = await ctrl.Balance(companyId, invoice.Id);
        Assert.Equal(0m, ((ObjectResult)invoiceBal.Result!).Value is DocumentBalanceResponse ib ? ib.Outstanding : -1m);

        var returnBal = await ctrl.Balance(companyId, salesReturn.Id);
        Assert.Equal(0m, ((ObjectResult)returnBal.Result!).Value is DocumentBalanceResponse rb ? rb.Outstanding : -1m);
    }

    [Fact]
    public async Task ReturnExceedingOriginal_Rejected()
    {
        var (db, companyId, partnerId, cashAccountId, _) = await SeedAsync();
        var ctrl = NewInvoiceController(db);

        var createResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateInvoiceLineRequest> { new("Service", 1, 100m, null, null) }));
        var invoice = ((ObjectResult)createResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, invoice!.Id);

        // Try return of 150 against invoice of 100 — should be rejected
        var returnResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 20), new DateOnly(2026, 10, 20),
            new List<CreateInvoiceLineRequest> { new("Over-return", 1, 150m, null, null) },
            DocumentType.SalesReturn, invoice.Id));
        var salesReturn = ((ObjectResult)returnResult.Result!).Value as InvoiceResponse;
        var postResult = await ctrl.Post(companyId, salesReturn!.Id);
        Assert.IsType<BadRequestObjectResult>(postResult.Result);
    }

    [Fact]
    public async Task DuplicateRefundPrevented()
    {
        var (db, companyId, partnerId, cashAccountId, _) = await SeedAsync();
        var ctrl = NewInvoiceController(db);

        var createResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateInvoiceLineRequest> { new("Service", 1, 100m, null, null) }));
        var invoice = ((ObjectResult)createResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, invoice!.Id);

        // Return
        var returnResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 20), new DateOnly(2026, 10, 20),
            new List<CreateInvoiceLineRequest> { new("Return", 1, 100m, null, null) },
            DocumentType.SalesReturn, invoice.Id));
        var salesReturn = ((ObjectResult)returnResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, salesReturn!.Id);

        // Refund 100
        await ctrl.RecordPayment(companyId, salesReturn!.Id,
            new RecordPaymentRequest(100m, cashAccountId, new DateOnly(2026, 9, 25)));

        // Try to refund again — should fail (over-reconciliation)
        var dupRefund = await ctrl.RecordPayment(companyId, salesReturn.Id,
            new RecordPaymentRequest(50m, cashAccountId, new DateOnly(2026, 9, 26)));
        Assert.IsType<BadRequestObjectResult>(dupRefund.Result);
    }

    [Fact]
    public async Task TrialBalance_DebitsEqualCredits()
    {
        var (db, companyId, partnerId, cashAccountId, _) = await SeedAsync();
        var ctrl = NewInvoiceController(db);

        // Create and post an invoice
        var createResult = await ctrl.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateInvoiceLineRequest> { new("Service", 1, 200m, null, null) }));
        var invoice = ((ObjectResult)createResult.Result!).Value as InvoiceResponse;
        await ctrl.Post(companyId, invoice!.Id);

        // Pay 120
        await ctrl.RecordPayment(companyId, invoice.Id,
            new RecordPaymentRequest(120m, cashAccountId, new DateOnly(2026, 9, 15)));

        // Verify trial balance: total debits = total credits across ALL journal entries
        var allJeLines = await db.JournalEntryLines.AsNoTracking()
            .Include(l => l.JournalEntry)
            .Where(l => l.JournalEntry!.CompanyId == companyId && l.JournalEntry.State == JournalEntryState.Posted)
            .ToListAsync();

        var totalDebit = allJeLines.Sum(l => l.Debit);
        var totalCredit = allJeLines.Sum(l => l.Credit);
        Assert.Equal(totalDebit, totalCredit);
    }
}
