namespace Pako.Api.Contracts;

public record CreatePayrollRunRequest(DateOnly PeriodStart, DateOnly PeriodEnd);

public record PayslipLineResponse(
    Guid Id,
    Guid EmployeeId,
    decimal GrossSalary,
    decimal PitAmount,
    decimal EmployeePensionAmount,
    decimal EmployerPensionAmount,
    decimal NetPay);

public record PayrollRunResponse(
    Guid Id,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    string State,
    Guid? JournalEntryId,
    List<PayslipLineResponse> Lines);
