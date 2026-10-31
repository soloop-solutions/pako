using Pako.Domain.Hr;
using Pako.Domain.Payroll;

namespace Pako.Api.Contracts;

// ---- Departments ----

public record DepartmentPermissions(
    AccessLevel Sales,
    AccessLevel Purchases,
    AccessLevel Partners,
    AccessLevel Accounting,
    AccessLevel Reports,
    AccessLevel Hr);

public record SaveDepartmentRequest(
    string Code,
    string Name,
    Guid? ParentId,
    Guid? ManagerEmployeeId,
    Guid? CostCenterId,
    DepartmentPermissions Permissions,
    PartnerScope PartnerScope,
    bool IsActive = true);

public record DepartmentResponse(
    Guid Id,
    string Code,
    string Name,
    Guid? ParentId,
    Guid? ManagerEmployeeId,
    string? ManagerName,
    Guid? CostCenterId,
    DepartmentPermissions Permissions,
    PartnerScope PartnerScope,
    bool IsActive,
    int EmployeeCount);

// ---- Employees ----

public record SaveEmployeeRequest(
    string? FirstName,
    string? LastName,
    string? Name,
    string? PersonalNumber,
    string? Email,
    string? Phone,
    string? Address,
    DateOnly? BirthDate,
    DateOnly? HireDate,
    DateOnly? TerminationDate,
    string? JobTitle,
    Guid? DepartmentId,
    Guid? ManagerId,
    Guid? UserId,
    string? Iban,
    string? BankName,
    decimal MonthlyGrossSalary,
    bool IsPrimaryEmployer = true,
    bool PensionExempt = false,
    bool IsActive = true,
    // E7. Null keeps the stored value, so older clients don't silently switch these off.
    bool? ReceivePayslipsByEmail = null,
    string? PreferredLanguage = null,
    // G11. Sent with every save like DepartmentId; null = no commission.
    Guid? CommissionPlanId = null);

public record EmployeeDetailResponse(
    Guid Id,
    string Name,
    string? FirstName,
    string? LastName,
    string? PersonalNumber,
    string? Email,
    string? Phone,
    string? Address,
    DateOnly? BirthDate,
    DateOnly? HireDate,
    DateOnly? TerminationDate,
    string? JobTitle,
    Guid? DepartmentId,
    string? DepartmentName,
    Guid? ManagerId,
    string? ManagerName,
    Guid? UserId,
    string? UserEmail,
    string? Iban,
    string? BankName,
    decimal MonthlyGrossSalary,
    decimal CurrentSalary,
    bool IsPrimaryEmployer,
    bool PensionExempt,
    bool IsActive,
    int AssignedPartnerCount,
    List<string> Warnings,
    bool ReceivePayslipsByEmail = false,
    string PreferredLanguage = "sq",
    Guid? CommissionPlanId = null,
    // True when the caller has no Payroll access: salary, IBAN and bank are blanked.
    bool PayDataHidden = false);

// G11: EffectiveFrom (default today) dates the change, so commission on a partner that moves
// between employees is split on that day.
public record SetEmployeePartnersRequest(List<Guid> PartnerIds, DateOnly? EffectiveFrom = null);

public record EmployeePartnerResponse(Guid PartnerId, string Name, bool IsCustomer, bool IsVendor);

// ---- Contracts (salary history) ----

public record SaveEmployeeContractRequest(
    DateOnly StartDate,
    DateOnly? EndDate,
    decimal MonthlyGrossSalary,
    EmploymentType EmploymentType,
    decimal WeeklyHours,
    string? JobTitle,
    string? Notes,
    DateOnly? ProbationEndDate = null);

public record EmployeeContractResponse(
    Guid Id,
    Guid EmployeeId,
    DateOnly StartDate,
    DateOnly? EndDate,
    decimal MonthlyGrossSalary,
    EmploymentType EmploymentType,
    decimal WeeklyHours,
    string? JobTitle,
    string? Notes,
    bool IsCurrent,
    DateOnly? ProbationEndDate = null);

// ---- Payroll adjustments (bonuses, overtime, deductions) ----

// Period is any date in the month; it is normalized to the first of the month. For hour-based
// kinds send Hours (and optionally RateMultiplier, defaulting to the Kosovo rule) — Amount is
// computed. For the others send Amount.
public record SavePayrollAdjustmentRequest(
    Guid EmployeeId,
    DateOnly Period,
    PayrollAdjustmentKind Kind,
    string? Description,
    decimal? Amount,
    decimal? Hours,
    decimal? RateMultiplier);

public record PayrollAdjustmentResponse(
    Guid Id,
    Guid EmployeeId,
    string EmployeeName,
    DateOnly Period,
    PayrollAdjustmentKind Kind,
    string? Description,
    decimal? Hours,
    decimal? RateMultiplier,
    decimal Amount,
    Guid? PayrollRunId,
    // G10/G11: where a generated adjustment came from.
    Guid? EmployeeLoanId = null,
    Guid? CommissionPlanId = null,
    decimal? CommissionBasisAmount = null);

// ---- Payroll runs ----

public record PayslipDetailResponse(
    Guid Id,
    Guid EmployeeId,
    string EmployeeName,
    string? PersonalNumber,
    Guid? DepartmentId,
    string? DepartmentName,
    decimal BaseSalary,
    decimal WorkingDays,
    decimal PaidDays,
    decimal BonusAmount,
    decimal OtherAdditionsAmount,
    decimal GrossSalary,
    decimal PitAmount,
    decimal EmployeePensionAmount,
    decimal EmployerPensionAmount,
    decimal DeductionsAmount,
    decimal NetPay,
    bool IsPrimaryEmployer,
    List<PayrollAdjustmentResponse> Adjustments,
    // Snapshot of the department's cost center when the slip was built ("CODE Name"); null if none.
    Guid? CostCenterId = null,
    string? CostCenterName = null,
    // G10/H13: the loan-repayment part of DeductionsAmount, and untaxed expense reimbursements
    // included in NetPay.
    decimal LoanRepaymentAmount = 0m,
    decimal ReimbursementAmount = 0m);

public record PayrollRunTotals(
    decimal Gross,
    decimal Pit,
    decimal EmployeePension,
    decimal EmployerPension,
    decimal Deductions,
    decimal NetPay,
    decimal EmployerCost);

public record PayrollRunDetailResponse(
    Guid Id,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    string State,
    Guid? JournalEntryId,
    Guid? PaymentJournalEntryId,
    DateOnly? PaidOn,
    DateTime? ApprovedAt,
    string? Notes,
    PayrollRunTotals Totals,
    List<PayslipDetailResponse> Lines,
    List<string> Warnings,
    // The statutory values the slips were computed with; null on list rows and on runs created
    // before parameters were snapshotted.
    PayrollParameters? Parameters = null);

public record PayPayrollRunRequest(DateOnly PaidOn, Guid CashOrBankAccountId);

// ---- Payroll reports ----

public record AnnualEmployeeStatementMonth(
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    decimal GrossSalary,
    decimal EmployeePension,
    decimal EmployerPension,
    decimal Pit,
    decimal NetPay);

public record AnnualEmployeeStatementResponse(
    Guid EmployeeId,
    string EmployeeName,
    string? PersonalNumber,
    int Year,
    List<AnnualEmployeeStatementMonth> Months,
    decimal TotalGross,
    decimal TotalEmployeePension,
    decimal TotalEmployerPension,
    decimal TotalPit,
    decimal TotalNetPay);

// ---- Leave ----

public record SaveLeaveTypeRequest(
    string Code, string Name, decimal? DefaultAnnualDays, decimal PayPercent, bool IsActive = true,
    // F9 carry-over; null = no carry-over / carried days never lapse.
    decimal? CarryOverMaxDays = null, int? CarryOverExpiryMonth = null);

public record LeaveTypeResponse(
    Guid Id, string Code, string Name, decimal? DefaultAnnualDays, decimal PayPercent, bool IsActive,
    decimal? CarryOverMaxDays = null, int? CarryOverExpiryMonth = null);

public record SaveLeaveAllocationRequest(Guid EmployeeId, Guid LeaveTypeId, int Year, decimal Days);

public record LeaveBalanceResponse(
    Guid EmployeeId,
    string EmployeeName,
    Guid LeaveTypeId,
    string LeaveTypeName,
    int Year,
    decimal Allocated,
    decimal Taken,
    decimal Pending,
    decimal Remaining,
    // True when the allocation is an employee-specific override rather than the type's default.
    bool IsOverride,
    // F9: Allocated includes CarriedOver; ExpiredCarryOver is the unused part of it that lapsed on
    // CarryOverExpiresOn. Remaining = Allocated − Taken − Pending − ExpiredCarryOver.
    decimal CarriedOver = 0m,
    decimal ExpiredCarryOver = 0m,
    DateOnly? CarryOverExpiresOn = null);

public record LeaveCarryOverResponse(int FromYear, int AllocationsUpdated);

public record CreateLeaveRequestRequest(Guid EmployeeId, Guid LeaveTypeId, DateOnly StartDate, DateOnly EndDate, string? Reason);

public record LeaveRequestResponse(
    Guid Id,
    Guid EmployeeId,
    string EmployeeName,
    Guid LeaveTypeId,
    string LeaveTypeName,
    DateOnly StartDate,
    DateOnly EndDate,
    decimal Days,
    string? Reason,
    string State,
    DateTime? DecidedAt,
    DateTime CreatedAt);

public record SavePublicHolidayRequest(DateOnly Date, string Name);

public record PublicHolidayResponse(Guid Id, DateOnly Date, string Name);

// ---- Current user's access ----

public record ModuleAccessResponse(
    AccessLevel Sales,
    AccessLevel Purchases,
    AccessLevel Partners,
    AccessLevel Accounting,
    AccessLevel Reports,
    AccessLevel Hr,
    // docs/USER_ACCESS_PLAN.md areas added with company roles.
    AccessLevel Items = AccessLevel.None,
    AccessLevel Payroll = AccessLevel.None,
    AccessLevel Settings = AccessLevel.None,
    AccessLevel Users = AccessLevel.None,
    AccessLevel Inventory = AccessLevel.None);

// What the web needs to hide nav items and buttons. IsStaff=false means classic role access:
// Modules reflect the role (Write for write-capable roles, Read for ClientViewer).
public record MyAccessResponse(
    bool IsStaff,
    bool CanWrite,
    bool IsAdmin,
    Guid? EmployeeId,
    string? DepartmentName,
    bool PartnerRestricted,
    int AssignedPartnerCount,
    ModuleAccessResponse Modules,
    // F9: the employee record linked to this login in this company (any role), which unlocks
    // "My HR"; IsTeamManager = someone active reports to them (team leave approvals).
    Guid? LinkedEmployeeId = null,
    bool IsTeamManager = false,
    // The role shown in the header ("Administrator", "Accountant", a custom role…), and whether
    // the administration dashboard is available.
    string? RoleName = null,
    bool CanManageUsers = false);
