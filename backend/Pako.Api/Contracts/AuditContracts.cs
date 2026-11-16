namespace Pako.Api.Contracts;

public record AuditEntryResponse(
    Guid Id, string EntityType, string EntityId, string Action,
    string? UserId, DateTime OccurredAtUtc, string? Changes,
    string? UserName = null, string? UserEmail = null,
    string? IpAddress = null, string? RequestId = null, Guid? SourceDocumentId = null,
    long? SequenceNumber = null, string? EntryHash = null);

public record AuditFieldChangeResponse(string Field, string? OldValue, string? NewValue);

public record AuditEntryDetailResponse(
    AuditEntryResponse Entry, List<AuditFieldChangeResponse> Fields, string? PrevHash);

public record AuditVerifyResponse(
    bool Valid, int CheckedCount, int UnchainedCount,
    long? FirstBrokenSequence, Guid? FirstBrokenId, string? Reason);
