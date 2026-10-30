using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
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
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Tests;

// The home dashboard: figures agree with the P&L, comparisons line up, sections follow the role,
// and the company layout only accepts widgets from the catalogue.
public class DashboardTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, Guid CompanyId, Guid CustomerId, Guid VendorId);

    // Capital 1000 cash on 1 Jan 2026; invoices of 1000 gross (Feb 2026) and 500 gross (Feb 2025) to
    // the customer; a bill of 400 gross (Mar 2026). All at VAT 18%, so the nets are 847.46, 423.73
    // and 338.98 (the same figures ReportsControllerTests checks against the P&L).
    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var tax = new TaxComputationService();
        var company = new Company { Id = Guid.NewGuid(), Name = "Dash Co" };

        var ids = new Dictionary<string, Guid>();
        foreach (var entry in DefaultChartOfAccountsTemplate.Entries)
        {
            ids[entry.Code] = Guid.NewGuid();
            db.Accounts.Add(new Account
            {
                Id = ids[entry.Code], CompanyId = company.Id, Code = entry.Code, Name = entry.Name,
                AccountType = entry.AccountType, AccountSubType = entry.AccountSubType
            });
        }
        ids["210100"] = Guid.NewGuid();
        db.Accounts.Add(new Account { Id = ids["210100"], CompanyId = company.Id, Code = "210100", Name = "Output VAT", AccountType = AccountType.CurrentLiability });
        ids["113100"] = Guid.NewGuid();
        db.Accounts.Add(new Account { Id = ids["113100"], CompanyId = company.Id, Code = "113100", Name = "Input VAT", AccountType = AccountType.CurrentAsset });

        var taxes = DefaultTaxDefinitionsTemplate.CreateDefaultTaxDefinitions(company.Id, ids);
        db.TaxDefinitions.AddRange(taxes);
        var taxesById = taxes.ToDictionary(t => t.Id);
        var vatSales = taxes.Single(t => t.Name == "VAT 18% (Sales)");
        var vatPurchases = taxes.Single(t => t.Name == "VAT 18% (Purchases)");

        var journal = new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General" };
        db.Journals.Add(journal);
        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Customer Co", IsCustomer = true };
        var vendor = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Vendor Co", IsVendor = true };
        db.Partners.AddRange(customer, vendor);

        var capital = new JournalEntry
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, JournalId = journal.Id, Date = new DateOnly(2026, 1, 1),
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = ids["1000"], Debit = 1000m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = ids["3000"], Credit = 1000m }
            }
        };
        capital.Post(company);
        db.JournalEntries.Add(capital);

        foreach (var (issued, gross) in new[] { (new DateOnly(2026, 2, 1), 1000m), (new DateOnly(2025, 2, 1), 500m) })
        {
            var invoice = new Invoice
            {
                Id = Guid.NewGuid(), CompanyId = company.Id, PartnerId = customer.Id, IssueDate = issued, DueDate = issued.AddDays(30),
                Lines = { new InvoiceLine { Id = Guid.NewGuid(), Description = "Consulting", Quantity = 1m, UnitPrice = gross, RevenueAccountId = ids["4000"], TaxDefinitionId = vatSales.Id } }
            };
            db.JournalEntries.Add(invoice.Post(company, journal.Id, ids["1200"], tax, taxesById, Guid.NewGuid(), Guid.NewGuid()));
            db.Invoices.Add(invoice);
        }

        var bill = new Bill
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, PartnerId = vendor.Id, VendorReference = "V-1",
            IssueDate = new DateOnly(2026, 3, 1), DueDate = new DateOnly(2026, 3, 31),
            Lines = { new BillLine { Id = Guid.NewGuid(), Description = "Rent", Quantity = 1m, UnitPrice = 400m, ExpenseAccountId = ids["6000"], TaxDefinitionId = vatPurchases.Id } }
        };
        db.JournalEntries.Add(bill.Post(company, journal.Id, ids["2000"], tax, taxesById, Guid.NewGuid(), Guid.NewGuid()));
        db.Bills.Add(bill);

        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return new Seed(db, company.Id, customer.Id, vendor.Id);
    }

    private static DashboardController Controller(PakoDbContext db, CompanyAccessContext access) =>
        new(db, new DashboardService(db, access, new TaxComputationService()), access, new NullStringLocalizer<ErrorMessages>());

    private static DashboardKpi Kpi(DashboardResponse r, string key) => r.Kpis.Single(k => k.Key == key);

    [Fact]
    public async Task Dashboard_FiguresMatchTheLedger_AndCompareWithLastYear()
    {
        var seed = await SeedAsync();
        var result = await Controller(seed.Db, CompanyAccessContext.Unrestricted())
            .Get(seed.CompanyId, new DateOnly(2026, 1, 1), new DateOnly(2026, 6, 30), new DateOnly(2025, 1, 1), new DateOnly(2025, 6, 30));
        var r = Assert.IsType<DashboardResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

        Assert.Equal("month", r.Granularity);
        Assert.Equal(6, r.Series.Count);
        Assert.Equal(6, r.CompareSeries!.Count);

        Assert.Equal(847.46m, Kpi(r, "revenue").Current);
        Assert.Equal(423.73m, Kpi(r, "revenue").Previous);
        Assert.Equal(100m, Kpi(r, "revenue").ChangePercent);
        Assert.Equal(338.98m, Kpi(r, "expenses").Current);
        Assert.Equal(508.48m, Kpi(r, "netProfit").Current);
        Assert.Equal(60m, Kpi(r, "netMargin").Current);

        // February holds the invoice; March the bill. Cash only moved with the capital in January.
        Assert.Equal(847.46m, r.Series[1].Revenue);
        Assert.Equal(338.98m, r.Series[2].Expenses);
        Assert.Equal(423.73m, r.CompareSeries[1].Revenue);
        Assert.All(r.Series, p => Assert.Equal(1000m, p.CashBalance));
        Assert.Equal(1000m, Kpi(r, "cash").Current);

        // Receivables are both invoices' gross; payables the bill's gross.
        Assert.Equal(1500m, Kpi(r, "receivables").Current);
        Assert.Equal(400m, Kpi(r, "payables").Current);

        var customer = Assert.Single(r.TopCustomers);
        Assert.Equal("Customer Co", customer.Name);
        Assert.Equal(847.46m, customer.Current);
        Assert.Equal(423.73m, customer.Previous);
        Assert.Equal(338.98m, Assert.Single(r.TopVendors).Current);
        Assert.Equal(1, Kpi(r, "invoiceCount").Current);
        Assert.Equal(847.46m, Kpi(r, "averageInvoice").Current);

        Assert.Equal("4000 Sales Revenue", Assert.Single(r.RevenueByAccount).Name);
        Assert.Equal(338.98m, Assert.Single(r.ExpensesByAccount).Current);

        // At 30 June both invoices are more than 90 days past due; the bill is 91 days past due.
        Assert.Equal(1500m, r.ReceivablesAging.Single(b => b.Key == "d90plus").Amount);
        Assert.Equal(2, r.ReceivablesAging.Single(b => b.Key == "d90plus").Count);
        Assert.Equal(1500m, Kpi(r, "overdueReceivables").Current);
        Assert.Equal(400m, r.PayablesAging.Single(b => b.Key == "d90plus").Amount);
    }

    [Fact]
    public async Task Dashboard_WithoutComparison_HasNoPreviousValues()
    {
        var seed = await SeedAsync();
        var result = await Controller(seed.Db, CompanyAccessContext.Unrestricted())
            .Get(seed.CompanyId, new DateOnly(2026, 2, 1), new DateOnly(2026, 2, 28));
        var r = Assert.IsType<DashboardResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

        Assert.Equal("day", r.Granularity);
        Assert.Equal(28, r.Series.Count);
        Assert.Null(r.CompareSeries);
        Assert.Null(Kpi(r, "revenue").Previous);
        Assert.Null(Kpi(r, "revenue").ChangePercent);
    }

    [Fact]
    public async Task Dashboard_RefusesAPeriodThatEndsBeforeItStarts()
    {
        var seed = await SeedAsync();
        var result = await Controller(seed.Db, CompanyAccessContext.Unrestricted())
            .Get(seed.CompanyId, new DateOnly(2026, 3, 1), new DateOnly(2026, 2, 1));
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Dashboard_SalesRole_SeesSalesButNotTheLedgerOrPurchases()
    {
        var seed = await SeedAsync();
        var userId = Guid.NewGuid();
        var role = new CompanyRole { Id = Guid.NewGuid(), CompanyId = seed.CompanyId, Name = "Sales", SalesAccess = AccessLevel.Write };
        seed.Db.CompanyRoles.Add(role);
        var membership = Membership.ForCompany(userId, seed.CompanyId, MembershipRole.ClientStaff);
        membership.CompanyRoleId = role.Id;
        seed.Db.Memberships.Add(membership);
        await seed.Db.SaveChangesAsync();
        var access = await ResolveAsync(seed.Db, userId, seed.CompanyId);

        var result = await Controller(seed.Db, access).Get(seed.CompanyId, new DateOnly(2026, 1, 1), new DateOnly(2026, 6, 30));
        var r = Assert.IsType<DashboardResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

        Assert.Equal(new DashboardSections(false, true, false, false, false), r.Sections);
        Assert.DoesNotContain(r.Kpis, k => k.Key is "revenue" or "cash" or "netProfit" or "purchasesNet" or "payrollCost");
        Assert.Equal(847.46m, Kpi(r, "salesNet").Current);
        Assert.Single(r.TopCustomers);
        Assert.Empty(r.TopVendors);
        Assert.Empty(r.ExpensesByAccount);
        Assert.All(r.Series, p => Assert.Equal(0m, p.Revenue));
        Assert.Empty(r.PayablesAging);
        Assert.NotEmpty(r.ReceivablesAging);
    }

    [Fact]
    public async Task Layout_DefaultUntilSaved_ValidatesWidgets_AndResets()
    {
        var seed = await SeedAsync();
        var controller = Controller(seed.Db, CompanyAccessContext.Unrestricted());

        var initial = Assert.IsType<DashboardLayoutResponse>(Assert.IsType<OkObjectResult>((await controller.GetLayout(seed.CompanyId)).Result).Value);
        Assert.True(initial.IsDefault);
        Assert.True(initial.CanEdit);
        Assert.Equal(DashboardController.DefaultWidgets.Count, initial.Widgets.Count);

        var widgets = new List<DashboardWidgetConfig> { new("kpi.cash", "hero", 2, true), new("topItems", "table", 4, false) };
        Assert.IsType<OkObjectResult>((await controller.SaveLayout(seed.CompanyId, new SaveDashboardLayoutRequest(widgets))).Result);
        var saved = Assert.IsType<DashboardLayoutResponse>(Assert.IsType<OkObjectResult>((await controller.GetLayout(seed.CompanyId)).Result).Value);
        Assert.False(saved.IsDefault);
        Assert.Equal(widgets, saved.Widgets);

        Assert.IsType<BadRequestObjectResult>((await controller.SaveLayout(seed.CompanyId,
            new SaveDashboardLayoutRequest([new("topItems", "pie", 2, false)]))).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.SaveLayout(seed.CompanyId,
            new SaveDashboardLayoutRequest([new("nope", "tile", 1, false)]))).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.SaveLayout(seed.CompanyId,
            new SaveDashboardLayoutRequest([new("kpi.cash", "tile", 5, false)]))).Result);

        await controller.ResetLayout(seed.CompanyId);
        var reset = Assert.IsType<DashboardLayoutResponse>(Assert.IsType<OkObjectResult>((await controller.GetLayout(seed.CompanyId)).Result).Value);
        Assert.True(reset.IsDefault);
    }

    [Theory]
    [InlineData("2026-01-01", "2026-01-31", null, "day", 31)]
    [InlineData("2026-01-01", "2026-03-31", null, "week", 13)]
    [InlineData("2026-01-01", "2026-12-31", null, "month", 12)]
    [InlineData("2024-01-01", "2026-12-31", null, "quarter", 12)]
    [InlineData("2026-01-01", "2026-12-31", "quarter", "quarter", 4)]
    [InlineData("2026-01-01", "2026-12-31", "day", "month", 12)]
    [InlineData("2026-01-15", "2026-03-10", "month", "month", 3)]
    public void Buckets_FollowTheGranularity(string from, string to, string? requested, string expected, int count)
    {
        var f = DateOnly.Parse(from);
        var t = DateOnly.Parse(to);
        var granularity = DashboardService.ResolveGranularity(f, t, requested);
        Assert.Equal(expected, granularity);
        var buckets = DashboardService.Buckets(f, t, granularity);
        Assert.Equal(count, buckets.Count);
        Assert.Equal(f, buckets[0].Start);
        Assert.Equal(t, buckets[^1].End);
    }

    private static async Task<CompanyAccessContext> ResolveAsync(PakoDbContext db, Guid userId, Guid companyId)
    {
        var access = new CompanyAccessContext();
        var filter = new CompanyAccessFilter(db, access, false, adminOnly: false, AccessModule.None);
        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
        };
        var routeData = new RouteData();
        routeData.Values["companyId"] = companyId.ToString();
        var actionContext = new ActionContext(httpContext, routeData, new ActionDescriptor());
        var executing = new ActionExecutingContext(actionContext, new List<IFilterMetadata>(), new Dictionary<string, object?>(), new object());
        await filter.OnActionExecutionAsync(executing,
            () => Task.FromResult(new ActionExecutedContext(actionContext, new List<IFilterMetadata>(), new object())));
        Assert.Null(executing.Result);
        return access;
    }
}
