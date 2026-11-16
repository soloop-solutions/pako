namespace Pako.Domain.Shared;

public class AuditEntryImmutableException(Guid auditEntryId)
    : Exception($"Audit entry {auditEntryId} is append-only and cannot be changed or deleted.")
{
    public Guid AuditEntryId { get; } = auditEntryId;
}
