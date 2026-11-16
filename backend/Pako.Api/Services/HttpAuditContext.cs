using System.Security.Claims;
using Pako.Infrastructure.Audit;

namespace Pako.Api.Services;

public class HttpAuditContext(IHttpContextAccessor accessor) : IAuditContext
{
    public string? UserId => accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);

    public string? IpAddress => accessor.HttpContext?.Connection.RemoteIpAddress?.ToString();

    public string? RequestId => accessor.HttpContext?.TraceIdentifier;

    public Guid? SourceDocumentId { get; set; }
}
