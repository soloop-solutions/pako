using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Payroll;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

public class JournalSequencingTests : IAsyncLifetime
{
    private static readonly TaxComputationService TaxService = new();
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private static ControllerContext UserContext() => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"))
        }
    };

    private static InvoicesController Invoices(PakoDbContext db) =>
        new(db, TaxService, new DocumentNumberService(), new NumberSeriesService(db), new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted())
        { ControllerContext = UserContext() };

    private static BillsController Bills(PakoDbContext db) =>
        new(db, TaxService, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted())
        { ControllerContext = UserContext() };

    private static PayrollRunsController Runs(PakoDbContext db) =>
        new(db, new PayrollRunComposer(db, new PayrollCalculationService(), new PayrollParameterProvider(db)), new PayslipDocumentService(db),
            new NotificationOutbox(db), new NullStringLocalizer<ErrorMessages>()) { ControllerContext = UserContext() };

    private static Journal NewJournal(Guid companyId, JournalType type, string code) =>
        new() { Id = Guid.NewGuid(), CompanyId = companyId, Type = type, Code = code, Name = code, SequencePrefix = code, SequenceNextNumber = 1, SequencePadding = 4 };

    private async Task<(PakoDbContext Db, Guid CompanyId, Guid PartnerId)> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co", IsVatRegistered = false };
        var partnerId = Guid.NewGuid();
        var receivableId = Guid.NewGuid();
        var payableId = Guid.NewGuid();
        var revenueId = Guid.NewGuid();
        var expenseId = Guid.NewGuid();
        var depositsId = Guid.NewGuid();

        db.Companies.Add(company);
        db.Partners.Add(new Partner { Id = partnerId, CompanyId = company.Id, Name = "Acme", IsCustomer = true, IsVendor = true });
        db.Accounts.Add(new Account { Id = receivableId, CompanyId = company.Id, Code = "1200", Name = "AR", AccountType = AccountType.Receivable, AccountSubType = AccountSubType.Receivable });
        db.Accounts.Add(new Account { Id = payableId, CompanyId = company.Id, Code = "2000", Name = "AP", AccountType = AccountType.Payable, AccountSubType = AccountSubType.Payable });
        db.Accounts.Add(new Account { Id = revenueId, CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income });
        db.Accounts.Add(new Account { Id = expenseId, CompanyId = company.Id, Code = "6000", Name = "Expenses", AccountType = AccountType.Expense });
        db.Accounts.Add(new Account { Id = depositsId, CompanyId = company.Id, Code = "2500", Name = "Deposits", AccountType = AccountType.CurrentLiability });
        db.Journals.AddRange(
            NewJournal(company.Id, JournalType.General, "GEN"),
            NewJournal(company.Id, JournalType.Sale, "SAL"),
            NewJournal(company.Id, JournalType.Purchase, "PUR"));
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            ReceivableAccountId = receivableId,
            PayableAccountId = payableId,
            RevenueAccountId = revenueId,
            ExpenseAccountId = expenseId,
            CustomerDepositsAccountId = depositsId
        });
        await db.SaveChangesAsync();
        return (db, company.Id, partnerId);
    }

    private static CreateInvoiceRequest InvoiceRequest(Guid partnerId) =>
        new(partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Consulting", 1m, 100m, null, null) });

    private static CreateBillRequest BillRequest(Guid partnerId, string vendorNumber) =>
        new(partnerId, vendorNumber, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateBillLineRequest> { new("Supplies", 1m, 100m, null, null) });

    private static T Created<T>(ActionResult<T> result) => Assert.IsType<T>(Assert.IsType<ObjectResult>(result.Result).Value);

    private static async Task<List<string?>> SequenceNumbersAsync(PakoDbContext db, Guid companyId, JournalType type)
    {
        var journalId = await db.Journals.AsNoTracking().Where(j => j.CompanyId == companyId && j.Type == type).Select(j => j.Id).SingleAsync();
        return await db.JournalEntries.AsNoTracking().Where(e => e.JournalId == journalId).OrderBy(e => e.SequenceNumber).Select(e => e.SequenceNumber).ToListAsync();
    }

    private static Task<int> NextNumberAsync(PakoDbContext db, Guid companyId, JournalType type) =>
        db.Journals.AsNoTracking().Where(j => j.CompanyId == companyId && j.Type == type).Select(j => j.SequenceNextNumber).SingleAsync();

    [Fact]
    public async Task PostInvoice_Twice_AssignsConsecutiveSalesJournalNumbers()
    {
        var (db, companyId, partnerId) = await SeedAsync();
        var controller = Invoices(db);

        for (var i = 0; i < 2; i++)
        {
            var invoice = Created(await controller.Create(companyId, InvoiceRequest(partnerId)));
            await controller.Post(companyId, invoice.Id);
        }

        Assert.Equal(new List<string?> { "SAL-0001", "SAL-0002" }, await SequenceNumbersAsync(db, companyId, JournalType.Sale));
        Assert.Equal(3, await NextNumberAsync(db, companyId, JournalType.Sale));
    }

    [Fact]
    public async Task PostBill_Twice_AssignsConsecutivePurchaseJournalNumbers()
    {
        var (db, companyId, partnerId) = await SeedAsync();
        var controller = Bills(db);

        for (var i = 0; i < 2; i++)
        {
            var bill = Created(await controller.Create(companyId, BillRequest(partnerId, $"VEND-{i}")));
            await controller.Post(companyId, bill.Id);
        }

        Assert.Equal(new List<string?> { "PUR-0001", "PUR-0002" }, await SequenceNumbersAsync(db, companyId, JournalType.Purchase));
        Assert.Equal(3, await NextNumberAsync(db, companyId, JournalType.Purchase));
    }

    [Fact]
    public async Task PostInvoice_FromFreshContextPerRequest_AssignsConsecutiveNumbers()
    {
        var (db, companyId, partnerId) = await SeedAsync();

        for (var i = 0; i < 2; i++)
        {
            var requestDb = PostgresTestDatabase.CreateAdditionalContext(db);
            _dbContexts.Add(requestDb);
            var controller = Invoices(requestDb);
            var invoice = Created(await controller.Create(companyId, InvoiceRequest(partnerId)));
            await controller.Post(companyId, invoice.Id);
        }

        Assert.Equal(new List<string?> { "SAL-0001", "SAL-0002" }, await SequenceNumbersAsync(db, companyId, JournalType.Sale));
    }

    [Fact]
    public async Task PostBills_Concurrently_NeverShareAJournalNumber()
    {
        var (db, companyId, partnerId) = await SeedAsync();
        const int count = 8;
        var ids = new List<Guid>();
        for (var i = 0; i < count; i++)
        {
            ids.Add(Created(await Bills(db).Create(companyId, BillRequest(partnerId, $"VEND-{i}"))).Id);
        }

        await Task.WhenAll(ids.Select(async id =>
        {
            var requestDb = PostgresTestDatabase.CreateAdditionalContext(db);
            _dbContexts.Add(requestDb);
            await Bills(requestDb).Post(companyId, id);
        }));

        var numbers = await SequenceNumbersAsync(db, companyId, JournalType.Purchase);
        Assert.Equal(count, numbers.Count);
        Assert.Equal(count, numbers.Distinct().Count());
        Assert.Equal(count + 1, await NextNumberAsync(db, companyId, JournalType.Purchase));
    }

    [Fact]
    public async Task PostInvoices_Concurrently_NeverShareAJournalNumber()
    {
        var (db, companyId, partnerId) = await SeedAsync();
        const int count = 8;
        var ids = new List<Guid>();
        for (var i = 0; i < count; i++)
        {
            ids.Add(Created(await Invoices(db).Create(companyId, InvoiceRequest(partnerId))).Id);
        }

        await Task.WhenAll(ids.Select(async id =>
        {
            var requestDb = PostgresTestDatabase.CreateAdditionalContext(db);
            _dbContexts.Add(requestDb);
            await Invoices(requestDb).Post(companyId, id);
        }));

        var numbers = await SequenceNumbersAsync(db, companyId, JournalType.Sale);
        Assert.Equal(count, numbers.Count);
        Assert.Equal(count, numbers.Distinct().Count());
        Assert.Equal(count + 1, await NextNumberAsync(db, companyId, JournalType.Sale));
    }

    [Fact]
    public async Task PostPayrollRun_AdvancesGeneralJournalSequence()
    {
        var (db, companyId, _) = await SeedAsync();
        var accounts = new Dictionary<string, Guid>();
        foreach (var (code, type) in new[] { ("600100", AccountType.Expense), ("213100", AccountType.CurrentLiability), ("221100", AccountType.CurrentLiability), ("220100", AccountType.CurrentLiability) })
        {
            var id = Guid.NewGuid();
            accounts[code] = id;
            db.Accounts.Add(new Account { Id = id, CompanyId = companyId, Code = code, Name = code, AccountType = type });
        }
        var defaults = await db.CompanyAccountDefaults.SingleAsync(d => d.CompanyId == companyId);
        defaults.SalaryExpenseAccountId = accounts["600100"];
        defaults.PitPayableAccountId = accounts["213100"];
        defaults.PensionPayableAccountId = accounts["221100"];
        defaults.NetPayPayableAccountId = accounts["220100"];
        await db.SaveChangesAsync();

        var employees = new EmployeesController(db, CompanyAccessContext.Unrestricted(), new NullStringLocalizer<ErrorMessages>()) { ControllerContext = UserContext() };
        Created(await employees.Create(companyId, new SaveEmployeeRequest("Arta", "Krasniqi", null, null, null, null, null, null, null, null, "Analyst", null, null, null, null, null, 1000m)));

        var first = Created(await Runs(db).Create(companyId, new CreatePayrollRunRequest(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30))));
        Assert.IsType<OkObjectResult>((await Runs(db).Post(companyId, first.Id)).Result);
        var second = Created(await Runs(db).Create(companyId, new CreatePayrollRunRequest(new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31))));
        Assert.IsType<OkObjectResult>((await Runs(db).Post(companyId, second.Id)).Result);

        Assert.Equal(new List<string?> { "GEN-0001", "GEN-0002" }, await SequenceNumbersAsync(db, companyId, JournalType.General));
        Assert.Equal(3, await NextNumberAsync(db, companyId, JournalType.General));
    }
}
