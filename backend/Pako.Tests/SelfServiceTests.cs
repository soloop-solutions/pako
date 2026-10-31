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
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Notifications;
using Pako.Domain.Payroll;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Tests;

// F9 security cases from docs/HR_MASTER_PLAN.md: an employee never reaches another employee's
// payslip, Draft runs stay invisible, a manager decides only their own reports' leave, and an IBAN
// change waits for HR.
public class SelfServiceTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private record Person(Guid UserId, Employee Employee);

    private record Seed(PakoDbContext Db, Guid CompanyId, Person Manager, Person Arta, Person Blerim, Guid HrAdminUserId);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        db.Companies.Add(company);

        // A department that grants nothing at all — self-service must still work.
        var noAccess = new Department { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "OPS", Name = "Operations" };
        db.Departments.Add(noAccess);

        Person Add(string name, Guid? managerId, Guid? departmentId)
        {
            var userId = Guid.NewGuid();
            var email = $"{name.ToLowerInvariant()}@x.test";
            db.Users.Add(new AppUser { Id = userId, Email = email, UserName = email });
            db.Memberships.Add(Membership.ForCompany(userId, company.Id, MembershipRole.ClientStaff));
            var employee = new Employee
            {
                Id = Guid.NewGuid(), CompanyId = company.Id, Name = name, Email = email, UserId = userId, ManagerId = managerId,
                DepartmentId = departmentId, MonthlyGrossSalary = 1000m, Iban = "XK051212012345678906"
            };
            db.Employees.Add(employee);
            return new Person(userId, employee);
        }

        var manager = Add("Mira", null, noAccess.Id);
        var arta = Add("Arta", manager.Employee.Id, noAccess.Id);
        var blerim = Add("Blerim", null, null);

        var hrAdmin = Guid.NewGuid();
        db.Users.Add(new AppUser { Id = hrAdmin, Email = "admin@x.test", UserName = "admin@x.test" });
        db.Memberships.Add(Membership.ForCompany(hrAdmin, company.Id, MembershipRole.ClientAdmin));
        await db.SaveChangesAsync();
        return new Seed(db, company.Id, manager, arta, blerim, hrAdmin);
    }

    private static ControllerContext As(Guid userId) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
        }
    };

    private static MeController Me(PakoDbContext db, Guid userId)
    {
        var outbox = new NotificationOutbox(db);
        return new MeController(db, new LeaveService(db, outbox, new NullStringLocalizer<ErrorMessages>()), new PayslipDocumentService(db),
            outbox, new NullStringLocalizer<ErrorMessages>()) { ControllerContext = As(userId) };
    }

    private static EmployeeProfileChangesController Changes(PakoDbContext db, Guid userId) =>
        new(db, new NotificationOutbox(db), new NullStringLocalizer<ErrorMessages>()) { ControllerContext = As(userId) };

    private static T Ok<T>(ActionResult<T> result) => Assert.IsType<T>(Assert.IsType<OkObjectResult>(result.Result).Value);

    private static async Task<(Guid PostedLine, Guid DraftLine)> AddRunsAsync(Seed seed, Employee employee)
    {
        var posted = new PayrollRun
        {
            Id = Guid.NewGuid(), CompanyId = seed.CompanyId, PeriodStart = new DateOnly(2026, 8, 1), PeriodEnd = new DateOnly(2026, 8, 31),
            State = PayrollRunState.Posted
        };
        var draft = new PayrollRun
        {
            Id = Guid.NewGuid(), CompanyId = seed.CompanyId, PeriodStart = new DateOnly(2026, 9, 1), PeriodEnd = new DateOnly(2026, 9, 30),
            State = PayrollRunState.Draft
        };
        var postedLine = new PayslipLine { Id = Guid.NewGuid(), PayrollRunId = posted.Id, EmployeeId = employee.Id, BaseSalary = 1000m, GrossSalary = 1000m, NetPay = 900m };
        var draftLine = new PayslipLine { Id = Guid.NewGuid(), PayrollRunId = draft.Id, EmployeeId = employee.Id, BaseSalary = 1000m, GrossSalary = 1000m, NetPay = 900m };
        posted.Lines.Add(postedLine);
        draft.Lines.Add(draftLine);
        seed.Db.PayrollRuns.AddRange(posted, draft);
        await seed.Db.SaveChangesAsync();
        return (postedLine.Id, draftLine.Id);
    }

    // ---- Access ----

    private static async Task<IActionResult?> RunFilterAsync(PakoDbContext db, Guid userId, Guid companyId, AccessModule module)
    {
        var httpContext = new DefaultHttpContext { User = As(userId).HttpContext.User };
        var routeData = new RouteData();
        routeData.Values["companyId"] = companyId.ToString();
        var actionContext = new ActionContext(httpContext, routeData, new ActionDescriptor());
        var executing = new ActionExecutingContext(actionContext, new List<IFilterMetadata>(), new Dictionary<string, object?>(), new object());
        await new CompanyAccessFilter(db, new CompanyAccessContext(), writeAccess: false, adminOnly: false, module: module)
            .OnActionExecutionAsync(executing, () => Task.FromResult(new ActionExecutedContext(actionContext, new List<IFilterMetadata>(), new object())));
        return executing.Result;
    }

    [Fact]
    public async Task SelfAccess_StaffWithNoHrRights_OrNoDepartment_IsAllowed_ButNotIntoHr()
    {
        var seed = await SeedAsync();

        Assert.Null(await RunFilterAsync(seed.Db, seed.Arta.UserId, seed.CompanyId, AccessModule.Self));
        Assert.Null(await RunFilterAsync(seed.Db, seed.Blerim.UserId, seed.CompanyId, AccessModule.Self));
        Assert.IsType<ForbidResult>(await RunFilterAsync(seed.Db, seed.Arta.UserId, seed.CompanyId, AccessModule.Hr));

        // A member with no linked employee has nothing to self-serve.
        Assert.IsType<NotFoundObjectResult>((await Me(seed.Db, seed.HrAdminUserId).Profile(seed.CompanyId)).Result);
    }

    // ---- Payslips ----

    [Fact]
    public async Task Payslips_OnlyMine_AndOnlyPosted()
    {
        var seed = await SeedAsync();
        var (artaPosted, artaDraft) = await AddRunsAsync(seed, seed.Arta.Employee);
        var (blerimPosted, _) = await AddRunsAsync(seed, seed.Blerim.Employee);

        var mine = Ok(await Me(seed.Db, seed.Arta.UserId).Payslips(seed.CompanyId));
        var only = Assert.Single(mine);
        Assert.Equal(artaPosted, only.LineId);

        Assert.Equal(900m, Ok(await Me(seed.Db, seed.Arta.UserId).Payslip(seed.CompanyId, artaPosted)).NetPay);
        Assert.IsType<FileContentResult>(await Me(seed.Db, seed.Arta.UserId).PayslipPdf(seed.CompanyId, artaPosted));

        // Another employee's slip and my own Draft slip look exactly like a missing one.
        Assert.IsType<NotFoundResult>((await Me(seed.Db, seed.Arta.UserId).Payslip(seed.CompanyId, blerimPosted)).Result);
        Assert.IsType<NotFoundResult>(await Me(seed.Db, seed.Arta.UserId).PayslipPdf(seed.CompanyId, blerimPosted));
        Assert.IsType<NotFoundResult>((await Me(seed.Db, seed.Arta.UserId).Payslip(seed.CompanyId, artaDraft)).Result);
    }

    // ---- Leave ----

    [Fact]
    public async Task Leave_RequestedByMe_DecidedOnlyByMyManager()
    {
        var seed = await SeedAsync();
        var types = Ok(await Me(seed.Db, seed.Arta.UserId).LeaveTypes(seed.CompanyId));
        var annual = types.First(t => t.DefaultAnnualDays is > 0m);

        var created = Assert.IsType<ObjectResult>((await Me(seed.Db, seed.Arta.UserId).CreateLeaveRequest(seed.CompanyId,
            new CreateMyLeaveRequest(annual.Id, new DateOnly(2026, 11, 2), new DateOnly(2026, 11, 3), null))).Result);
        var request = Assert.IsType<LeaveRequestResponse>(created.Value);
        Assert.Equal(seed.Arta.Employee.Id, request.EmployeeId);

        // Blerim is not Arta's manager.
        var stranger = await Me(seed.Db, seed.Blerim.UserId).ApproveTeamLeave(seed.CompanyId, request.Id);
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(stranger.Result).StatusCode);
        Assert.Empty(Ok(await Me(seed.Db, seed.Blerim.UserId).TeamLeave(seed.CompanyId)));

        // Arta can't approve her own request through the team endpoint either.
        var self = await Me(seed.Db, seed.Arta.UserId).ApproveTeamLeave(seed.CompanyId, request.Id);
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(self.Result).StatusCode);

        Assert.Single(Ok(await Me(seed.Db, seed.Manager.UserId).TeamLeave(seed.CompanyId)));
        Assert.Equal("Approved", Ok(await Me(seed.Db, seed.Manager.UserId).ApproveTeamLeave(seed.CompanyId, request.Id)).State);

        // Approved leave is HR's to undo, not the employee's.
        Assert.IsType<BadRequestObjectResult>((await Me(seed.Db, seed.Arta.UserId).CancelLeaveRequest(seed.CompanyId, request.Id)).Result);
    }

    [Fact]
    public async Task Leave_CannotCancelSomeoneElsesRequest()
    {
        var seed = await SeedAsync();
        var annual = Ok(await Me(seed.Db, seed.Blerim.UserId).LeaveTypes(seed.CompanyId)).First(t => t.DefaultAnnualDays is > 0m);
        var created = (LeaveRequestResponse)((ObjectResult)(await Me(seed.Db, seed.Blerim.UserId).CreateLeaveRequest(seed.CompanyId,
            new CreateMyLeaveRequest(annual.Id, new DateOnly(2026, 11, 9), new DateOnly(2026, 11, 9), null))).Result!).Value!;

        Assert.IsType<NotFoundResult>((await Me(seed.Db, seed.Arta.UserId).CancelLeaveRequest(seed.CompanyId, created.Id)).Result);
        Assert.Equal("Cancelled", Ok(await Me(seed.Db, seed.Blerim.UserId).CancelLeaveRequest(seed.CompanyId, created.Id)).State);
    }

    // ---- Profile / IBAN ----

    [Fact]
    public async Task IbanChange_StaysPendingUntilHrApproves_PhoneAppliesAtOnce()
    {
        var seed = await SeedAsync();
        var profile = Ok(await Me(seed.Db, seed.Arta.UserId).UpdateProfile(seed.CompanyId,
            new UpdateMyProfileRequest("+383 44 123 456", "Prishtinë", "XK27 1701 0000 0000 0012", "Raiffeisen", null, null)));

        Assert.Equal("+383 44 123 456", profile.Phone);
        Assert.Equal("XK051212012345678906", profile.Iban);
        Assert.NotNull(profile.PendingBankChange);
        Assert.Equal("XK271701000000000012", profile.PendingBankChange!.NewIban);
        Assert.Equal(NotificationTemplates.ProfileChangeRequested,
            (await seed.Db.Notifications.AsNoTracking().SingleAsync()).Template);

        // The requester can't approve their own change even if they had HR rights.
        var own = await Changes(seed.Db, seed.Arta.UserId).Approve(seed.CompanyId, profile.PendingBankChange.Id);
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(own.Result).StatusCode);

        var pending = Ok(await Changes(seed.Db, seed.HrAdminUserId).List(seed.CompanyId));
        Assert.Equal(profile.PendingBankChange.Id, Assert.Single(pending).Id);

        Assert.Equal("Approved", Ok(await Changes(seed.Db, seed.HrAdminUserId).Approve(seed.CompanyId, profile.PendingBankChange.Id)).State);
        var after = Ok(await Me(seed.Db, seed.Arta.UserId).Profile(seed.CompanyId));
        Assert.Equal("XK271701000000000012", after.Iban);
        Assert.Equal("Raiffeisen", after.BankName);
        Assert.Null(after.PendingBankChange);
    }

    [Fact]
    public async Task IbanChange_InvalidIbanRejected_AndASecondRequestReplacesTheFirst()
    {
        var seed = await SeedAsync();
        Assert.IsType<BadRequestObjectResult>((await Me(seed.Db, seed.Arta.UserId).UpdateProfile(seed.CompanyId,
            new UpdateMyProfileRequest(null, null, "XK00 0000 0000 0000 0000", null, null, null))).Result);

        Ok(await Me(seed.Db, seed.Arta.UserId).UpdateProfile(seed.CompanyId,
            new UpdateMyProfileRequest(null, null, "XK271701000000000012", null, null, null)));
        var second = Ok(await Me(seed.Db, seed.Arta.UserId).UpdateProfile(seed.CompanyId,
            new UpdateMyProfileRequest(null, null, "XK051212012345678906", "Other bank", null, null)));

        Assert.Equal("XK051212012345678906", second.PendingBankChange!.NewIban);
        var states = await seed.Db.EmployeeProfileChanges.AsNoTracking().Select(c => c.State).ToListAsync();
        Assert.Equal(1, states.Count(s => s == ProfileChangeState.Pending));
        Assert.Equal(1, states.Count(s => s == ProfileChangeState.Cancelled));
    }

    // ---- Carry-over ----

    [Fact]
    public async Task CarryOver_MovesUnusedDaysUpToTheCap_ExpiresUnusedOnes_AndIsIdempotent()
    {
        var seed = await SeedAsync();
        var leave = new LeaveService(seed.Db, new NotificationOutbox(seed.Db), new NullStringLocalizer<ErrorMessages>());
        await leave.EnsureDefaultsAsync(seed.CompanyId);
        var annual = await seed.Db.LeaveTypes.FirstAsync(t => t.CompanyId == seed.CompanyId && t.DefaultAnnualDays > 0m);
        annual.CarryOverMaxDays = 5m;
        annual.CarryOverExpiryMonth = 6;
        seed.Db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), CompanyId = seed.CompanyId, EmployeeId = seed.Arta.Employee.Id, LeaveTypeId = annual.Id,
            StartDate = new DateOnly(2025, 7, 1), EndDate = new DateOnly(2025, 7, 31), Days = annual.DefaultAnnualDays!.Value - 2m,
            State = LeaveRequestState.Approved
        });
        await seed.Db.SaveChangesAsync();

        var updated = await leave.CarryOverAsync(seed.CompanyId, 2025);
        Assert.Equal(3, updated); // Arta carries 2; Mira and Blerim carry the 5-day cap.
        Assert.Equal(0, await leave.CarryOverAsync(seed.CompanyId, 2025));

        var arta = (await leave.ComputeBalancesAsync(seed.CompanyId, 2026, seed.Arta.Employee.Id, new DateOnly(2026, 3, 1)))
            .Single(b => b.LeaveTypeId == annual.Id);
        Assert.Equal(2m, arta.CarriedOver);
        Assert.Equal(annual.DefaultAnnualDays + 2m, arta.Allocated);
        Assert.False(arta.IsOverride);
        Assert.Equal(new DateOnly(2026, 6, 30), arta.CarryOverExpiresOn);

        // Unused carried days lapse after 30 June.
        var july = (await leave.ComputeBalancesAsync(seed.CompanyId, 2026, seed.Arta.Employee.Id, new DateOnly(2026, 7, 1)))
            .Single(b => b.LeaveTypeId == annual.Id);
        Assert.Equal(2m, july.ExpiredCarryOver);
        Assert.Equal(annual.DefaultAnnualDays, july.Remaining);
    }

    // ---- Expense claims ----

    [Fact]
    public async Task ExpenseClaims_OnlyMine_EditableUntilSubmitted_DecidedOnlyByMyManager()
    {
        var seed = await SeedAsync();
        var expense = new Pako.Domain.Ledger.Account
        {
            Id = Guid.NewGuid(), CompanyId = seed.CompanyId, Code = "600500", Name = "Travel", AccountType = Pako.Domain.Ledger.AccountType.Expense
        };
        seed.Db.Accounts.Add(expense);
        await seed.Db.SaveChangesAsync();

        var options = Ok(await Me(seed.Db, seed.Arta.UserId).ExpenseOptions(seed.CompanyId));
        Assert.Contains(options.Accounts, a => a.Id == expense.Id);

        var request = new SaveExpenseClaimRequest("Taxi", new List<ExpenseClaimLineRequest> { new(new DateOnly(2026, 10, 1), "Taxi to client", expense.Id, 12.5m, null, null, null) });
        var created = (ExpenseClaimResponse)((ObjectResult)(await Me(seed.Db, seed.Arta.UserId).CreateExpenseClaim(seed.CompanyId, request)).Result!).Value!;
        Assert.Equal("Draft", created.Stage);

        // Blerim can neither see nor touch it.
        Assert.IsType<NotFoundResult>((await Me(seed.Db, seed.Blerim.UserId).SubmitExpenseClaim(seed.CompanyId, created.Id)).Result);
        Assert.Empty(Ok(await Me(seed.Db, seed.Blerim.UserId).ExpenseClaims(seed.CompanyId)));

        Assert.Equal("Submitted", Ok(await Me(seed.Db, seed.Arta.UserId).SubmitExpenseClaim(seed.CompanyId, created.Id)).Stage);
        Assert.IsType<BadRequestObjectResult>((await Me(seed.Db, seed.Arta.UserId).UpdateExpenseClaim(seed.CompanyId, created.Id, request)).Result);

        var stranger = await Me(seed.Db, seed.Blerim.UserId).ApproveTeamExpenseClaim(seed.CompanyId, created.Id, new DecideExpenseClaimRequest(null));
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(stranger.Result).StatusCode);

        Assert.Single(Ok(await Me(seed.Db, seed.Manager.UserId).TeamExpenseClaims(seed.CompanyId)));
        var approved = Ok(await Me(seed.Db, seed.Manager.UserId).ApproveTeamExpenseClaim(seed.CompanyId, created.Id, new DecideExpenseClaimRequest("Fine")));
        Assert.Equal("BillDraft", approved.Stage);
        Assert.NotNull(approved.BillId);
    }
}
