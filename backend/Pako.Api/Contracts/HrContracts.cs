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
    bool IsActive = true);

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
    List<string> Warnings);

public record SetEmployeePartnersRequest(List<Guid> PartnerIds);

public record EmployeePartnerResponse(Guid PartnerId, string Name, bool IsCustomer, bool IsVendor);

// ---- Contracts (salary history) ----

public record SaveEmployeeContractRequest(
    DateOnly StartDate,
    DateOnly? EndDate,
    decimal MonthlyGrossSalary,
    EmploymentType EmploymentType,
    decimal WeeklyHours,
    string? JobTitle,
    string? Notes);

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
    bool IsCurrent);

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
    Guid? PayrollRunId);

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
    List<PayrollAdjustmentResponse> Adjustments);

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
    List<string> Warnings);

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

public record SaveLeaveTypeRequest(string Code, string Name, decimal? DefaultAnnualDays, decimal PayPercent, bool IsActive = true);

public record LeaveTypeResponse(Guid Id, string Code, string Name, decimal? DefaultAnnualDays, decimal PayPercent, bool IsActive);

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
    decimal Remaining);

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
    AccessLevel Hr);

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
    ModuleAccessResponse Modules);
