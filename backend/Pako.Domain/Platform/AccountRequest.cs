namespace Pako.Domain.Platform;

public enum AccountRequestStatus
{
    Pending,
    Approved,
    Rejected
}

// Someone asking for a PAKO account. Accounts are no longer self-registered: a platform
// administrator approves the request (choosing how many companies the person may create), which
// creates the login and sends a link to set the password.
public class AccountRequest
{
    public Guid Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? FirmName { get; set; }
    public string? BusinessNumber { get; set; }
    public string? City { get; set; }
    public int RequestedCompanies { get; set; } = 1;
    public string? Message { get; set; }
    public AccountRequestStatus Status { get; set; } = AccountRequestStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DecidedAt { get; set; }
    public Guid? DecidedByUserId { get; set; }
    public string? DecisionNote { get; set; }
    public Guid? UserId { get; set; }
}
