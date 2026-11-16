namespace Pako.Domain.Shared;

public class AuditEntry
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public string EntityId { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string? UserId { get; set; }
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;
    public string? Changes { get; set; }

    public string? IpAddress { get; set; }
    public string? RequestId { get; set; }
    public Guid? SourceDocumentId { get; set; }

    public long? SequenceNumber { get; set; }
    public string? PrevHash { get; set; }
    public string? EntryHash { get; set; }
}
