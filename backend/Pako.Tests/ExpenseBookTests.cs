using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

public class ExpenseBookTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, Guid CompanyId, Account Rent, Account Cogs, Account Utilities);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var cash = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.CurrentAsset };
        var revenue = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income };
        var cogs = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "5000", Name = "Cost of goods", AccountType = AccountType.CostOfRevenue };
        var rent = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "6000", Name = "Rent", AccountType = AccountType.Expense };
        var utilities = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "6100", Name = "Utilities", AccountType = AccountType.Expense };
        var unused = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "6200", Name = "Unused", AccountType = AccountType.Expense };
        var partner = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Prime Properties", IsVendor = true };
        db.Companies.Add(company);
        db.Accounts.AddRange(cash, revenue, cogs, rent, utilities, unused);
        db.Partners.Add(partner);
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        db.Journals.Add(journal);

        Post(db, company, journal, new DateOnly(2025, 12, 20), "OLD", null, true, (rent, 999m, 0m), (cash, 0m, 999m));
        Post(db, company, journal, new DateOnly(2026, 1, 10), "BILL-1", partner.Id, true, (rent, 1000m, 0m), (cash, 0m, 1000m));
        Post(db, company, journal, new DateOnly(2026, 1, 15), null, null, true, (cogs, 300m, 0m), (rent, 50m, 0m), (cash, 0m, 350m));
        Post(db, company, journal, new DateOnly(2026, 1, 20), "SALE-1", null, true, (cash, 500m, 0m), (revenue, 0m, 500m));
        Post(db, company, journal, new DateOnly(2026, 1, 25), "BILL-2", null, true, (utilities, 240m, 0m), (cash, 0m, 240m));
        Post(db, company, journal, new DateOnly(2026, 1, 28), "DRAFT", null, false, (unused, 777m, 0m), (cash, 0m, 777m));
        Post(db, company, journal, new DateOnly(2026, 2, 5), "FEB", null, true, (rent, 888m, 0m), (cash, 0m, 888m));

        await db.SaveChangesAsync();
        return new Seed(db, company.Id, rent, cogs, utilities);
    }

    private static void Post(PakoDbContext db, Company company, Journal journal, DateOnly date, string? reference, Guid? partnerId, bool post,
        params (Account Account, decimal Debit, decimal Credit)[] lines)
    {
        var entry = new JournalEntry { Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = journal.Id, Date = date, Reference = reference };
        foreach (var l in lines)
        {
            entry.Lines.Add(new JournalEntryLine
            {
                Id = Guid.NewGuid(), AccountId = l.Account.Id, Debit = l.Debit, Credit = l.Credit,
                PartnerId = l.Account.AccountType == AccountType.Expense ? partnerId : null
            });
        }
        if (post) entry.Post(company);
        db.JournalEntries.Add(entry);
    }

    private static ExpenseBookController Controller(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted());

    private static async Task<ExpenseBookResponse> BookAsync(Seed s, DateOnly from, DateOnly to)
    {
        var result = await Controller(s.Db).ExpenseBook(s.CompanyId, from, to);
        return Assert.IsType<ExpenseBookResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
    }

    private static readonly DateOnly Jan1 = new(2026, 1, 1);
    private static readonly DateOnly Jan31 = new(2026, 1, 31);

    [Fact]
    public async Task ExpenseBook_OneRowPerPostedEntryWithExpenseLines()
    {
        var s = await SeedAsync();
        var book = await BookAsync(s, Jan1, Jan31);

        Assert.Equal(3, book.Rows.Count);
        Assert.Equal(new[] { new DateOnly(2026, 1, 10), new DateOnly(2026, 1, 15), new DateOnly(2026, 1, 25) }, book.Rows.Select(r => r.Date));
        Assert.Equal("BILL-1", book.Rows[0].DocumentNumber);
        Assert.Equal("Prime Properties", book.Rows[0].PartnerName);
        Assert.Null(book.Rows[1].DocumentNumber);
        Assert.Null(book.Rows[1].PartnerName);
        Assert.Equal(new[] { 1000m, 350m, 240m }, book.Rows.Select(r => r.Total));
    }

    [Fact]
    public async Task ExpenseBook_ColumnsAreExpenseAccountsUsedInRange()
    {
        var s = await SeedAsync();
        var book = await BookAsync(s, Jan1, Jan31);

        Assert.Equal(new[] { "5000", "6000", "6100" }, book.Columns.Select(c => c.AccountCode));
        Assert.Equal(new[] { s.Cogs.Id, s.Rent.Id, s.Utilities.Id }, book.Columns.Select(c => c.AccountId));
        Assert.Equal("Rent", book.Columns[1].AccountName);
    }

    [Fact]
    public async Task ExpenseBook_AmountsAlignedWithColumns()
    {
        var s = await SeedAsync();
        var book = await BookAsync(s, Jan1, Jan31);

        Assert.Equal(new[] { 0m, 1000m, 0m }, book.Rows[0].Amounts);
        Assert.Equal(new[] { 300m, 50m, 0m }, book.Rows[1].Amounts);
        Assert.Equal(new[] { 0m, 0m, 240m }, book.Rows[2].Amounts);
        Assert.All(book.Rows, r => Assert.Equal(book.Columns.Count, r.Amounts.Count));
    }

    [Fact]
    public async Task ExpenseBook_ColumnTotalsEqualPnlExpenses()
    {
        var s = await SeedAsync();
        var book = await BookAsync(s, Jan1, Jan31);

        Assert.Equal(new[] { 300m, 1050m, 240m }, book.ColumnTotals);

        var reports = new ReportsController(s.Db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(s.Db));
        var pnl = Assert.IsType<ProfitAndLossResponse>(Assert.IsType<OkObjectResult>((await reports.ProfitAndLoss(s.CompanyId, Jan1, Jan31)).Result).Value);
        Assert.Equal(1590m, pnl.TotalExpenses);
        Assert.Equal(pnl.TotalExpenses, book.ColumnTotals.Sum());
        Assert.Equal(pnl.TotalExpenses, book.Rows.Sum(r => r.Total));
    }

    [Fact]
    public async Task ExpenseBook_ExcludesDraftEntriesAndOutOfRange()
    {
        var s = await SeedAsync();
        var book = await BookAsync(s, Jan1, Jan31);

        Assert.DoesNotContain(book.Columns, c => c.AccountCode == "6200");
        Assert.DoesNotContain(book.Rows, r => r.DocumentNumber is "DRAFT" or "OLD" or "FEB");
        Assert.Equal(1590m, book.ColumnTotals.Sum());

        var empty = await BookAsync(s, new DateOnly(2027, 1, 1), new DateOnly(2027, 1, 31));
        Assert.Empty(empty.Columns);
        Assert.Empty(empty.Rows);
        Assert.Empty(empty.ColumnTotals);
    }

    [Fact]
    public async Task ExpenseBook_FromAfterTo_Returns400()
    {
        var s = await SeedAsync();
        var result = await Controller(s.Db).ExpenseBook(s.CompanyId, Jan31, Jan1);
        Assert.IsType<BadRequestObjectResult>(result.Result);

        var export = await Controller(s.Db).ExpenseBookExport(s.CompanyId, Jan31, Jan1);
        Assert.IsType<BadRequestObjectResult>(export);
    }

    [Fact]
    public async Task ExpenseBook_GrandTotalEqualsSumOfRowTotals()
    {
        var s = await SeedAsync();
        var book = await BookAsync(s, Jan1, Jan31);

        Assert.Equal(1590m, book.GrandTotal);
        Assert.Equal(book.Rows.Sum(r => r.Total), book.GrandTotal);
        Assert.Equal(book.ColumnTotals.Sum(), book.GrandTotal);
    }
}
