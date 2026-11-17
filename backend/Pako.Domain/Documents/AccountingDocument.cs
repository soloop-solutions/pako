namespace Pako.Domain.Documents;

public enum AccountingDocumentType { Buy, Sell }

// A file-cabinet document organized by year/month/type — the "Dokumentet" feature from kudofatura.
// Stored inline in Postgres (Content bytea), same rationale as Attachment.cs: one infrastructure
// dependency, no object storage needed for typical scan sizes.
public class AccountingDocument
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public byte[] Content { get; set; } = [];
    public AccountingDocumentType DocumentType { get; set; }
    public int Year { get; set; }
    public int Month { get; set; } // 1-12
    public Guid UploadedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
