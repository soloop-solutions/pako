using System.Globalization;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Reporting;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Tests;

public class VatDeclarationCalculatorTests
{
    private static VatBoxAmount Box(string box, decimal net, decimal vat) => new(box, net, vat);

    [Fact]
    public void TotalVatCalculated_SumsOnlyTheCalculatedVatBoxes()
    {
        var result = VatDeclaration.Calculate(new[]
        {
            Box("12", 100m, 18m), Box("14", 50m, 4m), Box("16", 10m, 1.80m), Box("28", 20m, 3.60m),
            Box("43", 999m, 999m), Box("9", 500m, 0m)
        }, 0m, 0m);

        Assert.Equal(27.40m, result.TotalVatCalculated);
    }

    [Fact]
    public void TotalVatDeductible_SumsOnlyTheDeductibleVatBoxes()
    {
        var result = VatDeclaration.Calculate(new[]
        {
            Box("43", 3252.91m, 585.53m), Box("35", 41970.06m, 7554.61m), Box("65", 5m, 1m), Box("53", 2m, 0.50m),
            Box("12", 999m, 999m), Box("33", 84m, 0m)
        }, 0m, 0m);

        Assert.Equal(8141.64m, result.TotalVatDeductible);
    }

    [Fact]
    public void RemainingCredit_WhenDeductiblePlusCarriedExceedsCalculated()
    {
        var result = VatDeclaration.Calculate(new[]
        {
            Box("12", 44408.45m, 7993.57m), Box("43", 3252.91m, 585.53m), Box("35", 41970.06m, 7554.61m)
        }, 1000m, 0m);

        Assert.Equal(7993.57m, result.TotalVatCalculated);
        Assert.Equal(8140.14m, result.TotalVatDeductible);
        Assert.Equal(1146.57m, result.RemainingCredit);
        Assert.Equal(0m, result.VatPayable);
        Assert.Equal(1146.57m, result.CreditForNextPeriod);
    }

    [Fact]
    public void VatPayable_WhenCalculatedExceedsDeductiblePlusCarried()
    {
        var result = VatDeclaration.Calculate(new[] { Box("12", 5555.56m, 1000m), Box("43", 1666.67m, 300m) }, 200m, 0m);

        Assert.Equal(500m, result.VatPayable);
        Assert.Equal(0m, result.RemainingCredit);
        Assert.Equal(0m, result.CreditForNextPeriod);
    }

    [Fact]
    public void CreditForNextPeriod_IsRemainingMinusRefund()
    {
        var result = VatDeclaration.Calculate(new[]
        {
            Box("12", 44408.45m, 7993.57m), Box("43", 3252.91m, 585.53m), Box("35", 41970.06m, 7554.61m)
        }, 1000m, 146.57m);

        Assert.Equal(1146.57m, result.RemainingCredit);
        Assert.Equal(146.57m, result.RefundRequested);
        Assert.Equal(1000m, result.CreditForNextPeriod);
    }

    [Fact]
    public void ExactBalance_GivesNeitherCreditNorPayable()
    {
        var result = VatDeclaration.Calculate(new[] { Box("12", 100m, 18m), Box("43", 100m, 18m) }, 0m, 0m);

        Assert.Equal(0m, result.RemainingCredit);
        Assert.Equal(0m, result.VatPayable);
    }

    [Fact]
    public void Rounding_SumsRowsThenRoundsHalfAwayFromZeroToTwoDecimals()
    {
        var result = VatDeclaration.Calculate(new[]
        {
            Box("12", 0.004m, 0.004m), Box("12", 0.004m, 0.004m),
            Box("14", 0m, 0.005m),
            Box("16", 0m, -0.005m)
        }, 0m, 0m);

        Assert.Equal(0.01m, result.Boxes["12"].Vat);
        Assert.Equal(0.01m, result.Boxes["14"].Vat);
        Assert.Equal(-0.01m, result.Boxes["16"].Vat);
        Assert.Equal(0.01m, result.TotalVatCalculated);
    }

    [Fact]
    public void Box10_IsSumOfTenAThroughTenC()
    {
        var result = VatDeclaration.Calculate(new[] { Box("10a", 10m, 0m), Box("10b", 20m, 0m), Box("10c", 5.5m, 0m) }, 0m, 0m);

        Assert.Equal(35.5m, result.Boxes["10"].Net);
    }

    [Fact]
    public void NonVatBearingBoxes_NeverFeedTheTotals()
    {
        var result = VatDeclaration.Calculate(new[] { Box("9", 100m, 18m), Box("33", 50m, 9m), Box("31", 10m, 1m) }, 0m, 0m);

        Assert.Equal(0m, result.TotalVatCalculated);
        Assert.Equal(0m, result.TotalVatDeductible);
    }

    [Fact]
    public void Mapper_NonDeductiblePurchase_FeedsBox33WithoutVat()
    {
        var row = new AtkTaxRow(Guid.NewGuid(), "B-1", new DateOnly(2026, 2, 1), Guid.NewGuid(), "BND", 0.18m, 84m,
            TaxDirection.In, 0m, false, TaxAtkBook.Blerje, "Bill", 15.12m);

        var amounts = AtkBookMapper.DeclarationAmounts(Array.Empty<AtkTaxRow>(), new[] { row });

        var amount = Assert.Single(amounts);
        Assert.Equal(new VatBoxAmount("33", 84m, 0m), amount);
    }
}

public class VatDeclarationTests : IAsyncLifetime
{
    private static readonly string[] ExpectedOrder =
    {
        "9", "10", "11", "12", "14", "16", "18", "20", "22", "24", "26", "28", "30",
        "31", "32", "33", "34", "35", "37", "39", "41", "43", "45", "47", "49", "51", "53", "55", "57", "59", "61", "63", "65", "67",
        "68", "69", "70", "71", "72"
    };

    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, Guid CompanyId, Guid CustomerId);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company
        {
            Id = Guid.NewGuid(), Name = "Dolcezza SH.P.K.", FiscalNumber = "811869132",
            StreetAddress = "Rruga Hajrullah Zymi, CB-4", Municipality = "Fushë Kosovë", Phone = "+38349850850"
        };

        var accountIdsByCode = new Dictionary<string, Guid>();
        foreach (var entry in DefaultChartOfAccountsTemplate.Entries)
        {
            var accountId = Guid.NewGuid();
            accountIdsByCode[entry.Code] = accountId;
            db.Accounts.Add(new Account
            {
                Id = accountId, CompanyId = company.Id, Code = entry.Code, Name = entry.Name,
                AccountType = entry.AccountType, AccountSubType = entry.AccountSubType
            });
        }

        accountIdsByCode["210100"] = Guid.NewGuid();
        db.Accounts.Add(new Account { Id = accountIdsByCode["210100"], CompanyId = company.Id, Code = "210100", Name = "Output VAT - Control", AccountType = AccountType.CurrentLiability });
        accountIdsByCode["113100"] = Guid.NewGuid();
        db.Accounts.Add(new Account { Id = accountIdsByCode["113100"], CompanyId = company.Id, Code = "113100", Name = "Input VAT - Control", AccountType = AccountType.CurrentAsset });

        var taxDefinitions = DefaultTaxDefinitionsTemplate.CreateDefaultTaxDefinitions(company.Id, accountIdsByCode);
        db.TaxDefinitions.AddRange(taxDefinitions);
        var byId = taxDefinitions.ToDictionary(t => t.Id);
        var vatOnSales = taxDefinitions.Single(t => t.Name == "VAT 18% (Sales)");
        var vatOnPurchases = taxDefinitions.Single(t => t.Name == "VAT 18% (Purchases)");
        vatOnSales.AtkBook = TaxAtkBook.Shitje;
        vatOnSales.Direction = TaxDirection.Out;
        vatOnPurchases.AtkBook = TaxAtkBook.Blerje;
        vatOnPurchases.Direction = TaxDirection.In;
        vatOnPurchases.DeductiblePercent = 100m;

        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        db.Journals.Add(journal);
        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Customer Co", IsCustomer = true };
        var vendor = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Vendor Co", IsVendor = true };
        db.Partners.AddRange(customer, vendor);
        db.Companies.Add(company);

        var calculator = new TaxComputationService();
        void Invoice(DateOnly date, decimal gross)
        {
            var invoice = new Invoice
            {
                Id = Guid.NewGuid(), CompanyId = company.Id, PartnerId = customer.Id, IssueDate = date, DueDate = date.AddDays(30),
                Lines = { new InvoiceLine { Id = Guid.NewGuid(), Description = "Consulting", Quantity = 1m, UnitPrice = gross, RevenueAccountId = accountIdsByCode["4000"], TaxDefinitionId = vatOnSales.Id } }
            };
            var entry = invoice.Post(company, journal.Id, accountIdsByCode["1200"], calculator, byId, Guid.NewGuid(), Guid.NewGuid());
            db.Invoices.Add(invoice);
            db.JournalEntries.Add(entry);
        }

        void Bill(DateOnly date, decimal gross)
        {
            var bill = new Bill
            {
                Id = Guid.NewGuid(), CompanyId = company.Id, PartnerId = vendor.Id, VendorReference = "S-" + date.ToString("MMdd"), IssueDate = date, DueDate = date.AddDays(30),
                Lines = { new BillLine { Id = Guid.NewGuid(), Description = "Rent", Quantity = 1m, UnitPrice = gross, ExpenseAccountId = accountIdsByCode["6000"], TaxDefinitionId = vatOnPurchases.Id } }
            };
            var entry = bill.Post(company, journal.Id, accountIdsByCode["2000"], calculator, byId, Guid.NewGuid(), Guid.NewGuid());
            db.Bills.Add(bill);
            db.JournalEntries.Add(entry);
        }

        Bill(new DateOnly(2026, 1, 10), 5000m);
        Invoice(new DateOnly(2026, 1, 20), 1000m);
        Invoice(new DateOnly(2026, 2, 5), 3000m);
        Bill(new DateOnly(2026, 2, 12), 400m);
        Invoice(new DateOnly(2026, 3, 3), 10000m);

        await db.SaveChangesAsync();
        return new Seed(db, company.Id, customer.Id);
    }

    private static ExportLabels Labels() => new(new NullStringLocalizer<ErrorMessages>());

    private static VatDeclarationController Controller(PakoDbContext db, CompanyAccessContext? access = null) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), access ?? CompanyAccessContext.Unrestricted(), Labels());

    private static ReportsController Reports(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(db), Labels());

    private static async Task<VatDeclarationResponse> Run(
        Seed s, int year, int month, decimal? carried = null, decimal? refund = null) =>
        Assert.IsType<VatDeclarationResponse>(Assert.IsType<OkObjectResult>(
            (await Controller(s.Db).Declaration(s.CompanyId, year, month, carried, refund)).Result).Value);

    private static VatDeclarationBox Find(VatDeclarationResponse r, string number) => r.Boxes.Single(b => b.Number == number);

    [Fact]
    public async Task Declaration_ListsEveryBoxInFormOrderWithHeaderFields()
    {
        var s = await SeedAsync();

        var r = await Run(s, 2026, 2);

        Assert.Equal(ExpectedOrder, r.Boxes.Select(b => b.Number));
        Assert.Equal("Dolcezza SH.P.K.", r.TaxpayerName);
        Assert.Equal("811869132", r.FiscalNumber);
        Assert.Equal("Rruga Hajrullah Zymi, CB-4, Fushë Kosovë", r.Address);
        Assert.Equal("Taxable sales at 18%", Find(r, "12").Label);
        Assert.Null(Find(r, "9").Vat);
        Assert.Null(Find(r, "30").Base);
    }

    [Fact]
    public async Task Declaration_Box30_EqualsSalesBookVatForTheMonth()
    {
        var s = await SeedAsync();
        var from = new DateOnly(2026, 2, 1);
        var to = new DateOnly(2026, 2, 28);
        var book = Assert.IsType<SalesBookResponse>(Assert.IsType<OkObjectResult>((await Reports(s.Db).SalesBook(s.CompanyId, from, to)).Result).Value);

        var r = await Run(s, 2026, 2);

        Assert.Equal(457.63m, book.TotalVat);
        Assert.Equal(book.TotalVat, Find(r, "30").Vat);
        Assert.Equal(book.TotalVat, r.TotalVatCalculated);
        Assert.Equal(book.TotalNet, Find(r, "12").Base);
        Assert.Equal(book.TotalVat, Find(r, "12").Vat);
    }

    [Fact]
    public async Task Declaration_Box67_EqualsPurchaseBookVatForTheMonth()
    {
        var s = await SeedAsync();
        var from = new DateOnly(2026, 2, 1);
        var to = new DateOnly(2026, 2, 28);
        var book = Assert.IsType<PurchaseBookResponse>(Assert.IsType<OkObjectResult>((await Reports(s.Db).PurchaseBook(s.CompanyId, from, to)).Result).Value);

        var r = await Run(s, 2026, 2);

        Assert.Equal(61.02m, book.TotalVat);
        Assert.Equal(book.TotalVat, Find(r, "67").Vat);
        Assert.Equal(book.TotalNet, Find(r, "43").Base);
        Assert.Equal(book.TotalVat, Find(r, "43").Vat);
    }

    [Fact]
    public async Task Declaration_EmptyMonth_IsAllZero()
    {
        var s = await SeedAsync();

        var r = await Run(s, 2025, 6);

        Assert.Equal(ExpectedOrder.Length, r.Boxes.Count);
        Assert.All(r.Boxes, b =>
        {
            Assert.Equal(0m, b.Base ?? 0m);
            Assert.Equal(0m, b.Vat ?? 0m);
        });
        Assert.Equal(0m, r.VatPayable);
        Assert.Equal(0m, r.CreditForNextPeriod);
    }

    [Fact]
    public async Task Declaration_CarriedCreditFlowsFromPreviousMonth()
    {
        var s = await SeedAsync();

        var jan = await Run(s, 2026, 1);
        var feb = await Run(s, 2026, 2);
        var mar = await Run(s, 2026, 3);

        Assert.Equal(0m, jan.CarriedCredit);
        Assert.Equal(152.54m, jan.TotalVatCalculated);
        Assert.Equal(762.71m, jan.TotalVatDeductible);
        Assert.Equal(610.17m, jan.RemainingCredit);
        Assert.Equal(610.17m, jan.CreditForNextPeriod);

        Assert.Equal(jan.CreditForNextPeriod, feb.CarriedCredit);
        Assert.Equal(610.17m, Find(feb, "68").Vat);
        Assert.Equal(213.56m, feb.RemainingCredit);
        Assert.Equal(0m, feb.VatPayable);

        Assert.Equal(feb.CreditForNextPeriod, mar.CarriedCredit);
        Assert.Equal(1525.42m, mar.TotalVatCalculated);
        Assert.Equal(1311.86m, mar.VatPayable);
        Assert.Equal(0m, mar.RemainingCredit);
    }

    [Fact]
    public async Task Declaration_CarriedCreditOverrideWins()
    {
        var s = await SeedAsync();

        var feb = await Run(s, 2026, 2, carried: 50m);

        Assert.Equal(50m, feb.CarriedCredit);
        Assert.Equal(50m, Find(feb, "68").Vat);
        Assert.Equal(0m, feb.RemainingCredit);
        Assert.Equal(346.61m, feb.VatPayable);
    }

    [Fact]
    public async Task Declaration_RefundRequestReducesCreditForNextPeriod()
    {
        var s = await SeedAsync();

        var feb = await Run(s, 2026, 2, refund: 13.56m);

        Assert.Equal(213.56m, feb.RemainingCredit);
        Assert.Equal(13.56m, feb.RefundRequested);
        Assert.Equal(200m, feb.CreditForNextPeriod);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(13)]
    [InlineData(-1)]
    public async Task Declaration_MonthOutsideOneToTwelve_Is400(int month)
    {
        var s = await SeedAsync();

        var result = await Controller(s.Db).Declaration(s.CompanyId, 2026, month);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(400, bad.StatusCode);
        Assert.Contains("month must be between 1 and 12", bad.Value!.ToString());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1999)]
    [InlineData(2101)]
    public async Task Declaration_InvalidYear_Is400(int year)
    {
        var s = await SeedAsync();

        Assert.IsType<BadRequestObjectResult>((await Controller(s.Db).Declaration(s.CompanyId, year, 3)).Result);
    }

    [Fact]
    public async Task Declaration_RefundAboveRemainingCredit_Is400()
    {
        var s = await SeedAsync();

        Assert.IsType<BadRequestObjectResult>((await Controller(s.Db).Declaration(s.CompanyId, 2026, 2, null, 500m)).Result);
    }

    [Fact]
    public async Task Declaration_ForbiddenForPartnerRestrictedUser()
    {
        var s = await SeedAsync();
        var access = CompanyAccessContext.ForStaff(s.CompanyId, Guid.NewGuid(), Guid.NewGuid(), new Department(), new HashSet<Guid> { s.CustomerId });
        var controller = Controller(s.Db, access);

        var json = await controller.Declaration(s.CompanyId, 2026, 2);
        Assert.Equal(403, Assert.IsType<ObjectResult>(json.Result).StatusCode);

        var export = await controller.Export(s.CompanyId, 2026, 2);
        Assert.Equal(403, Assert.IsType<ObjectResult>(export).StatusCode);
    }

    private static async Task<IXLWorksheet> ExportAsync(Seed s, string culture, int month = 2)
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = new CultureInfo(culture);
        try
        {
            var file = Assert.IsType<FileContentResult>(await Controller(s.Db).Export(s.CompanyId, 2026, month));
            return new XLWorkbook(new MemoryStream(file.FileContents)).Worksheet(1);
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    private static IXLRow BoxRow(IXLWorksheet sheet, string number) =>
        sheet.RowsUsed().Single(r => r.Cell(1).GetString() == "[" + number + "]");

    [Fact]
    public async Task Export_UnderSq_HasAlbanianTitleLabelsAndNumericCells()
    {
        var s = await SeedAsync();

        var sheet = await ExportAsync(s, "sq");

        Assert.Equal("Deklarata e TVSH-së (formulari)", sheet.Name);
        Assert.Equal("FORMULARI I DEKLARIMIT DHE PAGESËS SË TVSH", sheet.Cell(1, 1).GetString());

        var period = BoxRow(sheet, "1");
        Assert.Equal("Periudha tatimore", period.Cell(2).GetString());
        Assert.Equal(XLDataType.Number, period.Cell(3).DataType);
        Assert.Equal(2d, period.Cell(3).GetDouble());
        Assert.Equal(2026d, period.Cell(4).GetDouble());
        Assert.Equal("811869132", BoxRow(sheet, "3").Cell(3).GetString());
        Assert.Equal("Dolcezza SH.P.K.", BoxRow(sheet, "4").Cell(3).GetString());

        var box12 = BoxRow(sheet, "12");
        Assert.Equal("Shitjet e tatueshme me normën 18%", box12.Cell(2).GetString());
        Assert.Equal(XLDataType.Number, box12.Cell(3).DataType);
        Assert.Equal(2542.37d, box12.Cell(3).GetDouble());
        Assert.Equal("[13]", box12.Cell(4).GetString());
        Assert.Equal(XLDataType.Number, box12.Cell(5).DataType);
        Assert.Equal(457.63d, box12.Cell(5).GetDouble());

        var box72 = BoxRow(sheet, "72");
        Assert.Equal("TVSH për pagesë 72 =(30-67-68)>0", box72.Cell(2).GetString());
        Assert.Equal(XLDataType.Number, box72.Cell(5).DataType);
        Assert.Equal(0d, box72.Cell(5).GetDouble());
        Assert.Equal(610.17d, BoxRow(sheet, "68").Cell(5).GetDouble());
        Assert.Equal("Kalkulimi", sheet.Column(1).CellsUsed().Select(c => c.GetString()).Single(v => v == "Kalkulimi"));
    }

    [Fact]
    public async Task Export_UnderEn_HasEnglishTitleAndLabels()
    {
        var s = await SeedAsync();

        var sheet = await ExportAsync(s, "en");

        Assert.Equal("VAT Declaration", sheet.Name);
        Assert.Equal("VAT Declaration and Payment Form", sheet.Cell(1, 1).GetString());
        Assert.Equal("Taxable sales at 18%", BoxRow(sheet, "12").Cell(2).GetString());
    }

    [Fact]
    public async Task Export_EmptyMonth_MarksNoTransactions()
    {
        var s = await SeedAsync();

        var sheet = await ExportAsync(s, "en", month: 6);

        Assert.Equal("X", BoxRow(sheet, "8").Cell(3).GetString());
    }
}
