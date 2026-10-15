using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

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
        new(db, new PayrollRunComposer(db, new PayrollCalculationService()), new NullStringLocalizer<ErrorMessages>()) { ControllerContext = UserContext() };

    private static PayrollAdjustmentsController Adjustments(PakoDbContext db) => new(db, new NullStringLocalizer<ErrorMessages>());

    private static LeaveController Leave(PakoDbContext db) =>
        new(db, new NullStringLocalizer<ErrorMessages>()) { ControllerContext = UserContext() };

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
    public async Task Employee_StaffCannotMoveAnEmployeeBetweenDepartments()
    {
        var seed = await SeedAsync();
        var dept = Created(await Departments(seed.Db).Create(seed.CompanyId, DepartmentRequest("SALES")));
        var employee = Created(await Employees(seed.Db).Create(seed.CompanyId, EmployeeRequest("Arta", 800m)));
        var staff = CompanyAccessContext.ForStaff(seed.CompanyId, Guid.NewGuid(), Guid.NewGuid(), new Department { HrAccess = AccessLevel.Write }, null);

        var result = await Employees(seed.Db, staff).Update(seed.CompanyId, employee.Id, EmployeeRequest("Arta", 800m, dept.Id));

        Assert.IsType<ForbidResult>(result.Result);
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
}
