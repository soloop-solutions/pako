namespace Pako.Domain.Payroll;

public class Employee
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public decimal MonthlyGrossSalary { get; set; }
    public bool IsActive { get; set; } = true;
}
