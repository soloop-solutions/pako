using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace Pako.Api.Services;

// Microsoft.AspNetCore.OpenApi (the built-in generator wired up in Program.cs, not Swashbuckle)
// emits a nested IFormFile property — e.g. AttachmentContracts.UploadAttachmentRequest.File,
// bound via [FromForm] on AttachmentsController.Upload — as a $ref to a named "IFormFile"
// component schema rather than an inline `{type: string, format: binary}`. That $ref survives
// an IOpenApiSchemaTransformer targeting the DTO's own type, because the multipart/form-data
// request schema for a [FromForm] parameter is assembled directly from ApiParameterDescription
// metadata rather than through a JsonTypeInfo pass over the DTO — so a schema transformer keyed
// on the DTO's type never runs for it. Fixing it up on the fully-built document, after every
// operation's request body exists, is what actually works. NSwag's client generator only
// recognises the inline shape when deciding to emit its `FileParameter` helper interface; it
// doesn't resolve the $ref, so without this it referenced `FileParameter` in the generated
// client without ever defining it — a TypeScript compile error. Confirmed by regenerating
// against the live API before and after this transformer. This changes no runtime behavior.
public sealed class FormFileSchemaTransformer : IOpenApiDocumentTransformer
{
    public Task TransformAsync(OpenApiDocument document, OpenApiDocumentTransformerContext context, CancellationToken cancellationToken)
    {
        // The null-forgiving operators below work around Microsoft.OpenApi's nullable annotations
        // not flowing through Operations/Content the way a null check normally narrows — these
        // are never actually null for a document ASP.NET Core itself generated.
        foreach (OpenApiPathItem pathItem in document.Paths.Values)
        {
            foreach (OpenApiOperation operation in pathItem.Operations!.Values)
            {
                var requestBody = operation.RequestBody;
                if (requestBody is null ||
                    !requestBody.Content!.TryGetValue("multipart/form-data", out var mediaType) ||
                    mediaType.Schema is not { Properties: { } properties })
                {
                    continue;
                }

                foreach (var propertyName in properties.Keys.ToList())
                {
                    if (properties[propertyName] is { Format: "binary" })
                    {
                        properties[propertyName] = new OpenApiSchema { Type = JsonSchemaType.String, Format = "binary" };
                    }
                }
            }
        }

        return Task.CompletedTask;
    }
}
