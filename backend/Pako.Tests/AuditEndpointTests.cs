using System.Reflection;
using System.Text.Json;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Shared;
using Pako.Infrastructure;
using Pako.Infrastructure.Audit;
using Pako.Infrastructure.Identity;

namespace Pako.Tests;

public class AuditEndpointTests : IAsyncLifetime
{
    private sealed class Ambient : IAuditContext
    {
        public string? UserId { get; set; }
        public string? IpAddress { get; set; } = "198.51.100.4";
        public string? RequestId { get; set; } = "req-x";
        public Guid? SourceDocumentId { get; set; }
    }

    private readonly Ambient _ambient = new();
    private PakoDbContext _db = null!;
    private Company _company = null!;
    private Company _other = null!;
    private AppUser _alice = null!;
    private AppUser _bob = null!;

    public async Task InitializeAsync()
    {
        _db = await PostgresTestDatabase.CreateAsync(_ambient);
        _alice = new AppUser { Id = Guid.NewGuid(), UserName = "alice@x.test", Email = "alice@x.test", FullName = "Alice Berisha" };
        _bob = new AppUser { Id = Guid.NewGuid(), UserName = "bob@x.test", Email = "bob@x.test", FullName = "Bob Krasniqi" };
        _db.Users.AddRange(_alice, _bob);
        _company = new Company { Id = Guid.NewGuid(), Name = "Co" };
        _other = new Company { Id = Guid.NewGuid(), Name = "Other" };
        _db.Companies.AddRange(_company, _other);
        await _db.SaveChangesAsync();

        _ambient.UserId = _alice.Id.ToString();
        _db.Partners.Add(new Partner { Id = Guid.NewGuid(), CompanyId = _company.Id, Name = "Acme" });
        await _db.SaveChangesAsync();

        _ambient.UserId = _bob.Id.ToString();
        var p = new Partner { Id = Guid.NewGuid(), CompanyId = _company.Id, Name = "Zeta Trading" };
        _db.Partners.Add(p);
        await _db.SaveChangesAsync();
        p.TaxNumber = "811234567";
        await _db.SaveChangesAsync();

        _db.Partners.Add(new Partner { Id = Guid.NewGuid(), CompanyId = _other.Id, Name = "Foreign" });
        await _db.SaveChangesAsync();
    }

    public async Task DisposeAsync() => await _db.DisposeAsync();

    private AuditController Controller() =>
        new(_db, new NullStringLocalizer<ErrorMessages>(), new ExportLabels(new NullStringLocalizer<ErrorMessages>()), new ReportSourceResolver(_db));

    private static T Value<T>(ActionResult<T> result) => (T)((ObjectResult)result.Result!).Value!;

    [Fact]
    public async Task List_IsScopedToTheCompany_AndResolvesUserNames()
    {
        var rows = Value(await Controller().List(_company.Id, null, null));

        Assert.DoesNotContain(rows, r => r.EntityType == "Partner" && r.Changes!.Contains("Foreign"));
        Assert.Contains(rows, r => r.UserName == "Alice Berisha" && r.UserEmail == "alice@x.test");
        Assert.All(rows.Where(r => r.EntityType == "Partner"), r => Assert.Equal("198.51.100.4", r.IpAddress));
        Assert.All(rows, r => Assert.NotNull(r.EntryHash));
    }

    [Fact]
    public async Task List_FiltersByEntityTypeActionUserAndEntity()
    {
        var c = Controller();
        Assert.All(Value(await c.List(_company.Id, "Partner", null)), r => Assert.Equal("Partner", r.EntityType));

        var updates = Value(await c.List(_company.Id, null, null, action: "Updated"));
        Assert.Single(updates);
        Assert.Equal("Partner", updates[0].EntityType);

        var byBob = Value(await c.List(_company.Id, "Partner", null, userId: _bob.Id.ToString()));
        Assert.Equal(2, byBob.Count);

        var one = Value(await c.List(_company.Id, "Partner", updates[0].EntityId));
        Assert.Equal(2, one.Count);
    }

    [Fact]
    public async Task List_FiltersByDateRange()
    {
        var c = Controller();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        Assert.NotEmpty(Value(await c.List(_company.Id, null, null, from: today.AddDays(-1), to: today.AddDays(1))));
        Assert.Empty(Value(await c.List(_company.Id, null, null, to: today.AddDays(-2))));
        Assert.Empty(Value(await c.List(_company.Id, null, null, from: today.AddDays(2))));
        Assert.IsType<BadRequestObjectResult>((await c.List(_company.Id, null, null, from: today, to: today.AddDays(-3))).Result);
    }

    [Fact]
    public async Task List_SearchMatchesFieldValuesAndUserNames()
    {
        var c = Controller();

        var byValue = Value(await c.List(_company.Id, null, null, search: "Zeta"));
        Assert.NotEmpty(byValue);
        Assert.All(byValue, r => Assert.Contains("Zeta", r.Changes ?? string.Empty));

        var byUser = Value(await c.List(_company.Id, null, null, search: "berisha"));
        Assert.NotEmpty(byUser);
        Assert.All(byUser, r => Assert.Equal(_alice.Id.ToString(), r.UserId));
    }

    [Fact]
    public async Task ListPaged_ReturnsTotalAndRequestedPage()
    {
        var c = Controller();
        var all = Value(await c.List(_company.Id, null, null, pageSize: 200));

        var page = Value(await c.ListPaged(_company.Id, page: 2, pageSize: 2));

        Assert.Equal(all.Count, page.Total);
        Assert.Equal(2, page.Page);
        Assert.Equal(all.Skip(2).Take(2).Select(r => r.Id), page.Items.Select(r => r.Id));
    }

    [Fact]
    public async Task Get_ReturnsFieldDiffs_AndNotFoundForAnotherCompany()
    {
        var c = Controller();
        var update = Value(await c.List(_company.Id, null, null, action: "Updated")).Single();

        var detail = Value(await c.Get(_company.Id, update.Id));
        Assert.Contains(detail.Fields, f => f.Field == "TaxNumber" && f.OldValue is null && f.NewValue == "811234567");
        Assert.NotNull(detail.PrevHash);

        Assert.IsType<NotFoundResult>((await c.Get(_other.Id, update.Id)).Result);
    }

    [Fact]
    public async Task Verify_ReportsValidChain_ThenFirstBrokenLinkAfterTampering()
    {
        var c = Controller();
        var ok = Value(await c.Verify(_company.Id, CancellationToken.None));
        Assert.True(ok.Valid);
        Assert.True(ok.CheckedCount >= 4);

        await _db.Database.ExecuteSqlRawAsync("ALTER TABLE audit_entries DISABLE TRIGGER trg_audit_entries_append_only");
        await _db.Database.ExecuteSqlRawAsync(
            "UPDATE audit_entries SET \"Action\" = 'Deleted' WHERE \"SequenceNumber\" = 2 AND \"CompanyId\" = {0}", _company.Id);

        var broken = Value(await c.Verify(_company.Id, CancellationToken.None));
        Assert.False(broken.Valid);
        Assert.Equal(2, broken.FirstBrokenSequence);
        Assert.Equal(AuditChainVerifier.ReasonEntryHashMismatch, broken.Reason);
    }

    [Fact]
    public async Task Export_ReturnsWorkbookWithOneRowPerEntry()
    {
        var result = await Controller().Export(_company.Id, entityType: "Partner");

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal(ExcelExportService.XlsxContentType, file.ContentType);
        using var workbook = new XLWorkbook(new MemoryStream(file.FileContents));
        var sheet = workbook.Worksheets.First();
        var expected = Value(await Controller().List(_company.Id, "Partner", null)).Count;
        Assert.Equal(expected, sheet.RowsUsed().Count() - 1);
    }

    [Fact]
    public async Task Export_WithInvertedRange_Returns400Json()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var result = await Controller().Export(_company.Id, from: today, to: today.AddDays(-1));

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task SourceKind_ResolvesEachDocumentKind_AndIsCompanyScoped()
    {
        var jan = new DateOnly(2026, 1, 15);
        var partner = new Partner { Id = Guid.NewGuid(), CompanyId = _company.Id, Name = "P" };
        var foreignPartner = new Partner { Id = Guid.NewGuid(), CompanyId = _other.Id, Name = "FP" };
        var invoice = new Pako.Domain.Invoicing.Invoice { Id = Guid.NewGuid(), CompanyId = _company.Id, PartnerId = partner.Id, IssueDate = jan, DueDate = jan, DocumentType = Pako.Domain.Invoicing.DocumentType.Invoice };
        var salesReturn = new Pako.Domain.Invoicing.Invoice { Id = Guid.NewGuid(), CompanyId = _company.Id, PartnerId = partner.Id, IssueDate = jan, DueDate = jan, DocumentType = Pako.Domain.Invoicing.DocumentType.SalesReturn };
        var bill = new Pako.Domain.Bills.Bill { Id = Guid.NewGuid(), CompanyId = _company.Id, PartnerId = partner.Id, VendorReference = "B", IssueDate = jan, DueDate = jan, DocumentType = Pako.Domain.Bills.DocumentType.Bill };
        var purchaseReturn = new Pako.Domain.Bills.Bill { Id = Guid.NewGuid(), CompanyId = _company.Id, PartnerId = partner.Id, VendorReference = "R", IssueDate = jan, DueDate = jan, DocumentType = Pako.Domain.Bills.DocumentType.PurchaseReturn };
        var payroll = new Pako.Domain.Payroll.PayrollRun { Id = Guid.NewGuid(), CompanyId = _company.Id, PeriodStart = jan, PeriodEnd = jan };
        var warehouse = new Pako.Domain.Inventory.Warehouse { Id = Guid.NewGuid(), CompanyId = _company.Id, Code = "W1", Name = "Main" };
        var foreignInvoice = new Pako.Domain.Invoicing.Invoice { Id = Guid.NewGuid(), CompanyId = _other.Id, PartnerId = foreignPartner.Id, IssueDate = jan, DueDate = jan, DocumentType = Pako.Domain.Invoicing.DocumentType.Invoice };
        _db.AddRange(partner, foreignPartner, invoice, salesReturn, bill, purchaseReturn, payroll, warehouse, foreignInvoice);
        await _db.SaveChangesAsync();
        var stock = new Pako.Domain.Inventory.StockDocument { Id = Guid.NewGuid(), CompanyId = _company.Id, WarehouseId = warehouse.Id, Date = jan };
        _db.StockDocuments.Add(stock);
        await _db.SaveChangesAsync();

        var sources = new[] { invoice.Id, salesReturn.Id, bill.Id, purchaseReturn.Id, payroll.Id, stock.Id, foreignInvoice.Id, Guid.NewGuid() };
        foreach (var source in sources)
        {
            _db.AuditEntries.Add(new AuditEntry
            {
                Id = Guid.NewGuid(), CompanyId = _company.Id, EntityType = "JournalEntry", EntityId = Guid.NewGuid().ToString(),
                Action = "Created", OccurredAtUtc = DateTime.UtcNow, SourceDocumentId = source
            });
        }

        await _db.SaveChangesAsync();

        var rows = Value(await Controller().List(_company.Id, "JournalEntry", null));
        string? KindOf(Guid id) => rows.Single(r => r.SourceDocumentId == id).SourceKind;
        Assert.Equal("Invoice", KindOf(invoice.Id));
        Assert.Equal("SalesReturn", KindOf(salesReturn.Id));
        Assert.Equal("Bill", KindOf(bill.Id));
        Assert.Equal("PurchaseReturn", KindOf(purchaseReturn.Id));
        Assert.Equal("PayrollRun", KindOf(payroll.Id));
        Assert.Equal("StockDocument", KindOf(stock.Id));
        Assert.Null(KindOf(foreignInvoice.Id));
        Assert.Null(KindOf(sources[^1]));

        var detail = Value(await Controller().Get(_company.Id, rows.First(r => r.SourceDocumentId == bill.Id).Id));
        Assert.Equal("Bill", detail.Entry.SourceKind);

        var paged = Value(await Controller().ListPaged(_company.Id, entityType: "JournalEntry"));
        Assert.Equal("Invoice", paged.Items.Single(r => r.SourceDocumentId == invoice.Id).SourceKind);
        Assert.All(Value(await Controller().List(_company.Id, "Partner", null)), r => Assert.Null(r.SourceKind));
    }

    [Fact]
    public void EveryAuditAction_IsAdminOnly()
    {
        var actions = typeof(AuditController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes().Any(a => a is Microsoft.AspNetCore.Mvc.Routing.HttpMethodAttribute))
            .ToList();

        Assert.NotEmpty(actions);
        foreach (var action in actions)
        {
            var attribute = action.GetCustomAttribute<RequireCompanyAccessAttribute>();
            Assert.NotNull(attribute);
            Assert.True((bool)attribute!.Arguments![1], $"{action.Name} must be adminOnly");
        }
    }
}
