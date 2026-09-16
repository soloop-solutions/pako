using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

// IAsyncLifetime: xUnit creates a fresh instance of this class per [Fact] and calls DisposeAsync
// after it finishes, which is what actually closes each test's dedicated Postgres connection —
// without it, connections pile up across the run and Postgres refuses new ones past max_connections.
public class NumberSeriesControllerTests : IAsyncLifetime
{
    private static readonly TaxComputationService TaxService = new();
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private async Task<PakoDbContext> NewContextAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        return db;
    }

    private static NumberSeriesController NewController(PakoDbContext db) =>
        new(db, new NumberSeriesService(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"))
                }
            }
        };

    private static InvoicesController NewInvoicesController(PakoDbContext db) =>
        new(db, TaxService, new DocumentNumberService(), new NumberSeriesService(db), new NullStringLocalizer<ErrorMessages>())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"))
                }
            }
        };

    private async Task<(PakoDbContext Db, Guid CompanyId, Guid PartnerId, Guid InvoiceId, string InvoiceNumber)> SeedPostedInvoiceAsync(bool allowNumberOverride = true)
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co", IsVatRegistered = false, AllowNumberOverride = allowNumberOverride };
        var partnerId = Guid.NewGuid();
        var receivableAccountId = Guid.NewGuid();
        var revenueAccountId = Guid.NewGuid();

        db.Companies.Add(company);
        db.Partners.Add(new Partner { Id = partnerId, CompanyId = company.Id, Name = "Acme", IsCustomer = true });
        db.Accounts.Add(new Account { Id = receivableAccountId, CompanyId = company.Id, Code = "1200", Name = "Accounts Receivable", AccountType = AccountType.Receivable });
        db.Accounts.Add(new Account { Id = revenueAccountId, CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income });
        // B9: PostDraftInvoiceAsync now asks for the Sale journal specifically.
        db.Journals.Add(new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Sale, Code = "SAL", Name = "Sales", SequencePrefix = "SAL", SequenceNextNumber = 1, SequencePadding = 4 });
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            ReceivableAccountId = receivableAccountId,
            PayableAccountId = Guid.NewGuid(),
            RevenueAccountId = revenueAccountId,
            ExpenseAccountId = Guid.NewGuid(),
            CustomerDepositsAccountId = Guid.NewGuid()
        });
        await db.SaveChangesAsync();

        var invoicesController = NewInvoicesController(db);
        var createResult = await invoicesController.Create(company.Id, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Consulting", 1m, 100m, null, null) }));
        var created = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        var postResult = await invoicesController.Post(company.Id, created.Id);
        var posted = Assert.IsType<InvoiceResponse>(Assert.IsType<OkObjectResult>(postResult.Result).Value);

        return (db, company.Id, partnerId, posted.Id, posted.InvoiceNumber!);
    }

    [Fact]
    public async Task Preview_ReturnsProvisionalNumber_WithoutReservingIt()
    {
        var db = await NewContextAsync();
        var companyId = Guid.NewGuid();
        db.Companies.Add(new Company { Id = companyId, Name = "Test Co" });
        await db.SaveChangesAsync();
        var controller = NewController(db);

        var first = await controller.Preview(companyId, "Invoice");
        var second = await controller.Preview(companyId, "Invoice");

        var firstResponse = Assert.IsType<NumberPreviewResponse>(Assert.IsType<OkObjectResult>(first.Result).Value);
        var secondResponse = Assert.IsType<NumberPreviewResponse>(Assert.IsType<OkObjectResult>(second.Result).Value);
        Assert.True(firstResponse.Provisional);
        // Calling Preview twice must not itself have reserved/consumed anything — same answer both times.
        Assert.Equal(firstResponse.Number, secondResponse.Number);
    }

    // B5: a hand-entered number is accepted if free.
    [Fact]
    public async Task OverrideNumber_ToFreeNumber_Succeeds()
    {
        var (db, companyId, _, invoiceId, _) = await SeedPostedInvoiceAsync();
        var controller = NewController(db);

        var result = await controller.OverrideInvoiceNumber(companyId, invoiceId, new OverrideNumberRequest("INV-CUSTOM-0001"));

        Assert.IsType<OkObjectResult>(result);
        var reloaded = await db.Invoices.FindAsync(invoiceId);
        Assert.Equal("INV-CUSTOM-0001", reloaded!.InvoiceNumber);
    }

    // B5: a hand-entered number is refused if already taken by another document in the company.
    [Fact]
    public async Task OverrideNumber_ToTakenNumber_Rejected()
    {
        var (db, companyId, partnerId, invoiceId, _) = await SeedPostedInvoiceAsync();
        var invoicesController = NewInvoicesController(db);
        var secondCreateResult = await invoicesController.Create(companyId, new CreateInvoiceRequest(
            partnerId, new DateOnly(2026, 8, 26), new DateOnly(2026, 9, 25),
            new List<CreateInvoiceLineRequest> { new("Consulting", 1m, 100m, null, null) }));
        var secondCreated = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>(secondCreateResult.Result).Value);
        var secondPostResult = await invoicesController.Post(companyId, secondCreated.Id);
        var secondPosted = Assert.IsType<InvoiceResponse>(Assert.IsType<OkObjectResult>(secondPostResult.Result).Value);
        var controller = NewController(db);

        // Attempt to rename the SECOND invoice to the FIRST invoice's already-issued number.
        var firstInvoice = await db.Invoices.AsNoTracking().FirstAsync(i => i.Id == invoiceId);
        var result = await controller.OverrideInvoiceNumber(companyId, secondPosted.Id, new OverrideNumberRequest(firstInvoice.InvoiceNumber!));

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task OverrideNumber_WhenNotAllowedOnCompany_Rejected()
    {
        var (db, companyId, _, invoiceId, _) = await SeedPostedInvoiceAsync(allowNumberOverride: false);
        var controller = NewController(db);

        var result = await controller.OverrideInvoiceNumber(companyId, invoiceId, new OverrideNumberRequest("INV-CUSTOM-0001"));

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task GapReport_NoGapsAfterSequentialPosting_ReturnsEmpty()
    {
        var (db, companyId, _, _, _) = await SeedPostedInvoiceAsync();
        var controller = NewController(db);

        var result = await controller.GapReport(companyId, "Invoice", 2026);

        var response = Assert.IsType<GapReportResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Empty(response.Gaps);
    }
}
