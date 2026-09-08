namespace Pako.Domain.Companies;

// S0.3 (Sprint 0 registers, additive/inert). DocumentId is polymorphic (Invoice or Bill) and
// carries no DB FK, same convention as JournalEntry.SourceDocumentId.
public class DocumentNumberAudit
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid UserId { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string? OldNumber { get; set; }
    public string? NewNumber { get; set; }
}
