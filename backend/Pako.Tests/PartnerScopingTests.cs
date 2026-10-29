using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Attachments;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Invoicing;
using Pako.Domain.Payroll;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

// HR module: a ClientStaff user whose department has PartnerScope.Assigned sees only the partners
// assigned to their employee record, and only documents referencing them. Seeded full-stack
// (CompaniesController.Create's real v2 chart + S18/B18 codes) so the sales/purchase books run
// against real posted documents for two partners, A (assigned) and B (not).
public class PartnerScopingTests : IAsyncLifetime
{
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

    private static ClaimsPrincipal PrincipalFor(Guid userId) =>
        new(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"));

    private static T WithUser<T>(T controller, Guid userId) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = PrincipalFor(userId) } };
        return controller;
    }

    private static NullStringLocalizer<ErrorMessages> Localizer => new();

    private static InvoicesController Invoices(PakoDbContext db, CompanyAccessContext access, Guid userId) =>
        WithUser(new InvoicesController(db, new TaxComputationService(), new DocumentNumberService(), new NumberSeriesService(db), Localizer, access), userId);

    private static BillsController Bills(PakoDbContext db, CompanyAccessContext access, Guid userId) =>
        WithUser(new BillsController(db, new TaxComputationService(), Localizer, access), userId);

    private sealed record Scenario(
        PakoDbContext Db, Guid CompanyId, Guid UserId, Guid PartnerA, Guid PartnerB,
        Guid InvoiceA, Guid InvoiceB, Guid BillA, Guid BillB,
        Guid S18, Guid RevenueAccountId);

    private async Task<Scenario> SeedAsync()
    {
        var db = await NewContextAsync();
        var userId = Guid.NewGuid();
        var unrestricted = CompanyAccessContext.Unrestricted();

        var companies = WithUser(new CompaniesController(db, Localizer), userId);
        var company = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(
            (await companies.Create(new CreateCompanyRequest("Scoped Co"))).Result).Value);

        var partners = new PartnersController(db, Localizer, unrestricted);
        async Task<Guid> CreatePartner(string name, string taxNumber) =>
            Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>((await partners.Create(company.Id,
                new CreatePartnerRequest(name, taxNumber, IsCustomer: true, IsVendor: true, IsVatRegistered: true))).Result).Value).Id;
        var partnerA = await CreatePartner("Partner A", "810111111");
        var partnerB = await CreatePartner("Partner B", "810222222");

        var s18 = await db.TaxDefinitions.AsNoTracking().SingleAsync(t => t.CompanyId == company.Id && t.Code == "S18");
        var b18 = await db.TaxDefinitions.AsNoTracking().SingleAsync(t => t.CompanyId == company.Id && t.Code == "B18");
        var defaults = await db.CompanyAccountDefaults.AsNoTracking().SingleAsync(d => d.CompanyId == company.Id);

        var invoices = Invoices(db, unrestricted, userId);
        async Task<Guid> CreateAndPostInvoice(Guid partnerId, decimal amount)
        {
            var created = Assert.IsType<InvoiceResponse>(Assert.IsType<ObjectResult>((await invoices.Create(company.Id, new CreateInvoiceRequest(
                partnerId, new DateOnly(2026, 2, 1), new DateOnly(2026, 3, 1),
                new List<CreateInvoiceLineRequest> { new("Consulting", 1m, amount, s18.Id, defaults.RevenueAccountId) }))).Result).Value);
            Assert.IsType<OkObjectResult>((await invoices.Post(company.Id, created.Id)).Result);
            return created.Id;
        }

        var bills = Bills(db, unrestricted, userId);
        async Task<Guid> CreateAndPostBill(Guid partnerId, string reference)
        {
            var created = Assert.IsType<BillResponse>(Assert.IsType<ObjectResult>((await bills.Create(company.Id, new CreateBillRequest(
                partnerId, reference, new DateOnly(2026, 3, 1), new DateOnly(2026, 3, 31),
                new List<CreateBillLineRequest> { new("Office rent", 1m, 400m, b18.Id, defaults.ExpenseAccountId) }))).Result).Value);
            Assert.IsType<OkObjectResult>((await bills.Post(company.Id, created.Id)).Result);
            return created.Id;
        }

        var invoiceA = await CreateAndPostInvoice(partnerA, 1000m);
        var invoiceB = await CreateAndPostInvoice(partnerB, 500m);
        var billA = await CreateAndPostBill(partnerA, "SUP-A");
        var billB = await CreateAndPostBill(partnerB, "SUP-B");

        return new Scenario(db, company.Id, userId, partnerA, partnerB, invoiceA, invoiceB, billA, billB, s18.Id, defaults.RevenueAccountId);
    }

    private static Department ScopedDepartment(Guid companyId) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = companyId,
        Code = "SALES",
        Name = "Sales",
        SalesAccess = AccessLevel.Write,
        PurchasesAccess = AccessLevel.Write,
        PartnersAccess = AccessLevel.Write,
        AccountingAccess = AccessLevel.Write,
        ReportsAccess = AccessLevel.Read,
        PartnerScope = PartnerScope.Assigned
    };

    private static CompanyAccessContext ScopedTo(Scenario s, Guid employeeId, params Guid[] partnerIds) =>
        CompanyAccessContext.ForStaff(s.CompanyId, s.UserId, employeeId, ScopedDepartment(s.CompanyId), partnerIds.ToHashSet());

    [Fact]
    public async Task ScopedStaff_ListsOnlyAssignedPartnersInvoicesAndBills()
    {
        var s = await SeedAsync();
        var access = ScopedTo(s, Guid.NewGuid(), s.PartnerA);

        var invoices = Assert.IsType<List<InvoiceResponse>>(Assert.IsType<OkObjectResult>(
            (await Invoices(s.Db, access, s.UserId).List(s.CompanyId)).Result).Value);
        Assert.Equal(new[] { s.InvoiceA }, invoices.Select(i => i.Id));

        var bills = Assert.IsType<List<BillResponse>>(Assert.IsType<OkObjectResult>(
            (await Bills(s.Db, access, s.UserId).List(s.CompanyId)).Result).Value);
        Assert.Equal(new[] { s.BillA }, bills.Select(b => b.Id));

        var partners = Assert.IsType<List<PartnerResponse>>(Assert.IsType<OkObjectResult>(
            (await new PartnersController(s.Db, Localizer, access).List(s.CompanyId)).Result).Value);
        Assert.Equal(new[] { s.PartnerA }, partners.Select(p => p.Id));
    }

    [Fact]
    public async Task Unrestricted_SeesBothPartnersDocuments()
    {
        var s = await SeedAsync();
        var access = CompanyAccessContext.Unrestricted();

        var invoices = Assert.IsType<List<InvoiceResponse>>(Assert.IsType<OkObjectResult>(
            (await Invoices(s.Db, access, s.UserId).List(s.CompanyId)).Result).Value);
        Assert.Equal(2, invoices.Count);

        var bills = Assert.IsType<List<BillResponse>>(Assert.IsType<OkObjectResult>(
            (await Bills(s.Db, access, s.UserId).List(s.CompanyId)).Result).Value);
        Assert.Equal(2, bills.Count);

        var partners = Assert.IsType<List<PartnerResponse>>(Assert.IsType<OkObjectResult>(
            (await new PartnersController(s.Db, Localizer, access).List(s.CompanyId)).Result).Value);
        Assert.Equal(2, partners.Count);
    }

    [Fact]
    public async Task ScopedStaff_GetsNotFoundForUnassignedPartnersDocuments()
    {
        var s = await SeedAsync();
        var access = ScopedTo(s, Guid.NewGuid(), s.PartnerA);
        var invoices = Invoices(s.Db, access, s.UserId);

        Assert.IsType<OkObjectResult>((await invoices.Get(s.CompanyId, s.InvoiceA)).Result);
        Assert.IsType<NotFoundResult>((await invoices.Get(s.CompanyId, s.InvoiceB)).Result);
        Assert.IsType<NotFoundResult>((await invoices.Balance(s.CompanyId, s.InvoiceB)).Result);
        Assert.IsType<NotFoundResult>((await Bills(s.Db, access, s.UserId).Get(s.CompanyId, s.BillB)).Result);
        Assert.IsType<NotFoundResult>((await new PartnersController(s.Db, Localizer, access).Get(s.CompanyId, s.PartnerB)).Result);
    }

    [Fact]
    public async Task ScopedStaff_CannotCreateInvoiceForUnassignedPartner()
    {
        var s = await SeedAsync();
        var access = ScopedTo(s, Guid.NewGuid(), s.PartnerA);

        var result = await Invoices(s.Db, access, s.UserId).Create(s.CompanyId, new CreateInvoiceRequest(
            s.PartnerB, new DateOnly(2026, 4, 1), new DateOnly(2026, 5, 1),
            new List<CreateInvoiceLineRequest> { new("Consulting", 1m, 100m, s.S18, s.RevenueAccountId) }));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(Localizer["PartnerNotAssigned"].Value, badRequest.Value);
    }

    [Fact]
    public async Task ScopedStaff_CannotApplyCreditNoteOfUnassignedPartner()
    {
        var s = await SeedAsync();
        var access = ScopedTo(s, Guid.NewGuid(), s.PartnerA);

        // InvoiceB stands in for "some document of partner B" — it must 404 before any
        // credit-note-type validation can leak that it exists.
        var result = await Invoices(s.Db, access, s.UserId).ApplyCreditNote(
            s.CompanyId, s.InvoiceA, new ApplyCreditNoteRequest(s.InvoiceB, 10m));

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task ScopedStaff_IsRefusedLedgerWideReports()
    {
        var s = await SeedAsync();
        var reports = new ReportsController(s.Db, Localizer, ScopedTo(s, Guid.NewGuid(), s.PartnerA), new LedgerAggregator(s.Db));
        var from = new DateOnly(2026, 1, 1);
        var to = new DateOnly(2026, 12, 31);

        var pnl = Assert.IsType<ObjectResult>((await reports.ProfitAndLoss(s.CompanyId, from, to)).Result);
        Assert.Equal(StatusCodes.Status403Forbidden, pnl.StatusCode);
        Assert.Equal(Localizer["ReportNotAvailableForScopedUser"].Value, pnl.Value);

        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>((await reports.BalanceSheet(s.CompanyId, to)).Result).StatusCode);
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>((await reports.VatReturn(s.CompanyId, from, to)).Result).StatusCode);
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>((await reports.CitAddBack(s.CompanyId, from, to)).Result).StatusCode);
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(await reports.ProfitAndLossExport(s.CompanyId, from, to)).StatusCode);
    }

    [Fact]
    public async Task ScopedStaff_SeesFilteredBooksAndDebtAging()
    {
        var s = await SeedAsync();
        var from = new DateOnly(2026, 1, 1);
        var to = new DateOnly(2026, 12, 31);
        var scoped = new ReportsController(s.Db, Localizer, ScopedTo(s, Guid.NewGuid(), s.PartnerA), new LedgerAggregator(s.Db));
        var unrestricted = new ReportsController(s.Db, Localizer, CompanyAccessContext.Unrestricted(), new LedgerAggregator(s.Db));

        var salesBook = Assert.IsType<SalesBookResponse>(Assert.IsType<OkObjectResult>((await scoped.SalesBook(s.CompanyId, from, to)).Result).Value);
        Assert.Equal(new[] { s.InvoiceA }, salesBook.Lines.Select(l => l.InvoiceId));
        var fullSalesBook = Assert.IsType<SalesBookResponse>(Assert.IsType<OkObjectResult>((await unrestricted.SalesBook(s.CompanyId, from, to)).Result).Value);
        Assert.Equal(2, fullSalesBook.Lines.Count);

        var purchaseBook = Assert.IsType<PurchaseBookResponse>(Assert.IsType<OkObjectResult>((await scoped.PurchaseBook(s.CompanyId, from, to)).Result).Value);
        Assert.Equal(new[] { s.BillA }, purchaseBook.Lines.Select(l => l.BillId));

        var aging = Assert.IsType<DebtAgingResponse>(Assert.IsType<OkObjectResult>((await scoped.DebtAging(s.CompanyId, to)).Result).Value);
        Assert.Equal(new[] { s.InvoiceA }, aging.Lines.Select(l => l.InvoiceId));
    }

    [Fact]
    public async Task ScopedStaff_CreatingPartnerAssignsItToThemselves()
    {
        var s = await SeedAsync();
        // EmployeePartnerAssignment has a real FK to employees, so this one needs a real row.
        var department = ScopedDepartment(s.CompanyId);
        var employee = new Employee { Id = Guid.NewGuid(), CompanyId = s.CompanyId, Name = "Scoped Seller", UserId = s.UserId, DepartmentId = department.Id };
        s.Db.Departments.Add(department);
        s.Db.Employees.Add(employee);
        await s.Db.SaveChangesAsync();
        var employeeId = employee.Id;
        var access = CompanyAccessContext.ForStaff(s.CompanyId, s.UserId, employeeId, department, new HashSet<Guid> { s.PartnerA });

        var result = await new PartnersController(s.Db, Localizer, access).Create(s.CompanyId,
            new CreatePartnerRequest("Partner C", null, IsCustomer: true, IsVendor: false));
        var created = Assert.IsType<PartnerResponse>(Assert.IsType<ObjectResult>(result.Result).Value);

        Assert.True(await s.Db.EmployeePartnerAssignments.AnyAsync(a => a.EmployeeId == employeeId && a.PartnerId == created.Id));
    }

    [Fact]
    public async Task ScopedStaff_CannotUpdateUnassignedPartner()
    {
        var s = await SeedAsync();
        var access = ScopedTo(s, Guid.NewGuid(), s.PartnerA);

        var result = await new PartnersController(s.Db, Localizer, access).Update(s.CompanyId, s.PartnerB,
            new UpdatePartnerRequest("Renamed", null, IsCustomer: true, IsVendor: true));

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task ScopedStaff_AttachmentsFollowOwnerVisibility()
    {
        var s = await SeedAsync();
        var access = ScopedTo(s, Guid.NewGuid(), s.PartnerA);
        s.Db.Attachments.Add(new Attachment
        {
            Id = Guid.NewGuid(), CompanyId = s.CompanyId, OwnerType = AttachmentOwnerType.Invoice, OwnerId = s.InvoiceB,
            FileName = "b.pdf", ContentType = "application/pdf", SizeBytes = 1, Content = new byte[] { 1 }, UploadedAtUtc = DateTime.UtcNow, UploadedByUserId = s.UserId
        });
        await s.Db.SaveChangesAsync();
        var attachmentB = await s.Db.Attachments.AsNoTracking().SingleAsync(a => a.OwnerId == s.InvoiceB);
        var controller = WithUser(new AttachmentsController(s.Db, Localizer, access), s.UserId);

        Assert.IsType<OkObjectResult>((await controller.List(s.CompanyId, AttachmentOwnerType.Invoice, s.InvoiceA)).Result);
        Assert.IsType<NotFoundResult>((await controller.List(s.CompanyId, AttachmentOwnerType.Invoice, s.InvoiceB)).Result);
        Assert.IsType<NotFoundResult>(await controller.Download(s.CompanyId, attachmentB.Id));
        Assert.IsType<NotFoundResult>(await controller.Delete(s.CompanyId, attachmentB.Id));
        Assert.IsType<NotFoundResult>((await controller.List(s.CompanyId, AttachmentOwnerType.Partner, s.PartnerB)).Result);
    }

    // ---- CompanyAccessFilter, run directly against a hand-built ActionExecutingContext ----

    private static async Task<(IActionResult? Result, bool NextCalled)> RunFilterAsync(
        PakoDbContext db, CompanyAccessContext access, Guid userId, Guid companyId, bool writeAccess, AccessModule module)
    {
        var filter = new CompanyAccessFilter(db, access, writeAccess, adminOnly: false, module);
        var httpContext = new DefaultHttpContext { User = PrincipalFor(userId) };
        var routeData = new RouteData();
        routeData.Values["companyId"] = companyId.ToString();
        var actionContext = new ActionContext(httpContext, routeData, new ActionDescriptor());
        var executingContext = new ActionExecutingContext(
            actionContext, new List<IFilterMetadata>(), new Dictionary<string, object?>(), controller: new object());

        var nextCalled = false;
        ActionExecutionDelegate next = () =>
        {
            nextCalled = true;
            return Task.FromResult(new ActionExecutedContext(actionContext, new List<IFilterMetadata>(), controller: new object()));
        };

        await filter.OnActionExecutionAsync(executingContext, next);
        return (executingContext.Result, nextCalled);
    }

    private async Task<(PakoDbContext Db, Guid CompanyId, Guid StaffUserId, Guid EmployeeId, Guid PartnerId)> SeedStaffAsync(AccessLevel salesAccess)
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Staff Co" };
        var staffUserId = Guid.NewGuid();
        var department = new Department
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Code = "SALES", Name = "Sales",
            SalesAccess = salesAccess, PartnerScope = PartnerScope.Assigned
        };
        var employee = new Employee { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Staff Member", UserId = staffUserId, DepartmentId = department.Id };
        var partner = new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Assigned Co", IsCustomer = true };

        db.Companies.Add(company);
        db.Departments.Add(department);
        db.Employees.Add(employee);
        db.Partners.Add(partner);
        db.EmployeePartnerAssignments.Add(new EmployeePartnerAssignment { Id = Guid.NewGuid(), CompanyId = company.Id, EmployeeId = employee.Id, PartnerId = partner.Id });
        db.Memberships.Add(Membership.ForCompany(staffUserId, company.Id, MembershipRole.ClientStaff));
        await db.SaveChangesAsync();

        return (db, company.Id, staffUserId, employee.Id, partner.Id);
    }

    [Fact]
    public async Task Filter_ClientStaffWithSalesRead_ForbiddenFromSalesWrite()
    {
        var (db, companyId, userId, _, _) = await SeedStaffAsync(AccessLevel.Read);

        var (result, nextCalled) = await RunFilterAsync(db, new CompanyAccessContext(), userId, companyId, writeAccess: true, AccessModule.Sales);

        Assert.IsType<ForbidResult>(result);
        Assert.False(nextCalled);
    }

    [Fact]
    public async Task Filter_ClientStaffWithSalesRead_AllowedSalesReadAndResolvesAssignedPartners()
    {
        var (db, companyId, userId, employeeId, partnerId) = await SeedStaffAsync(AccessLevel.Read);
        var access = new CompanyAccessContext();

        var (result, nextCalled) = await RunFilterAsync(db, access, userId, companyId, writeAccess: false, AccessModule.Sales);

        Assert.Null(result);
        Assert.True(nextCalled);
        Assert.True(access.IsStaffAccess);
        Assert.Equal(employeeId, access.EmployeeId);
        Assert.Equal(new[] { partnerId }, access.VisiblePartnerIds!.ToArray());
    }

    [Fact]
    public async Task Filter_ClientStaffWithoutEmployeeRecord_Forbidden()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Staff Co" };
        var userId = Guid.NewGuid();
        db.Companies.Add(company);
        db.Memberships.Add(Membership.ForCompany(userId, company.Id, MembershipRole.ClientStaff));
        await db.SaveChangesAsync();

        var (result, _) = await RunFilterAsync(db, new CompanyAccessContext(), userId, company.Id, writeAccess: false, AccessModule.None);

        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task Filter_ClientViewer_UnaffectedByModule()
    {
        var db = await NewContextAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Viewer Co" };
        var userId = Guid.NewGuid();
        db.Companies.Add(company);
        db.Memberships.Add(Membership.ForCompany(userId, company.Id, MembershipRole.ClientViewer));
        await db.SaveChangesAsync();

        var access = new CompanyAccessContext();
        var (readResult, _) = await RunFilterAsync(db, access, userId, company.Id, writeAccess: false, AccessModule.Accounting);
        Assert.Null(readResult);
        Assert.False(access.IsPartnerRestricted);
        Assert.False(access.IsStaffAccess);

        var (writeResult, _) = await RunFilterAsync(db, new CompanyAccessContext(), userId, company.Id, writeAccess: true, AccessModule.Sales);
        Assert.IsType<ForbidResult>(writeResult);
    }
}
