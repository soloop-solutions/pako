namespace Pako.Domain.Invoicing;

// A5 (v2 release): "every edit of a posted document writes an audit row." Typed columns, not a
// generic FieldName/OldValue/NewValue design — only DueDate/InternalNotes are ever editable on a
// Posted document (see InvoicesController.Update/BillsController.Update), so a key-value table
// would be over-engineering. DocumentId is polymorphic (Invoice or Bill) and carries no DB FK,
// same convention as JournalEntry.SourceDocumentId/DocumentNumberAudit.DocumentId.
public class DocumentEditAudit
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid UserId { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public DateOnly? OldDueDate { get; set; }
    public DateOnly? NewDueDate { get; set; }
    public string? OldInternalNotes { get; set; }
    public string? NewInternalNotes { get; set; }
}
