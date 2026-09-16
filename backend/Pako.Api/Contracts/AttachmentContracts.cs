using Microsoft.AspNetCore.Http;

namespace Pako.Api.Contracts;

// A bound class, not a record with a query/route param per field: ASP.NET Core's built-in OpenAPI
// generator describes a multipart/form-data operation with several individual [FromForm]
// parameters as an `allOf` of several single-property schemas, which NSwag's client generator
// doesn't flatten back into one method signature (confirmed — one parameter silently vanished
// from the generated client entirely). Binding the whole form to one model produces a single flat
// schema object instead, which both generators handle correctly.
public class UploadAttachmentRequest
{
    public string OwnerType { get; set; } = string.Empty;
    public Guid OwnerId { get; set; }
    public IFormFile? File { get; set; }
}

public record AttachmentResponse(
    Guid Id,
    string OwnerType,
    Guid OwnerId,
    string FileName,
    string ContentType,
    long SizeBytes,
    DateTime UploadedAtUtc);
