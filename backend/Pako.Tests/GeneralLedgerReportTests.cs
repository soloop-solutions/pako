using Microsoft.AspNetCore.Mvc;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Tests;

public class GeneralLedgerReportTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, Guid CompanyId, Guid CashId, Guid RevenueId, Guid CustomerId, Guid VendorId);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        db.Companies.Add(company);
        var cash = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1000", Name = "Cash", AccountType = AccountType.CurrentAsset };
        var revenue = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income };
        db.Accounts.AddRange(cash, revenue);
        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        db.Journals.Add(journal);
        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Customer Co", IsCustomer = true };
        var vendor = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Vendor Co", IsVendor = true };
        db.Partners.AddRange(customer, vendor);

        void Add(DateOnly date, decimal amount, Guid? partnerId, string description, string reference, bool post = true)
        {
            var entry = new JournalEntry
            {
                Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = journal.Id, Date = date, Reference = reference,
                Lines =
                {
                    new JournalEntryLine { Id = Guid.NewGuid(), AccountId = cash.Id, PartnerId = partnerId, Debit = amount, Description = description },
                    new JournalEntryLine { Id = Guid.NewGuid(), AccountId = revenue.Id, Credit = amount, Description = description }
                }
            };
            if (post) entry.Post(company);
            db.JournalEntries.Add(entry);
        }

        Add(new DateOnly(2026, 1, 10), 100m, customer.Id, "January sale", "REF-A");
        Add(new DateOnly(2026, 2, 10), 200m, vendor.Id, "February sale", "REF-B");
        Add(new DateOnly(2026, 3, 10), 300m, customer.Id, "March sale", "REF-C");
        Add(new DateOnly(2026, 2, 15), 999m, customer.Id, "Draft sale", "REF-D", post: false);
        await db.SaveChangesAsync();
        return new Seed(db, company.Id, cash.Id, revenue.Id, customer.Id, vendor.Id);
    }

    private static GeneralLedgerReportController Controller(PakoDbContext db, CompanyAccessContext? access = null) =>
        new(db, new NullStringLocalizer<ErrorMessages>(), access ?? CompanyAccessContext.Unrestricted());

    private static PaginatedResponse<GeneralLedgerLine> Page(ActionResult<PaginatedResponse<GeneralLedgerLine>> result) =>
        Assert.IsType<PaginatedResponse<GeneralLedgerLine>>(Assert.IsType<OkObjectResult>(result.Result).Value);

    private static readonly DateOnly Jan1 = new(2026, 1, 1);
    private static readonly DateOnly Dec31 = new(2026, 12, 31);

    [Fact]
    public async Task GeneralLedger_ReturnsOnlyPostedLinesInRange()
    {
        var s = await SeedAsync();
        var page = Page(await Controller(s.Db).GeneralLedger(s.CompanyId, new DateOnly(2026, 2, 1), new DateOnly(2026, 3, 31), null, null));

        Assert.Equal(4, page.Total);
        Assert.DoesNotContain(page.Items, i => i.Reference == "REF-D" || i.Reference == "REF-A");
        Assert.Equal(new[] { "REF-B", "REF-B", "REF-C", "REF-C" }, page.Items.Select(i => i.Reference));
    }

    [Fact]
    public async Task GeneralLedger_FiltersByAccountAndPartner()
    {
        var s = await SeedAsync();
        var byAccount = Page(await Controller(s.Db).GeneralLedger(s.CompanyId, Jan1, Dec31, s.RevenueId, null));
        Assert.Equal(3, byAccount.Total);
        Assert.All(byAccount.Items, i => Assert.Equal("4000", i.AccountCode));

        var byPartner = Page(await Controller(s.Db).GeneralLedger(s.CompanyId, Jan1, Dec31, null, s.VendorId));
        var line = Assert.Single(byPartner.Items);
        Assert.Equal("Vendor Co", line.PartnerName);
        Assert.Equal(200m, line.Debit);
    }

    [Fact]
    public async Task GeneralLedger_PagesWithTotal()
    {
        var s = await SeedAsync();
        var page = Page(await Controller(s.Db).GeneralLedger(s.CompanyId, Jan1, Dec31, null, null, page: 2, pageSize: 4));

        Assert.Equal(6, page.Total);
        Assert.Equal(2, page.Page);
        Assert.Equal(4, page.PageSize);
        Assert.Equal(2, page.Items.Count);
        Assert.All(page.Items, i => Assert.Equal("REF-C", i.Reference));
    }

    [Fact]
    public async Task GeneralLedger_ForbiddenForPartnerRestrictedUser()
    {
        var s = await SeedAsync();
        var access = CompanyAccessContext.ForStaff(s.CompanyId, Guid.NewGuid(), Guid.NewGuid(), new Department(), new HashSet<Guid> { s.CustomerId });
        var controller = Controller(s.Db, access);

        var json = await controller.GeneralLedger(s.CompanyId, Jan1, Dec31, null, null);
        Assert.Equal(403, Assert.IsType<ObjectResult>(json.Result).StatusCode);

        var export = await controller.GeneralLedgerExport(s.CompanyId, Jan1, Dec31, null, null);
        Assert.Equal(403, Assert.IsType<ObjectResult>(export).StatusCode);
    }

    [Fact]
    public async Task GeneralLedger_Export_IncludesAllRowsIgnoringPaging()
    {
        var s = await SeedAsync();
        var result = await Controller(s.Db).GeneralLedgerExport(s.CompanyId, Jan1, Dec31, null, null);

        var file = Assert.IsType<FileContentResult>(result);
        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(file.FileContents));
        var sheet = workbook.Worksheet(1);
        Assert.Equal(7, sheet.LastRowUsed()!.RowNumber());
        Assert.Equal("Account code", sheet.Cell(1, 3).GetString());
        Assert.Equal("Credit", sheet.Cell(1, 8).GetString());
    }

    [Fact]
    public async Task GeneralLedger_FromAfterTo_Returns400()
    {
        var s = await SeedAsync();
        var controller = Controller(s.Db);

        var json = await controller.GeneralLedger(s.CompanyId, Dec31, Jan1, null, null);
        Assert.Equal(400, Assert.IsType<BadRequestObjectResult>(json.Result).StatusCode);

        var export = await controller.GeneralLedgerExport(s.CompanyId, Dec31, Jan1, null, null);
        Assert.IsType<BadRequestObjectResult>(export);
    }

    [Fact]
    public async Task GeneralLedger_SearchFiltersRows()
    {
        var s = await SeedAsync();
        var byPartner = Page(await Controller(s.Db).GeneralLedger(s.CompanyId, Jan1, Dec31, null, null, search: "vendor"));
        Assert.Equal(1, byPartner.Total);

        var byDescription = Page(await Controller(s.Db).GeneralLedger(s.CompanyId, Jan1, Dec31, null, null, search: "MARCH"));
        Assert.Equal(2, byDescription.Total);

        var byReference = Page(await Controller(s.Db).GeneralLedger(s.CompanyId, Jan1, Dec31, null, null, search: "ref-a"));
        Assert.Equal(2, byReference.Total);

        var byAccountName = Page(await Controller(s.Db).GeneralLedger(s.CompanyId, Jan1, Dec31, null, null, search: "revenue"));
        Assert.Equal(3, byAccountName.Total);
    }

    [Fact]
    public async Task GeneralLedger_SortsDescendingWithDashPrefix()
    {
        var s = await SeedAsync();
        var byDate = Page(await Controller(s.Db).GeneralLedger(s.CompanyId, Jan1, Dec31, null, null, sort: "-date"));
        Assert.Equal("REF-C", byDate.Items.First().Reference);
        Assert.Equal("REF-A", byDate.Items.Last().Reference);

        var byDebit = Page(await Controller(s.Db).GeneralLedger(s.CompanyId, Jan1, Dec31, null, null, sort: "-debit"));
        Assert.Equal(300m, byDebit.Items.First().Debit);

        var byAccount = Page(await Controller(s.Db).GeneralLedger(s.CompanyId, Jan1, Dec31, null, null, sort: "-account"));
        Assert.Equal("4000", byAccount.Items.First().AccountCode);
    }
}
