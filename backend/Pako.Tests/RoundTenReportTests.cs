using System.Globalization;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Reporting;
using Pako.Infrastructure;

namespace Pako.Tests;

public class RoundTenReportTests : IAsyncLifetime
{
    private static readonly DateOnly From = new(2026, 1, 1);
    private static readonly DateOnly To = new(2026, 1, 31);

    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, Company Company, Journal General, Journal Bank, Account Cash, Account Revenue, Account CostOfRevenue, Account Rent);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        Account Acc(string code, string name, AccountType type, int cls) =>
            new() { Id = Guid.NewGuid(), CompanyId = company.Id, Code = code, Name = name, AccountType = type, Class = cls };
        var cash = Acc("1000", "Cash", AccountType.CurrentAsset, 1);
        var revenue = Acc("4000", "Revenue", AccountType.Income, 4);
        var cogs = Acc("5000", "Cost of goods", AccountType.CostOfRevenue, 5);
        var rent = Acc("6000", "Rent", AccountType.Expense, 6);
        var general = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        var bank = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Bank, Code = "BNK", Name = "Bank" };
        var root = new AccountGroup { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Root", CodePrefixStart = "0", CodePrefixEnd = "9999" };
        var assets = new AccountGroup { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Assets", CodePrefixStart = "1000", CodePrefixEnd = "1999", ParentGroupId = root.Id };
        var income = new AccountGroup { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Revenue group", CodePrefixStart = "4000", CodePrefixEnd = "4999", ParentGroupId = root.Id };
        db.Companies.Add(company);
        db.Accounts.AddRange(cash, revenue, cogs, rent);
        db.Journals.AddRange(general, bank);
        db.AccountGroups.AddRange(root, assets, income);
        var seed = new Seed(db, company, general, bank, cash, revenue, cogs, rent);
        AddEntry(seed, general, new DateOnly(2025, 12, 20), cash, revenue, 200m);
        AddEntry(seed, general, new DateOnly(2026, 1, 10), cash, revenue, 1000m);
        AddEntry(seed, general, new DateOnly(2026, 1, 15), cogs, cash, 400m);
        AddEntry(seed, general, new DateOnly(2026, 1, 20), rent, cash, 150m);
        await db.SaveChangesAsync();
        return seed;
    }

    private static void AddEntry(Seed s, Journal journal, DateOnly date, Account debit, Account credit, decimal amount)
    {
        var entry = new JournalEntry { Id = Guid.NewGuid(), CompanyId = s.Company.Id, JournalId = journal.Id, Date = date };
        entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = debit.Id, Debit = amount, Credit = 0m });
        entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = credit.Id, Debit = 0m, Credit = amount });
        entry.Post(s.Company);
        s.Db.JournalEntries.Add(entry);
    }

    private static ExportLabels Labels() => new(new NullStringLocalizer<ErrorMessages>());

    private static LedgerController Ledger(PakoDbContext db) => new(db, new NullStringLocalizer<ErrorMessages>(), Labels());

    private static ReportsController Reports(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(db), Labels());

    private static async Task<T> WithCultureAsync<T>(string culture, Func<Task<T>> action)
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = new CultureInfo(culture);
        try
        {
            return await action();
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    private static IXLWorksheet Sheet(IActionResult result) =>
        new XLWorkbook(new MemoryStream(Assert.IsType<FileContentResult>(result).FileContents)).Worksheet(1);

    [Fact]
    public async Task ProfitAndLoss_GrossProfitIsIncomeMinusCostOfRevenue_ExistingFieldsUnchanged()
    {
        var s = await SeedAsync();

        var pnl = Assert.IsType<ProfitAndLossResponse>(Assert.IsType<OkObjectResult>((await Reports(s.Db).ProfitAndLoss(s.Company.Id, From, To)).Result).Value);

        Assert.Equal(1000m, pnl.TotalIncome);
        var cost = Assert.Single(pnl.CostOfRevenue);
        Assert.Equal("5000", cost.AccountCode);
        Assert.Equal(400m, cost.Amount);
        Assert.Equal(400m, pnl.TotalCostOfRevenue);
        Assert.Equal(600m, pnl.GrossProfit);
        Assert.Equal(new[] { "5000", "6000" }, pnl.Expenses.Select(l => l.AccountCode));
        Assert.Equal(550m, pnl.TotalExpenses);
        Assert.Equal(450m, pnl.NetIncome);
    }

    [Fact]
    public async Task ProfitAndLossExport_HasCostOfRevenueAndGrossProfitRows()
    {
        var s = await SeedAsync();

        var en = await WithCultureAsync("en", async () => Sheet(await Reports(s.Db).ProfitAndLossExport(s.Company.Id, From, To)));
        var sq = await WithCultureAsync("sq", async () => Sheet(await Reports(s.Db).ProfitAndLossExport(s.Company.Id, From, To)));

        Assert.Equal(600m, en.RowsUsed().Single(r => r.Cell(3).GetString() == "Gross Profit").Cell(4).GetValue<decimal>());
        Assert.Equal(400m, en.RowsUsed().Single(r => r.Cell(3).GetString() == "Total cost of revenue").Cell(4).GetValue<decimal>());
        Assert.Equal(600m, sq.RowsUsed().Single(r => r.Cell(3).GetString() == "Fitimi bruto").Cell(4).GetValue<decimal>());
        Assert.Equal(450m, en.RowsUsed().Single(r => r.Cell(3).GetString() == "Net Income").Cell(4).GetValue<decimal>());
    }

    [Fact]
    public void PeriodProfitAndLoss_Calculate_ReturnsGrossProfit()
    {
        var r = PeriodProfitAndLoss.Calculate(new[] { 700m, 300.50m }, new[] { 250.25m, 49.75m });

        Assert.Equal(1000.50m, r.TotalIncome);
        Assert.Equal(300m, r.TotalCostOfRevenue);
        Assert.Equal(700.50m, r.GrossProfit);
    }

    [Fact]
    public async Task TrialBalanceExport_HasSubtotalAfterEachGroupAndGrandTotal()
    {
        var s = await SeedAsync();

        var en = await WithCultureAsync("en", async () => Sheet(await Ledger(s.Db).TrialBalanceExport(s.Company.Id, From, To)));
        var sq = await WithCultureAsync("sq", async () => Sheet(await Ledger(s.Db).TrialBalanceExport(s.Company.Id, From, To)));

        string[] Labelled(IXLWorksheet sheet) => sheet.RowsUsed().Skip(1).Select(r => r.Cell(1).GetString()).ToArray();
        Assert.Equal(
            new[] { "1000", "Total Assets", "4000", "Total Revenue group", "5000", "Total Class 5", "6000", "Total Class 6", "Total" },
            Labelled(en));
        Assert.Equal(
            new[] { "1000", "Gjithsejt Assets", "4000", "Gjithsejt Revenue group", "5000", "Gjithsejt Klasa 5", "6000", "Gjithsejt Klasa 6", "Gjithsejt" },
            Labelled(sq));

        decimal[] Amounts(IXLRow r) => Enumerable.Range(3, 4).Select(c => r.Cell(c).GetValue<decimal>()).ToArray();
        var rows = en.RowsUsed().ToDictionary(r => r.Cell(1).GetString(), r => r);
        Assert.Equal(new[] { 200m, 1000m, 550m, 650m }, Amounts(rows["Total Assets"]));
        Assert.Equal(new[] { -200m, 0m, 1000m, -1200m }, Amounts(rows["Total Revenue group"]));
        Assert.Equal(new[] { 0m, 400m, 0m, 400m }, Amounts(rows["Total Class 5"]));
        Assert.Equal(new[] { 0m, 150m, 0m, 150m }, Amounts(rows["Total Class 6"]));
        Assert.Equal(new[] { 0m, 1550m, 1550m, 0m }, Amounts(rows["Total"]));
    }

    [Fact]
    public async Task TrialBalanceTotals_MatchesGrandTotalRow_AndRejectsInvertedRange()
    {
        var s = await SeedAsync();

        var totals = Assert.IsType<TrialBalanceTotals>(Assert.IsType<OkObjectResult>((await Ledger(s.Db).TrialBalanceTotalsAction(s.Company.Id, From, To)).Result).Value);

        Assert.Equal(new TrialBalanceTotals(0m, 1550m, 1550m, 0m), totals);
        Assert.IsType<BadRequestObjectResult>((await Ledger(s.Db).TrialBalanceTotalsAction(s.Company.Id, To, From)).Result);
    }

    [Fact]
    public void TrialBalanceCalculator_Groups_KeepsFirstAppearanceOrderAndSumsPerGroup()
    {
        var lines = new (string Code, int? Class, string? Group, decimal Debit)[]
        {
            ("1", 1, "A", 10m), ("2", 2, null, 5m), ("3", 1, "A", 7.5m), ("4", 1, "B", 1m)
        };

        var groups = TrialBalanceCalculator.Groups(lines, l => l.Class, l => l.Group, l => new TrialBalanceAmounts(0m, l.Debit, 0m, l.Debit, l.Debit));

        Assert.Equal(new[] { "A", null, "B" }, groups.Select(g => g.GroupName));
        Assert.Equal(17.5m, groups[0].Total.Debit);
        Assert.Equal(new[] { "1", "3" }, groups[0].Lines.Select(l => l.Code));
    }

    [Fact]
    public async Task TrialBalanceExport_FileNameCarriesThePeriod()
    {
        var s = await SeedAsync();

        Assert.Equal("trial-balance-20260101-20260131.xlsx", Assert.IsType<FileContentResult>(await Ledger(s.Db).TrialBalanceExport(s.Company.Id, From, To)).FileDownloadName);
        Assert.Equal("trial-balance-to-20260131.xlsx", Assert.IsType<FileContentResult>(await Ledger(s.Db).TrialBalanceExport(s.Company.Id, null, To)).FileDownloadName);
        Assert.Equal("trial-balance.xlsx", Assert.IsType<FileContentResult>(await Ledger(s.Db).TrialBalanceExport(s.Company.Id)).FileDownloadName);
    }

    [Fact]
    public async Task ComparativeAndGeneralLedgerExports_FileNamesCarryThePeriod()
    {
        var s = await SeedAsync();
        var statements = new StatementReportsController(new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(s.Db), Labels());
        var gl = new GeneralLedgerReportController(s.Db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), Labels());

        Assert.Equal("balance-sheet-comparative-20260131-20251231.xlsx",
            Assert.IsType<FileContentResult>(await statements.BalanceSheetComparativeExport(s.Company.Id, To, new DateOnly(2025, 12, 31))).FileDownloadName);
        Assert.Equal("general-ledger-20260101-20260131.xlsx",
            Assert.IsType<FileContentResult>(await gl.GeneralLedgerExport(s.Company.Id, From, To, null, null)).FileDownloadName);
    }

    [Fact]
    public async Task GeneralLedgerExport_DocumentTypeCellsTranslateUnderSqAndStayEnglishUnderEn()
    {
        var s = await SeedAsync();
        AddEntry(s, s.Bank, new DateOnly(2026, 1, 25), s.Cash, s.Revenue, 10m);
        await s.Db.SaveChangesAsync();
        var gl = new GeneralLedgerReportController(s.Db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), Labels());

        var en = await WithCultureAsync("en", async () => Sheet(await gl.GeneralLedgerExport(s.Company.Id, From, To, null, null)));
        var sq = await WithCultureAsync("sq", async () => Sheet(await gl.GeneralLedgerExport(s.Company.Id, From, To, null, null)));

        var enTypes = en.RowsUsed().Skip(1).Select(r => r.Cell(3).GetString()).Where(t => t.Length > 0).Distinct().OrderBy(t => t).ToArray();
        var sqTypes = sq.RowsUsed().Skip(1).Select(r => r.Cell(3).GetString()).Where(t => t.Length > 0).Distinct().OrderBy(t => t).ToArray();
        Assert.Equal(new[] { "Manual", "Payment" }, enTypes);
        Assert.Equal(new[] { "Manual", "Pagesë" }, sqTypes);

        var json = Assert.IsType<GeneralLedgerResponse>(Assert.IsType<OkObjectResult>((await gl.GeneralLedger(s.Company.Id, From, To, null, null)).Result).Value);
        Assert.Contains(json.Items, i => i.DocumentType == "Payment");
    }

    [Fact]
    public void EnumLabels_EveryDocumentTypeJournalTypeAndBucketHasEnglishAndAlbanianEntry()
    {
        var docTypes = Enum.GetNames<Pako.Domain.Invoicing.DocumentType>()
            .Concat(Enum.GetNames<Pako.Domain.Bills.DocumentType>().Select(n => n == "CreditNote" ? "SupplierCreditNote" : n))
            .Concat(new[] { "Other", "Payment", "Manual" })
            .Distinct()
            .Select(v => "Export_Enum_DocType_" + v);
        var journals = Enum.GetNames<JournalType>().Select(v => "Export_Enum_Journal_" + v);
        var buckets = new[] { "Current", "WithinGrace", "Overdue", "Over360" }.Select(v => "Export_Enum_Bucket_" + v);

        foreach (var culture in new[] { "en", "sq" })
        {
            var previous = CultureInfo.CurrentUICulture;
            CultureInfo.CurrentUICulture = new CultureInfo(culture);
            try
            {
                var localizer = new NullStringLocalizer<ErrorMessages>();
                foreach (var key in docTypes.Concat(journals).Concat(buckets))
                {
                    Assert.False(localizer[key].ResourceNotFound, $"{culture}: {key}");
                }
            }
            finally
            {
                CultureInfo.CurrentUICulture = previous;
            }
        }
    }
}
