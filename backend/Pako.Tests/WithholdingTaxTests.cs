using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Tests;

public class WithholdingTaxTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private async Task<(PakoDbContext Db, Guid CompanyId)> SeedCompanyAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return (db, company.Id);
    }

    private static WithholdingTaxController NewController(PakoDbContext db) => new(db, new NullStringLocalizer<ErrorMessages>());

    private static SaveWithholdingTaxEntryRequest Request(
        int year = 2025, string personalNumber = "1010391632", string name = "Ljubica Azemi",
        decimal interest = 0m, decimal propertyRights = 0m, decimal lottery = 0m, decimal rent = 0m,
        decimal entertainer = 0m, decimal services = 0m, decimal nonEntrepreneur = 0m,
        decimal? area = null, decimal? monthlyRent = null, string country = "Kosova") =>
        new(year, personalNumber, name, interest, propertyRights, lottery, rent, entertainer, services,
            nonEntrepreneur, area, monthlyRent, country);

    [Fact]
    public void WithheldTax_IsTenPercentOfInterestRightsAndLottery()
    {
        var entry = new WithholdingTaxEntry { GrossInterest = 9m, PropertyRights = 100m, LotteryWinnings = 50m };

        Assert.Equal(15.90m, entry.WithheldTax(0.10m));
    }

    [Fact]
    public void WithheldTax_DoesNotIncludeRent()
    {
        var entry = new WithholdingTaxEntry { GrossRent = 1000m };

        Assert.Equal(0m, entry.WithheldTax(0.10m));
    }

    [Fact]
    public void NonResidentWithheldTax_IsFivePercentOfEntertainerAndServices_RoundedAwayFromZero()
    {
        var entry = new WithholdingTaxEntry { NonResidentEntertainer = 10.10m, NonResidentServices = 0.10m };

        Assert.Equal(0.51m, entry.NonResidentWithheldTax(0.05m));
    }

    [Fact]
    public void Rates_ComeFromKosovoWithholdingRates()
    {
        Assert.Equal(0.10m, WithholdingDeclarationRates.Standard);
        Assert.Equal(0.05m, WithholdingDeclarationRates.NonResident);
    }

    [Fact]
    public async Task Create_ReturnsComputedWithholding()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, Request(interest: 9m, services: 200m, entertainer: 100m));

        var created = Assert.IsType<WithholdingTaxEntryResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(0.90m, created.WithheldTax);
        Assert.Equal(15.00m, created.NonResidentWithheldTax);
        Assert.Equal("Kosova", created.Country);
    }

    [Fact]
    public async Task Create_BlankCountry_DefaultsToKosova()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, Request(interest: 1m, country: " "));

        var created = Assert.IsType<WithholdingTaxEntryResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal("Kosova", created.Country);
    }

    [Fact]
    public async Task Create_RentWithoutAreaOrMonthlyRent_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, Request(rent: 100m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_RentWithAreaAndMonthlyRent_Succeeds()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, Request(rent: 100m, area: 29m, monthlyRent: 100m));

        var created = Assert.IsType<WithholdingTaxEntryResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(29m, created.RentalAreaM2);
        Assert.Equal(100m, created.MonthlyGrossRent);
    }

    [Fact]
    public async Task Create_NoRent_DropsRentalDetails()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, Request(interest: 5m, area: 29m, monthlyRent: 100m));

        var created = Assert.IsType<WithholdingTaxEntryResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Null(created.RentalAreaM2);
        Assert.Null(created.MonthlyGrossRent);
    }

    [Fact]
    public async Task Create_NegativeAmount_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, Request(interest: -1m));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_MissingNameOrPersonalNumber_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        Assert.IsType<BadRequestObjectResult>((await controller.Create(companyId, Request(name: " "))).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.Create(companyId, Request(personalNumber: ""))).Result);
    }

    [Fact]
    public async Task Create_UnknownCountry_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, Request(country: "Atlantis"));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task List_ScopesToCompanyAndYear_AndTotalsCoverAllPages()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var otherCompanyId = Guid.NewGuid();
        db.Companies.Add(new Company { Id = otherCompanyId, Name = "Other Co" });
        await db.SaveChangesAsync();
        var controller = NewController(db);

        await controller.Create(companyId, Request(name: "A", interest: 100m));
        await controller.Create(companyId, Request(name: "B", interest: 50m));
        await controller.Create(companyId, Request(year: 2024, name: "C", interest: 999m));
        await controller.Create(otherCompanyId, Request(name: "D", interest: 999m));

        var result = await controller.List(companyId, 2025, page: 1, pageSize: 1);

        var list = Assert.IsType<WithholdingTaxListResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(2, list.Total);
        Assert.Single(list.Items);
        Assert.Equal("A", list.Items[0].Name);
        Assert.Equal(150m, list.Totals.GrossInterest);
        Assert.Equal(15.00m, list.Totals.WithheldTax);
    }

    [Fact]
    public async Task Update_RecomputesWithholding_AndDelete_Removes()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var created = Assert.IsType<WithholdingTaxEntryResponse>(
            Assert.IsType<ObjectResult>((await controller.Create(companyId, Request(interest: 100m))).Result).Value);

        var updated = await controller.Update(companyId, created.Id, Request(interest: 200m));
        var response = Assert.IsType<WithholdingTaxEntryResponse>(Assert.IsType<OkObjectResult>(updated.Result).Value);
        Assert.Equal(20.00m, response.WithheldTax);

        Assert.IsType<NoContentResult>(await controller.Delete(companyId, created.Id));
        Assert.IsType<NotFoundResult>(await controller.Delete(companyId, created.Id));
    }

    [Fact]
    public async Task Get_EntryOfAnotherCompany_NotFound()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        var created = Assert.IsType<WithholdingTaxEntryResponse>(
            Assert.IsType<ObjectResult>((await controller.Create(companyId, Request(interest: 1m))).Result).Value);

        var result = await controller.Get(Guid.NewGuid(), created.Id);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Create_NameOver256Chars_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, Request(name: new string('x', 257)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_PersonalNumberOver50Chars_Rejected()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        var result = await controller.Create(companyId, Request(personalNumber: new string('1', 51)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1999)]
    [InlineData(2101)]
    public async Task ListAndExport_YearMissingOrOutOfRange_Rejected(int year)
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);

        Assert.IsType<BadRequestObjectResult>((await controller.List(companyId, year)).Result);
        Assert.IsType<BadRequestObjectResult>(await controller.Export(companyId, year));
    }

    [Fact]
    public async Task List_SearchTreatsPercentAndUnderscoreLiterally()
    {
        var (db, companyId) = await SeedCompanyAsync();
        var controller = NewController(db);
        await controller.Create(companyId, Request(name: "Alpha 100% Ltd", interest: 1m));
        await controller.Create(companyId, Request(name: "Alpha_Beta", interest: 1m));
        await controller.Create(companyId, Request(name: "Gamma", interest: 1m));

        async Task<List<string>> Names(string term)
        {
            var result = await controller.List(companyId, 2025, search: term);
            var list = Assert.IsType<WithholdingTaxListResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
            return list.Items.Select(i => i.Name).ToList();
        }

        Assert.Equal(new[] { "Alpha 100% Ltd" }, await Names("%"));
        Assert.Equal(new[] { "Alpha_Beta" }, await Names("_"));
        Assert.Empty(await Names("alp_a"));
        Assert.Equal(new[] { "Alpha_Beta" }, await Names("alpha_b"));
    }

    [Fact]
    public void Export_MatchesAtkTemplateStructure()
    {
        var entries = new List<WithholdingTaxEntry>
        {
            new()
            {
                PersonalNumber = "1010391632", Name = "Ljubica Azemi", GrossInterest = 9m, GrossRent = 100m,
                RentalAreaM2 = 29m, MonthlyGrossRent = 100m, Country = "Kosova"
            },
            new()
            {
                PersonalNumber = "0123456", Name = "Foreign Ltd", NonResidentServices = 1000m,
                NonResidentEntertainer = 200m, Country = "Shqiperia"
            }
        };

        var bytes = WithholdingTaxExportService.BuildWorkbook(entries, 0.10m, 0.05m);

        using var workbook = new XLWorkbook(new MemoryStream(bytes));
        var sheet = workbook.Worksheet(1);
        Assert.Equal("Sheet1", sheet.Name);

        for (var col = 1; col <= 15; col++)
        {
            Assert.Equal(WithholdingTaxExportService.Headers[col - 1], sheet.Cell(1, col).GetString());
            Assert.Equal("Segoe UI", sheet.Cell(1, col).Style.Font.FontName);
            Assert.Equal(9, sheet.Cell(1, col).Style.Font.FontSize);
        }

        Assert.Equal(63, sheet.Row(1).Height);
        Assert.Equal(XLFillPatternValues.Solid, sheet.Cell(2, 1).Style.Fill.PatternType);
        Assert.Equal(XLThemeColor.Background1, sheet.Cell(2, 1).Style.Fill.BackgroundColor.ThemeColor);
        Assert.Equal("Calibri Light", sheet.Cell(2, 1).Style.Font.FontName);
        Assert.Equal(8, sheet.Cell(2, 1).Style.Font.FontSize);
        Assert.Equal("7=(4+5+6)*10% ose % sipas METD", sheet.Cell(2, 7).GetString());
        Assert.Equal("11=(9+10)*5% ose % sipas METD", sheet.Cell(2, 11).GetString());
        foreach (var col in new[] { 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15 })
        {
            Assert.Equal(col, sheet.Cell(2, col).GetValue<int>());
        }

        Assert.Equal(9.109375, sheet.Column(1).Width, 3);
        Assert.Equal(14.6640625, sheet.Column(2).Width, 3);
        Assert.Equal(14.6640625, sheet.Column(14).Width, 3);
        Assert.Equal(21.77734375, sheet.Column(15).Width, 3);

        Assert.Equal(1, sheet.Cell(3, 1).GetValue<int>());
        Assert.Equal(1010391632L, sheet.Cell(3, 2).GetValue<long>());
        Assert.Equal("Ljubica Azemi", sheet.Cell(3, 3).GetString());
        Assert.Equal(9m, sheet.Cell(3, 4).GetValue<decimal>());
        Assert.Equal(0.90m, sheet.Cell(3, 7).GetValue<decimal>());
        Assert.Equal(100m, sheet.Cell(3, 8).GetValue<decimal>());
        Assert.Equal(29m, sheet.Cell(3, 13).GetValue<decimal>());
        Assert.Equal(100m, sheet.Cell(3, 14).GetValue<decimal>());
        Assert.False(sheet.Cell(3, 11).HasFormula);
        Assert.False(sheet.Cell(3, 7).HasFormula);

        Assert.Equal("0123456", sheet.Cell(4, 2).GetString());
        Assert.Equal(60m, sheet.Cell(4, 11).GetValue<decimal>());
        Assert.True(sheet.Cell(4, 13).IsEmpty());
        Assert.Equal("Shqiperia", sheet.Cell(4, 15).GetString());

        Assert.Equal(AtkCountries.Names[0], sheet.Cell(4, 21).GetString());
        Assert.Equal(AtkCountries.Names[^1], sheet.Cell(224, 21).GetString());
        var validation = sheet.Cell(3, 15).GetDataValidation();
        Assert.Equal(XLAllowedValues.List, validation.AllowedValues);
        Assert.Contains("$U$4:$U$224", validation.MinValue);
    }
}
