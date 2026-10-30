using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Notifications;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Services.Notifications;

public record NotificationRecipient(string Email, string Culture);

// E7: queues outbox rows on the caller's DbContext. It never calls SaveChanges — the caller's own
// SaveChanges commits the notification together with the business change it reports.
public class NotificationOutbox
{
    public const string DefaultCulture = "sq";

    private readonly PakoDbContext _db;

    public NotificationOutbox(PakoDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsEnabledAsync(Guid companyId, string template) =>
        !await _db.CompanyNotificationSettings.AnyAsync(s => s.CompanyId == companyId && s.Template == template && !s.Enabled);

    // Queues one row per distinct address. A template the company switched off is not queued.
    public async Task EnqueueAsync(
        Guid? companyId,
        string template,
        IEnumerable<NotificationRecipient> recipients,
        IReadOnlyDictionary<string, string> payload,
        string? attachmentKind = null,
        Guid? attachmentRefId = null)
    {
        if (companyId is { } id && !await IsEnabledAsync(id, template)) return;

        var json = JsonSerializer.Serialize(payload);
        foreach (var recipient in recipients
                     .Where(r => IsPlausibleEmail(r.Email))
                     .DistinctBy(r => r.Email.Trim().ToLowerInvariant()))
        {
            _db.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                RecipientEmail = recipient.Email.Trim(),
                Template = template,
                Culture = recipient.Culture is "en" ? "en" : "sq",
                PayloadJson = json,
                AttachmentKind = attachmentKind,
                AttachmentRefId = attachmentRefId,
                CreatedAt = DateTime.UtcNow,
                NextAttemptAt = DateTime.UtcNow
            });
        }
    }

    // Same template to recipients who read different languages: the payload is built once per
    // language, so values like "approved" or a field name arrive translated.
    public async Task EnqueueLocalizedAsync(
        Guid? companyId,
        string template,
        IEnumerable<NotificationRecipient> recipients,
        Func<string, IReadOnlyDictionary<string, string>> payloadFor)
    {
        foreach (var group in recipients.GroupBy(r => r.Culture is "en" ? "en" : "sq"))
        {
            await EnqueueAsync(companyId, template, group, payloadFor(group.Key));
        }
    }

    // ---- Recipients ----

    // The employee's own address: their HR record's email, else the email of their login.
    public async Task<NotificationRecipient?> EmployeeAsync(Employee employee)
    {
        var email = employee.Email;
        if (string.IsNullOrWhiteSpace(email) && employee.UserId is { } userId)
        {
            email = await _db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Email).FirstOrDefaultAsync();
        }

        return string.IsNullOrWhiteSpace(email) ? null : new NotificationRecipient(email, employee.PreferredLanguage);
    }

    // Who handles HR for a company: its firm's admins and accountants, the company's admins, and
    // users whose role approves HR (docs/USER_ACCESS_PLAN.md: HR at Approve).
    public async Task<List<NotificationRecipient>> HrTeamAsync(Guid companyId)
    {
        var firmId = await _db.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.FirmId).FirstOrDefaultAsync();

        var userIds = await _db.Memberships.AsNoTracking()
            .Where(m => m.IsActive && ((m.CompanyId == companyId && m.Role == MembershipRole.ClientAdmin) ||
                        (firmId != null && m.FirmId == firmId && (m.Role == MembershipRole.FirmAdmin || m.Role == MembershipRole.FirmAccountant))))
            .Select(m => m.UserId)
            .ToListAsync();

        var approverIds = await (
            from m in _db.Memberships.AsNoTracking()
            join r in _db.CompanyRoles.AsNoTracking() on m.CompanyRoleId equals r.Id
            where m.CompanyId == companyId && m.IsActive && m.Role == MembershipRole.ClientStaff && r.HrAccess == AccessLevel.Approve
            select m.UserId).ToListAsync();
        var hrStaff = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.UserId != null && approverIds.Contains(e.UserId.Value))
            .Select(e => new { UserId = e.UserId!.Value, e.PreferredLanguage })
            .ToListAsync();
        userIds.AddRange(approverIds);

        var allIds = userIds.Concat(hrStaff.Select(s => s.UserId)).Distinct().ToList();
        var emails = await _db.Users.AsNoTracking()
            .Where(u => allIds.Contains(u.Id) && u.Email != null)
            .Select(u => new { u.Id, u.Email })
            .ToListAsync();

        return emails
            .Select(u => new NotificationRecipient(u.Email!,
                hrStaff.FirstOrDefault(s => s.UserId == u.Id)?.PreferredLanguage ?? DefaultCulture))
            .ToList();
    }

    // Who decides an employee's leave: their direct manager when that manager can be reached,
    // otherwise the HR team.
    public async Task<List<NotificationRecipient>> LeaveApproversAsync(Employee employee)
    {
        if (employee.ManagerId is { } managerId &&
            await _db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.Id == managerId && e.IsActive) is { } manager &&
            await EmployeeAsync(manager) is { } managerRecipient)
        {
            return new List<NotificationRecipient> { managerRecipient };
        }

        return await HrTeamAsync(employee.CompanyId);
    }

    private static bool IsPlausibleEmail(string? email) =>
        !string.IsNullOrWhiteSpace(email) && email.Contains('@') && email.Trim().Length <= 256;
}
