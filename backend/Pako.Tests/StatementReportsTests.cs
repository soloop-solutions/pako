using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
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
        new(new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(db), new ExportLabels(new NullStringLocalizer<ErrorMessages>()));

    private static ReportsController Reports(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(db), new ExportLabels(new NullStringLocalizer<ErrorMessages>()));

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

    private record FlowSeed(PakoDbContext Db, Guid CompanyId, Account Receivable, Account Fixed, Account Loan, Account Capital);

    private async Task<FlowSeed> SeedFlowAsync(bool withEntries = true)
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Flow Co" };
        Account Acc(string code, string name, AccountType type, CashFlowCategory cat = CashFlowCategory.None) =>
            new() { Id = Guid.NewGuid(), CompanyId = company.Id, Code = code, Name = name, AccountType = type, CashFlowCategory = cat };
        var cash = Acc("1000", "Cash", AccountType.Cash);
        var receivable = Acc("1200", "Receivables", AccountType.CurrentAsset, CashFlowCategory.Operating);
        var fixedAsset = Acc("1500", "Fixed assets", AccountType.FixedAsset, CashFlowCategory.Investing);
        var loan = Acc("2500", "Loan", AccountType.NonCurrentLiability, CashFlowCategory.Financing);
        var capital = Acc("3000", "Capital", AccountType.Equity, CashFlowCategory.Financing);
        var revenue = Acc("4000", "Revenue", AccountType.Income);
        var rent = Acc("6000", "Rent", AccountType.Expense);
        db.Companies.Add(company);
        db.Accounts.AddRange(cash, receivable, fixedAsset, loan, capital, revenue, rent);
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        db.Journals.Add(journal);

        if (withEntries)
        {
            Post(db, company, journal, new DateOnly(2025, 12, 15), (cash, 5000m, 0m), (capital, 0m, 5000m));
            Post(db, company, journal, new DateOnly(2026, 1, 10), (cash, 1000m, 0m), (revenue, 0m, 1000m));
            Post(db, company, journal, new DateOnly(2026, 2, 1), (fixedAsset, 2000m, 0m), (cash, 0m, 2000m));
            Post(db, company, journal, new DateOnly(2026, 3, 1), (cash, 3000m, 0m), (loan, 0m, 3000m));
            Post(db, company, journal, new DateOnly(2026, 3, 5), (receivable, 500m, 0m), (revenue, 0m, 500m));
            Post(db, company, journal, new DateOnly(2026, 3, 25), (rent, 400m, 0m), (cash, 0m, 400m));
            Post(db, company, journal, new DateOnly(2026, 4, 1), (capital, 200m, 0m), (cash, 0m, 200m));
        }

        await db.SaveChangesAsync();
        return new FlowSeed(db, company.Id, receivable, fixedAsset, loan, capital);
    }

    private static readonly DateOnly Jan1 = new(2026, 1, 1);
    private static readonly DateOnly Dec31 = new(2026, 12, 31);

    private static async Task<CashFlowResponse> CashFlowAsync(PakoDbContext db, Guid companyId)
    {
        var result = await Statements(db).CashFlow(companyId, Jan1, Dec31);
        return Assert.IsType<CashFlowResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
    }

    [Fact]
    public async Task CashFlow_ClosesToCashAndBankBalance_Check3()
    {
        var s = await SeedFlowAsync();
        var r = await CashFlowAsync(s.Db, s.CompanyId);

        Assert.Equal(5000m, r.OpeningCash);
        Assert.Equal(1100m, r.NetIncome);
        Assert.Equal(1400m, r.NetChange);
        Assert.Equal(6400m, r.ClosingCash);
        Assert.Equal(0m, r.Difference);
        Assert.Equal(-500m, Assert.Single(r.Operating).Amount);
    }

    [Fact]
    public async Task CashFlow_UsesAccountCashFlowCategory()
    {
        var s = await SeedFlowAsync();
        s.Db.Accounts.Single(a => a.Id == s.Loan.Id).CashFlowCategory = CashFlowCategory.Investing;
        s.Db.Accounts.Single(a => a.Id == s.Receivable.Id).CashFlowCategory = CashFlowCategory.None;
        await s.Db.SaveChangesAsync();

        var r = await CashFlowAsync(s.Db, s.CompanyId);

        Assert.Empty(r.Operating);
        Assert.Equal(new[] { "1500", "2500" }, r.Investing.Select(l => l.AccountCode));
        Assert.Equal(new[] { -2000m, 3000m }, r.Investing.Select(l => l.Amount));
        Assert.Equal(new[] { "3000" }, r.Financing.Select(l => l.AccountCode));
        Assert.Equal(-200m, Assert.Single(r.Financing).Amount);
        Assert.Equal(1900m, r.NetChange);
        Assert.Equal(-500m, r.Difference);
    }

    [Fact]
    public async Task CashFlow_ClosesWithOpeningBalanceClearing_Check3()
    {
        var s = await SeedFlowAsync(withEntries: false);
        var inventory = new Account { Id = Guid.NewGuid(), CompanyId = s.CompanyId, Code = "1310", Name = "Stock", AccountType = AccountType.CurrentAsset, CashFlowCategory = CashFlowCategory.Operating };
        var clearing = new Account { Id = Guid.NewGuid(), CompanyId = s.CompanyId, Code = "390100", Name = "Opening Balance Clearing", AccountType = AccountType.Equity, CashFlowCategory = CashFlowCategory.None };
        var cash = s.Db.Accounts.Single(a => a.CompanyId == s.CompanyId && a.Code == "1000");
        var revenue = s.Db.Accounts.Single(a => a.CompanyId == s.CompanyId && a.Code == "4000");
        var rent = s.Db.Accounts.Single(a => a.CompanyId == s.CompanyId && a.Code == "6000");
        var company = s.Db.Companies.Single(c => c.Id == s.CompanyId);
        var journal = s.Db.Journals.Single(j => j.CompanyId == s.CompanyId);
        s.Db.Accounts.AddRange(inventory, clearing);
        Post(s.Db, company, journal, new DateOnly(2026, 1, 2), (inventory, 15232.92m, 0m), (clearing, 0m, 15232.92m));
        Post(s.Db, company, journal, new DateOnly(2026, 1, 10), (cash, 1000m, 0m), (revenue, 0m, 1000m));
        Post(s.Db, company, journal, new DateOnly(2026, 3, 25), (rent, 400m, 0m), (cash, 0m, 400m));
        await s.Db.SaveChangesAsync();

        var r = await CashFlowAsync(s.Db, s.CompanyId);

        Assert.Equal(600m, r.NetChange);
        Assert.Equal(600m, r.ClosingCash);
        Assert.Equal(0m, r.Difference);
        Assert.Contains(r.Operating, l => l.AccountCode == "390100" && l.Amount == 15232.92m);
        Assert.Contains(r.Operating, l => l.AccountCode == "1310" && l.Amount == -15232.92m);
    }

    [Fact]
    public async Task CashFlow_OrdinaryAccountWithCategoryNone_StillShowsDifference_Check3()
    {
        var s = await SeedFlowAsync(withEntries: false);
        var stuff = new Account { Id = Guid.NewGuid(), CompanyId = s.CompanyId, Code = "1400", Name = "Unclassified", AccountType = AccountType.CurrentAsset, CashFlowCategory = CashFlowCategory.None };
        var cash = s.Db.Accounts.Single(a => a.CompanyId == s.CompanyId && a.Code == "1000");
        var company = s.Db.Companies.Single(c => c.Id == s.CompanyId);
        var journal = s.Db.Journals.Single(j => j.CompanyId == s.CompanyId);
        s.Db.Accounts.Add(stuff);
        Post(s.Db, company, journal, new DateOnly(2026, 1, 10), (stuff, 700m, 0m), (cash, 0m, 700m));
        await s.Db.SaveChangesAsync();

        var r = await CashFlowAsync(s.Db, s.CompanyId);

        Assert.Equal(-700m, r.Difference);
    }

    [Fact]
    public async Task CashFlow_NoPostings_ReturnsZeros()
    {
        var s = await SeedFlowAsync(withEntries: false);
        var r = await CashFlowAsync(s.Db, s.CompanyId);

        Assert.Equal(0m, r.OpeningCash);
        Assert.Equal(0m, r.ClosingCash);
        Assert.Equal(0m, r.Difference);
        Assert.Empty(r.Operating);
        Assert.Empty(r.Investing);
        Assert.Empty(r.Financing);
    }

    [Fact]
    public async Task CashFlow_FromAfterTo_Returns400()
    {
        var s = await SeedFlowAsync();
        var result = await Statements(s.Db).CashFlow(s.CompanyId, Dec31, Jan1);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CashFlow_PartnerRestricted_Returns403()
    {
        var s = await SeedFlowAsync();
        var access = CompanyAccessContext.ForStaff(s.CompanyId, Guid.NewGuid(), Guid.NewGuid(), new Department(), new HashSet<Guid> { Guid.NewGuid() });
        var controller = new StatementReportsController(new NullStringLocalizer<ErrorMessages>(), access, new LedgerAggregator(s.Db), new ExportLabels(new NullStringLocalizer<ErrorMessages>()));

        var json = await controller.CashFlow(s.CompanyId, Jan1, Dec31);
        Assert.Equal(403, Assert.IsType<ObjectResult>(json.Result).StatusCode);
        var export = await controller.CashFlowExport(s.CompanyId, Jan1, Dec31);
        Assert.Equal(403, Assert.IsType<ObjectResult>(export).StatusCode);
    }

    [Fact]
    public async Task CashFlow_Export_IncludesSummaryRows()
    {
        var s = await SeedFlowAsync();
        var file = Assert.IsType<FileContentResult>(await Statements(s.Db).CashFlowExport(s.CompanyId, Jan1, Dec31));
        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(file.FileContents));
        var sheet = workbook.Worksheet(1);
        Assert.Equal("Amount", sheet.Cell(1, 4).GetString());
        var last = sheet.LastRowUsed()!.RowNumber();
        Assert.Equal("Difference", sheet.Cell(last, 3).GetString());
        Assert.Equal(0m, sheet.Cell(last, 4).GetValue<decimal>());
    }

    [Fact]
    public async Task Equity_ClosingEqualsBalanceSheetEquity()
    {
        var s = await SeedFlowAsync();
        var result = await Statements(s.Db).EquityStatement(s.CompanyId, Jan1, Dec31);
        var r = Assert.IsType<EquityStatementResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var bs = await new LedgerAggregator(s.Db).BalanceSheetAsync(s.CompanyId, Dec31);

        Assert.Equal(5000m, r.OpeningEquity);
        Assert.Equal(-200m, Assert.Single(r.Movements).Amount);
        Assert.Equal(5900m, r.ClosingEquity);
        Assert.Equal(bs.TotalEquity, r.ClosingEquity);
    }

    [Fact]
    public async Task Equity_NetIncomeMatchesProfitAndLoss_Check2()
    {
        var s = await SeedFlowAsync();
        var result = await Statements(s.Db).EquityStatement(s.CompanyId, Jan1, Dec31);
        var r = Assert.IsType<EquityStatementResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var pnl = Assert.IsType<ProfitAndLossResponse>(Assert.IsType<OkObjectResult>((await Reports(s.Db).ProfitAndLoss(s.CompanyId, Jan1, Dec31)).Result).Value);

        Assert.Equal(1100m, pnl.NetIncome);
        Assert.Equal(pnl.NetIncome, r.NetIncome);
    }

    [Fact]
    public async Task Equity_FromAfterTo_Returns400()
    {
        var s = await SeedFlowAsync();
        var result = await Statements(s.Db).EquityStatement(s.CompanyId, Dec31, Jan1);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Equity_Export_EndsWithClosingEquity()
    {
        var s = await SeedFlowAsync();
        var file = Assert.IsType<FileContentResult>(await Statements(s.Db).EquityStatementExport(s.CompanyId, Jan1, Dec31));
        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(file.FileContents));
        var sheet = workbook.Worksheet(1);
        var last = sheet.LastRowUsed()!.RowNumber();
        Assert.Equal("Closing Equity", sheet.Cell(last, 3).GetString());
        Assert.Equal(5900m, sheet.Cell(last, 4).GetValue<decimal>());
    }

    [Fact]
    public async Task CashFlow_FromMinValue_ReturnsZeroOpeningAndSucceeds()
    {
        var s = await SeedFlowAsync();
        var result = await Statements(s.Db).CashFlow(s.CompanyId, DateOnly.MinValue, Dec31);
        var r = Assert.IsType<CashFlowResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

        Assert.Equal(0m, r.OpeningCash);
        Assert.Equal(6400m, r.ClosingCash);
        Assert.Equal(6400m, r.NetChange);
        Assert.Equal(0m, r.Difference);
    }

    [Fact]
    public async Task Equity_FromMinValue_ReturnsZeroOpeningAndSucceeds()
    {
        var s = await SeedFlowAsync();
        var result = await Statements(s.Db).EquityStatement(s.CompanyId, DateOnly.MinValue, Dec31);
        var r = Assert.IsType<EquityStatementResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var bs = await new LedgerAggregator(s.Db).BalanceSheetAsync(s.CompanyId, Dec31);

        Assert.Equal(0m, r.OpeningEquity);
        Assert.Equal(5900m, r.ClosingEquity);
        Assert.Equal(bs.TotalEquity, r.ClosingEquity);
    }

    [Fact]
    public async Task MonthlyPnl_SectionMonthlyAndYearTotals()
    {
        var s = await SeedAsync();
        var r = await MonthlyAsync(s.Db, s.CompanyId, 2026);

        Assert.Equal(12, r.IncomeByMonth.Count);
        Assert.Equal(12, r.CostOfRevenueByMonth.Count);
        Assert.Equal(12, r.ExpensesByMonth.Count);
        Assert.Equal(1000m, r.IncomeByMonth[0]);
        Assert.Equal(2000m, r.IncomeByMonth[2]);
        Assert.Equal(300m, r.CostOfRevenueByMonth[0]);
        Assert.Equal(600m, r.CostOfRevenueByMonth[11]);
        Assert.Equal(400m, r.ExpensesByMonth[2]);
        Assert.Equal(3000m, r.TotalIncome);
        Assert.Equal(900m, r.TotalCostOfRevenue);
        Assert.Equal(400m, r.TotalExpenses);
        Assert.Equal(r.TotalIncome - r.TotalCostOfRevenue, r.GrossProfit);
        Assert.Equal(r.GrossProfit - r.TotalExpenses, r.NetIncome);
    }

    [Fact]
    public async Task Comparative_SectionTotalsCurrentPriorDifference()
    {
        var s = await SeedAsync();

        var result = await Statements(s.Db).BalanceSheetComparative(s.CompanyId, new DateOnly(2026, 12, 31), new DateOnly(2025, 12, 31));
        var c = Assert.IsType<BalanceSheetComparativeResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

        Assert.Equal(2200m, c.AssetsTotals.Current);
        Assert.Equal(500m, c.AssetsTotals.Prior);
        Assert.Equal(1700m, c.AssetsTotals.Difference);
        Assert.Equal(0m, c.LiabilitiesTotals.Current);
        Assert.Equal(0m, c.LiabilitiesTotals.Difference);
        Assert.Equal(2200m, c.EquityTotals.Current);
        Assert.Equal(500m, c.EquityTotals.Prior);
        Assert.Equal(1700m, c.EquityTotals.Difference);
        Assert.Equal(c.Equity.Sum(l => l.Current), c.EquityTotals.Current);
        Assert.Equal(c.Assets.Sum(l => l.Prior), c.AssetsTotals.Prior);
    }
}
