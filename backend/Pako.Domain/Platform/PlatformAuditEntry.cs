namespace Pako.Domain.Platform;

// docs/PLATFORM_ADMIN.md: every change a platform administrator makes — deciding account requests,
// changing a user's access, switching a company's modules. Never updated or deleted. Separate from
// the company audit trail (AuditEntry), which is per company.
public class PlatformAuditEntry
{
    public Guid Id { get; set; }
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;
    public Guid ActorUserId { get; set; }
    // ApproveRequest, RejectRequest, UpdateUser, UpdateModules.
    public string Action { get; set; } = string.Empty;
    // AccountRequest, User, Company.
    public string TargetType { get; set; } = string.Empty;
    public Guid TargetId { get; set; }
    // Email or company name at the time, so the entry still reads well if the target changes.
    public string TargetLabel { get; set; } = string.Empty;
    // JSON: { "before": {...}, "after": {...} } or { "note": ... }.
    public string? Details { get; set; }
}
