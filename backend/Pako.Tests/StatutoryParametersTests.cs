using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Payroll;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Tests;

public class StatutoryParametersTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    // ---- Resolver (pure) ----

    [Fact]
    public void Defaults_MatchTheLegacyConstants()
    {
        var resolved = StatutoryParameterResolver.Resolve(KosovoStatutoryDefaults.All, new DateOnly(2026, 10, 1));
        var legacy = KosovoPersonalIncomeTaxBrackets.Brackets;

        var brackets = resolved.ToRates().AnnualPitBrackets;
        Assert.Equal(legacy.Count, brackets.Count);
        for (var i = 0; i < legacy.Count; i++)
        {
            Assert.Equal(legacy[i].LowerBoundEurPerYear, brackets[i].LowerBound);
            Assert.Equal(legacy[i].UpperBoundEurPerYear, brackets[i].UpperBound);
            Assert.Equal(legacy[i].Rate, brackets[i].Rate);
        }

        Assert.Equal(KosovoPensionContribution.EmployeeRate, resolved.PensionEmployeeRate);
        Assert.Equal(KosovoPensionContribution.EmployerRate, resolved.PensionEmployerRate);
        Assert.Equal(KosovoPayrollRules.SecondaryEmployerFlatRate, resolved.SecondaryEmployerRate);
        Assert.Equal(KosovoPayrollRules.MinimumWageOn(new DateOnly(2026, 10, 1)), resolved.MinimumWage);
    }

    [Fact]
    public void Defaults_GiveTheSameSlipAsTheLegacyRates()
    {
        var legacyRates = new PayrollStatutoryRates(
            KosovoPersonalIncomeTaxBrackets.Brackets.Select(b => new PitBracket(b.LowerBoundEurPerYear, b.UpperBoundEurPerYear, b.Rate)).ToList(),
            KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate, KosovoPayrollRules.SecondaryEmployerFlatRate);
        var resolvedRates = StatutoryParameterResolver.Resolve(KosovoStatutoryDefaults.All, new DateOnly(2026, 10, 1)).ToRates();
        var calc = new PayrollCalculationService();

        foreach (var gross in new[] { 0m, 250m, 263.16m, 450m, 500m, 1000m, 1050m, 2200m, 15000m })
        foreach (var primary in new[] { true, false })
        {
            var input = new PayslipInput(gross, 120m, 30m, primary);
            Assert.Equal(calc.Compute(input, legacyRates), calc.Compute(input, resolvedRates));
        }
    }

    [Fact]
    public void Resolve_TakesTheNewestValue_AndAnOverrideWinsOnTheSameDate()
    {
        var values = new List<DatedParameterValue>(KosovoStatutoryDefaults.All)
        {
            new(StatutoryParameterKeys.MinimumWage, new DateOnly(2027, 1, 1), 550m, IsOverride: true),
            new(StatutoryParameterKeys.MinimumWage, new DateOnly(2026, 7, 1), 510m, IsOverride: true)
        };

        Assert.Equal(425m, StatutoryParameterResolver.Resolve(values, new DateOnly(2026, 6, 30)).MinimumWage);
        Assert.Equal(510m, StatutoryParameterResolver.Resolve(values, new DateOnly(2026, 7, 1)).MinimumWage);
        Assert.Equal(550m, StatutoryParameterResolver.Resolve(values, new DateOnly(2027, 3, 1)).MinimumWage);
    }

    // ---- Through the API (Postgres) ----

    private record Seed(PakoDbContext Db, Guid FirmId, Guid CompanyId);

    private async Task<Seed> SeedAsync(bool withFirm = true)
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var firm = new Firm { Id = Guid.NewGuid(), Name = "Firm" };
        db.Firms.Add(firm);
        var company = new Company { Id = Guid.NewGuid(), Name = "Co", FirmId = withFirm ? firm.Id : null };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return new Seed(db, firm.Id, company.Id);
    }

    private static StatutoryParametersController Controller(PakoDbContext db) =>
        new(db, new PayrollParameterProvider(db), new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"))
                }
            }
        };

    [Fact]
    public async Task FirmOverride_AppliesToItsCompanies_FromItsDate()
    {
        var seed = await SeedAsync();
        var created = await Controller(seed.Db).Create(seed.FirmId,
            new CreateStatutoryParameterRequest(StatutoryParameterKeys.PensionEmployerRate, new DateOnly(2026, 11, 1), 0.06m, "Test decision"));
        Assert.IsType<ObjectResult>(created.Result);

        var provider = new PayrollParameterProvider(seed.Db);
        Assert.Equal(0.05m, (await provider.ForCompanyAsync(seed.CompanyId, new DateOnly(2026, 10, 31))).PensionEmployerRate);
        Assert.Equal(0.06m, (await provider.ForCompanyAsync(seed.CompanyId, new DateOnly(2026, 11, 30))).PensionEmployerRate);

        var list = Assert.IsType<OkObjectResult>((await Controller(seed.Db).List(seed.FirmId)).Result).Value as List<StatutoryParameterResponse>;
        Assert.Contains(list!, r => r.IsOverride && r.Key == StatutoryParameterKeys.PensionEmployerRate && r.Value == 0.06m);
        Assert.Contains(list!, r => !r.IsOverride && r.Key == StatutoryParameterKeys.MinimumWage && r.Value == 500m);
    }

    [Fact]
    public async Task FirmOverride_DoesNotReachACompanyOutsideTheFirm()
    {
        var seed = await SeedAsync(withFirm: false);
        await Controller(seed.Db).Create(seed.FirmId,
            new CreateStatutoryParameterRequest(StatutoryParameterKeys.MinimumWage, new DateOnly(2026, 8, 1), 999m, null));

        var resolved = await new PayrollParameterProvider(seed.Db).ForCompanyAsync(seed.CompanyId, new DateOnly(2026, 10, 1));
        Assert.Equal(500m, resolved.MinimumWage);
    }

    [Theory]
    [InlineData("NoSuchKey", 1)]
    [InlineData(StatutoryParameterKeys.PensionEmployeeRate, 5)] // 5 instead of 0.05.
    [InlineData(StatutoryParameterKeys.MinimumWage, -1)]
    public async Task Create_RejectsInvalidValues(string key, decimal value)
    {
        var seed = await SeedAsync();
        var result = await Controller(seed.Db).Create(seed.FirmId, new CreateStatutoryParameterRequest(key, new DateOnly(2026, 1, 1), value, null));
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_RejectsASecondValueOnTheSameDate()
    {
        var seed = await SeedAsync();
        var request = new CreateStatutoryParameterRequest(StatutoryParameterKeys.MinimumWage, new DateOnly(2027, 1, 1), 550m, null);
        await Controller(seed.Db).Create(seed.FirmId, request);
        Assert.IsType<BadRequestObjectResult>((await Controller(seed.Db).Create(seed.FirmId, request)).Result);
    }
}
