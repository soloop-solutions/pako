using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Options;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services.Notifications;
using Pako.Domain.Hr;
using Pako.Domain.Notifications;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// Email delivery (docs/EMAIL.md): "Send test email". Sent at once, not through the outbox, so whoever
// set up the email API sees the provider's answer immediately.
[ApiController]
[Authorize]
public class EmailTestController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IEmailSender _sender;
    private readonly NotificationRenderer _renderer;
    private readonly EmailOptions _options;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ILogger<EmailTestController> _logger;

    public EmailTestController(
        PakoDbContext db, IEmailSender sender, NotificationRenderer renderer, IOptions<EmailOptions> options,
        IStringLocalizer<ErrorMessages> localizer, ILogger<EmailTestController> logger)
    {
        _db = db;
        _sender = sender;
        _renderer = renderer;
        _options = options.Value;
        _localizer = localizer;
        _logger = logger;
    }

    // To the signed-in administrator's own address — a company can't use PAKO to mail strangers.
    [HttpPost("api/companies/{companyId:guid}/notifications/test", Name = "SendCompanyTestEmail")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    public async Task<ActionResult<TestEmailResponse>> CompanyTest(Guid companyId)
    {
        var company = await _db.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.Name).FirstOrDefaultAsync();
        if (company is null) return NotFound();
        var email = await CurrentUserEmailAsync();
        if (email is null) return BadRequest(_localizer["TestEmailNoAddress"].Value);
        return Ok(await SendAsync(email, company, companyId));
    }

    [HttpPost("api/platform/email/test", Name = "SendPlatformTestEmail")]
    [RequirePlatformAdmin]
    public async Task<ActionResult<TestEmailResponse>> PlatformTest(SendTestEmailRequest request)
    {
        var email = string.IsNullOrWhiteSpace(request.To) ? await CurrentUserEmailAsync() : request.To.Trim();
        if (email is null || !NotificationOutbox.IsPlausibleEmail(email))
            return BadRequest(string.Format(_localizer["InvoiceEmailInvalidAddress"].Value, email ?? string.Empty));
        return Ok(await SendAsync(email, "PAKO", null));
    }

    private async Task<TestEmailResponse> SendAsync(string to, string company, Guid? companyId)
    {
        var culture = CultureCode();
        var notification = new Notification
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            RecipientEmail = to,
            Template = NotificationTemplates.TestEmail,
            Culture = culture,
            PayloadJson = System.Text.Json.JsonSerializer.Serialize(new Dictionary<string, string>
            {
                ["company"] = company,
                ["mode"] = _options.Mode,
            }),
        };
        var (subject, text, html) = _renderer.Render(notification);
        try
        {
            await _sender.SendAsync(new EmailMessage(to, subject, text, html, Array.Empty<EmailAttachment>(), notification.Id.ToString("N")),
                HttpContext.RequestAborted);
            return new TestEmailResponse(to, true, _options.Mode, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Test email to {To} failed", to);
            return new TestEmailResponse(to, false, _options.Mode, ex.Message);
        }
    }

    private static string CultureCode() =>
        System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "en" ? "en" : NotificationOutbox.DefaultCulture;

    private async Task<string?> CurrentUserEmailAsync()
    {
        if (!Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return null;
        var email = await _db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Email).FirstOrDefaultAsync();
        return NotificationOutbox.IsPlausibleEmail(email) ? email : null;
    }
}
