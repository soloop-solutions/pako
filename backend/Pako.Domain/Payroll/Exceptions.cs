namespace Pako.Domain.Payroll;

public class PostedPayrollRunImmutableException : Exception
{
    public Guid PayrollRunId { get; }

    public PostedPayrollRunImmutableException(Guid payrollRunId)
        : base($"Payroll run {payrollRunId} is Posted and cannot be modified or deleted.")
    {
        PayrollRunId = payrollRunId;
    }
}
