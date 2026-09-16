namespace Pako.Domain.Attachments;

// B12: generic, not typed per entity — one table serves every owner, rather than a
// InvoiceAttachment/BillAttachment/... table per document type. "Owner id" resolves against
// whichever table OwnerType names; there is no database foreign key to enforce that (a generic
// link table can't have one), so AttachmentsController validates the owner actually belongs to
// the company itself before accepting an upload.
public enum AttachmentOwnerType
{
    Invoice,
    Bill,
    JournalEntry,
    Partner
}

// Stored inline in Postgres (Content bytea), not on local disk or external object storage — this
// product has exactly one infrastructure dependency today (self-hosted Postgres, per CLAUDE.md),
// and a self-hosted SME deployment shouldn't need a second one (a persistent volume, its own
// backup story) just to hold invoice/receipt scans. Fine for the sizes a typical attachment
// actually is; revisit if usage patterns turn out to need something else — nothing above the
// storage layer (the controller's own contract) would need to change if it did.
//
// OCR is deliberately NOT part of this task — this is the storage/link mechanism OCR would need
// as a prerequisite (per the brief's own "this is also the OCR prerequisite" framing, not "build
// both together"), not OCR extraction itself.
public class Attachment
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public AttachmentOwnerType OwnerType { get; set; }
    public Guid OwnerId { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public byte[] Content { get; set; } = [];
    public DateTime UploadedAtUtc { get; set; } = DateTime.UtcNow;
    public Guid UploadedByUserId { get; set; }
}
