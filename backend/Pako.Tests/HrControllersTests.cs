using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Domain.Payroll;
using Pako.Infrastructure;
using DocumentType = Pako.Domain.Invoicing.DocumentType;

namespace Pako.Tests;

// Departments, employees, payroll adjustments/runs and leave through their controllers, against
// real Postgres (unique indexes, the payroll immutability guard and the migrated CHECK matter).
public class HrControllersTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, Guid CompanyId, Guid BankAccountId, Guid PartnerId, Dictionary<string, Guid> Accounts);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);

        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        db.Companies.Add(company);

        var accounts = new Dictionary<string, Guid>();
        void AddAccount(string code, AccountType type, AccountSubType subType = AccountSubType.None)
        {
            var id = Guid.NewGuid();
            accounts[code] = id;
            db.Accounts.Add(new Account { Id = id, CompanyId = company.Id, Code = code, Name = code, AccountType = type, AccountSubType = subType });
        }

        AddAccount("600100", AccountType.Expense);
        AddAccount("600200", AccountType.Expense);
        AddAccount("600300", AccountType.Expense);
        AddAccount("213100", AccountType.CurrentLiability);
        AddAccount("221100", AccountType.CurrentLiability);
        AddAccount("221200", AccountType.CurrentLiability);
        AddAccount("222100", AccountType.CurrentLiability);
        AddAccount("220100", AccountType.CurrentLiability);
        AddAccount("102100", AccountType.Cash, AccountSubType.Bank);
        AddAccount("111100", AccountType.CurrentAsset);
        AddAccount("110100", AccountType.Receivable);
        AddAccount("700100", AccountType.Income);
        AddAccount("212100", AccountType.CurrentLiability);
        AddAccount("200100", AccountType.Payable);
        AddAccount("600500", AccountType.Expense);

        db.Journals.AddRange(
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.General, Code = "GEN", Name = "General", SequencePrefix = "GEN", SequenceNextNumber = 1, SequencePadding = 4 },
            new Journal { Id = Guid.NewGuid(), CompanyId = company.Id, Type = JournalType.Bank, Code = "BNK", Name = "Bank", SequencePrefix = "BNK", SequenceNextNumber = 1, SequencePadding = 4 });
        db.CompanyAccountDefaults.Add(new CompanyAccountDefaults
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            ReceivableAccountId = Guid.NewGuid(),
            PayableAccountId = Guid.NewGuid(),
            RevenueAccountId = Guid.NewGuid(),
            ExpenseAccountId = Guid.NewGuid(),
            CustomerDepositsAccountId = Guid.NewGuid(),
            SalaryExpenseAccountId = accounts["600100"],
            PitPayableAccountId = accounts["213100"],
            PensionPayableAccountId = accounts["221100"],
            NetPayPayableAccountId = accounts["220100"],
            BonusExpenseAccountId = accounts["600300"],
            EmployerPensionExpenseAccountId = accounts["600200"],
            EmployerPensionPayableAccountId = accounts["221200"],
            PayrollDeductionsAccountId = accounts["222100"]
        });

        var partnerId = Guid.NewGuid();
        db.Partners.Add(new Partner { Id = partnerId, CompanyId = company.Id, Name = "Viva Fresh", IsCustomer = true });
        await db.SaveChangesAsync();

        return new Seed(db, company.Id, accounts["102100"], partnerId, accounts);
    }

    private static ControllerContext UserContext() => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"))
        }
    };

    private static EmployeesController Employees(PakoDbContext db, CompanyAccessContext? access = null) =>
        new(db, access ?? CompanyAccessContext.Unrestricted(), new NullStringLocalizer<ErrorMessages>());

    private static DepartmentsController Departments(PakoDbContext db, CompanyAccessContext? access = null) =>
        new(db, access ?? CompanyAccessContext.Unrestricted(), new NullStringLocalizer<ErrorMessages>());

    private static PayrollRunsController Runs(PakoDbContext db) =>
        new(db, new PayrollRunComposer(db, new PayrollCalculationService(), new PayrollParameterProvider(db)), new PayslipDocumentService(db),
            new NotificationOutbox(db), new NullStringLocalizer<ErrorMessages>()) { ControllerContext = UserContext() };

    private static PayrollAdjustmentsController Adjustments(PakoDbContext db) => new(db, new NullStringLocalizer<ErrorMessages>());

    private static LeaveController Leave(PakoDbContext db) =>
        new(db, LeaveService(db), new NullStringLocalizer<ErrorMessages>()) { ControllerContext = UserContext() };

    private static LeaveService LeaveService(PakoDbContext db) =>
        new(db, new NotificationOutbox(db), new NullStringLocalizer<ErrorMessages>());

    private static CostCentersController CostCenters(PakoDbContext db) => new(db, new NullStringLocalizer<ErrorMessages>());

    private static T Created<T>(ActionResult<T> result) => Assert.IsType<T>(Assert.IsType<ObjectResult>(result.Result).Value);

    private static T Ok<T>(ActionResult<T> result) => Assert.IsType<T>(Assert.IsType<OkObjectResult>(result.Result).Value);

    private static SaveEmployeeRequest EmployeeRequest(string first, decimal salary, Guid? departmentId = null, string? personalNumber = null) =>
        new(first, "Krasniqi", null, personalNumber, null, null, null, null, null, null, "Analyst", departmentId, null, null, null, null, salary);

    private static SaveDepartmentRequest DepartmentRequest(string code, Guid? parentId = null, PartnerScope scope = PartnerScope.All) =>
        new(code, $"Dept {code}", parentId, null, null,
            new DepartmentPermissions(AccessLevel.Write, AccessLevel.None, AccessLevel.Read, AccessLevel.None, AccessLevel.Read, AccessLevel.None),
            scope);

    // ---- Departments ----

    [Fact]
    public async Task Department_CreateAndUpdate_PersistsPermissionMatrix()
    {
        var seed = await SeedAsync();

        var created = Created(await Departments(seed.Db).Create(seed.CompanyId, DepartmentRequest("SALES", scope: PartnerScope.Assigned)));

        Assert.Equal(AccessLevel.Write, created.Permissions.Sales);
        Assert.Equal(PartnerScope.Assigned, created.PartnerScope);
    }

    [Fact]
    public async Task Department_DuplicateCode_Rejected()
    {
        var seed = await SeedAsync();
        await Departments(seed.Db).Create(seed.CompanyId, DepartmentRequest("SALES"));

        var result = await Departments(seed.Db).Create(seed.CompanyId, DepartmentRequest("SALES"));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Department_CannotBecomeItsOwnDescendant()
    {
        var seed = await SeedAsync();
        var parent = Created(await Departments(seed.Db).Create(seed.CompanyId, DepartmentRequest("OPS")));
        var child = Created(await Departments(seed.Db).Create(seed.CompanyId, DepartmentRequest("OPS-A", parent.Id)));

        var result = await Departments(seed.Db).Update(seed.CompanyId, parent.Id, DepartmentRequest("OPS", child.Id));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Department_StaffCannotEditPermissions_EvenWithHrWrite()
    {
        var seed = await SeedAsync();
        var hr = new Department { Id = Guid.NewGuid(), HrAccess = AccessLevel.Write };
        var staff = CompanyAccessContext.ForStaff(seed.CompanyId, Guid.NewGuid(), Guid.NewGuid(), hr, null);

        var result = await Departments(seed.Db, staff).Create(seed.CompanyId, DepartmentRequest("X"));

        Assert.IsType<ForbidResult>(result.Result);
    }

    [Fact]
    public async Task Department_InUse_CannotBeDeleted()
    {
        var seed = await SeedAsync();
        var dept = Created(await Departments(seed.Db).Create(seed.CompanyId, DepartmentRequest("SALES")));
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 800m, dept.Id)));

        Assert.IsType<BadRequestObjectResult>(await Departments(seed.Db).Delete(seed.CompanyId, dept.Id));
    }

    // ---- Employees ----

    [Fact]
    public async Task Employee_Create_BuildsDisplayNameAndFlagsMissingData()
    {
        var seed = await SeedAsync();

        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 300m)));

        Assert.Equal("Arta Krasniqi", employee.Name);
        Assert.Contains("BelowMinimumWage", employee.Warnings);
        Assert.Contains("MissingPersonalNumber", employee.Warnings);
        Assert.Contains("MissingIban", employee.Warnings);
    }

    [Fact]
    public async Task Employee_DuplicatePersonalNumber_Rejected()
    {
        var seed = await SeedAsync();
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 800m, personalNumber: "1234567890")));

        var result = await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Blerim", 800m, personalNumber: "1234567890"));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Employee_StaffMayMoveDepartments_ButNeverLinkALogin()
    {
        // Departments no longer grant access (roles do), so moving someone is a plain HR edit;
        // linking a login stays user management (docs/USER_ACCESS_PLAN.md).
        var seed = await SeedAsync();
        var dept = Created(await Departments(seed.Db).Create(seed.CompanyId, DepartmentRequest("SALES")));
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 800m)));
        var hrOfficer = new CompanyRole { Id = Guid.NewGuid(), CompanyId = seed.CompanyId, Name = "HR", HrAccess = AccessLevel.Approve };
        var staff = CompanyAccessContext.ForStaff(seed.CompanyId, Guid.NewGuid(), null, hrOfficer, null);

        var moved = Ok(await Employees(seed.Db, staff).Update(seed.CompanyId, employee.Id, EmployeeRequest("Arta", 800m, dept.Id)));
        Assert.Equal(dept.Id, moved.DepartmentId);

        var linked = await Employees(seed.Db, staff).Update(seed.CompanyId, employee.Id,
            EmployeeRequest("Arta", 800m, dept.Id) with { UserId = Guid.NewGuid() });
        Assert.IsType<ForbidResult>(linked.Result);
    }

    [Fact]
    public async Task Employee_PayDataHiddenAndUntouched_WithoutPayrollAccess()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId,
            EmployeeRequest("Arta", 1200m) with { Iban = "XK051212012345678906" }));
        var hrOnly = CompanyAccessContext.ForStaff(seed.CompanyId, Guid.NewGuid(), null,
            new CompanyRole { Id = Guid.NewGuid(), CompanyId = seed.CompanyId, Name = "HR", HrAccess = AccessLevel.Approve }, null);

        var seen = Ok(await Employees(seed.Db, hrOnly).Get(seed.CompanyId, employee.Id));
        Assert.True(seen.PayDataHidden);
        Assert.Equal(0m, seen.MonthlyGrossSalary);
        Assert.Null(seen.Iban);

        // Saving what HR saw (salary 0, no IBAN) changes neither.
        Ok(await Employees(seed.Db, hrOnly).Update(seed.CompanyId, employee.Id, EmployeeRequest("Arta", 0m) with { JobTitle = "Lead" }));
        var stored = await seed.Db.Employees.AsNoTracking().SingleAsync(e => e.Id == employee.Id);
        Assert.Equal(1200m, stored.MonthlyGrossSalary);
        Assert.Equal("XK051212012345678906", stored.Iban);
        Assert.Equal("Lead", stored.JobTitle);
    }

    [Fact]
    public async Task Employee_PartnerAssignments_ReplaceTheWholeSet()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 800m)));
        var second = new Partner { Id = Guid.NewGuid(), CompanyId = seed.CompanyId, Name = "Meridian", IsCustomer = true };
        seed.Db.Partners.Add(second);
        await seed.Db.SaveChangesAsync();

        await Employees(seed.Db).SetPartners(seed.CompanyId, employee.Id, new SetEmployeePartnersRequest(new List<Guid> { seed.PartnerId, second.Id }));
        var after = Ok(await Employees(seed.Db).SetPartners(seed.CompanyId, employee.Id, new SetEmployeePartnersRequest(new List<Guid> { second.Id })));

        Assert.Equal("Meridian", Assert.Single(after).Name);
    }

    [Fact]
    public async Task Employee_PartnerFromAnotherCompany_Rejected()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 800m)));

        var result = await Employees(seed.Db).SetPartners(seed.CompanyId, employee.Id, new SetEmployeePartnersRequest(new List<Guid> { Guid.NewGuid() }));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Contract_Overlapping_Rejected_AndCurrentContractDrivesSalary()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 600m)));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        Created(await Employees(seed.Db).CreateContract(seed.CompanyId, employee.Id,
            new SaveEmployeeContractRequest(today.AddYears(-1), null, 950m, EmploymentType.FullTime, 40m, null, null)));
        var overlap = await Employees(seed.Db).CreateContract(seed.CompanyId, employee.Id,
            new SaveEmployeeContractRequest(today, null, 1000m, EmploymentType.FullTime, 40m, null, null));

        Assert.IsType<BadRequestObjectResult>(overlap.Result);
        Assert.Equal(950m, Ok(await Employees(seed.Db).Get(seed.CompanyId, employee.Id)).CurrentSalary);
    }

    // ---- Payroll ----

    private static readonly DateOnly Sep1 = new(2026, 9, 1);
    private static readonly DateOnly Sep30 = new(2026, 9, 30);

    [Fact]
    public async Task Run_ConsumesAdjustments_AndDeleteReleasesThem()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        var bonus = Created(await Adjustments(seed.Db).Create(seed.CompanyId,
            new SavePayrollAdjustmentRequest(employee.Id, new DateOnly(2026, 9, 15), PayrollAdjustmentKind.Bonus, "Q3", 200m, null, null)));
        Assert.Equal(Sep1, bonus.Period);

        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));

        var slip = Assert.Single(run.Lines);
        Assert.Equal(200m, slip.BonusAmount);
        Assert.Equal(1200m, slip.GrossSalary);
        Assert.Equal(run.Id, (await seed.Db.PayrollAdjustments.AsNoTracking().SingleAsync()).PayrollRunId);

        // Consumed: can't edit it any more.
        var edit = await Adjustments(seed.Db).Update(seed.CompanyId, bonus.Id,
            new SavePayrollAdjustmentRequest(employee.Id, Sep1, PayrollAdjustmentKind.Bonus, "Q3", 300m, null, null));
        Assert.IsType<BadRequestObjectResult>(edit.Result);

        Assert.IsType<NoContentResult>(await Runs(seed.Db).Delete(seed.CompanyId, run.Id));
        Assert.Null((await seed.Db.PayrollAdjustments.AsNoTracking().SingleAsync()).PayrollRunId);
    }

    // ---- D6 payslip documents ----

    [Fact]
    public async Task Payslip_CarriesDepartmentCostCenterSnapshot()
    {
        var seed = await SeedAsync();
        var costCenter = new CostCenter { Id = Guid.NewGuid(), CompanyId = seed.CompanyId, Code = "ADM", Name = "Administration" };
        seed.Db.CostCenters.Add(costCenter);
        await seed.Db.SaveChangesAsync();
        var department = Created(await Departments(seed.Db).Create(seed.CompanyId, DepartmentRequest("FIN") with { CostCenterId = costCenter.Id }));
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m, department.Id)));

        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));

        var slip = Assert.Single(run.Lines);
        Assert.Equal(costCenter.Id, slip.CostCenterId);
        Assert.Equal("ADM Administration", slip.CostCenterName);
    }

    [Fact]
    public async Task PayslipPdf_RendersOnePagePdf_AndUnknownLineIs404()
    {
        var seed = await SeedAsync();
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));
        var slip = Assert.Single(run.Lines);

        var file = Assert.IsType<FileContentResult>(await Runs(seed.Db).PayslipPdf(seed.CompanyId, run.Id, slip.Id));

        Assert.Equal("application/pdf", file.ContentType);
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(file.FileContents, 0, 4));
        Assert.Equal(1, PdfPageCount(file.FileContents));
        Assert.Equal("payslip-202609-Arta-Krasniqi.pdf", file.FileDownloadName);
        Assert.IsType<NotFoundResult>(await Runs(seed.Db).PayslipPdf(seed.CompanyId, run.Id, Guid.NewGuid()));
    }

    [Fact]
    public async Task PayslipsZip_HasOnePdfPerEmployee_EvenWithDuplicateNames()
    {
        var seed = await SeedAsync();
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m, personalNumber: "1000000001")));
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 900m, personalNumber: "1000000002")));
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Blerim", 800m)));
        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));

        var file = Assert.IsType<FileContentResult>(await Runs(seed.Db).PayslipsZip(seed.CompanyId, run.Id));

        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(file.FileContents));
        Assert.Equal(3, zip.Entries.Count);
        Assert.Equal(3, zip.Entries.Select(e => e.Name).Distinct().Count());
        Assert.All(zip.Entries, e => Assert.EndsWith(".pdf", e.Name));
    }

    [Fact]
    public async Task AnnualStatementPdf_UnknownEmployeeIs404_KnownRenders()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m, personalNumber: "1234567890")));

        Assert.IsType<NotFoundResult>(await Runs(seed.Db).AnnualStatementPdf(seed.CompanyId, Guid.NewGuid(), 2026));
        var file = Assert.IsType<FileContentResult>(await Runs(seed.Db).AnnualStatementPdf(seed.CompanyId, employee.Id, 2026));
        Assert.Equal("annual-statement-2026-1234567890.pdf", file.FileDownloadName);
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(file.FileContents, 0, 4));
    }

    [Fact]
    public async Task Post_QueuesPayslipEmail_OnlyForOptedInEmployees_WithPdfAttached()
    {
        var seed = await SeedAsync();
        Created(await Employees(seed.Db).Create(seed.CompanyId,
            EmployeeRequest("Arta", 1000m) with { Email = "arta@x.test", ReceivePayslipsByEmail = true, PreferredLanguage = "en" }));
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Blerim", 900m) with { Email = "blerim@x.test" }));
        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));
        Ok(await Runs(seed.Db).Approve(seed.CompanyId, run.Id));

        // Nothing is queued before posting: a Draft or Approved slip isn't final.
        Assert.Empty(await seed.Db.Notifications.AsNoTracking().ToListAsync());

        Ok(await Runs(seed.Db).Post(seed.CompanyId, run.Id));

        var queued = Assert.Single(await seed.Db.Notifications.AsNoTracking().ToListAsync());
        Assert.Equal("arta@x.test", queued.RecipientEmail);
        Assert.Equal(NotificationAttachments.PayslipLine, queued.AttachmentKind);

        var sender = new CapturingSender();
        var dispatcher = new NotificationDispatcher(seed.Db, sender,
            new NotificationRenderer(Microsoft.Extensions.Options.Options.Create(new EmailOptions())), new PayslipDocumentService(seed.Db),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<NotificationDispatcher>.Instance);
        Assert.Equal(1, await dispatcher.DeliverDueAsync(DateTime.UtcNow));

        var message = Assert.Single(sender.Sent);
        Assert.Equal("Your payslip for 09.2026 — Test Co", message.Subject);
        var pdf = Assert.Single(message.Attachments);
        Assert.Equal("payslip-202609-Arta-Krasniqi.pdf", pdf.FileName);
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(pdf.Content, 0, 4));
    }

    private sealed class CapturingSender : IEmailSender
    {
        public List<EmailMessage> Sent { get; } = new();

        public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
        {
            Sent.Add(message);
            return Task.CompletedTask;
        }
    }

    // Counts "/Type /Page" objects (not "/Pages"); good enough for QuestPDF's uncompressed object table.
    private static int PdfPageCount(byte[] pdf) =>
        System.Text.RegularExpressions.Regex.Matches(System.Text.Encoding.Latin1.GetString(pdf), @"/Type\s*/Page(?!s)").Count;

    [Fact]
    public async Task Run_OverlappingPeriod_Rejected()
    {
        var seed = await SeedAsync();
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));

        var result = await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(new DateOnly(2026, 9, 15), new DateOnly(2026, 10, 14)));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Run_Recompute_PicksUpAnAdjustmentAddedAfterCreation()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));
        Created(await Adjustments(seed.Db).Create(seed.CompanyId,
            new SavePayrollAdjustmentRequest(employee.Id, Sep1, PayrollAdjustmentKind.Overtime, null, null, 10m, null)));

        var recomputed = Ok(await Runs(seed.Db).Recompute(seed.CompanyId, run.Id));

        // 1,000 / 173.33 h × 10 h × 1.30.
        Assert.Equal(75m, Assert.Single(recomputed.Lines).OtherAdditionsAmount);
    }

    [Fact]
    public async Task Run_TerminatedBeforePeriod_IsExcluded()
    {
        var seed = await SeedAsync();
        var request = EmployeeRequest("Arta", 1000m) with { HireDate = new DateOnly(2025, 1, 1), TerminationDate = new DateOnly(2026, 8, 31) };
        Created(await Employees(seed.Db).Create(seed.CompanyId, request));
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Blerim", 900m)));

        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));

        Assert.Equal("Blerim Krasniqi", Assert.Single(run.Lines).EmployeeName);
    }

    [Fact]
    public async Task Run_ApprovePostPay_FullWorkflow()
    {
        var seed = await SeedAsync();
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));

        Assert.Equal("Approved", Ok(await Runs(seed.Db).Approve(seed.CompanyId, run.Id)).State);

        // Approved runs can't be recomputed or deleted.
        Assert.IsType<BadRequestObjectResult>(await Runs(seed.Db).Delete(seed.CompanyId, run.Id));

        var posted = Ok(await Runs(seed.Db).Post(seed.CompanyId, run.Id));
        Assert.Equal("Posted", posted.State);
        Assert.Equal(1050m, posted.Totals.EmployerCost);

        var accrual = await seed.Db.JournalEntries.Include(e => e.Lines).AsNoTracking().SingleAsync(e => e.Id == posted.JournalEntryId);
        Assert.Equal(50m, accrual.Lines.Single(l => l.AccountId == seed.Accounts["221200"]).Credit);
        Assert.Equal(50m, accrual.Lines.Single(l => l.AccountId == seed.Accounts["600200"]).Debit);

        var paid = Ok(await Runs(seed.Db).Pay(seed.CompanyId, run.Id, new PayPayrollRunRequest(new DateOnly(2026, 10, 5), seed.BankAccountId)));
        Assert.Equal("Paid", paid.State);
        Assert.NotNull(paid.PaymentJournalEntryId);

        // A Paid run is frozen at the database level too.
        var tracked = await seed.Db.PayrollRuns.SingleAsync(r => r.Id == run.Id);
        tracked.Notes = "edit";
        await Assert.ThrowsAsync<PostedPayrollRunImmutableException>(() => seed.Db.SaveChangesAsync());
    }

    [Fact]
    public async Task Run_PayRejectsNonBankAccount()
    {
        var seed = await SeedAsync();
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));
        Ok(await Runs(seed.Db).Post(seed.CompanyId, run.Id));

        var result = await Runs(seed.Db).Pay(seed.CompanyId, run.Id, new PayPayrollRunRequest(Sep30, seed.Accounts["600100"]));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task AnnualStatement_SumsOnlyPostedRunsOfTheYear()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        var august = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(new DateOnly(2026, 8, 1), new DateOnly(2026, 8, 31))));
        Ok(await Runs(seed.Db).Post(seed.CompanyId, august.Id));
        Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30))); // stays Draft

        var statement = Ok(await Runs(seed.Db).AnnualStatement(seed.CompanyId, employee.Id, 2026));

        Assert.Single(statement.Months);
        Assert.Equal(1000m, statement.TotalGross);
        Assert.Equal(66m, statement.TotalPit);
    }

    // ---- Leave ----

    [Fact]
    public async Task Leave_SeedsKosovoDefaults_CountsWorkingDays_AndUnpaidLeaveReducesPay()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 2200m)));
        var types = Ok(await Leave(seed.Db).ListTypes(seed.CompanyId));
        var unpaid = types.Single(t => t.Code == "UNPAID");
        Assert.Contains(types, t => t.Code == "ANNUAL" && t.DefaultAnnualDays == 20m);

        // Mon 7 – Sun 13 Sep 2026: five working days.
        var request = Created(await Leave(seed.Db).CreateRequest(seed.CompanyId,
            new CreateLeaveRequestRequest(employee.Id, unpaid.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 13), null)));
        Assert.Equal(5m, request.Days);
        Assert.Equal("Approved", Ok(await Leave(seed.Db).Approve(seed.CompanyId, request.Id)).State);

        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));

        Assert.Equal(1700m, Assert.Single(run.Lines).BaseSalary); // 2,200 × 17 / 22.
    }

    [Fact]
    public async Task Leave_OverlapAndBalance_AreEnforced()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        var annual = Ok(await Leave(seed.Db).ListTypes(seed.CompanyId)).Single(t => t.Code == "ANNUAL");

        Created(await Leave(seed.Db).CreateRequest(seed.CompanyId,
            new CreateLeaveRequestRequest(employee.Id, annual.Id, new DateOnly(2026, 11, 2), new DateOnly(2026, 11, 6), null)));

        var overlap = await Leave(seed.Db).CreateRequest(seed.CompanyId,
            new CreateLeaveRequestRequest(employee.Id, annual.Id, new DateOnly(2026, 11, 5), new DateOnly(2026, 11, 9), null));
        Assert.IsType<BadRequestObjectResult>(overlap.Result);

        // 5 pending + 16 more working days > 20 allocated.
        var tooLong = await Leave(seed.Db).CreateRequest(seed.CompanyId,
            new CreateLeaveRequestRequest(employee.Id, annual.Id, new DateOnly(2026, 11, 9), new DateOnly(2026, 11, 30), null));
        Assert.IsType<BadRequestObjectResult>(tooLong.Result);

        var balance = Ok(await Leave(seed.Db).Balances(seed.CompanyId, 2026, employee.Id)).Single(b => b.LeaveTypeId == annual.Id);
        Assert.Equal(5m, balance.Pending);
        Assert.Equal(15m, balance.Remaining);
    }

    [Fact]
    public async Task Leave_Allocation_OverrideIsFlagged_AndResetRestoresTheDefault()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        var annual = Ok(await Leave(seed.Db).ListTypes(seed.CompanyId)).Single(t => t.Code == "ANNUAL");

        var initial = Ok(await Leave(seed.Db).Balances(seed.CompanyId, 2026, employee.Id)).Single(b => b.LeaveTypeId == annual.Id);
        Assert.False(initial.IsOverride);

        var overridden = Ok(await Leave(seed.Db).SetAllocation(seed.CompanyId, new SaveLeaveAllocationRequest(employee.Id, annual.Id, 2026, 25m)));
        Assert.True(overridden.IsOverride);
        Assert.Equal(25m, overridden.Allocated);

        Assert.IsType<NoContentResult>(await Leave(seed.Db).ResetAllocation(seed.CompanyId, employee.Id, annual.Id, 2026));
        var reset = Ok(await Leave(seed.Db).Balances(seed.CompanyId, 2026, employee.Id)).Single(b => b.LeaveTypeId == annual.Id);
        Assert.False(reset.IsOverride);
        Assert.Equal(20m, reset.Allocated);

        Assert.IsType<NotFoundResult>(await Leave(seed.Db).ResetAllocation(seed.CompanyId, employee.Id, annual.Id, 2026));
    }

    [Fact]
    public async Task Employee_List_WithoutLogin_LeavesOutLinkedEmployees()
    {
        var seed = await SeedAsync();
        var linked = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Blerim", 1000m)));
        var tracked = await seed.Db.Employees.SingleAsync(e => e.Id == linked.Id);
        tracked.UserId = Guid.NewGuid();
        await seed.Db.SaveChangesAsync();

        var page = Ok(await Employees(seed.Db).List(seed.CompanyId, withoutLogin: true));

        Assert.Equal("Blerim Krasniqi", Assert.Single(page.Items).Name);
    }

    [Fact]
    public async Task Run_SnapshotsTheStatutoryValues_AndALaterFirmOverrideDoesNotChangeIt()
    {
        var seed = await SeedAsync();
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));
        Assert.Equal(0.05m, run.Parameters!.PensionEmployerRate);

        var firm = new Firm { Id = Guid.NewGuid(), Name = "Firm" };
        seed.Db.Firms.Add(firm);
        (await seed.Db.Companies.SingleAsync(c => c.Id == seed.CompanyId)).FirmId = firm.Id;
        seed.Db.StatutoryParameters.Add(new StatutoryParameter
        {
            Id = Guid.NewGuid(), FirmId = firm.Id, Key = StatutoryParameterKeys.PensionEmployerRate,
            EffectiveFrom = new DateOnly(2026, 1, 1), Value = 0.07m, CreatedAt = DateTimeOffset.UtcNow
        });
        await seed.Db.SaveChangesAsync();

        var reread = Ok(await Runs(seed.Db).Get(seed.CompanyId, run.Id));
        Assert.Equal(0.05m, reread.Parameters!.PensionEmployerRate);
        Assert.Equal(50m, reread.Totals.EmployerPension);

        // Recomputing the Draft picks the override up.
        var recomputed = Ok(await Runs(seed.Db).Recompute(seed.CompanyId, run.Id));
        Assert.Equal(0.07m, recomputed.Parameters!.PensionEmployerRate);
        Assert.Equal(70m, recomputed.Totals.EmployerPension);
    }

    // ---- Cost centers ----

    [Fact]
    public async Task CostCenter_CreateNormalisesCode_AndRejectsDuplicates()
    {
        var seed = await SeedAsync();
        var created = Created(await CostCenters(seed.Db).Create(seed.CompanyId, new SaveCostCenterRequest(" sales ", "Shitjet", null)));
        Assert.Equal("SALES", created.Code);
        Assert.Equal("Shitjet", created.NameEn); // Falls back to the Albanian name.

        var duplicate = await CostCenters(seed.Db).Create(seed.CompanyId, new SaveCostCenterRequest("SALES", "Other", null));
        Assert.IsType<BadRequestObjectResult>(duplicate.Result);
        Assert.Single(Ok(await CostCenters(seed.Db).List(seed.CompanyId)));
    }

    [Fact]
    public async Task CostCenter_FromAnotherCompany_RejectedOnDepartment()
    {
        var seed = await SeedAsync();
        var other = await SeedAsync();
        var foreign = Created(await CostCenters(other.Db).Create(other.CompanyId, new SaveCostCenterRequest("X", "Foreign", null)));

        var result = await Departments(seed.Db).Create(seed.CompanyId, DepartmentRequest("SALES") with { CostCenterId = foreign.Id });

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CostCenter_OnDepartment_TagsThePostedPayrollExpense()
    {
        var seed = await SeedAsync();
        var costCenter = Created(await CostCenters(seed.Db).Create(seed.CompanyId, new SaveCostCenterRequest("SALES", "Shitjet", "Sales")));
        var department = Created(await Departments(seed.Db).Create(seed.CompanyId, DepartmentRequest("SALES") with { CostCenterId = costCenter.Id }));
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m, department.Id)));

        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));
        Ok(await Runs(seed.Db).Approve(seed.CompanyId, run.Id));
        var posted = Ok(await Runs(seed.Db).Post(seed.CompanyId, run.Id));

        var accrual = await seed.Db.JournalEntries.Include(e => e.Lines).AsNoTracking().SingleAsync(e => e.Id == posted.JournalEntryId);
        var salary = accrual.Lines.Single(l => l.AccountId == seed.Accounts["600100"]);
        Assert.Equal(100m, salary.AnalyticDistribution![costCenter.Id]);
    }

    // ---- G10 salary advances and loans ----

    private static EmployeeLoansController Loans(PakoDbContext db) =>
        new(db, new EmployeeLoanService(db), new NullStringLocalizer<ErrorMessages>()) { ControllerContext = UserContext() };

    private static readonly DateOnly Oct1 = new(2026, 10, 1);
    private static readonly DateOnly Oct31 = new(2026, 10, 31);
    private static readonly DateOnly Nov1 = new(2026, 11, 1);
    private static readonly DateOnly Nov30 = new(2026, 11, 30);

    private async Task<(Seed Seed, EmployeeDetailResponse Employee, EmployeeLoanResponse Loan)> LoanSeedAsync(decimal principal = 250m, decimal installment = 100m)
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        var loan = Created(await Loans(seed.Db).Create(seed.CompanyId, new CreateEmployeeLoanRequest(
            employee.Id, EmployeeLoanKind.Advance, principal, new DateOnly(2026, 8, 20), installment, Sep1, seed.BankAccountId, "Rent")));
        return (seed, employee, loan);
    }

    private async Task<PayrollRunDetailResponse> PostRunAsync(Seed seed, DateOnly start, DateOnly end)
    {
        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(start, end)));
        return Ok(await Runs(seed.Db).Post(seed.CompanyId, run.Id));
    }

    [Fact]
    public async Task Loan_Issue_PostsDisbursement_Dr111100_CrBank()
    {
        var (seed, employee, loan) = await LoanSeedAsync();

        Assert.Equal("Active", loan.State);
        Assert.Equal(250m, loan.Outstanding);
        var entry = await seed.Db.JournalEntries.Include(e => e.Lines).AsNoTracking().SingleAsync(e => e.Id == loan.DisbursementJournalEntryId);
        Assert.Equal(250m, entry.Lines.Single(l => l.AccountId == seed.Accounts["111100"]).Debit);
        Assert.Equal(employee.Id, entry.Lines.Single(l => l.AccountId == seed.Accounts["111100"]).EmployeeId);
        Assert.Equal(250m, entry.Lines.Single(l => l.AccountId == seed.BankAccountId).Credit);
    }

    [Fact]
    public async Task Loan_RecoveredInInstallments_LastOneCapped_SettlesOnPost()
    {
        var (seed, _, loan) = await LoanSeedAsync();

        var sep = await PostRunAsync(seed, Sep1, Sep30);
        var slip = Assert.Single(sep.Lines);
        Assert.Equal(100m, slip.DeductionsAmount);
        Assert.Contains(slip.Adjustments, a => a.Kind == PayrollAdjustmentKind.LoanRepayment && a.Amount == 100m && a.EmployeeLoanId == loan.Id);
        var accrual = await seed.Db.JournalEntries.Include(e => e.Lines).AsNoTracking().SingleAsync(e => e.Id == sep.JournalEntryId);
        Assert.Equal(100m, accrual.Lines.Single(l => l.AccountId == seed.Accounts["111100"]).Credit);
        // The repayment credits 111100, not the deductions liability (which posts its usual zero line).
        Assert.Equal(0m, accrual.Lines.Where(l => l.AccountId == seed.Accounts["222100"]).Sum(l => l.Credit));

        await PostRunAsync(seed, Oct1, Oct31);
        var nov = await PostRunAsync(seed, Nov1, Nov30);
        Assert.Equal(50m, Assert.Single(nov.Lines).DeductionsAmount);

        var settled = Ok(await Loans(seed.Db).Get(seed.CompanyId, loan.Id));
        Assert.Equal("Settled", settled.State);
        Assert.Equal(0m, settled.Outstanding);
        Assert.Equal(3, settled.Repayments.Count);

        // Nothing more is taken once settled.
        var dec = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(new DateOnly(2026, 12, 1), new DateOnly(2026, 12, 31))));
        Assert.Equal(0m, Assert.Single(dec.Lines).DeductionsAmount);
    }

    [Fact]
    public async Task Loan_RecomputeNeverDoublesARepayment_AndDeletingTheDraftReleasesIt()
    {
        var (seed, _, loan) = await LoanSeedAsync();
        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));

        var recomputed = Ok(await Runs(seed.Db).Recompute(seed.CompanyId, run.Id));
        Assert.Equal(100m, Assert.Single(recomputed.Lines).DeductionsAmount);
        Assert.Equal(1, await seed.Db.PayrollAdjustments.CountAsync(a => a.EmployeeLoanId == loan.Id));

        // A draft holding the installment counts against the balance for another run.
        Assert.Equal(100m, Ok(await Loans(seed.Db).Get(seed.CompanyId, loan.Id)).InDraftRuns);

        Assert.IsType<NoContentResult>(await Runs(seed.Db).Delete(seed.CompanyId, run.Id));
        Assert.Equal(0, await seed.Db.PayrollAdjustments.CountAsync(a => a.EmployeeLoanId == loan.Id));
    }

    [Fact]
    public async Task Loan_CancelReversesThePayout_OnlyBeforeAnyRecovery()
    {
        var (seed, employee, loan) = await LoanSeedAsync();
        var cancelled = Ok(await Loans(seed.Db).Cancel(seed.CompanyId, loan.Id, Sep30));
        Assert.Equal("Cancelled", cancelled.State);
        var reversal = await seed.Db.JournalEntries.Include(e => e.Lines).AsNoTracking()
            .SingleAsync(e => e.SourceDocumentId == loan.Id && e.Id != loan.DisbursementJournalEntryId);
        Assert.Equal(250m, reversal.Lines.Single(l => l.AccountId == seed.Accounts["111100"]).Credit);

        var second = Created(await Loans(seed.Db).Create(seed.CompanyId, new CreateEmployeeLoanRequest(
            employee.Id, EmployeeLoanKind.Loan, 300m, Sep1, 100m, Sep1, seed.BankAccountId, null)));
        await PostRunAsync(seed, Sep1, Sep30);
        Assert.IsType<BadRequestObjectResult>((await Loans(seed.Db).Cancel(seed.CompanyId, second.Id, null)).Result);
    }

    [Fact]
    public async Task Loan_RepaymentCannotBeTypedByHand()
    {
        var (seed, employee, _) = await LoanSeedAsync();
        var result = await Adjustments(seed.Db).Create(seed.CompanyId,
            new SavePayrollAdjustmentRequest(employee.Id, Sep1, PayrollAdjustmentKind.LoanRepayment, null, 50m, null, null));
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // ---- G11 commission ----

    private async Task<Guid> PostedSaleAsync(Seed seed, Guid partnerId, DateOnly date, decimal net, DocumentType type = DocumentType.Invoice)
    {
        var sign = type is DocumentType.CreditNote or DocumentType.SalesReturn ? -1m : 1m;
        var vat = Math.Round(net * 0.18m, 2);
        var gross = net + vat;
        var company = await seed.Db.Companies.FirstAsync(c => c.Id == seed.CompanyId);
        var journal = await seed.Db.Journals.FirstAsync(j => j.CompanyId == seed.CompanyId);
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(), CompanyId = seed.CompanyId, JournalId = journal.Id, Date = date,
            Lines = new List<JournalEntryLine>
            {
                new() { Id = Guid.NewGuid(), AccountId = seed.Accounts["110100"], PartnerId = partnerId, Debit = sign > 0 ? gross : 0m, Credit = sign < 0 ? gross : 0m },
                new() { Id = Guid.NewGuid(), AccountId = seed.Accounts["700100"], Credit = sign > 0 ? net : 0m, Debit = sign < 0 ? net : 0m },
                new() { Id = Guid.NewGuid(), AccountId = seed.Accounts["212100"], Credit = sign > 0 ? vat : 0m, Debit = sign < 0 ? vat : 0m }
            }
        };
        entry.Post(company);
        var invoice = new Pako.Domain.Invoicing.Invoice
        {
            Id = Guid.NewGuid(), CompanyId = seed.CompanyId, PartnerId = partnerId, IssueDate = date, DueDate = date,
            State = Pako.Domain.Invoicing.InvoiceState.Posted, DocumentType = type, JournalEntryId = entry.Id,
            InvoiceNumber = $"INV-{Guid.NewGuid():N}"[..12],
            Lines = new List<Pako.Domain.Invoicing.InvoiceLine>
            {
                new() { Id = Guid.NewGuid(), Description = "Goods", Quantity = 1m, UnitPrice = net, RevenueAccountId = seed.Accounts["700100"] }
            }
        };
        seed.Db.JournalEntries.Add(entry);
        seed.Db.Invoices.Add(invoice);
        await seed.Db.SaveChangesAsync();
        return invoice.Id;
    }

    [Fact]
    public async Task Commission_InvoicedNet_CreditNoteReduces_DraftsIgnored_SplitByAssignmentDate()
    {
        var seed = await SeedAsync();
        var plan = Created(await new CommissionPlansController(seed.Db, new NullStringLocalizer<ErrorMessages>())
            .Create(seed.CompanyId, new SaveCommissionPlanRequest("Sales 3%", CommissionBasis.InvoicedNet, 0.03m, null)));
        var arta = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m) with { CommissionPlanId = plan.Id }));
        var blerim = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Blerim", 1000m) with { CommissionPlanId = plan.Id }));

        // Viva Fresh is Arta's until 14 Sep, Blerim's from 15 Sep.
        Ok(await Employees(seed.Db).SetPartners(seed.CompanyId, arta.Id, new SetEmployeePartnersRequest(new List<Guid> { seed.PartnerId }, new DateOnly(2026, 1, 1))));
        Ok(await Employees(seed.Db).SetPartners(seed.CompanyId, arta.Id, new SetEmployeePartnersRequest(new List<Guid>(), new DateOnly(2026, 9, 15))));
        Ok(await Employees(seed.Db).SetPartners(seed.CompanyId, blerim.Id, new SetEmployeePartnersRequest(new List<Guid> { seed.PartnerId }, new DateOnly(2026, 9, 15))));

        await PostedSaleAsync(seed, seed.PartnerId, new DateOnly(2026, 9, 5), 1000m);
        await PostedSaleAsync(seed, seed.PartnerId, new DateOnly(2026, 9, 10), 200m, DocumentType.CreditNote);
        await PostedSaleAsync(seed, seed.PartnerId, new DateOnly(2026, 9, 20), 2000m);
        await PostedSaleAsync(seed, seed.PartnerId, new DateOnly(2026, 10, 2), 5000m);
        seed.Db.Invoices.Add(new Pako.Domain.Invoicing.Invoice
        {
            Id = Guid.NewGuid(), CompanyId = seed.CompanyId, PartnerId = seed.PartnerId, IssueDate = new DateOnly(2026, 9, 25),
            DueDate = new DateOnly(2026, 9, 25), State = Pako.Domain.Invoicing.InvoiceState.Draft
        });
        await seed.Db.SaveChangesAsync();

        var results = Ok(await Adjustments(seed.Db).CalculateCommissions(seed.CompanyId, new CalculateCommissionsRequest(Sep1), new CommissionService(seed.Db)));

        var artaResult = results.Single(r => r.EmployeeId == arta.Id);
        Assert.Equal(800m, artaResult.Basis);   // 1,000 − 200 credit note, VAT excluded
        Assert.Equal(24m, artaResult.Amount);
        var blerimResult = results.Single(r => r.EmployeeId == blerim.Id);
        Assert.Equal(2000m, blerimResult.Basis);
        Assert.Equal(60m, blerimResult.Amount);

        var basis = Ok(await Adjustments(seed.Db).CommissionBasis(seed.CompanyId, artaResult.AdjustmentId!.Value, new CommissionService(seed.Db)));
        Assert.Equal(new[] { 1000m, -200m }, basis.Select(b => b.CountedAmount));
    }

    [Fact]
    public async Task Commission_Recalculate_ReplacesUnused_NeverTouchesOneARunConsumed()
    {
        var seed = await SeedAsync();
        var plan = Created(await new CommissionPlansController(seed.Db, new NullStringLocalizer<ErrorMessages>())
            .Create(seed.CompanyId, new SaveCommissionPlanRequest("Sales 5%", CommissionBasis.InvoicedNet, 0.05m, 500m)));
        var arta = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m) with { CommissionPlanId = plan.Id }));
        Ok(await Employees(seed.Db).SetPartners(seed.CompanyId, arta.Id, new SetEmployeePartnersRequest(new List<Guid> { seed.PartnerId }, new DateOnly(2026, 1, 1))));
        await PostedSaleAsync(seed, seed.PartnerId, new DateOnly(2026, 9, 5), 400m);

        // Below the 500 threshold: nothing.
        var first = Ok(await Adjustments(seed.Db).CalculateCommissions(seed.CompanyId, new CalculateCommissionsRequest(Sep1), new CommissionService(seed.Db)));
        Assert.Equal(0m, Assert.Single(first).Amount);

        await PostedSaleAsync(seed, seed.PartnerId, new DateOnly(2026, 9, 6), 600m);
        Ok(await Adjustments(seed.Db).CalculateCommissions(seed.CompanyId, new CalculateCommissionsRequest(Sep1), new CommissionService(seed.Db)));
        Ok(await Adjustments(seed.Db).CalculateCommissions(seed.CompanyId, new CalculateCommissionsRequest(Sep1), new CommissionService(seed.Db)));
        var commission = await seed.Db.PayrollAdjustments.AsNoTracking().SingleAsync(a => a.CommissionPlanId == plan.Id);
        Assert.Equal(50m, commission.Amount);

        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));
        Assert.Equal(50m, Assert.Single(run.Lines).BonusAmount);

        await PostedSaleAsync(seed, seed.PartnerId, new DateOnly(2026, 9, 7), 10_000m);
        var locked = Assert.Single(Ok(await Adjustments(seed.Db).CalculateCommissions(seed.CompanyId, new CalculateCommissionsRequest(Sep1), new CommissionService(seed.Db))));
        Assert.True(locked.Locked);
        Assert.Equal(50m, (await seed.Db.PayrollAdjustments.AsNoTracking().SingleAsync(a => a.CommissionPlanId == plan.Id)).Amount);
    }

    [Fact]
    public async Task Commission_PaidNet_CountsTheNetShareOfPaymentsMadeInTheMonth()
    {
        var seed = await SeedAsync();
        var plan = Created(await new CommissionPlansController(seed.Db, new NullStringLocalizer<ErrorMessages>())
            .Create(seed.CompanyId, new SaveCommissionPlanRequest("Collected 3%", CommissionBasis.PaidNet, 0.03m, null)));
        var arta = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m) with { CommissionPlanId = plan.Id }));
        Ok(await Employees(seed.Db).SetPartners(seed.CompanyId, arta.Id, new SetEmployeePartnersRequest(new List<Guid> { seed.PartnerId }, new DateOnly(2026, 1, 1))));

        // August invoice: net 1,000 + VAT 180 = 1,180; half of it paid on 10 September.
        var invoiceId = await PostedSaleAsync(seed, seed.PartnerId, new DateOnly(2026, 8, 25), 1000m);
        var company = await seed.Db.Companies.FirstAsync(c => c.Id == seed.CompanyId);
        var journal = await seed.Db.Journals.FirstAsync(j => j.CompanyId == seed.CompanyId);
        var receivableLine = new JournalEntryLine { Id = Guid.NewGuid(), AccountId = seed.Accounts["110100"], PartnerId = seed.PartnerId, Credit = 590m };
        var payment = new JournalEntry
        {
            Id = Guid.NewGuid(), CompanyId = seed.CompanyId, JournalId = journal.Id, Date = new DateOnly(2026, 9, 10),
            Lines = new List<JournalEntryLine> { new() { Id = Guid.NewGuid(), AccountId = seed.BankAccountId, Debit = 590m }, receivableLine }
        };
        payment.Post(company);
        seed.Db.JournalEntries.Add(payment);
        seed.Db.Reconciliations.Add(Pako.Domain.Reconciliation.Reconciliation.ForInvoice(seed.CompanyId, invoiceId, receivableLine.Id, 590m));
        await seed.Db.SaveChangesAsync();

        var result = Assert.Single(Ok(await Adjustments(seed.Db).CalculateCommissions(seed.CompanyId, new CalculateCommissionsRequest(Sep1), new CommissionService(seed.Db))));
        Assert.Equal(500m, result.Basis);
        Assert.Equal(15m, result.Amount);

        // Nothing was collected in August, so August earns nothing even though it was invoiced then.
        var august = Assert.Single(Ok(await Adjustments(seed.Db).CalculateCommissions(seed.CompanyId, new CalculateCommissionsRequest(new DateOnly(2026, 8, 1)), new CommissionService(seed.Db))));
        Assert.Equal(0m, august.Basis);
    }

    // ---- H13 expense claims ----

    [Fact]
    public async Task ExpenseClaim_ApprovedDraftsABill_ThenPayrollReimbursesItUntaxed_AndSettlesTheBill()
    {
        var seed = await SeedAsync();
        var defaults = await seed.Db.CompanyAccountDefaults.FirstAsync(d => d.CompanyId == seed.CompanyId);
        defaults.PayableAccountId = seed.Accounts["200100"];
        await seed.Db.SaveChangesAsync();

        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));
        var claims = new ExpenseClaimService(seed.Db, new NotificationOutbox(seed.Db), new NullStringLocalizer<ErrorMessages>());
        var claim = new ExpenseClaim { Id = Guid.NewGuid(), CompanyId = seed.CompanyId, EmployeeId = employee.Id };
        Assert.Null(await claims.ApplyAsync(seed.CompanyId, claim, new SaveExpenseClaimRequest("Trip to Prizren", new List<ExpenseClaimLineRequest>
        {
            new(new DateOnly(2026, 9, 3), "Fuel", seed.Accounts["600500"], 59m, null, "Petrol Station", "810000001"),
            new(new DateOnly(2026, 9, 4), "Lunch", seed.Accounts["600500"], 21m, null, null, null)
        })));
        seed.Db.ExpenseClaims.Add(claim);
        await seed.Db.SaveChangesAsync();
        seed.Db.Attachments.Add(new Pako.Domain.Attachments.Attachment
        {
            Id = Guid.NewGuid(), CompanyId = seed.CompanyId, OwnerType = Pako.Domain.Attachments.AttachmentOwnerType.ExpenseClaim, OwnerId = claim.Id,
            FileName = "fuel.jpg", ContentType = "image/jpeg", SizeBytes = 3, Content = new byte[] { 1, 2, 3 }, UploadedByUserId = Guid.NewGuid()
        });
        await seed.Db.SaveChangesAsync();

        // A line on a non-expense account (here: payables) is refused before anything is saved.
        Assert.NotNull(await claims.ApplyAsync(seed.CompanyId, new ExpenseClaim { Id = Guid.NewGuid(), CompanyId = seed.CompanyId },
            new SaveExpenseClaimRequest("Bad", new List<ExpenseClaimLineRequest> { new(Sep1, "X", seed.Accounts["200100"], 10m, null, null, null) })));

        Assert.NotNull((await claims.SubmitAsync(claim)).Claim);
        Assert.NotNull((await claims.DecideAsync(claim, approve: true, Guid.NewGuid(), "OK")).Claim);

        var bill = await seed.Db.Bills.Include(b => b.Lines).AsNoTracking().SingleAsync(b => b.Id == claim.BillId);
        Assert.Equal(Pako.Domain.Bills.BillState.Draft, bill.State);
        // Lines come back in no particular order; match them by amount.
        Assert.Equal(new[] { 21m, 59m }, bill.Lines.Select(l => l.UnitPrice).OrderBy(p => p));
        Assert.Contains("Petrol Station (810000001)", bill.Lines.Single(l => l.UnitPrice == 59m).Description);
        var partner = await seed.Db.Partners.AsNoTracking().SingleAsync(p => p.Id == bill.PartnerId);
        Assert.Equal(employee.Id, partner.EmployeeId);
        Assert.True(await seed.Db.Attachments.AnyAsync(a => a.OwnerType == Pako.Domain.Attachments.AttachmentOwnerType.Bill && a.OwnerId == bill.Id));
        Assert.Equal("BillDraft", (await claims.ToResponsesAsync(new List<ExpenseClaim> { claim })).Single().Stage);

        // Not reimbursable until the bill is posted.
        Assert.Null((await claims.ReimburseViaPayrollAsync(claim, Sep1)).Claim);

        // The accountant posts it (Dr 600500 / Cr 200100, partner = the employee).
        var company = await seed.Db.Companies.FirstAsync(c => c.Id == seed.CompanyId);
        var journal = await seed.Db.Journals.FirstAsync(j => j.CompanyId == seed.CompanyId);
        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(), CompanyId = seed.CompanyId, JournalId = journal.Id, Date = new DateOnly(2026, 9, 5),
            Lines = new List<JournalEntryLine>
            {
                new() { Id = Guid.NewGuid(), AccountId = seed.Accounts["600500"], Debit = 80m },
                new() { Id = Guid.NewGuid(), AccountId = seed.Accounts["200100"], PartnerId = partner.Id, Credit = 80m }
            }
        };
        entry.Post(company);
        seed.Db.JournalEntries.Add(entry);
        var trackedBill = await seed.Db.Bills.FirstAsync(b => b.Id == bill.Id);
        trackedBill.State = Pako.Domain.Bills.BillState.Posted;
        trackedBill.JournalEntryId = entry.Id;
        await seed.Db.SaveChangesAsync();
        Assert.Equal("Posted", (await claims.ToResponsesAsync(new List<ExpenseClaim> { claim })).Single().Stage);

        Assert.NotNull((await claims.ReimburseViaPayrollAsync(claim, Sep1)).Claim);
        Assert.Null((await claims.ReimburseViaPayrollAsync(claim, Sep1)).Claim); // only once

        var run = Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));
        var slip = Assert.Single(run.Lines);
        Assert.Equal(1000m, slip.GrossSalary);          // not income
        Assert.Equal(80m, slip.ReimbursementAmount);
        var withoutClaim = slip.GrossSalary - slip.PitAmount - slip.EmployeePensionAmount - slip.DeductionsAmount;
        Assert.Equal(withoutClaim + 80m, slip.NetPay);  // paid on top of net

        var posted = Ok(await Runs(seed.Db).Post(seed.CompanyId, run.Id));
        var accrual = await seed.Db.JournalEntries.Include(e => e.Lines).AsNoTracking().SingleAsync(e => e.Id == posted.JournalEntryId);
        var payableLine = accrual.Lines.Single(l => l.AccountId == seed.Accounts["200100"]);
        Assert.Equal(80m, payableLine.Debit);
        Assert.Equal(partner.Id, payableLine.PartnerId);

        var after = (await claims.ToResponsesAsync(new List<ExpenseClaim> { await claims.LoadAsync(seed.CompanyId, claim.Id) ?? claim })).Single();
        Assert.Equal("Reimbursed", after.Stage);
        Assert.Equal(0m, after.Outstanding);
    }

    // ---- G12 timesheets ----

    private static TimesheetsController Timesheets(PakoDbContext db) =>
        new(db, new TimesheetService(db, new NullStringLocalizer<ErrorMessages>()), new NullStringLocalizer<ErrorMessages>()) { ControllerContext = UserContext() };

    [Fact]
    public async Task Timesheet_ApprovedMonthBecomesPremiumAdjustments_PricedLikeHandTypedOnes_LockedOnceUsed()
    {
        var seed = await SeedAsync();
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m)));

        // 2026-09-12 is a Saturday: its kind is derived. Overtime must be stated.
        var saturday = Created(await Timesheets(seed.Db).Create(seed.CompanyId, new SaveTimeEntryRequest(employee.Id, new DateOnly(2026, 9, 12), 8m, null, null)));
        Assert.Equal(TimeEntryKind.Weekend, saturday.Kind);
        Created(await Timesheets(seed.Db).Create(seed.CompanyId, new SaveTimeEntryRequest(employee.Id, new DateOnly(2026, 9, 14), 6m, TimeEntryKind.Overtime, null)));
        Created(await Timesheets(seed.Db).Create(seed.CompanyId, new SaveTimeEntryRequest(employee.Id, new DateOnly(2026, 9, 15), 4m, TimeEntryKind.Overtime, null)));
        Created(await Timesheets(seed.Db).Create(seed.CompanyId, new SaveTimeEntryRequest(employee.Id, new DateOnly(2026, 9, 16), 8m, null, null)));
        Assert.IsType<BadRequestObjectResult>((await Timesheets(seed.Db).Create(seed.CompanyId, new SaveTimeEntryRequest(employee.Id, Sep1, 25m, null, null))).Result);

        var summary = Assert.Single(Ok(await Timesheets(seed.Db).ApproveMonth(seed.CompanyId, new ApproveTimesheetMonthRequest(Sep1, null))));
        Assert.Equal(8m, summary.Regular);
        Assert.Equal(10m, summary.Overtime);
        Assert.Equal(0, summary.Unapproved);

        var adjustments = await seed.Db.PayrollAdjustments.AsNoTracking().Where(a => a.FromTimesheet).ToListAsync();
        var overtime = adjustments.Single(a => a.Kind == PayrollAdjustmentKind.Overtime);
        Assert.Equal(10m, overtime.Hours);
        Assert.Equal(75m, overtime.Amount); // 1,000 / 173.33 h × 10 h × 1.30 — same as a hand-typed one
        Assert.Equal(8m, adjustments.Single(a => a.Kind == PayrollAdjustmentKind.WeekendWork).Hours);

        // Approving again replaces, never duplicates…
        Ok(await Timesheets(seed.Db).ApproveMonth(seed.CompanyId, new ApproveTimesheetMonthRequest(Sep1, null)));
        Assert.Equal(2, await seed.Db.PayrollAdjustments.CountAsync(a => a.FromTimesheet));

        // …and once a run used them, nothing changes any more.
        Created(await Runs(seed.Db).Create(seed.CompanyId, new CreatePayrollRunRequest(Sep1, Sep30)));
        Created(await Timesheets(seed.Db).Create(seed.CompanyId, new SaveTimeEntryRequest(employee.Id, new DateOnly(2026, 9, 17), 5m, TimeEntryKind.Overtime, null)));
        var locked = Assert.Single(Ok(await Timesheets(seed.Db).ApproveMonth(seed.CompanyId, new ApproveTimesheetMonthRequest(Sep1, null))));
        Assert.True(locked.Locked);
        Assert.Equal(75m, (await seed.Db.PayrollAdjustments.AsNoTracking().SingleAsync(a => a.FromTimesheet && a.Kind == PayrollAdjustmentKind.Overtime)).Amount);
    }

    [Fact]
    public async Task Timesheet_CsvImport_KeepsGoodLines_ReportsBadOnes_DerivesKindFromCalendar()
    {
        var seed = await SeedAsync();
        Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 1000m, personalNumber: "1234567890")));
        var csv = "personal_number;date;hours;kind\n" +
                  "1234567890;2026-09-12;8;\n" +          // Saturday → Weekend
                  "1234567890;14.09.2026;2,5;Overtime\n" +
                  "9999999999;2026-09-15;8;\n" +          // unknown employee
                  "1234567890;2026-09-16;30;\n";          // too many hours
        var file = new FormFile(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(csv)), 0, csv.Length, "File", "clock.csv");

        var result = Ok(await Timesheets(seed.Db).Import(seed.CompanyId, new ImportTimesheetRequest { File = file }));

        Assert.Equal(2, result.Imported);
        Assert.Equal(new[] { 4, 5 }, result.Errors.Select(e => e.Line));
        var entries = await seed.Db.TimeEntries.AsNoTracking().OrderBy(t => t.Date).ToListAsync();
        Assert.Equal(TimeEntryKind.Weekend, entries[0].Kind);
        Assert.Equal(TimeEntryKind.Overtime, entries[1].Kind);
        Assert.Equal(2.5m, entries[1].Hours);
        Assert.All(entries, t => Assert.Equal(TimeEntrySource.Import, t.Source));
    }
}
