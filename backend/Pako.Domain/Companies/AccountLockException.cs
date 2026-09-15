namespace Pako.Domain.Companies;

// B4: the four soft locks an exception can apply to — deliberately excludes HardLockDate.
// Exceptions apply to soft locks only; HardLockDate has no exception path at all.
public enum LockDateField
{
    AccountingLockDate,
    TaxLockDate,
    SaleLockDate,
    PurchaseLockDate
}

// B4: a per-user, reasoned, expiring override of one soft lock. Never deleted (R26-style — see
// CLAUDE.md's repo-wide "no deletion" convention): revoking sets RevokedAt rather than removing
// the row, so the grant/revoke history stays auditable.
public class AccountLockException
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid UserId { get; set; }
    public LockDateField LockDateField { get; set; }
    public DateOnly LockDate { get; set; }
    public string Reason { get; set; } = string.Empty;
    public DateTime EndsAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid GrantedByUserId { get; set; }
    public DateTime? RevokedAt { get; set; }
    public Guid? RevokedByUserId { get; set; }

    public bool IsLive(DateTime asOfUtc) => RevokedAt is null && EndsAt > asOfUtc;
}
