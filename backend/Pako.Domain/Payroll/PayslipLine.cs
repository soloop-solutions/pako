namespace Pako.Domain.Payroll;

public class PayslipLine
{
    public Guid Id { get; set; }
    public Guid PayrollRunId { get; set; }
    public Guid EmployeeId { get; set; }
    public decimal GrossSalary { get; set; }
    public decimal PitAmount { get; set; }
    public decimal EmployeePensionAmount { get; set; }
    public decimal EmployerPensionAmount { get; set; }
    public decimal NetPay { get; set; }

    public PayrollRun? PayrollRun { get; set; }
}
