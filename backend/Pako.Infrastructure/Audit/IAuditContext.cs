namespace Pako.Infrastructure.Audit;

public interface IAuditContext
{
    string? UserId { get; }
    string? IpAddress { get; }
    string? RequestId { get; }
    Guid? SourceDocumentId { get; set; }
}
