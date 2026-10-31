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
using Pako.Infrastructure.Migrations;

namespace Pako.Tests;

public class JournalCounterRepairTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private static Journal NewJournal(Guid companyId, JournalType type, string code, int next = 1) =>
        new() { Id = Guid.NewGuid(), CompanyId = companyId, Type = type, Code = code, Name = code, SequencePrefix = code, SequenceNextNumber = next, SequencePadding = 4 };

    private static JournalEntry Entry(Guid companyId, Guid journalId, string? number) =>
        new() { Id = Guid.NewGuid(), CompanyId = companyId, JournalId = journalId, SequenceNumber = number, Date = new DateOnly(2026, 8, 26), Reference = "legacy", State = JournalEntryState.Draft };

    private async Task<(PakoDbContext Db, Company Company, Guid PartnerId)> SeedAsync()
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
        db.Partners.Add(new Partner { Id = partnerId, CompanyId = company.Id, Name = "Acme", IsCustomer = true });
        db.Accounts.Add(new Account { Id = receivableId, CompanyId = company.Id, Code = "1200", Name = "AR", AccountType = AccountType.Receivable, AccountSubType = AccountSubType.Receivable });
        db.Accounts.Add(new Account { Id = payableId, CompanyId = company.Id, Code = "2000", Name = "AP", AccountType = AccountType.Payable, AccountSubType = AccountSubType.Payable });
        db.Accounts.Add(new Account { Id = revenueId, CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income });
        db.Accounts.Add(new Account { Id = expenseId, CompanyId = company.Id, Code = "6000", Name = "Expenses", AccountType = AccountType.Expense });
        db.Accounts.Add(new Account { Id = depositsId, CompanyId = company.Id, Code = "2500", Name = "Deposits", AccountType = AccountType.CurrentLiability });
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, ReceivableAccountId = receivableId, PayableAccountId = payableId,
            RevenueAccountId = revenueId, ExpenseAccountId = expenseId, CustomerDepositsAccountId = depositsId
        });
        await db.SaveChangesAsync();
        return (db, company, partnerId);
    }

    private static async Task RepairAsync(PakoDbContext db) =>
        await db.Database.ExecuteSqlRawAsync(RepairJournalSequenceCounters.RepairSql);

    private static Task<int> NextAsync(PakoDbContext db, Guid journalId) =>
        db.Journals.AsNoTracking().Where(j => j.Id == journalId).Select(j => j.SequenceNextNumber).SingleAsync();

    [Fact]
    public async Task Repair_RaisesCounterPastHighestLegacyNumber_IgnoresUnparseableAndIsIdempotent()
    {
        var (db, company, _) = await SeedAsync();
        var sal = NewJournal(company.Id, JournalType.Sale, "SAL");
        var pur = NewJournal(company.Id, JournalType.Purchase, "PUR");
        var gen = NewJournal(company.Id, JournalType.General, "GEN");
        var high = NewJournal(company.Id, JournalType.Miscellaneous, "MSC", next: 50);
        db.Journals.AddRange(sal, pur, gen, high);
        db.JournalEntries.AddRange(
            Entry(company.Id, sal.Id, "SAL-0001"), Entry(company.Id, sal.Id, "SAL-0001"), Entry(company.Id, sal.Id, "SAL-0001"),
            Entry(company.Id, sal.Id, "SAL-0007"), Entry(company.Id, sal.Id, null), Entry(company.Id, sal.Id, "SAL-ABC"),
            Entry(company.Id, sal.Id, "PUR-0099"), Entry(company.Id, sal.Id, "SAL-99999999999"),
            Entry(company.Id, gen.Id, null),
            Entry(company.Id, high.Id, "MSC-0003"));
        await db.SaveChangesAsync();

        await RepairAsync(db);
        Assert.Equal(8, await NextAsync(db, sal.Id));
        Assert.Equal(1, await NextAsync(db, pur.Id));
        Assert.Equal(1, await NextAsync(db, gen.Id));
        Assert.Equal(50, await NextAsync(db, high.Id));

        await RepairAsync(db);
        Assert.Equal(8, await NextAsync(db, sal.Id));
        Assert.Equal(1, await NextAsync(db, pur.Id));
        Assert.Equal(1, await NextAsync(db, gen.Id));
        Assert.Equal(50, await NextAsync(db, high.Id));
    }

    [Fact]
    public async Task PostInvoice_AfterRepair_YieldsSal0008()
    {
        var (db, company, partnerId) = await SeedAsync();
        var sal = NewJournal(company.Id, JournalType.Sale, "SAL");
        db.Journals.Add(sal);
        db.JournalEntries.AddRange(
            Entry(company.Id, sal.Id, "SAL-0001"), Entry(company.Id, sal.Id, "SAL-0001"),
            Entry(company.Id, sal.Id, "SAL-0001"), Entry(company.Id, sal.Id, "SAL-0007"));
        await db.SaveChangesAsync();

        await RepairAsync(db);

        var controller = new InvoicesController(db, new TaxComputationService(), new DocumentNumberService(), new NumberSeriesService(db),
            new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"))
                }
            }
        };
        var created = await controller.Create(company.Id, new CreateInvoiceRequest(partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Consulting", 1m, 100m, null, null) }));
        var invoice = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(created.Result).Value);
        await controller.Post(company.Id, invoice.Id);

        var numbers = await db.JournalEntries.AsNoTracking().Where(e => e.JournalId == sal.Id && e.Reference != "legacy")
            .Select(e => e.SequenceNumber).ToListAsync();
        Assert.Equal(new List<string?> { "SAL-0008" }, numbers);
        Assert.Equal(9, await NextAsync(db, sal.Id));
    }
}
