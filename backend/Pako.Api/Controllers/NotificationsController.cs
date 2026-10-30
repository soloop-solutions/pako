using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Notifications;
using Pako.Infrastructure;
using Pako.Domain.Hr;

namespace Pako.Api.Controllers;

// E7: which emails a company sends, and what was sent.
[ApiController]
[Route("api/companies/{companyId:guid}/notifications")]
[Authorize]
public class NotificationsController : ControllerBase
{
    private readonly PakoDbContext _db;

    public NotificationsController(PakoDbContext db)
    {
        _db = db;
    }

    [HttpGet("settings", Name = "GetNotificationSettings")]
    [RequireCompanyAccess(module: AccessModule.Settings)]
    public async Task<ActionResult<List<NotificationSettingResponse>>> Settings(Guid companyId)
    {
        var disabled = await _db.CompanyNotificationSettings.AsNoTracking()
            .Where(s => s.CompanyId == companyId && !s.Enabled)
            .Select(s => s.Template)
            .ToListAsync();
        return Ok(NotificationTemplates.CompanyConfigurable
            .Select(t => new NotificationSettingResponse(t, !disabled.Contains(t)))
            .ToList());
    }

    [HttpPut("settings", Name = "SaveNotificationSettings")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    public async Task<ActionResult<List<NotificationSettingResponse>>> SaveSettings(Guid companyId, SaveNotificationSettingsRequest request)
    {
        var existing = await _db.CompanyNotificationSettings.Where(s => s.CompanyId == companyId).ToListAsync();
        foreach (var setting in request.Settings.Where(s => NotificationTemplates.CompanyConfigurable.Contains(s.Template)))
        {
            var row = existing.FirstOrDefault(e => e.Template == setting.Template);
            if (setting.Enabled)
            {
                if (row is not null) _db.CompanyNotificationSettings.Remove(row);
            }
            else if (row is null)
            {
                _db.CompanyNotificationSettings.Add(new CompanyNotificationSetting { CompanyId = companyId, Template = setting.Template, Enabled = false });
            }
        }

        await _db.SaveChangesAsync();
        return await Settings(companyId);
    }

    [HttpGet("log", Name = "ListNotificationLog")]
    [RequireCompanyAccess(module: AccessModule.Settings)]
    public async Task<ActionResult<PaginatedResponse<NotificationLogResponse>>> Log(
        Guid companyId, [FromQuery] int page = 1, [FromQuery] int pageSize = 50, [FromQuery] string? state = null)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _db.Notifications.AsNoTracking().Where(n => n.CompanyId == companyId);
        if (Enum.TryParse<NotificationState>(state, true, out var parsed)) query = query.Where(n => n.State == parsed);

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(n => n.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(n => new NotificationLogResponse(n.Id, n.Template, n.RecipientEmail, n.State.ToString(), n.Attempts, n.LastError, n.CreatedAt, n.SentAt))
            .ToListAsync();
        return Ok(new PaginatedResponse<NotificationLogResponse>(rows, total, page, pageSize));
    }

    // Puts a Failed row back in the queue (e.g. after fixing the SMTP settings).
    [HttpPost("log/{id:guid}/retry", Name = "RetryNotification")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    public async Task<IActionResult> Retry(Guid companyId, Guid id)
    {
        var row = await _db.Notifications.FirstOrDefaultAsync(n => n.Id == id && n.CompanyId == companyId);
        if (row is null) return NotFound();
        if (row.State != NotificationState.Failed) return NoContent();

        row.State = NotificationState.Pending;
        row.Attempts = 0;
        row.NextAttemptAt = DateTime.UtcNow;
        row.LastError = null;
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
