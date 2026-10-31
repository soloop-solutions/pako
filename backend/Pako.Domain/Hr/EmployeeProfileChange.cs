namespace Pako.Domain.Hr;

public enum ProfileChangeState
{
    Pending,
    Approved,
    Rejected,
    Cancelled
}

// F9: a bank-account change an employee asked for through self-service. Salaries are paid to this
// account, so it applies only once HR approves it (fraud guard: a hijacked login can't redirect
// pay). Phone and address changes apply directly and never create one of these.
public class EmployeeProfileChange
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EmployeeId { get; set; }

    public string NewIban { get; set; } = string.Empty;
    public string? NewBankName { get; set; }

    // What was on file when the change was requested, for the reviewer.
    public string? PreviousIban { get; set; }
    public string? PreviousBankName { get; set; }

    public ProfileChangeState State { get; set; } = ProfileChangeState.Pending;
    public Guid RequestedByUserId { get; set; }
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public Guid? DecidedByUserId { get; set; }
    public DateTime? DecidedAt { get; set; }

    public void Decide(bool approve, Guid userId, DateTime now)
    {
        if (State != ProfileChangeState.Pending)
        {
            throw new InvalidOperationException($"Profile change {Id} is {State}; only Pending changes can be decided.");
        }

        State = approve ? ProfileChangeState.Approved : ProfileChangeState.Rejected;
        DecidedByUserId = userId;
        DecidedAt = now;
    }
}
