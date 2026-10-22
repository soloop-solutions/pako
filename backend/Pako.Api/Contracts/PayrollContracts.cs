namespace Pako.Api.Contracts;

public record CreatePayrollRunRequest(DateOnly PeriodStart, DateOnly PeriodEnd);
