namespace Pako.Api.Contracts;

public record CreateEmployeeRequest(string Name, decimal MonthlyGrossSalary);

public record EmployeeResponse(Guid Id, string Name, decimal MonthlyGrossSalary, bool IsActive);
