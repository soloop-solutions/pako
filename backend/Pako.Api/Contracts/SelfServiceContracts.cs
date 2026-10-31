namespace Pako.Api.Contracts;

// ---- F9 employee self-service (api/companies/{companyId}/me/...) ----

public record ProfileChangeResponse(
    Guid Id,
    Guid EmployeeId,
    string EmployeeName,
    string NewIban,
    string? NewBankName,
    string? PreviousIban,
    string? PreviousBankName,
    string State,
    DateTime RequestedAt,
    DateTime? DecidedAt);

public record MyProfileResponse(
    Guid EmployeeId,
    string Name,
    string? PersonalNumber,
    string? Email,
    string? Phone,
    string? Address,
    string? JobTitle,
    string? DepartmentName,
    string? ManagerName,
    DateOnly? HireDate,
    string? Iban,
    string? BankName,
    bool ReceivePayslipsByEmail,
    string PreferredLanguage,
    // The bank-account change waiting for HR, if any.
    ProfileChangeResponse? PendingBankChange);

// Phone, address and email preferences apply at once. A new IBAN/bank name only creates a pending
// change for HR to approve; sending the current IBAN again changes nothing.
public record UpdateMyProfileRequest(
    string? Phone,
    string? Address,
    string? Iban,
    string? BankName,
    bool? ReceivePayslipsByEmail,
    string? PreferredLanguage);

// One posted (or paid) payslip of mine. Draft and Approved runs are never shown to employees.
public record MyPayslipResponse(
    Guid RunId,
    Guid LineId,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    string State,
    decimal GrossSalary,
    decimal NetPay,
    DateOnly? PaidOn);

public record CreateMyLeaveRequest(Guid LeaveTypeId, DateOnly StartDate, DateOnly EndDate, string? Reason);
