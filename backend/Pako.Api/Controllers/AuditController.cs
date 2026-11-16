using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Auth;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Shared;
using Pako.Infrastructure;
using Pako.Infrastructure.Audit;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/audit")]
[Authorize]
public class AuditController : ControllerBase
{
    private const int ExportRowLimit = 20000;

    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ExportLabels _labels;
    private readonly ReportSourceResolver _sources;

    public AuditController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, ExportLabels labels, ReportSourceResolver sources)
    {
        _sources = sources;
        _db = db;
        _localizer = localizer;
        _labels = labels;
    }

    // The trail records changes to every kind of record (salaries, invoices, users), so only company
    // administrators may read it.
    [HttpGet]
    [RequireCompanyAccess(adminOnly: true)]
    public async Task<ActionResult<List<AuditEntryResponse>>> List(
        Guid companyId,
        [FromQuery] string? entityType,
        [FromQuery] string? entityId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? userId = null,
        [FromQuery] string? action = null,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] string? search = null)
    {
        if (RangeInvalid(from, to))
        {
            return BadRequest(_localizer["ReportDateRangeInvalid"].Value);
        }

        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var rows = await Filtered(companyId, entityType, entityId, userId, action, from, to, search)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(await ToResponsesAsync(rows));
    }

    [HttpGet("paged", Name = "AuditPaged")]
    [RequireCompanyAccess(adminOnly: true)]
    public async Task<ActionResult<PaginatedResponse<AuditEntryResponse>>> ListPaged(
        Guid companyId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? entityType = null,
        [FromQuery] string? entityId = null,
        [FromQuery] string? userId = null,
        [FromQuery] string? action = null,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] string? search = null)
    {
        if (RangeInvalid(from, to))
        {
            return BadRequest(_localizer["ReportDateRangeInvalid"].Value);
        }

        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = Filtered(companyId, entityType, entityId, userId, action, from, to, search);
        var total = await query.CountAsync();
        var rows = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new PaginatedResponse<AuditEntryResponse>(await ToResponsesAsync(rows), total, page, pageSize));
    }

    [HttpGet("{id:guid}", Name = "AuditDetail")]
    [RequireCompanyAccess(adminOnly: true)]
    public async Task<ActionResult<AuditEntryDetailResponse>> Get(Guid companyId, Guid id)
    {
        var row = await _db.AuditEntries.AsNoTracking().FirstOrDefaultAsync(a => a.CompanyId == companyId && a.Id == id);
        if (row is null)
        {
            return NotFound();
        }

        var entry = (await ToResponsesAsync(new List<AuditEntry> { row }))[0];
        var fields = ParseChanges(row.Changes)
            .Select(c => new AuditFieldChangeResponse(c.Field, c.OldValue, c.NewValue)).ToList();
        return Ok(new AuditEntryDetailResponse(entry, fields, row.PrevHash));
    }

    [HttpGet("verify", Name = "AuditVerify")]
    [RequireCompanyAccess(adminOnly: true)]
    public async Task<ActionResult<AuditVerifyResponse>> Verify(Guid companyId, CancellationToken cancellationToken)
    {
        var result = await AuditChainVerifier.VerifyAsync(_db, companyId, cancellationToken);
        return Ok(new AuditVerifyResponse(
            result.Valid, result.CheckedCount, result.UnchainedCount,
            result.FirstBrokenSequence, result.FirstBrokenId, result.Reason));
    }

    [ProducesXlsx]
    [EnableRateLimiting(AuthRateLimit.ExcelExportPolicy)]
    [HttpGet("export", Name = "AuditExport")]
    [RequireCompanyAccess(adminOnly: true)]
    public async Task<IActionResult> Export(
        Guid companyId,
        [FromQuery] string? entityType = null,
        [FromQuery] string? entityId = null,
        [FromQuery] string? userId = null,
        [FromQuery] string? action = null,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] string? search = null)
    {
        if (RangeInvalid(from, to))
        {
            return BadRequest(_localizer["ReportDateRangeInvalid"].Value);
        }

        var query = Filtered(companyId, entityType, entityId, userId, action, from, to, search);
        if (await query.CountAsync() > ExportRowLimit)
        {
            return BadRequest(_localizer["AuditExportTooLarge", ExportRowLimit].Value);
        }

        var responses = await ToResponsesAsync(await query.ToListAsync());
        var headers = new[]
        {
            _labels["Audit_Sequence"], _labels["Audit_OccurredAt"], _labels["Audit_User"], _labels["Audit_Action"],
            _labels["Audit_EntityType"], _labels["Audit_EntityId"], _labels["Audit_Changes"],
            _labels["Audit_IpAddress"], _labels["Audit_RequestId"]
        };
        var rows = responses.Select(r => (IReadOnlyList<object?>)new object?[]
        {
            r.SequenceNumber,
            r.OccurredAtUtc.ToString("yyyy-MM-dd HH:mm:ss"),
            r.UserName ?? r.UserEmail ?? r.UserId,
            _labels["Audit_Action_" + r.Action],
            r.EntityType,
            r.EntityId,
            ChangesText(r.Changes),
            r.IpAddress,
            r.RequestId
        }).ToList();

        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_Audit"], headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"audit-trail-{DateTime.UtcNow:yyyyMMdd}.xlsx");
    }

    private static string? ChangesText(string? changes)
    {
        var parsed = ParseChanges(changes);
        return parsed.Count == 0
            ? changes
            : string.Join("; ", parsed.Select(c => $"{c.Field}: {c.OldValue} → {c.NewValue}"));
    }

    private static bool RangeInvalid(DateOnly? from, DateOnly? to) => from is { } f && to is { } t && f > t;

    private IQueryable<AuditEntry> Filtered(
        Guid companyId, string? entityType, string? entityId, string? userId, string? action,
        DateOnly? from, DateOnly? to, string? search)
    {
        var query = _db.AuditEntries.AsNoTracking().Where(a => a.CompanyId == companyId);
        if (!string.IsNullOrEmpty(entityType)) query = query.Where(a => a.EntityType == entityType);
        if (!string.IsNullOrEmpty(entityId)) query = query.Where(a => a.EntityId == entityId);
        if (!string.IsNullOrEmpty(userId)) query = query.Where(a => a.UserId == userId);
        if (!string.IsNullOrEmpty(action)) query = query.Where(a => a.Action == action);
        if (from is { } f)
        {
            var start = DateTime.SpecifyKind(f.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
            query = query.Where(a => a.OccurredAtUtc >= start);
        }

        if (to is { } t)
        {
            var end = DateTime.SpecifyKind(t.AddDays(1).ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
            query = query.Where(a => a.OccurredAtUtc < end);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = LikePattern.Contains(search.Trim());
            var userIds = _db.Users
                .Where(u => (u.Email != null && EF.Functions.ILike(u.Email, pattern, LikePattern.EscapeChar)) ||
                            (u.FullName != null && EF.Functions.ILike(u.FullName, pattern, LikePattern.EscapeChar)))
                .Select(u => u.Id.ToString());
            query = query.Where(a =>
                EF.Functions.ILike(a.EntityType, pattern, LikePattern.EscapeChar) ||
                EF.Functions.ILike(a.EntityId, pattern, LikePattern.EscapeChar) ||
                EF.Functions.ILike(a.Action, pattern, LikePattern.EscapeChar) ||
                (a.Changes != null && EF.Functions.ILike(a.Changes, pattern, LikePattern.EscapeChar)) ||
                (a.IpAddress != null && EF.Functions.ILike(a.IpAddress, pattern, LikePattern.EscapeChar)) ||
                (a.RequestId != null && EF.Functions.ILike(a.RequestId, pattern, LikePattern.EscapeChar)) ||
                (a.UserId != null && userIds.Contains(a.UserId)));
        }

        return query.OrderByDescending(a => a.OccurredAtUtc)
            .ThenByDescending(a => a.SequenceNumber)
            .ThenBy(a => a.Id);
    }

    private async Task<List<AuditEntryResponse>> ToResponsesAsync(List<AuditEntry> rows)
    {
        var companyId = rows.Count > 0 ? rows[0].CompanyId : Guid.Empty;
        var kinds = await _sources.ResolveKindsAsync(companyId, rows.Where(r => r.SourceDocumentId != null).Select(r => r.SourceDocumentId!.Value));

        var userIds = rows.Select(r => r.UserId).Where(u => Guid.TryParse(u, out _))
            .Select(u => Guid.Parse(u!)).Distinct().ToList();
        var users = userIds.Count == 0
            ? new Dictionary<string, (string? Name, string? Email)>()
            : (await _db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id))
                .Select(u => new { u.Id, u.FullName, u.Email }).ToListAsync())
                .ToDictionary(u => u.Id.ToString(), u => (u.FullName, u.Email));

        return rows.Select(a =>
        {
            (string? Name, string? Email) user = a.UserId is not null && users.TryGetValue(a.UserId, out var found)
                ? found : (null, null);
            return new AuditEntryResponse(
                a.Id, a.EntityType, a.EntityId, a.Action, a.UserId, a.OccurredAtUtc, a.Changes,
                user.Name, user.Email, a.IpAddress, a.RequestId, a.SourceDocumentId, a.SequenceNumber, a.EntryHash,
                a.SourceDocumentId is { } sid && kinds.TryGetValue(sid, out var kind) ? kind : null);
        }).ToList();
    }

    private static List<AuditFieldChange> ParseChanges(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || !json.TrimStart().StartsWith('['))
        {
            return new List<AuditFieldChange>();
        }

        try
        {
            return JsonSerializer.Deserialize<List<JsonElement>>(json)!
                .Where(e => e.ValueKind == JsonValueKind.Object && e.TryGetProperty("field", out _))
                .Select(e => new AuditFieldChange(
                    e.GetProperty("field").GetString() ?? string.Empty,
                    e.TryGetProperty("oldValue", out var o) ? o.GetString() : null,
                    e.TryGetProperty("newValue", out var n) ? n.GetString() : null))
                .ToList();
        }
        catch (JsonException)
        {
            return new List<AuditFieldChange>();
        }
    }

    /// <summary>
    /// Stages a semantic audit entry (Post, Payment, role change, lock date…) on the DbContext's change
    /// tracker WITHOUT calling SaveChangesAsync. It commits atomically with the caller's next
    /// SaveChangesAsync and is chained with the automatic entries; user, IP and request id are filled
    /// from the ambient request when not given. Field-level Created/Updated/Deleted rows are written
    /// automatically for [Audited] entities, so Stage is only for events that name what happened.
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
