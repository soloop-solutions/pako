namespace Pako.Domain.Hr;

public class LeaveType
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;

    // Default yearly entitlement; null = no allocation tracked (e.g. unpaid leave).
    public decimal? DefaultAnnualDays { get; set; }

    // Share of the daily base salary paid for a day of this leave: 100 for annual/sick, 70 for
    // the employer-paid part of maternity, 0 for unpaid. Payroll deducts (100 - PayPercent)%.
    public decimal PayPercent { get; set; } = 100m;
    public bool IsActive { get; set; } = true;

    // F9 year-end carry-over: at most this many unused days move to next year (null = none), and
    // they lapse if not used by the end of CarryOverExpiryMonth of that year (null = never).
    // Kosovo Law on Labour art. 32: unused annual leave may be used until 30 June (month 6).
    public decimal? CarryOverMaxDays { get; set; }
    public int? CarryOverExpiryMonth { get; set; }
}

public class LeaveAllocation
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EmployeeId { get; set; }
    public Guid LeaveTypeId { get; set; }
    public int Year { get; set; }

    // The entitlement for the year. Used only when HasCustomDays; otherwise the type's default
    // applies (a row can exist just to hold carried-over days).
    public decimal Days { get; set; }
    public bool HasCustomDays { get; set; } = true;

    // Days carried in from the previous year (null = carry-over not run for this row yet) and the
    // date they lapse if unused.
    public decimal? CarriedOverDays { get; set; }
    public DateOnly? CarriedOverExpiresOn { get; set; }

    public decimal EntitlementDays(LeaveType type) => HasCustomDays ? Days : type.DefaultAnnualDays ?? 0m;
}

public enum LeaveRequestState
{
    Pending,
    Approved,
    Rejected,
    Cancelled
}

public class LeaveRequest
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EmployeeId { get; set; }
    public Guid LeaveTypeId { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }

    // Working days (Mon–Fri, excluding the company's public holidays) — fixed at request time.
    public decimal Days { get; set; }
    public string? Reason { get; set; }
    public LeaveRequestState State { get; set; } = LeaveRequestState.Pending;
    public Guid? DecidedByUserId { get; set; }
    public DateTime? DecidedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public void Decide(bool approve, Guid userId)
    {
        if (State != LeaveRequestState.Pending)
        {
            throw new InvalidOperationException($"Leave request {Id} is {State}; only Pending requests can be decided.");
        }

        State = approve ? LeaveRequestState.Approved : LeaveRequestState.Rejected;
        DecidedByUserId = userId;
        DecidedAt = DateTime.UtcNow;
    }

    public void Cancel()
    {
        if (State is LeaveRequestState.Rejected or LeaveRequestState.Cancelled)
        {
            throw new InvalidOperationException($"Leave request {Id} is already {State}.");
        }

        State = LeaveRequestState.Cancelled;
    }
}

public class PublicHoliday
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public DateOnly Date { get; set; }
    public string Name { get; set; } = string.Empty;
}
