using System.Security.Claims;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

public class PurchaseAnalysisTests : IAsyncLifetime
{
    private static readonly DateOnly Jan1 = new(2026, 1, 1);
    private static readonly DateOnly Jan31 = new(2026, 1, 31);

    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, Guid CompanyId, Guid Alpha, Guid Beta, Guid PaperItemId);

    private static ClaimsPrincipal TestUser() =>
        new(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"));

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);

        var companies = new CompaniesController(db, new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = TestUser() } }
        };
        var created = await companies.Create(new CreateCompanyRequest("Purchases Co"));
        var companyId = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(created.Result).Value).Id;
        var company = await db.Companies.SingleAsync(c => c.Id == companyId);
        var defaults = await db.CompanyAccountDefaults.AsNoTracking().SingleAsync(d => d.CompanyId == companyId);
        var journal = await db.Journals.AsNoTracking().FirstAsync(j => j.CompanyId == companyId && j.Type == JournalType.Purchase);
        var b18 = await db.TaxDefinitions.Include(t => t.RepartitionLines).SingleAsync(t => t.CompanyId == companyId && t.Code == "B18");
        var taxById = new Dictionary<Guid, TaxDefinition> { [b18.Id] = b18 };

        var alpha = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Alpha Supplies", TaxNumber = "810111111", IsVendor = true, IsVatRegistered = true };
        var beta = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Beta Services", TaxNumber = "810222222", IsVendor = true, IsVatRegistered = true };
        db.Partners.AddRange(alpha, beta);
        var paper = new Item { Id = Guid.NewGuid(), CompanyId = companyId, Code = 7, Name = "A4 paper", Unit = "pcs" };
        db.Items.Add(paper);

        void Post(Partner vendor, string reference, DateOnly date, DocumentType type, params BillLine[] lines)
        {
            var bill = new Bill
            {
                Id = Guid.NewGuid(), CompanyId = companyId, PartnerId = vendor.Id, VendorReference = reference,
                IssueDate = date, DueDate = date.AddDays(30), DocumentType = type
            };
            bill.Lines.AddRange(lines);
            var entry = bill.Post(company, journal.Id, defaults.PayableAccountId, new TaxComputationService(), taxById, Guid.NewGuid(), Guid.NewGuid());
            db.Bills.Add(bill);
            db.JournalEntries.Add(entry);
        }

        BillLine Line(string description, decimal qty, decimal price, Guid? itemId = null, decimal discount = 0m) => new()
        {
            Id = Guid.NewGuid(), Description = description, Quantity = qty, UnitPrice = price, DiscountPercent = discount,
            TaxDefinitionId = b18.Id, ExpenseAccountId = defaults.ExpenseAccountId, ItemId = itemId
        };

        Post(alpha, "A-1", new DateOnly(2026, 1, 5), DocumentType.Bill,
            Line("Paper A4", 10m, 11.80m, paper.Id), Line("Consulting retainer", 2m, 59m));
        Post(beta, "B-1", new DateOnly(2026, 1, 10), DocumentType.Bill, Line("Consulting retainer", 1m, 590m));
        Post(alpha, "A-2", new DateOnly(2026, 1, 20), DocumentType.Bill, Line("Paper A4 discounted", 10m, 11.80m, paper.Id, 10m));
        Post(alpha, "A-CN", new DateOnly(2026, 1, 25), DocumentType.CreditNote, Line("Paper A4 returned", 5m, 11.80m, paper.Id));
        Post(alpha, "A-FEB", new DateOnly(2026, 2, 3), DocumentType.Bill, Line("Out of range", 1m, 118m));

        db.Bills.Add(new Bill
        {
            Id = Guid.NewGuid(), CompanyId = companyId, PartnerId = alpha.Id, VendorReference = "A-DRAFT",
            IssueDate = new DateOnly(2026, 1, 12), DueDate = new DateOnly(2026, 2, 12),
            Lines = { Line("Draft only", 1m, 118m) }
        });
        await db.SaveChangesAsync();
        return new Seed(db, companyId, alpha.Id, beta.Id, paper.Id);
    }

    private static PayablesReportsController Controller(PakoDbContext db, CompanyAccessContext? access = null)
    {
        access ??= CompanyAccessContext.Unrestricted();
        return new(new NullStringLocalizer<ErrorMessages>(), access, new VendorLedgerService(db, access));
    }

    private static T Ok<T>(ActionResult<T> result) => Assert.IsType<T>(Assert.IsType<OkObjectResult>(result.Result).Value);

    private static async Task<PaginatedResponse<PurchaseTransactionLine>> Transactions(
        PayablesReportsController c, Guid companyId, Guid? partnerId = null, int page = 1, int pageSize = 50, string? search = null, string? sort = null) =>
        Ok(await c.PurchaseTransactions(companyId, Jan1, Jan31, partnerId, page, pageSize, search, sort));

    [Fact]
    public async Task PurchasesByVendor_TotalsMatchPurchaseBook()
    {
        var s = await SeedAsync();

        var vendors = Ok(await Controller(s.Db).PurchasesByVendor(s.CompanyId, Jan1, Jan31));

        var reports = new ReportsController(s.Db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(s.Db));
        var book = Ok(await reports.PurchaseBook(s.CompanyId, Jan1, Jan31));
        Assert.Equal(book.TotalNet, vendors.Sum(v => v.NetAmount));
        Assert.Equal(book.TotalVat, vendors.Sum(v => v.VatAmount));
        Assert.Equal(740m, vendors.Sum(v => v.NetAmount));
        Assert.Equal(133.20m, vendors.Sum(v => v.VatAmount));

        Assert.Equal(new[] { "Alpha Supplies", "Beta Services" }, vendors.Select(v => v.Name));
        var alpha = vendors[0];
        Assert.Equal(s.Alpha, alpha.PartnerId);
        Assert.Equal(240m, alpha.NetAmount);
        Assert.Equal(10m, alpha.DiscountAmount);
        Assert.Equal(43.20m, alpha.VatAmount);
        Assert.Equal(283.20m, alpha.GrossAmount);
        var beta = vendors[1];
        Assert.Equal(500m, beta.NetAmount);
        Assert.Equal(0m, beta.DiscountAmount);
        Assert.Equal(90m, beta.VatAmount);
        Assert.Equal(590m, beta.GrossAmount);
    }

    [Fact]
    public async Task PurchasesByItem_GroupsByItemAndFallsBackToDescription()
    {
        var s = await SeedAsync();

        var items = Ok(await Controller(s.Db).PurchasesByItem(s.CompanyId, Jan1, Jan31));

        Assert.Equal(2, items.Count);
        var consulting = items[0];
        Assert.Null(consulting.ItemId);
        Assert.Null(consulting.ItemCode);
        Assert.Null(consulting.Unit);
        Assert.Equal("Consulting retainer", consulting.Description);
        Assert.Equal(3m, consulting.Quantity);
        Assert.Equal(600m, consulting.NetAmount);
        Assert.Equal(108m, consulting.VatAmount);
        Assert.Equal(708m, consulting.GrossAmount);

        var paper = items[1];
        Assert.Equal(s.PaperItemId, paper.ItemId);
        Assert.Equal("7", paper.ItemCode);
        Assert.Equal("A4 paper", paper.Description);
        Assert.Equal("pcs", paper.Unit);
        Assert.Equal(15m, paper.Quantity);
        Assert.Equal(140m, paper.NetAmount);
        Assert.Equal(25.20m, paper.VatAmount);
        Assert.Equal(165.20m, paper.GrossAmount);
    }

    [Fact]
    public async Task PurchaseTransactions_OneRowPerBillLine()
    {
        var s = await SeedAsync();

        var r = await Transactions(Controller(s.Db), s.CompanyId);

        Assert.Equal(5, r.Total);
        Assert.Equal(5, r.Items.Count);
        Assert.Equal(
            new[] { "Consulting retainer", "Paper A4", "Consulting retainer", "Paper A4 discounted", "Paper A4 returned" },
            r.Items.Select(i => i.Description));
        Assert.Equal(new[] { "A-1", "A-1", "B-1", "A-2", "A-CN" }, r.Items.Select(i => i.DocumentNumber));
        var first = r.Items[1];
        Assert.Equal(new DateOnly(2026, 1, 5), first.Date);
        Assert.Equal("Bill", first.DocumentType);
        Assert.Equal("Alpha Supplies", first.PartnerName);
        Assert.Equal("7", first.ItemCode);
        Assert.Equal(10m, first.Quantity);
        Assert.Equal(11.80m, first.UnitPrice);
        Assert.Equal(100m, first.NetAmount);
        Assert.Equal(18m, first.VatAmount);
        Assert.Equal(118m, first.GrossAmount);
        Assert.Null(r.Items[0].ItemCode);
        Assert.Equal(1, r.Page);
    }

    [Fact]
    public async Task PurchaseTransactions_FiltersByPartner()
    {
        var s = await SeedAsync();

        var r = await Transactions(Controller(s.Db), s.CompanyId, partnerId: s.Beta);

        var row = Assert.Single(r.Items);
        Assert.Equal(1, r.Total);
        Assert.Equal("Beta Services", row.PartnerName);
        Assert.Equal(500m, row.NetAmount);
        Assert.Equal(90m, row.VatAmount);
        Assert.Equal(590m, row.GrossAmount);
    }

    [Fact]
    public async Task PurchaseTransactions_Pages()
    {
        var s = await SeedAsync();

        var r = await Transactions(Controller(s.Db), s.CompanyId, page: 2, pageSize: 2);

        Assert.Equal(5, r.Total);
        Assert.Equal(2, r.Page);
        Assert.Equal(2, r.PageSize);
        Assert.Equal(new[] { "B-1", "A-2" }, r.Items.Select(i => i.DocumentNumber));
    }

    [Fact]
    public async Task PurchaseTransactions_SearchFiltersRows()
    {
        var s = await SeedAsync();
        var c = Controller(s.Db);

        var byDescription = await Transactions(c, s.CompanyId, search: "RETAIN");
        Assert.Equal(2, byDescription.Total);

        var byVendor = await Transactions(c, s.CompanyId, search: "beta");
        Assert.Equal("B-1", Assert.Single(byVendor.Items).DocumentNumber);

        var byDocument = await Transactions(c, s.CompanyId, search: "A-CN");
        Assert.Equal(-59m, Assert.Single(byDocument.Items).GrossAmount);

        var byItemCode = await Transactions(c, s.CompanyId, search: "7");
        Assert.Equal(3, byItemCode.Total);
    }

    [Fact]
    public async Task PurchaseTransactions_SortsDescendingWithDashPrefix()
    {
        var s = await SeedAsync();
        var c = Controller(s.Db);

        var byGrossDesc = await Transactions(c, s.CompanyId, sort: "-gross");
        Assert.Equal(new[] { 590m, 118m, 118m, 106.20m, -59m }, byGrossDesc.Items.Select(i => i.GrossAmount));

        var byGrossAsc = await Transactions(c, s.CompanyId, sort: "gross");
        Assert.Equal(new[] { -59m, 106.20m, 118m, 118m, 590m }, byGrossAsc.Items.Select(i => i.GrossAmount));

        var byDateDesc = await Transactions(c, s.CompanyId, sort: "-date");
        Assert.Equal("A-CN", byDateDesc.Items[0].DocumentNumber);

        var byVendorDesc = await Transactions(c, s.CompanyId, sort: "-vendor");
        Assert.Equal("Beta Services", byVendorDesc.Items[0].PartnerName);
    }

    [Fact]
    public async Task Purchases_CreditNoteIsNegative()
    {
        var s = await SeedAsync();

        var r = await Transactions(Controller(s.Db), s.CompanyId, search: "returned");

        var row = Assert.Single(r.Items);
        Assert.Equal("CreditNote", row.DocumentType);
        Assert.Equal(-5m, row.Quantity);
        Assert.Equal(11.80m, row.UnitPrice);
        Assert.Equal(-50m, row.NetAmount);
        Assert.Equal(-9m, row.VatAmount);
        Assert.Equal(-59m, row.GrossAmount);
    }

    [Fact]
    public async Task Purchases_RestrictedUserSeesOnlyVisiblePartners()
    {
        var s = await SeedAsync();
        var access = CompanyAccessContext.ForStaff(s.CompanyId, Guid.NewGuid(), Guid.NewGuid(), new Department(), new HashSet<Guid> { s.Beta });
        var c = Controller(s.Db, access);

        var vendors = Ok(await c.PurchasesByVendor(s.CompanyId, Jan1, Jan31));
        Assert.Equal(s.Beta, Assert.Single(vendors).PartnerId);

        var items = Ok(await c.PurchasesByItem(s.CompanyId, Jan1, Jan31));
        var only = Assert.Single(items);
        Assert.Equal(1m, only.Quantity);
        Assert.Equal(500m, only.NetAmount);

        var tx = await Transactions(c, s.CompanyId);
        Assert.Equal("B-1", Assert.Single(tx.Items).DocumentNumber);

        var hidden = await Transactions(c, s.CompanyId, partnerId: s.Alpha);
        Assert.Empty(hidden.Items);
        Assert.Equal(0, hidden.Total);
    }

    private async Task<Seed> SeedReverseChargeAsync()
    {
        var s = await SeedAsync();
        var company = await s.Db.Companies.SingleAsync(c => c.Id == s.CompanyId);
        var defaults = await s.Db.CompanyAccountDefaults.AsNoTracking().SingleAsync(d => d.CompanyId == s.CompanyId);
        var journal = await s.Db.Journals.AsNoTracking().FirstAsync(j => j.CompanyId == s.CompanyId && j.Type == JournalType.Purchase);
        var rc = await s.Db.TaxDefinitions.Include(t => t.RepartitionLines).SingleAsync(t => t.CompanyId == s.CompanyId && t.Code == "RC18");
        var bill = new Bill
        {
            Id = Guid.NewGuid(), CompanyId = s.CompanyId, PartnerId = s.Beta, VendorReference = "B-RC",
            IssueDate = new DateOnly(2026, 1, 15), DueDate = new DateOnly(2026, 2, 15),
            Lines =
            {
                new BillLine
                {
                    Id = Guid.NewGuid(), Description = "Foreign software", Quantity = 1m, UnitPrice = 1000m,
                    TaxDefinitionId = rc.Id, ExpenseAccountId = defaults.ExpenseAccountId
                }
            }
        };
        var entry = bill.Post(
            company, journal.Id, defaults.PayableAccountId, new TaxComputationService(),
            new Dictionary<Guid, TaxDefinition> { [rc.Id] = rc },
            defaults.ReverseChargeInputVatAccountId, defaults.ReverseChargeOutputVatAccountId);
        s.Db.Bills.Add(bill);
        s.Db.JournalEntries.Add(entry);
        await s.Db.SaveChangesAsync();
        return s;
    }

    [Fact]
    public async Task PurchasesByVendor_ReverseChargeBill_VatMatchesPurchaseBook()
    {
        var s = await SeedReverseChargeAsync();

        var vendors = Ok(await Controller(s.Db).PurchasesByVendor(s.CompanyId, Jan1, Jan31));

        var reports = new ReportsController(s.Db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(s.Db));
        var book = Ok(await reports.PurchaseBook(s.CompanyId, Jan1, Jan31));
        Assert.Equal(1500m, vendors.Single(v => v.PartnerId == s.Beta).NetAmount);
        Assert.Equal(270m, vendors.Single(v => v.PartnerId == s.Beta).VatAmount);
        Assert.Equal(book.TotalNet, vendors.Sum(v => v.NetAmount));
        Assert.Equal(book.TotalVat, vendors.Sum(v => v.VatAmount));
    }

    [Fact]
    public async Task PurchaseTransactions_ReverseChargeLine_GrossEqualsNet()
    {
        var s = await SeedReverseChargeAsync();

        var r = await Transactions(Controller(s.Db), s.CompanyId, search: "Foreign software");

        var row = Assert.Single(r.Items);
        Assert.Equal(1000m, row.NetAmount);
        Assert.Equal(180m, row.VatAmount);
        Assert.Equal(1000m, row.GrossAmount);
    }

    [Fact]
    public async Task Purchases_FromAfterTo_Returns400()
    {
        var s = await SeedAsync();
        var c = Controller(s.Db);

        Assert.IsType<BadRequestObjectResult>((await c.PurchasesByVendor(s.CompanyId, Jan31, Jan1)).Result);
        Assert.IsType<BadRequestObjectResult>((await c.PurchasesByItem(s.CompanyId, Jan31, Jan1)).Result);
        Assert.IsType<BadRequestObjectResult>((await c.PurchaseTransactions(s.CompanyId, Jan31, Jan1, null)).Result);
        Assert.IsType<BadRequestObjectResult>(await c.PurchasesByVendorExport(s.CompanyId, Jan31, Jan1));
    }

    [Fact]
    public async Task Purchases_EmptyRange_ReturnsEmptyLists()
    {
        var s = await SeedAsync();
        var c = Controller(s.Db);
        var from = new DateOnly(2025, 1, 1);
        var to = new DateOnly(2025, 1, 31);

        Assert.Empty(Ok(await c.PurchasesByVendor(s.CompanyId, from, to)));
        Assert.Empty(Ok(await c.PurchasesByItem(s.CompanyId, from, to)));
        var tx = Ok(await c.PurchaseTransactions(s.CompanyId, from, to, null));
        Assert.Empty(tx.Items);
        Assert.Equal(0, tx.Total);
    }

    [Fact]
    public async Task Purchases_Exports_HaveRowsAndTotals()
    {
        var s = await SeedAsync();
        var c = Controller(s.Db);

        var vendorFile = Assert.IsType<FileContentResult>(await c.PurchasesByVendorExport(s.CompanyId, Jan1, Jan31));
        using (var wb = new XLWorkbook(new MemoryStream(vendorFile.FileContents)))
        {
            var sheet = wb.Worksheet(1);
            Assert.Equal("Vendor", sheet.Cell(1, 1).GetString());
            Assert.Equal("Alpha Supplies", sheet.Cell(2, 1).GetString());
            Assert.Equal("Total", sheet.Cell(4, 1).GetString());
            Assert.Equal(740m, sheet.Cell(4, 2).GetValue<decimal>());
        }

        var itemFile = Assert.IsType<FileContentResult>(await c.PurchasesByItemExport(s.CompanyId, Jan1, Jan31));
        using (var wb = new XLWorkbook(new MemoryStream(itemFile.FileContents)))
        {
            var sheet = wb.Worksheet(1);
            Assert.Equal("Total", sheet.Cell(4, 1).GetString());
            Assert.Equal(873.20m, sheet.Cell(4, sheet.LastColumnUsed()!.ColumnNumber()).GetValue<decimal>());
        }

        var txFile = Assert.IsType<FileContentResult>(await c.PurchaseTransactionsExport(s.CompanyId, Jan1, Jan31, null));
        using (var wb = new XLWorkbook(new MemoryStream(txFile.FileContents)))
        {
            Assert.Equal(6, wb.Worksheet(1).LastRowUsed()!.RowNumber());
        }
    }
}
