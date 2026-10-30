using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Domain.Shared;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/audit")]
[Authorize]
public class AuditController : ControllerBase
{
    private readonly PakoDbContext _db;

    public AuditController(PakoDbContext db) => _db = db;

    public record AuditEntryResponse(
        Guid Id, string EntityType, string EntityId, string Action,
        string? UserId, DateTime OccurredAtUtc, string? Changes);

    // The trail records changes to every kind of record (salaries, invoices, users), so only company
    // administrators may read it.
    [HttpGet]
    [RequireCompanyAccess(adminOnly: true)]
    public async Task<ActionResult<List<AuditEntryResponse>>> List(
        Guid companyId,
        [FromQuery] string? entityType,
        [FromQuery] string? entityId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50)
    {
        var entries = await _db.AuditEntries.AsNoTracking()
            .Where(a => a.CompanyId == companyId)
            .Where(a => string.IsNullOrEmpty(entityType) || a.EntityType == entityType)
            .Where(a => string.IsNullOrEmpty(entityId) || a.EntityId == entityId)
            .OrderByDescending(a => a.OccurredAtUtc)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => new AuditEntryResponse(
                a.Id, a.EntityType, a.EntityId, a.Action,
                a.UserId, a.OccurredAtUtc, a.Changes))
            .ToListAsync();

        return Ok(entries);
    }

    /// <summary>
    /// Stages an audit entry on the DbContext's change tracker WITHOUT calling SaveChangesAsync.
    /// The entry commits atomically with the next SaveChangesAsync the caller performs —
    /// if the business operation rolls back, the audit entry is also rolled back.
    ///
    /// For accounting-critical operations (post, payment, refund, reversal), call this
    /// BEFORE the final SaveChangesAsync so the audit record is part of the same transaction.
    /// </summary>
    public static void Stage(PakoDbContext db, Guid companyId, string entityType,
        string entityId, string action, string? userId, string? changes = null)
    {
        db.AuditEntries.Add(new AuditEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            EntityType = entityType,
            EntityId = entityId,
            Action = action,
            UserId = userId,
            OccurredAtUtc = DateTime.UtcNow,
            Changes = changes
        });
    }
}
