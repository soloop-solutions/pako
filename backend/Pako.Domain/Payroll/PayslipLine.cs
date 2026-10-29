namespace Pako.Domain.Payroll;

public class PayslipLine
{
    public Guid Id { get; set; }
    public Guid PayrollRunId { get; set; }
    public Guid EmployeeId { get; set; }

    // Snapshots taken when the run is computed, so later HR edits never change a posted slip.
    public Guid? DepartmentId { get; set; }
    public Guid? CostCenterId { get; set; }

    // Base after proration (partial month, unpaid/part-paid leave).
    public decimal BaseSalary { get; set; }
    public decimal WorkingDays { get; set; }
    public decimal PaidDays { get; set; }

    // Taxable additions to gross, split so bonuses can post to their own expense account.
    public decimal BonusAmount { get; set; }
    public decimal OtherAdditionsAmount { get; set; }

    // GrossSalary = BaseSalary + BonusAmount + OtherAdditionsAmount.
    public decimal GrossSalary { get; set; }
    public decimal PitAmount { get; set; }
    public decimal EmployeePensionAmount { get; set; }
    public decimal EmployerPensionAmount { get; set; }

    // After-tax deductions; NetPay = Gross − PIT − employee pension − Deductions.
    public decimal DeductionsAmount { get; set; }
    public decimal NetPay { get; set; }
    public bool IsPrimaryEmployer { get; set; } = true;

    public PayrollRun? PayrollRun { get; set; }
}
