namespace Pako.Api.Contracts;

public record AccountingDocumentResponse(
    Guid Id,
    string Name,
    string FileName,
    string ContentType,
    long SizeBytes,
    string DocumentType, // "Buy" or "Sell"
    int Year,
    int Month,
    Guid UploadedByUserId,
    DateTime CreatedAt);

public record AccountingDocumentListResponse(
    AccountingDocumentResponse[] Items,
    int Total);

// Bound class (not a record) for multipart/form-data — same NSwag workaround as
// UploadAttachmentRequest: individual [FromForm] parameters with an enum produce an allOf
// schema that NSwag's client generator doesn't flatten correctly.
public class UploadAccountingDocumentRequest
{
    public string DocumentType { get; set; } = string.Empty; // "Buy" or "Sell"
    public int Year { get; set; }
    public int Month { get; set; } // 1-12
    public string? Name { get; set; }
    public Microsoft.AspNetCore.Http.IFormFile? File { get; set; }
}
