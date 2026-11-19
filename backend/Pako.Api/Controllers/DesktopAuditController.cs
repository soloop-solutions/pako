using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Infrastructure;
using Pako.Infrastructure.Audit;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/desktop/audit-verify")]
[AllowAnonymous]
public class DesktopAuditController(PakoDbContext db) : ControllerBase
{
    [HttpGet(Name = "DesktopAuditVerify")]
    public async Task<ActionResult<DesktopAuditVerifyResponse>> Verify(CancellationToken ct)
    {
        var companyIds = await db.Companies.AsNoTracking().OrderBy(c => c.Id).Select(c => c.Id).ToListAsync(ct);
        var failures = new List<DesktopAuditFailure>();
        foreach (var companyId in companyIds)
        {
            var result = await AuditChainVerifier.VerifyAsync(db, companyId, ct);
            if (!result.Valid) failures.Add(new DesktopAuditFailure(companyId, result.Reason ?? "Invalid"));
        }
        return Ok(new DesktopAuditVerifyResponse(failures.Count == 0, failures));
    }
}
