namespace Pako.Domain.Shared;

/// <summary>
/// Item 36: immutable audit log entry. Recorded by the SaveChanges interceptor for
/// accounting-sensitive entities (invoices, bills, journal entries, accounts, partners).
/// </summary>
public class AuditEntry
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public string EntityId { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty; // Created, Updated
    public string? UserId { get; set; }
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;
    public string? Changes { get; set; } // JSON: [{field, oldValue, newValue}]
}
