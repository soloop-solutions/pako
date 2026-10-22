using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;

namespace Pako.Tests;

// Pure domain tests for the HR module's payroll rules: statutory calculation variants, the
// payslip builder (proration, leave, adjustments), the split posting and the run workflow.
public class HrPayrollDomainTests
{
    private static readonly PayrollStatutoryRates Rates = PayrollRunComposer.KosovoRates();
    private static readonly IReadOnlySet<DateOnly> NoHolidays = new HashSet<DateOnly>();
    private readonly PayrollCalculationService _calculation = new();

    // ---- Calculation ----

    [Fact]
    public void Compute_PrimaryEmployer_1000Gross_MatchesAtkExample()
    {
        // Gross 1,000: pension 50, taxable 950, PIT = 8% × 200 + 10% × 500 = 66, net 884.
        var result = _calculation.Compute(new PayslipInput(1000m), Rates);

        Assert.Equal(50m, result.EmployeePensionAmount);
        Assert.Equal(50m, result.EmployerPensionAmount);
        Assert.Equal(66m, result.PitAmount);
        Assert.Equal(884m, result.NetPay);
    }

    [Fact]
    public void Compute_SecondaryEmployer_FlatTenPercentWithNoZeroBand()
    {
        var result = _calculation.Compute(new PayslipInput(300m, IsPrimaryEmployer: false), Rates);

        // Taxable 285 (300 − 15 pension) × 10%.
        Assert.Equal(28.50m, result.PitAmount);
        Assert.Equal(300m - 15m - 28.50m, result.NetPay);
    }

    [Fact]
    public void Compute_PensionExempt_NoContributionsAndFullBaseTaxed()
    {
        var result = _calculation.Compute(new PayslipInput(1000m, PensionExempt: true), Rates);

        Assert.Equal(0m, result.EmployeePensionAmount);
        Assert.Equal(0m, result.EmployerPensionAmount);
        // Taxable 1,000: 8% × 200 + 10% × 550 = 71.
        Assert.Equal(71m, result.PitAmount);
    }

    [Fact]
    public void Compute_BonusIsTaxedAndPensioned_DeductionComesOutOfNet()
    {
        var result = _calculation.Compute(new PayslipInput(800m, TaxableAdditions: 200m, Deductions: 30m), Rates);

        Assert.Equal(1000m, result.GrossSalary);
        Assert.Equal(50m, result.EmployeePensionAmount);
        Assert.Equal(66m, result.PitAmount);
        Assert.Equal(884m - 30m, result.NetPay);
    }

    [Fact]
    public void Compute_LegacyOverload_StillMatchesPreHrBehaviour()
    {
        var brackets = Rates.AnnualPitBrackets;
        var legacy = _calculation.Compute(500m, brackets, 0.05m, 0.05m);

        Assert.Equal(500m, legacy.GrossSalary);
        Assert.Equal(25m, legacy.EmployeePensionAmount);
    }

    // ---- Payslip builder ----

    private static Employee NewEmployee(decimal salary = 1000m) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = Guid.NewGuid(),
        Name = "Arta Krasniqi",
        MonthlyGrossSalary = salary
    };

    private PayslipLine Build(PayslipEmployeeData data, DateOnly start, DateOnly end, IReadOnlySet<DateOnly>? holidays = null) =>
        new PayslipBuilder(_calculation, Rates).Build(data, start, end, holidays ?? NoHolidays);

    private static readonly DateOnly Sep1 = new(2026, 9, 1);
    private static readonly DateOnly Sep30 = new(2026, 9, 30);

    [Fact]
    public void Build_FullMonth_PaysFullSalary()
    {
        var line = Build(new PayslipEmployeeData(NewEmployee(), null, null, [], []), Sep1, Sep30);

        Assert.Equal(22m, line.WorkingDays); // September 2026 has 22 weekdays.
        Assert.Equal(22m, line.PaidDays);
        Assert.Equal(1000m, line.BaseSalary);
    }

    [Fact]
    public void Build_HiredMidMonth_ProratesByWorkingDays()
    {
        var employee = NewEmployee(1100m);
        employee.HireDate = new DateOnly(2026, 9, 16); // 11 working days remain (16–30 Sep).

        var line = Build(new PayslipEmployeeData(employee, null, null, [], []), Sep1, Sep30);

        Assert.Equal(11m, line.PaidDays);
        Assert.Equal(550m, line.BaseSalary);
    }

    [Fact]
    public void Build_ContractSalaryOverridesEmployeeFallback()
    {
        var employee = NewEmployee(600m);
        var contract = new EmployeeContract { EmployeeId = employee.Id, StartDate = new DateOnly(2026, 1, 1), MonthlyGrossSalary = 900m };

        var line = Build(new PayslipEmployeeData(employee, contract, null, [], []), Sep1, Sep30);

        Assert.Equal(900m, line.BaseSalary);
    }

    [Fact]
    public void Build_UnpaidLeave_ReducesBase_PaidLeaveDoesNot()
    {
        var employee = NewEmployee(2200m); // 100 per working day in September.
        var unpaid = new LeaveType { Id = Guid.NewGuid(), PayPercent = 0m };
        var annual = new LeaveType { Id = Guid.NewGuid(), PayPercent = 100m };
        var leave = new List<(LeaveRequest, LeaveType)>
        {
            (new LeaveRequest { StartDate = new DateOnly(2026, 9, 7), EndDate = new DateOnly(2026, 9, 8) }, unpaid), // 2 days
            (new LeaveRequest { StartDate = new DateOnly(2026, 9, 14), EndDate = new DateOnly(2026, 9, 18) }, annual)
        };

        var line = Build(new PayslipEmployeeData(employee, null, null, [], leave), Sep1, Sep30);

        Assert.Equal(20m, line.PaidDays);
        Assert.Equal(2000m, line.BaseSalary);
    }

    [Fact]
    public void Build_MaternityAtSeventyPercent_DeductsThirtyPercentOfThoseDays()
    {
        var employee = NewEmployee(2200m);
        var maternity = new LeaveType { Id = Guid.NewGuid(), PayPercent = 70m };
        var leave = new List<(LeaveRequest, LeaveType)>
        {
            (new LeaveRequest { StartDate = Sep1, EndDate = Sep30 }, maternity)
        };

        var line = Build(new PayslipEmployeeData(employee, null, null, [], leave), Sep1, Sep30);

        Assert.Equal(1540m, line.BaseSalary); // 70% of 2,200.
    }

    [Fact]
    public void Build_PublicHolidayIsNotAWorkingDay()
    {
        var holidays = new HashSet<DateOnly> { new(2026, 9, 1) };

        var line = Build(new PayslipEmployeeData(NewEmployee(), null, null, [], []), Sep1, Sep30, holidays);

        Assert.Equal(21m, line.WorkingDays);
        Assert.Equal(1000m, line.BaseSalary);
    }

    [Fact]
    public void Build_SplitsBonusFromOtherAdditions_AndSnapshotsCostCenter()
    {
        var employee = NewEmployee();
        var department = new Department { Id = Guid.NewGuid(), CostCenterId = Guid.NewGuid() };
        employee.DepartmentId = department.Id;
        var adjustments = new List<PayrollAdjustment>
        {
            new() { Kind = PayrollAdjustmentKind.Bonus, Amount = 150m },
            new() { Kind = PayrollAdjustmentKind.Overtime, Amount = 50m },
            new() { Kind = PayrollAdjustmentKind.Deduction, Amount = 40m }
        };

        var line = Build(new PayslipEmployeeData(employee, null, department, adjustments, []), Sep1, Sep30);

        Assert.Equal(150m, line.BonusAmount);
        Assert.Equal(50m, line.OtherAdditionsAmount);
        Assert.Equal(1200m, line.GrossSalary);
        Assert.Equal(40m, line.DeductionsAmount);
        Assert.Equal(line.GrossSalary - line.PitAmount - line.EmployeePensionAmount - 40m, line.NetPay);
        Assert.Equal(department.CostCenterId, line.CostCenterId);
    }

    [Fact]
    public void AmountFromHours_OvertimeAt130Percent()
    {
        // 1,040 / (40 × 52 / 12) = 6.00 per hour; 10 h × 6 × 1.30 = 78.
        Assert.Equal(78m, PayrollAdjustment.AmountFromHours(1040m, 40m, 10m, 1.30m));
    }

    // ---- Posting ----

    private static PayrollRun RunWith(params PayslipLine[] lines) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = Guid.NewGuid(),
        PeriodStart = Sep1,
        PeriodEnd = Sep30,
        Lines = lines.ToList()
    };

    private static PayslipLine Slip(decimal gross, decimal bonus, decimal pit, decimal pension, decimal deductions, Guid? costCenter = null) => new()
    {
        Id = Guid.NewGuid(),
        EmployeeId = Guid.NewGuid(),
        BaseSalary = gross - bonus,
        BonusAmount = bonus,
        GrossSalary = gross,
        PitAmount = pit,
        EmployeePensionAmount = pension,
        EmployerPensionAmount = pension,
        DeductionsAmount = deductions,
        NetPay = gross - pit - pension - deductions,
        CostCenterId = costCenter
    };

    [Fact]
    public void Post_WithFullAccountSet_SplitsBonusEmployerPensionAndDeductions()
    {
        var accounts = new PayrollPostingAccounts(
            SalaryExpenseAccountId: Guid.NewGuid(),
            PitPayableAccountId: Guid.NewGuid(),
            PensionPayableAccountId: Guid.NewGuid(),
            NetPayPayableAccountId: Guid.NewGuid(),
            BonusExpenseAccountId: Guid.NewGuid(),
            EmployerPensionExpenseAccountId: Guid.NewGuid(),
            EmployerPensionPayableAccountId: Guid.NewGuid(),
            DeductionsPayableAccountId: Guid.NewGuid());
        var run = RunWith(Slip(1200m, 200m, 76m, 60m, 40m));

        var entry = run.Post(new Company { Id = run.CompanyId, Name = "Co" }, Guid.NewGuid(), accounts);

        Assert.Equal(entry.Lines.Sum(l => l.Debit), entry.Lines.Sum(l => l.Credit));
        Assert.Equal(1000m, entry.Lines.Single(l => l.AccountId == accounts.SalaryExpenseAccountId).Debit);
        Assert.Equal(200m, entry.Lines.Single(l => l.AccountId == accounts.BonusExpenseAccountId).Debit);
        Assert.Equal(60m, entry.Lines.Single(l => l.AccountId == accounts.EmployerPensionExpenseAccountId).Debit);
        Assert.Equal(60m, entry.Lines.Single(l => l.AccountId == accounts.PensionPayableAccountId).Credit);
        Assert.Equal(60m, entry.Lines.Single(l => l.AccountId == accounts.EmployerPensionPayableAccountId).Credit);
        Assert.Equal(40m, entry.Lines.Single(l => l.AccountId == accounts.DeductionsPayableAccountId).Credit);
        Assert.Equal(1024m, entry.Lines.Single(l => l.AccountId == accounts.NetPayPayableAccountId).Credit);
    }

    [Fact]
    public void Post_WithOnlyLegacyAccounts_FoldsEverythingIntoTheFourRoles()
    {
        var accounts = new PayrollPostingAccounts(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var run = RunWith(Slip(1200m, 200m, 76m, 60m, 40m));

        var entry = run.Post(new Company { Id = run.CompanyId, Name = "Co" }, Guid.NewGuid(), accounts);

        Assert.Equal(1260m, entry.Lines.Single(l => l.AccountId == accounts.SalaryExpenseAccountId).Debit);
        Assert.Equal(120m, entry.Lines.Single(l => l.AccountId == accounts.PensionPayableAccountId).Credit);
        Assert.Equal(1064m, entry.Lines.Single(l => l.AccountId == accounts.NetPayPayableAccountId).Credit);
    }

    [Fact]
    public void Post_TagsExpenseWithEachDepartmentsCostCenter()
    {
        var sales = Guid.NewGuid();
        var accounts = new PayrollPostingAccounts(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var run = RunWith(Slip(1000m, 0m, 66m, 50m, 0m, sales), Slip(500m, 0m, 16m, 25m, 0m));

        var entry = run.Post(new Company { Id = run.CompanyId, Name = "Co" }, Guid.NewGuid(), accounts);

        var expenseLines = entry.Lines.Where(l => l.AccountId == accounts.SalaryExpenseAccountId).ToList();
        Assert.Equal(2, expenseLines.Count);
        var tagged = Assert.Single(expenseLines, l => l.AnalyticDistribution is not null);
        Assert.Equal(100m, tagged.AnalyticDistribution![sales]);
        Assert.Equal(1050m, tagged.Debit);
    }

    [Fact]
    public void Post_RefusesNegativeNetPay()
    {
        var accounts = new PayrollPostingAccounts(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var run = RunWith(Slip(300m, 0m, 0m, 15m, 400m));

        Assert.Throws<InvalidOperationException>(() => run.Post(new Company { Id = run.CompanyId, Name = "Co" }, Guid.NewGuid(), accounts));
    }

    // ---- Workflow ----

    [Fact]
    public void Approve_ThenReturnToDraft_ThenApproveAgain()
    {
        var run = RunWith(Slip(500m, 0m, 0m, 25m, 0m));
        var user = Guid.NewGuid();

        run.Approve(user);
        Assert.Equal(PayrollRunState.Approved, run.State);
        Assert.Equal(user, run.ApprovedByUserId);

        run.ReturnToDraft();
        Assert.Equal(PayrollRunState.Draft, run.State);
        Assert.Null(run.ApprovedAt);

        run.Approve(user);
        Assert.Equal(PayrollRunState.Approved, run.State);
    }

    [Fact]
    public void Pay_OnlyFromPosted_ClearsNetPayAgainstBank()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Co" };
        var run = RunWith(Slip(500m, 0m, 0m, 25m, 0m));
        var netPay = Guid.NewGuid();
        var bank = Guid.NewGuid();

        Assert.Throws<InvalidOperationException>(() => run.Pay(company, Guid.NewGuid(), Sep30, netPay, bank));

        run.Post(company, Guid.NewGuid(), new PayrollPostingAccounts(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), netPay));
        var payment = run.Pay(company, Guid.NewGuid(), new DateOnly(2026, 10, 5), netPay, bank);

        Assert.Equal(PayrollRunState.Paid, run.State);
        Assert.Equal(475m, payment.Lines.Single(l => l.AccountId == netPay).Debit);
        Assert.Equal(475m, payment.Lines.Single(l => l.AccountId == bank).Credit);
        Assert.Equal(payment.Id, run.PaymentJournalEntryId);
    }

    // ---- Access and validation helpers ----

    [Theory]
    [InlineData("1234567890", true)]
    [InlineData("123456789", false)]
    [InlineData("12345678ab", false)]
    public void PersonalNumber_MustBeTenDigits(string value, bool valid) =>
        Assert.Equal(valid, EmployeeValidation.IsValidPersonalNumber(value));

    [Theory]
    [InlineData("XK05 1212 0123 4567 8906", true)]
    [InlineData("XK05 1212 0123 4567 8907", false)]
    [InlineData("DE89 3704 0044 0532 0130 00", true)]
    [InlineData("1234", false)]
    public void Iban_Mod97(string value, bool valid) =>
        Assert.Equal(valid, EmployeeValidation.IsValidIban(EmployeeValidation.NormalizeIban(value)));

    [Fact]
    public void WorkingDays_SkipsWeekendsAndHolidays()
    {
        var holidays = new HashSet<DateOnly> { new(2026, 10, 14) };

        // Mon 12 – Sun 18 Oct 2026: 5 weekdays, one of them a holiday.
        Assert.Equal(4, WorkingDays.Count(new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 18), holidays));
    }

    [Fact]
    public void Department_AssignedScope_ForcesAccountingToNone()
    {
        var department = new Department { AccountingAccess = AccessLevel.Write, SalesAccess = AccessLevel.Read, PartnerScope = PartnerScope.Assigned };

        Assert.Equal(AccessLevel.None, department.LevelFor(AccessModule.Accounting));
        Assert.Equal(AccessLevel.Read, department.LevelFor(AccessModule.Sales));
        Assert.Equal(AccessLevel.Read, department.LevelFor(AccessModule.None));
    }
}
