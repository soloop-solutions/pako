using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Assets;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

// Client feedback 2026-11: fixed assets v1 — the straight-line calculator and the register,
// depreciation runs, disposals and year-end schedule through the controller, on real Postgres
// (the filtered unique index on posted runs and the CHECK constraint matter).
public class StraightLineDepreciationTests
{
    private static readonly DateOnly InService = new(2026, 1, 15);

    [Fact]
    public void StartsTheMonthAfterInService_AndSpreadsTheBaseEvenly()
    {
        // 1,200 − 0 over 12 months: 100 a month from February.
        Assert.Equal(0m, StraightLineDepreciation.AmountFor(1200m, 0m, 12, InService, new DateOnly(2026, 1, 1), 0m));
        Assert.Equal(100m, StraightLineDepreciation.AmountFor(1200m, 0m, 12, InService, new DateOnly(2026, 2, 1), 0m));
        var schedule = StraightLineDepreciation.Schedule(1200m, 0m, 12, InService);
        Assert.Equal(12, schedule.Count);
        Assert.Equal(new DateOnly(2026, 2, 1), schedule[0].Period);
        Assert.Equal(new DateOnly(2027, 1, 1), schedule[^1].Period);
        Assert.All(schedule, l => Assert.Equal(100m, l.Amount));
        Assert.Equal(0m, schedule[^1].BookValue);
    }

    [Fact]
    public void RoundingNeverAccumulates_AndTheLastMonthTakesTheRest()
    {
        // 1,000 − 100 residual over 7 months = 128.571428…
        var schedule = StraightLineDepreciation.Schedule(1000m, 100m, 7, InService);
        Assert.Equal(7, schedule.Count);
        Assert.Equal(900m, schedule.Sum(l => l.Amount));
        Assert.All(schedule, l => Assert.InRange(l.Amount, 128.57m, 128.58m));
        Assert.Equal(100m, schedule[^1].BookValue);
        Assert.Equal(128.57m, StraightLineDepreciation.MonthlyAmount(1000m, 100m, 7));
    }

    [Fact]
    public void SkippedMonthsAreCaughtUp_AndNothingPassesTheBase()
    {
        // Nothing posted for February and March: April takes three months.
        Assert.Equal(300m, StraightLineDepreciation.AmountFor(1200m, 0m, 12, InService, new DateOnly(2026, 4, 1), 0m));
        // Already fully depreciated (opening from before Pako): nothing more.
        Assert.Equal(0m, StraightLineDepreciation.AmountFor(1200m, 0m, 12, InService, new DateOnly(2026, 5, 1), 1200m));
        Assert.Equal(1200m, StraightLineDepreciation.DueThrough(1200m, 0m, 12, InService, new DateOnly(2030, 1, 1)));
    }

    [Fact]
    public void Schedule_ContinuesFromOpeningAccumulatedDepreciation()
    {
        var schedule = StraightLineDepreciation.Schedule(1200m, 0m, 12, InService, openingAccumulated: 500m);
        // Due by June is 500: depreciation resumes in July.
        Assert.Equal(new DateOnly(2026, 7, 1), schedule[0].Period);
        Assert.Equal(100m, schedule[0].Amount);
        Assert.Equal(1200m, schedule[^1].Accumulated);
    }

    [Fact]
    public void Disposal_SplitsGainAndLossAgainstTheBookValue()
    {
        Assert.Equal((400m, 100m, 0m), StraightLineDepreciation.Disposal(1000m, 600m, 500m));
        Assert.Equal((400m, 0m, 400m), StraightLineDepreciation.Disposal(1000m, 600m, 0m));
    }

    [Fact]
    public void RollForward_SplitsOpeningAdditionsDepreciationAndDisposals()
    {
        var posted = new[] { (new DateOnly(2025, 12, 1), 50m), (new DateOnly(2026, 1, 1), 50m), (new DateOnly(2026, 2, 1), 50m) };
        var bought2025 = FixedAssetRollForward.ForYear(2026, new DateOnly(2025, 6, 1), null, 1000m, 100m, posted)!;
        Assert.Equal(new AssetYearAmounts(1000m, 0m, 0m, 1000m, 150m, 100m, 0m, 250m, 850m, 750m), bought2025);

        var disposed = FixedAssetRollForward.ForYear(2026, new DateOnly(2025, 6, 1), new DateOnly(2026, 3, 10), 1000m, 100m, posted)!;
        Assert.Equal(new AssetYearAmounts(1000m, 0m, 1000m, 0m, 150m, 100m, 250m, 0m, 850m, 0m), disposed);

        var bought2026 = FixedAssetRollForward.ForYear(2026, new DateOnly(2026, 5, 1), null, 600m, 0m, Array.Empty<(DateOnly, decimal)>())!;
        Assert.Equal(600m, bought2026.Additions);
        Assert.Equal(0m, bought2026.CostOpening);

        Assert.Null(FixedAssetRollForward.ForYear(2026, new DateOnly(2027, 1, 1), null, 600m, 0m, posted));
        Assert.Null(FixedAssetRollForward.ForYear(2026, new DateOnly(2024, 1, 1), new DateOnly(2025, 12, 31), 600m, 0m, posted));
    }
}

public class FixedAssetsControllerTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, Guid CompanyId, Dictionary<string, Guid> Accounts);

    private async Task<Seed> SeedAsync(bool withResultAccounts = true)
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Asset Co" };
        db.Companies.Add(company);

        var accounts = new Dictionary<string, Guid>();
        void Add(string code, string name, AccountType type, AccountSubType sub = AccountSubType.None)
        {
            var id = Guid.NewGuid();
            accounts[code] = id;
            db.Accounts.Add(new Account { Id = id, CompanyId = company.Id, Code = code, Name = name, AccountType = type, AccountSubType = sub });
        }

        Add("150100", "Land", AccountType.FixedAsset);
        Add("152100", "Machinery", AccountType.FixedAsset);
        Add("159200", "Accumulated depreciation - machinery", AccountType.FixedAsset);
        Add("650200", "Machinery depreciation", AccountType.Expense);
        Add("155100", "Computers", AccountType.FixedAsset);
        Add("159600", "Accumulated depreciation - computers", AccountType.FixedAsset);
        Add("650500", "Computer depreciation", AccountType.Expense);
        Add("102100", "Bank", AccountType.Cash, AccountSubType.Bank);
        if (withResultAccounts)
        {
            Add("420300", "Gain on sale of assets", AccountType.Income);
            Add("661500", "Loss on sale of assets", AccountType.Expense);
        }

        db.Journals.Add(new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 });
        await db.SaveChangesAsync();
        return new Seed(db, company.Id, accounts);
    }

    private static FixedAssetsController Controller(PakoDbContext db) =>
        new(db, new NumberSeriesService(db), new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"))
                }
            }
        };

    private static T Created<T>(ActionResult<T> result) => Assert.IsType<T>(Assert.IsType<ObjectResult>(result.Result).Value);
    private static T Ok<T>(ActionResult<T> result) => Assert.IsType<T>(Assert.IsType<OkObjectResult>(result.Result).Value);
    private static string Bad<T>(ActionResult<T> result) => Assert.IsType<string>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);

    private static async Task<Guid> MachineryAsync(Seed s) =>
        Created(await Controller(s.Db).CreateCategory(s.CompanyId, new SaveAssetCategoryRequest(
            "Machinery", s.Accounts["152100"], true, s.Accounts["159200"], s.Accounts["650200"], 120))).Id;

    private static async Task<FixedAssetResponse> AssetAsync(Seed s, Guid categoryId, decimal cost = 1200m, int life = 12, string? code = null, decimal? opening = null) =>
        Created(await Controller(s.Db).Create(s.CompanyId, new SaveFixedAssetRequest(
            code, "CNC lathe", categoryId, new DateOnly(2026, 1, 10), new DateOnly(2026, 1, 15), cost, null, life, opening)));

    [Fact]
    public async Task DefaultCategories_ComeFromTheChart_AndAreNotDuplicated()
    {
        var s = await SeedAsync();
        var first = Ok(await Controller(s.Db).CreateDefaultCategories(s.CompanyId));
        // Land (not depreciated), machinery and computers exist in this chart; the rest are skipped.
        Assert.Equal(new[] { "Computers", "Land", "Machinery" }, first.Select(c => c.Name).ToArray());
        var land = first.Single(c => c.Name == "Land");
        Assert.False(land.IsDepreciable);
        Assert.Null(land.DepreciationExpenseAccountCode);
        var machinery = first.Single(c => c.Name == "Machinery");
        Assert.Equal(("152100", "159200", "650200", 120), (machinery.AssetAccountCode, machinery.AccumulatedDepreciationAccountCode, machinery.DepreciationExpenseAccountCode, machinery.DefaultUsefulLifeMonths));

        var second = Ok(await Controller(s.Db).CreateDefaultCategories(s.CompanyId));
        Assert.Equal(3, second.Count);
    }

    [Fact]
    public async Task Category_DepreciableNeedsBothDepreciationAccounts()
    {
        var s = await SeedAsync();
        var error = Bad(await Controller(s.Db).CreateCategory(s.CompanyId, new SaveAssetCategoryRequest("Machinery", s.Accounts["152100"], true, null, s.Accounts["650200"], 120)));
        Assert.Contains("accumulated depreciation account", error);
    }

    [Fact]
    public async Task Create_NumbersTheAssetFromTheSeries_AndTakesTheCategoryLife()
    {
        var s = await SeedAsync();
        var category = await MachineryAsync(s);
        var first = Created(await Controller(s.Db).Create(s.CompanyId, new SaveFixedAssetRequest(
            null, "Lathe", category, new DateOnly(2026, 1, 10), new DateOnly(2026, 1, 15), 1200m)));
        var second = await AssetAsync(s, category);
        Assert.Equal("AS-00001", first.Code);
        Assert.Equal("AS-00002", second.Code);
        Assert.Equal(120, first.UsefulLifeMonths);
        Assert.Equal(10m, first.MonthlyDepreciation);
        Assert.Equal(1200m, first.BookValue);

        var taken = Bad(await Controller(s.Db).Create(s.CompanyId, new SaveFixedAssetRequest(
            "AS-00001", "Copy", category, new DateOnly(2026, 1, 10), new DateOnly(2026, 1, 15), 100m)));
        Assert.Equal("Another asset already has this code.", taken);
    }

    [Fact]
    public async Task Create_RejectsResidualAboveCost_AndInServiceBeforeAcquisition()
    {
        var s = await SeedAsync();
        var category = await MachineryAsync(s);
        Bad(await Controller(s.Db).Create(s.CompanyId, new SaveFixedAssetRequest(null, "X", category, new DateOnly(2026, 1, 10), new DateOnly(2026, 1, 15), 100m, 150m)));
        Bad(await Controller(s.Db).Create(s.CompanyId, new SaveFixedAssetRequest(null, "X", category, new DateOnly(2026, 1, 10), new DateOnly(2026, 1, 5), 100m)));
    }

    [Fact]
    public async Task Run_PostsOneBalancedEntryPerMonth_DrExpenseCrAccumulated()
    {
        var s = await SeedAsync();
        var category = await MachineryAsync(s);
        var asset = await AssetAsync(s, category);

        var preview = Ok(await Controller(s.Db).PreviewRun(s.CompanyId, new DateOnly(2026, 2, 20)));
        Assert.Equal(new DateOnly(2026, 2, 1), preview.Period);
        Assert.Equal(100m, preview.Total);
        Assert.Equal(("650200", "159200", 100m), (preview.Categories.Single().ExpenseAccountCode, preview.Categories.Single().AccumulatedAccountCode, preview.Categories.Single().Amount));

        var run = Created(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 2, 1))));
        Assert.Equal(100m, run.Total);
        var entry = await s.Db.JournalEntries.Include(e => e.Lines).AsNoTracking().SingleAsync(e => e.Id == run.JournalEntryId);
        Assert.Equal(new DateOnly(2026, 2, 28), entry.Date);
        Assert.Equal(JournalEntryState.Posted, entry.State);
        Assert.Equal(100m, entry.Lines.Single(l => l.AccountId == s.Accounts["650200"]).Debit);
        Assert.Equal(100m, entry.Lines.Single(l => l.AccountId == s.Accounts["159200"]).Credit);

        var again = Bad(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 2, 1))));
        Assert.Equal("Depreciation for this month is already posted.", again);

        var detail = Ok(await Controller(s.Db).Get(s.CompanyId, asset.Id));
        Assert.Equal(100m, detail.Asset.AccumulatedDepreciation);
        Assert.Equal(new DateOnly(2026, 2, 1), detail.Asset.LastDepreciatedPeriod);
        Assert.True(detail.Schedule[0].Posted);
        Assert.False(detail.Schedule[1].Posted);
    }

    [Fact]
    public async Task Run_CatchesUpASkippedMonth_AndRefusesAnEarlierMonth()
    {
        var s = await SeedAsync();
        var category = await MachineryAsync(s);
        await AssetAsync(s, category);

        var april = Created(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 4, 1))));
        Assert.Equal(300m, april.Total);
        var march = Bad(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 3, 1))));
        Assert.Contains("later month", march);
    }

    [Fact]
    public async Task Run_RespectsTheAccountingLockDate()
    {
        var s = await SeedAsync();
        var category = await MachineryAsync(s);
        await AssetAsync(s, category);
        var company = await s.Db.Companies.SingleAsync(c => c.Id == s.CompanyId);
        company.AccountingLockDate = new DateOnly(2026, 3, 31);
        await s.Db.SaveChangesAsync();

        Bad(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 2, 1))));
        Assert.Empty(await s.Db.DepreciationRuns.ToListAsync());
    }

    [Fact]
    public async Task Reverse_OnlyTheLatestRun_ThenTheMonthCanBePostedAgain()
    {
        var s = await SeedAsync();
        var category = await MachineryAsync(s);
        await AssetAsync(s, category);
        var february = Created(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 2, 1))));
        var march = Created(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 3, 1))));

        Assert.Contains("latest", Bad(await Controller(s.Db).ReverseRun(s.CompanyId, february.Id)));
        var reversed = Ok(await Controller(s.Db).ReverseRun(s.CompanyId, march.Id));
        Assert.Equal("Reversed", reversed.State);
        var storno = await s.Db.JournalEntries.Include(e => e.Lines).AsNoTracking().SingleAsync(e => e.Id == reversed.ReversalJournalEntryId);
        Assert.Equal(100m, storno.Lines.Single(l => l.AccountId == s.Accounts["159200"]).Debit);

        var again = Created(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 3, 1))));
        Assert.Equal(100m, again.Total);
    }

    [Fact]
    public async Task Update_AfterDepreciation_OnlyDescriptiveFieldsChange()
    {
        var s = await SeedAsync();
        var category = await MachineryAsync(s);
        var asset = await AssetAsync(s, category);
        Created(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 2, 1))));

        var request = new SaveFixedAssetRequest(asset.Code, "Renamed lathe", category, asset.AcquisitionDate, asset.InServiceDate, asset.Cost, 0m, 12, 0m, "SN-1", "Hall B");
        var renamed = Ok(await Controller(s.Db).Update(s.CompanyId, asset.Id, request));
        Assert.Equal(("Renamed lathe", "SN-1", "Hall B"), (renamed.Name, renamed.SerialNumber, renamed.Location));

        Assert.Contains("only its name", Bad(await Controller(s.Db).Update(s.CompanyId, asset.Id, request with { Cost = 1500m })));
        Assert.IsType<BadRequestObjectResult>(await Controller(s.Db).Delete(s.CompanyId, asset.Id));
    }

    [Fact]
    public async Task Dispose_WithProceeds_BooksTheGain()
    {
        var s = await SeedAsync();
        var category = await MachineryAsync(s);
        var asset = await AssetAsync(s, category, opening: 600m);

        // Cost 1,200, accumulated 600 (before Pako), sold for 700 → gain 100.
        var disposed = Ok(await Controller(s.Db).Dispose(s.CompanyId, asset.Id, new DisposeFixedAssetRequest(new DateOnly(2026, 3, 15), 700m, s.Accounts["102100"])));
        Assert.Equal("Disposed", disposed.Status);
        var entry = await s.Db.JournalEntries.Include(e => e.Lines).AsNoTracking().SingleAsync(e => e.Id == disposed.DisposalJournalEntryId);
        Assert.Equal(1200m, entry.Lines.Single(l => l.AccountId == s.Accounts["152100"]).Credit);
        Assert.Equal(600m, entry.Lines.Single(l => l.AccountId == s.Accounts["159200"]).Debit);
        Assert.Equal(700m, entry.Lines.Single(l => l.AccountId == s.Accounts["102100"]).Debit);
        Assert.Equal(100m, entry.Lines.Single(l => l.AccountId == s.Accounts["420300"]).Credit);

        Assert.Equal("This asset is already disposed.", Bad(await Controller(s.Db).Dispose(s.CompanyId, asset.Id, new DisposeFixedAssetRequest(new DateOnly(2026, 3, 20)))));
        // A disposed asset takes no further depreciation.
        Assert.Equal(0m, Ok(await Controller(s.Db).PreviewRun(s.CompanyId, new DateOnly(2026, 4, 1))).Total);
    }

    [Fact]
    public async Task Dispose_WithoutProceeds_BooksTheBookValueAsALoss_AndIsRefusedBeforeAPostedMonth()
    {
        var s = await SeedAsync();
        var category = await MachineryAsync(s);
        var asset = await AssetAsync(s, category);
        Created(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 3, 1))));

        Assert.Contains("after the disposal date", Bad(await Controller(s.Db).Dispose(s.CompanyId, asset.Id, new DisposeFixedAssetRequest(new DateOnly(2026, 2, 10)))));

        var disposed = Ok(await Controller(s.Db).Dispose(s.CompanyId, asset.Id, new DisposeFixedAssetRequest(new DateOnly(2026, 3, 31))));
        var entry = await s.Db.JournalEntries.Include(e => e.Lines).AsNoTracking().SingleAsync(e => e.Id == disposed.DisposalJournalEntryId);
        Assert.Equal(1000m, entry.Lines.Single(l => l.AccountId == s.Accounts["661500"]).Debit);
        Assert.Equal(200m, entry.Lines.Single(l => l.AccountId == s.Accounts["159200"]).Debit);
    }

    [Fact]
    public async Task Dispose_WithoutTheLossAccountInTheChart_SaysWhichAccountIsMissing()
    {
        var s = await SeedAsync(withResultAccounts: false);
        var category = await MachineryAsync(s);
        var asset = await AssetAsync(s, category);
        Assert.Contains("661500", Bad(await Controller(s.Db).Dispose(s.CompanyId, asset.Id, new DisposeFixedAssetRequest(new DateOnly(2026, 3, 31)))));
    }

    [Fact]
    public async Task Schedule_RollsCostAndDepreciationForwardWithTotals()
    {
        var s = await SeedAsync();
        var category = await MachineryAsync(s);
        var a = await AssetAsync(s, category);
        await AssetAsync(s, category, cost: 2400m, life: 24);
        Created(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 2, 1))));
        Created(await Controller(s.Db).PostRun(s.CompanyId, new PostDepreciationRunRequest(new DateOnly(2026, 3, 1))));

        var schedule = Ok(await Controller(s.Db).Schedule(s.CompanyId, 2026));
        Assert.Equal(2, schedule.Lines.Count);
        var line = schedule.Lines.Single(l => l.FixedAssetId == a.Id).Amounts;
        Assert.Equal((0m, 1200m, 200m, 1000m), (line.CostOpening, line.Additions, line.Depreciation, line.BookValueClosing));
        Assert.Equal(3600m, schedule.Total.Additions);
        Assert.Equal(400m, schedule.Total.Depreciation);
        Assert.Equal(3200m, schedule.Total.BookValueClosing);
        Assert.Equal(400m, schedule.Categories.Single().Amounts.Depreciation);

        var export = Assert.IsType<FileContentResult>(await Controller(s.Db).ScheduleExport(s.CompanyId, 2026));
        Assert.NotEmpty(export.FileContents);
    }
}
