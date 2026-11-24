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
using Pako.Domain.Hr;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Payments;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

// Direct payments (2026-11-24): a payment received from a customer or paid to a vendor with no
// document sits on the partner's balance and is applied to invoices/bills now or later.
public class DirectPaymentsTests : IAsyncLifetime
{
    private static readonly TaxComputationService TaxService = new();
    private static readonly NullStringLocalizer<ErrorMessages> L = new();
    private readonly List<PakoDbContext> _dbs = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbs) await db.DisposeAsync();
    }

    private sealed record Seed(PakoDbContext Db, Guid CompanyId, Guid CustomerId, Guid OtherCustomerId, Guid VendorId,
        Guid CashId, Guid BankId, Guid ReceivableId, Guid PayableId, Guid OutstandingReceiptsId, Guid OutstandingPaymentsId);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbs.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Direct Payments Co", IsVatRegistered = false };
        Guid Id() => Guid.NewGuid();
        var (customer, other, vendor) = (Id(), Id(), Id());
        var (cash, bank, ar, ap, outRec, outPay, revenue, expense) = (Id(), Id(), Id(), Id(), Id(), Id(), Id(), Id());

        db.Companies.Add(company);
        db.Partners.AddRange(
            new Partner { Id = customer, CompanyId = company.Id, Name = "Customer A", IsCustomer = true },
            new Partner { Id = other, CompanyId = company.Id, Name = "Customer B", IsCustomer = true },
            new Partner { Id = vendor, CompanyId = company.Id, Name = "Vendor V", IsVendor = true });
        db.Accounts.AddRange(
            new Account { Id = cash, CompanyId = company.Id, Code = "100100", Name = "Cash", AccountType = AccountType.Cash, AccountSubType = AccountSubType.Cash },
            new Account { Id = bank, CompanyId = company.Id, Code = "101001", Name = "Bank", AccountType = AccountType.Cash, AccountSubType = AccountSubType.Bank },
            new Account { Id = outPay, CompanyId = company.Id, Code = "100400", Name = "Outstanding payments", AccountType = AccountType.CurrentAsset },
            new Account { Id = outRec, CompanyId = company.Id, Code = "100500", Name = "Outstanding receipts", AccountType = AccountType.CurrentAsset },
            new Account { Id = ar, CompanyId = company.Id, Code = "110100", Name = "Receivable", AccountType = AccountType.Receivable, AccountSubType = AccountSubType.Receivable },
            new Account { Id = ap, CompanyId = company.Id, Code = "200100", Name = "Payable", AccountType = AccountType.Payable, AccountSubType = AccountSubType.Payable },
            new Account { Id = revenue, CompanyId = company.Id, Code = "400100", Name = "Revenue", AccountType = AccountType.Income },
            new Account { Id = expense, CompanyId = company.Id, Code = "661200", Name = "Expense", AccountType = AccountType.Expense });
        db.Journals.AddRange(
            new Journal { Id = Id(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Id(), CompanyId = company.Id, Type = JournalType.Sale, Code = "SAL", Name = "Sales", SequencePrefix = "SAL", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Id(), CompanyId = company.Id, Type = JournalType.Purchase, Code = "PUR", Name = "Purchases", SequencePrefix = "PUR", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Id(), CompanyId = company.Id, Type = JournalType.Cash, Code = "CSH", Name = "Cash", SequencePrefix = "CSH", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal
            {
                Id = Id(), CompanyId = company.Id, Type = JournalType.Bank, Code = "BNK", Name = "Bank", SequencePrefix = "BNK", SequenceNextNumber = 1, SequencePadding = 4,
                OutstandingPaymentsAccountId = outPay, OutstandingReceiptsAccountId = outRec,
            });
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Id(), CompanyId = company.Id, ReceivableAccountId = ar, PayableAccountId = ap, RevenueAccountId = revenue, ExpenseAccountId = expense,
            OutstandingPaymentsAccountId = outPay, OutstandingReceiptsAccountId = outRec,
        });
        await db.SaveChangesAsync();
        return new Seed(db, company.Id, customer, other, vendor, cash, bank, ar, ap, outRec, outPay);
    }

    private static T As<T>(T controller) where T : ControllerBase
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"));
        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } };
        return controller;
    }

    private static PaymentsController Payments(Seed s, CompanyAccessContext? access = null) =>
        As(new PaymentsController(s.Db, L, access ?? CompanyAccessContext.Unrestricted(s.CompanyId)));

    private static InvoicesController Invoices(Seed s) =>
        As(new InvoicesController(s.Db, TaxService, new DocumentNumberService(), new NumberSeriesService(s.Db), L, CompanyAccessContext.Unrestricted()));

    private static BillsController Bills(Seed s) => As(new BillsController(s.Db, TaxService, L, CompanyAccessContext.Unrestricted()));

    private static async Task<Guid> PostedInvoiceAsync(Seed s, Guid partnerId, decimal amount, DateOnly due, bool post = true)
    {
        var created = await Invoices(s).Create(s.CompanyId, new CreateInvoiceRequest(partnerId, due.AddDays(-30), due,
            new List<CreateInvoiceLineRequest> { new("Service", 1, amount, null, null) }));
        var invoice = Assert.IsType<InvoiceResponse>(((ObjectResult)created.Result!).Value);
        if (post) await Invoices(s).Post(s.CompanyId, invoice.Id);
        return invoice.Id;
    }

    private static async Task<Guid> PostedBillAsync(Seed s, decimal amount)
    {
        var created = await Bills(s).Create(s.CompanyId, new CreateBillRequest(s.VendorId, "V-1", new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1),
            new List<CreateBillLineRequest> { new("Goods", 1, amount, null, null) }));
        var bill = Assert.IsType<BillResponse>(((ObjectResult)created.Result!).Value);
        await Bills(s).Post(s.CompanyId, bill.Id);
        return bill.Id;
    }

    private static async Task<decimal> InvoiceOutstandingAsync(Seed s, Guid invoiceId) =>
        Assert.IsType<DocumentBalanceResponse>(((ObjectResult)(await Invoices(s).Balance(s.CompanyId, invoiceId)).Result!).Value).Outstanding;

    private static async Task<PaymentResponse> CreateAsync(Seed s, CreatePaymentRequest request)
    {
        var result = Assert.IsType<ObjectResult>(await Payments(s).Create(s.CompanyId, request));
        Assert.True(result.StatusCode == StatusCodes.Status201Created, $"{result.StatusCode}: {result.Value}");
        return Assert.IsType<PaymentResponse>(result.Value);
    }

    private static readonly DateOnly PayDate = new(2026, 9, 20);

    [Fact]
    public async Task Received_WithoutAnInvoice_SitsOnTheCustomersBalance()
    {
        var s = await SeedAsync();

        var payment = await CreateAsync(s, new CreatePaymentRequest("Inbound", s.CustomerId, 300m, s.BankId, PayDate, "Advance"));

        Assert.Equal("Posted", payment.State);
        Assert.Equal(300m, payment.Unapplied);
        Assert.Equal(0, payment.AppliedCount);
        Assert.Null(payment.InvoiceId);
        var stored = await s.Db.Payments.AsNoTracking().SingleAsync();
        var lines = await s.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == stored.JournalEntryId).ToListAsync();
        Assert.Contains(lines, l => l.AccountId == s.OutstandingReceiptsId && l.Debit == 300m);
        Assert.Contains(lines, l => l.AccountId == s.ReceivableId && l.Credit == 300m && l.PartnerId == s.CustomerId);
    }

    [Fact]
    public async Task Received_AppliedOldestFirst_PaysTheOldestInvoiceFirst()
    {
        var s = await SeedAsync();
        var newer = await PostedInvoiceAsync(s, s.CustomerId, 150m, new DateOnly(2026, 11, 1));
        var older = await PostedInvoiceAsync(s, s.CustomerId, 100m, new DateOnly(2026, 10, 1));

        var open = Assert.IsType<List<OpenDocumentResponse>>(Assert.IsType<OkObjectResult>(
            await Payments(s).OpenDocuments(s.CompanyId, s.CustomerId, "Inbound", 200m)).Value);
        Assert.Equal(new[] { older, newer }, open.Select(d => d.DocumentId));
        Assert.Equal(new[] { 100m, 100m }, open.Select(d => d.Suggested));

        var payment = await CreateAsync(s, new CreatePaymentRequest("Inbound", s.CustomerId, 200m, s.BankId, PayDate,
            Allocations: open.Select(d => new PaymentAllocationRequest(d.DocumentId, null, d.Suggested)).ToList()));

        Assert.Equal(0m, payment.Unapplied);
        Assert.Equal(2, payment.AppliedCount);
        Assert.Equal(0m, await InvoiceOutstandingAsync(s, older));
        Assert.Equal(50m, await InvoiceOutstandingAsync(s, newer));
    }

    [Fact]
    public async Task Allocation_RefusesTooMuch_AnotherCustomersInvoice_AndADraft_AndSavesNothing()
    {
        var s = await SeedAsync();
        var invoice = await PostedInvoiceAsync(s, s.CustomerId, 100m, new DateOnly(2026, 10, 1));
        var othersInvoice = await PostedInvoiceAsync(s, s.OtherCustomerId, 100m, new DateOnly(2026, 10, 1));
        var draft = await PostedInvoiceAsync(s, s.CustomerId, 100m, new DateOnly(2026, 10, 1), post: false);
        var entriesBefore = await s.Db.JournalEntries.CountAsync();

        PaymentAllocationRequest[][] bad =
        [
            [new(invoice, null, 60m), new(draft, null, 1m)],          // a draft
            [new(othersInvoice, null, 10m)],                         // another customer's invoice
            [new(invoice, null, 120m)],                              // more than the invoice owes
            [new(invoice, null, 60m), new(invoice, null, 10m)],      // the same invoice twice
        ];
        foreach (var allocations in bad)
        {
            var result = await Payments(s).Create(s.CompanyId, new CreatePaymentRequest("Inbound", s.CustomerId, 100m, s.BankId, PayDate,
                Allocations: allocations.ToList()));
            Assert.IsType<BadRequestObjectResult>(result);
        }

        // More than the payment itself.
        Assert.IsType<BadRequestObjectResult>(await Payments(s).Create(s.CompanyId, new CreatePaymentRequest("Inbound", s.CustomerId, 50m,
            s.BankId, PayDate, Allocations: [new(invoice, null, 60m)])));

        // Every refused request rolled back: no payment, entry or reconciliation reached the database.
        s.Db.ChangeTracker.Clear();
        Assert.Equal(0, await s.Db.Payments.CountAsync());
        Assert.Equal(entriesBefore, await s.Db.JournalEntries.CountAsync());
        Assert.Equal(0, await s.Db.Reconciliations.CountAsync());
    }

    [Fact]
    public async Task AppliedLater_ThenCancelled_GivesTheInvoiceItsBalanceBack()
    {
        var s = await SeedAsync();
        var invoice = await PostedInvoiceAsync(s, s.CustomerId, 100m, new DateOnly(2026, 10, 1));
        var payment = await CreateAsync(s, new CreatePaymentRequest("Inbound", s.CustomerId, 100m, s.BankId, PayDate));

        var applied = Assert.IsType<PaymentResponse>(Assert.IsType<OkObjectResult>(await Payments(s).Apply(s.CompanyId, payment.Id,
            new ApplyPaymentRequest([new(invoice, null, 60m)]))).Value);
        Assert.Equal(40m, applied.Unapplied);
        Assert.Equal(40m, await InvoiceOutstandingAsync(s, invoice));

        Assert.IsType<OkResult>(await Payments(s).Cancel(s.CompanyId, payment.Id));

        Assert.Equal(100m, await InvoiceOutstandingAsync(s, invoice));
        Assert.Equal(PaymentState.Cancelled, (await s.Db.Payments.AsNoTracking().SingleAsync()).State);
        Assert.Equal(0, await s.Db.Reconciliations.CountAsync());
    }

    [Fact]
    public async Task Cash_GoesStraightToTheCashAccount_AndCanBeCancelled()
    {
        var s = await SeedAsync();

        var payment = await CreateAsync(s, new CreatePaymentRequest("Inbound", s.CustomerId, 40m, s.CashId, PayDate));

        Assert.Equal("Reconciled", payment.State);
        Assert.Equal(40m, payment.Unapplied);
        Assert.True(payment.CanCancel);
        var stored = await s.Db.Payments.AsNoTracking().SingleAsync();
        Assert.True(stored.IsDirectToCash);
        var lines = await s.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == stored.JournalEntryId).ToListAsync();
        Assert.Contains(lines, l => l.AccountId == s.CashId && l.Debit == 40m);
        Assert.Contains(lines, l => l.AccountId == s.ReceivableId && l.Credit == 40m);

        Assert.IsType<OkResult>(await Payments(s).Cancel(s.CompanyId, payment.Id));
    }

    [Fact]
    public async Task Paid_ToAVendor_AppliesToTheBill()
    {
        var s = await SeedAsync();
        var bill = await PostedBillAsync(s, 100m);

        var payment = await CreateAsync(s, new CreatePaymentRequest("Outbound", s.VendorId, 80m, s.BankId, PayDate,
            Allocations: [new(null, bill, 80m)]));

        Assert.Equal(0m, payment.Unapplied);
        var balance = Assert.IsType<DocumentBalanceResponse>(((ObjectResult)(await Bills(s).Balance(s.CompanyId, bill)).Result!).Value);
        Assert.Equal(20m, balance.Outstanding);
        var stored = await s.Db.Payments.AsNoTracking().SingleAsync();
        var lines = await s.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == stored.JournalEntryId).ToListAsync();
        Assert.Contains(lines, l => l.AccountId == s.PayableId && l.Debit == 80m && l.PartnerId == s.VendorId);
        Assert.Contains(lines, l => l.AccountId == s.OutstandingPaymentsId && l.Credit == 80m);

        // A payment made cannot be applied to an invoice.
        var invoice = await PostedInvoiceAsync(s, s.CustomerId, 50m, new DateOnly(2026, 10, 1));
        Assert.IsType<BadRequestObjectResult>(await Payments(s).Create(s.CompanyId, new CreatePaymentRequest("Outbound", s.VendorId, 10m,
            s.BankId, PayDate, Allocations: [new(invoice, null, 10m)])));
    }

    [Fact]
    public async Task UnappliedPayment_ClearsToTheBank_LikeAnyOutstandingPayment()
    {
        var s = await SeedAsync();
        await CreateAsync(s, new CreatePaymentRequest("Inbound", s.CustomerId, 75m, s.BankId, PayDate));
        var payment = await s.Db.Payments.SingleAsync();
        var company = await s.Db.Companies.SingleAsync();

        var outcome = await new PaymentClearingService(s.Db, L).ClearAsync(company, payment, PayDate.AddDays(2));
        await s.Db.SaveChangesAsync();

        Assert.True(outcome.Succeeded, outcome.Error);
        Assert.Equal(PaymentState.Reconciled, (await s.Db.Payments.AsNoTracking().SingleAsync()).State);
        var lines = await s.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == outcome.Entry!.Id).ToListAsync();
        Assert.Contains(lines, l => l.AccountId == s.BankId && l.Debit == 75m);
        Assert.Contains(lines, l => l.AccountId == s.OutstandingReceiptsId && l.Credit == 75m);
    }

    [Fact]
    public async Task ASalesRole_MayRecordMoneyReceived_ButNotMoneyPaid()
    {
        var s = await SeedAsync();
        var role = new CompanyRole { Id = Guid.NewGuid(), CompanyId = s.CompanyId, Name = "Sales" };
        role.Set(AccessModule.Sales, AccessLevel.Approve);
        role.Set(AccessModule.Partners, AccessLevel.Write);
        var staff = CompanyAccessContext.ForStaff(s.CompanyId, Guid.NewGuid(), null, role, null);

        Assert.IsType<ForbidResult>(await Payments(s, staff).Create(s.CompanyId,
            new CreatePaymentRequest("Outbound", s.VendorId, 10m, s.BankId, PayDate)));
        var received = Assert.IsType<ObjectResult>(await Payments(s, staff).Create(s.CompanyId,
            new CreatePaymentRequest("Inbound", s.CustomerId, 10m, s.BankId, PayDate)));
        Assert.Equal(StatusCodes.Status201Created, received.StatusCode);
    }
}
