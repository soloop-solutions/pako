namespace Pako.Domain.Companies;

public enum MonthLockAction
{
    Lock,
    Unlock
}

[Pako.Domain.Shared.Audited]
public class MonthLock
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public int Year { get; set; }
    public int Month { get; set; } // 1-12
    public bool IsLocked { get; set; }
    public Guid? LockedByUserId { get; set; }
    public DateTime? LockedAt { get; set; }
    public Guid? UnlockedByUserId { get; set; }
    public DateTime? UnlockedAt { get; set; }
    public string? UnlockReason { get; set; }
}

public class MonthLockEvent
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public int Year { get; set; }
    public int Month { get; set; } // 1-12
    public MonthLockAction Action { get; set; }
    public Guid UserId { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string? Reason { get; set; }
}
