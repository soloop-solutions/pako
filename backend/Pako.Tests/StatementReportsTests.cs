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

public class StatementReportsTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, Guid CompanyId, Guid CashId);

    private async Task<Seed> SeedAsync(bool withEntries = true)
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var cash = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.CurrentAsset };
        var capital = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "3000", Name = "Capital", AccountType = AccountType.Equity };
        var revenue = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income };
        var cogs = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "5000", Name = "Cost of goods", AccountType = AccountType.CostOfRevenue };
        var rent = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "6000", Name = "Rent", AccountType = AccountType.Expense };
        db.Companies.Add(company);
        db.Accounts.AddRange(cash, capital, revenue, cogs, rent);
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        db.Journals.Add(journal);

        if (withEntries)
        {
            Post(db, company, journal, new DateOnly(2025, 12, 15), (cash, 500m, 0m), (capital, 0m, 500m));
            Post(db, company, journal, new DateOnly(2026, 1, 10), (cash, 1000m, 0m), (revenue, 0m, 1000m));
            Post(db, company, journal, new DateOnly(2026, 1, 20), (cogs, 300m, 0m), (cash, 0m, 300m));
            Post(db, company, journal, new DateOnly(2026, 3, 5), (cash, 2000m, 0m), (revenue, 0m, 2000m));
            Post(db, company, journal, new DateOnly(2026, 3, 25), (rent, 400m, 0m), (cash, 0m, 400m));
            Post(db, company, journal, new DateOnly(2026, 12, 31), (cogs, 600m, 0m), (cash, 0m, 600m));
        }

        await db.SaveChangesAsync();
        return new Seed(db, company.Id, cash.Id);
    }

    private static void Post(PakoDbContext db, Company company, Journal journal, DateOnly date, params (Account Account, decimal Debit, decimal Credit)[] lines)
    {
        var entry = new JournalEntry { Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = journal.Id, Date = date };
        foreach (var l in lines)
        {
            entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = l.Account.Id, Debit = l.Debit, Credit = l.Credit });
        }
        entry.Post(company);
        db.JournalEntries.Add(entry);
    }

    private static StatementReportsController Statements(PakoDbContext db) =>
        new(new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(db));

    private static ReportsController Reports(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(db));

    private static async Task<MonthlyProfitAndLossResponse> MonthlyAsync(PakoDbContext db, Guid companyId, int year)
    {
        var result = await Statements(db).MonthlyProfitAndLoss(companyId, year);
        return Assert.IsType<MonthlyProfitAndLossResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
    }

    [Fact]
    public async Task MonthlyPnl_PlacesEachPostingInItsMonth()
    {
        var s = await SeedAsync();
        var r = await MonthlyAsync(s.Db, s.CompanyId, 2026);

        var revenue = Assert.Single(r.Income);
        Assert.Equal(12, revenue.Months.Count);
        Assert.Equal(1000m, revenue.Months[0]);
        Assert.Equal(2000m, revenue.Months[2]);
        Assert.Equal(0m, revenue.Months[1]);
        Assert.Equal(3000m, revenue.Total);

        var cogs = Assert.Single(r.CostOfRevenue);
        Assert.Equal(300m, cogs.Months[0]);
        Assert.Equal(600m, cogs.Months[11]);
        Assert.Equal(900m, cogs.Total);

        var rent = Assert.Single(r.Expenses);
        Assert.Equal(400m, rent.Months[2]);
        Assert.Equal(400m, rent.Total);
    }

    [Fact]
    public async Task MonthlyPnl_MonthsSumToExistingYearlyPnl()
    {
        var s = await SeedAsync();
        var monthly = await MonthlyAsync(s.Db, s.CompanyId, 2026);

        var yearlyResult = await Reports(s.Db).ProfitAndLoss(s.CompanyId, new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31));
        var yearly = Assert.IsType<ProfitAndLossResponse>(Assert.IsType<OkObjectResult>(yearlyResult.Result).Value);

        Assert.Equal(1700m, yearly.NetIncome);
        Assert.Equal(yearly.NetIncome, monthly.NetIncome);
        Assert.Equal(yearly.NetIncome, monthly.NetIncomeByMonth.Sum());
    }

    [Fact]
    public async Task MonthlyPnl_GrossProfitIsIncomeMinusCostOfRevenue()
    {
        var s = await SeedAsync();
        var r = await MonthlyAsync(s.Db, s.CompanyId, 2026);

        Assert.Equal(12, r.GrossProfitByMonth.Count);
        Assert.Equal(700m, r.GrossProfitByMonth[0]);
        Assert.Equal(2000m, r.GrossProfitByMonth[2]);
        Assert.Equal(-600m, r.GrossProfitByMonth[11]);
        Assert.Equal(2100m, r.GrossProfit);
        Assert.Equal(1600m, r.NetIncomeByMonth[2]);
        Assert.Equal(1700m, r.NetIncome);
    }

    [Fact]
    public async Task Comparative_PriorColumnEqualsBalanceSheetAtThatDate()
    {
        var s = await SeedAsync();
        var asOf = new DateOnly(2026, 12, 31);
        var prior = new DateOnly(2025, 12, 31);

        var result = await Statements(s.Db).BalanceSheetComparative(s.CompanyId, asOf, prior);
        var comparative = Assert.IsType<BalanceSheetComparativeResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

        var priorSheetResult = await Reports(s.Db).BalanceSheet(s.CompanyId, prior);
        var priorSheet = Assert.IsType<BalanceSheetResponse>(Assert.IsType<OkObjectResult>(priorSheetResult.Result).Value);

        var cash = Assert.Single(comparative.Assets);
        Assert.Equal(500m, cash.Prior);
        Assert.Equal(priorSheet.Assets.Single().Amount, cash.Prior);
        Assert.Equal(2200m, cash.Current);
        Assert.Equal(priorSheet.TotalEquity, comparative.Equity.Sum(l => l.Prior));
        Assert.Equal(2200m, comparative.TotalAssets);
        Assert.Equal(2200m, comparative.TotalLiabilitiesAndEquity);
    }

    [Fact]
    public async Task Comparative_DifferenceIsCurrentMinusPrior()
    {
        var s = await SeedAsync();

        var result = await Statements(s.Db).BalanceSheetComparative(s.CompanyId, new DateOnly(2026, 12, 31), new DateOnly(2025, 12, 31));
        var comparative = Assert.IsType<BalanceSheetComparativeResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

        var cash = Assert.Single(comparative.Assets);
        Assert.Equal(1700m, cash.Difference);
        var earnings = comparative.Equity.Single(l => l.AccountCode == "3999");
        Assert.Equal(1700m, earnings.Current);
        Assert.Equal(0m, earnings.Prior);
        Assert.Equal(1700m, earnings.Difference);
        foreach (var line in comparative.Assets.Concat(comparative.Liabilities).Concat(comparative.Equity))
        {
            Assert.Equal(line.Current - line.Prior, line.Difference);
        }
    }

    [Fact]
    public async Task Monthly_EmptyYear_ReturnsZeros()
    {
        var s = await SeedAsync(withEntries: false);
        var r = await MonthlyAsync(s.Db, s.CompanyId, 2026);

        Assert.Empty(r.Income);
        Assert.Empty(r.CostOfRevenue);
        Assert.Empty(r.Expenses);
        Assert.Equal(12, r.GrossProfitByMonth.Count);
        Assert.Equal(12, r.NetIncomeByMonth.Count);
        Assert.All(r.GrossProfitByMonth, v => Assert.Equal(0m, v));
        Assert.All(r.NetIncomeByMonth, v => Assert.Equal(0m, v));
        Assert.Equal(0m, r.GrossProfit);
        Assert.Equal(0m, r.NetIncome);
    }
}
