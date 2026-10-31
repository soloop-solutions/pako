using System.Globalization;
using System.Net;
using System.Resources;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pako.Domain.Notifications;
using Pako.Infrastructure;

namespace Pako.Api.Services.Notifications;

// Turns an outbox row into an email: subject and body from ErrorMessages(.sq).resx keys
// Email_{Template}_Subject / Email_{Template}_Body, with {name} placeholders filled from the
// row's payload. Background work has no request culture, so the culture comes from the row.
public class NotificationRenderer
{
    private static readonly ResourceManager Resources = new("Pako.Api.Resources.ErrorMessages", typeof(ErrorMessages).Assembly);

    private readonly EmailOptions _options;

    public NotificationRenderer(IOptions<EmailOptions> options)
    {
        _options = options.Value;
    }

    public static string Text(string key, string culture) =>
        Resources.GetString(key, CultureInfo.GetCultureInfo(culture)) ?? key;

    public static Func<string, string> Labels(string culture) => key => Text(key, culture);

    public (string Subject, string TextBody, string HtmlBody) Render(Notification notification)
    {
        var payload = JsonSerializer.Deserialize<Dictionary<string, string>>(notification.PayloadJson) ?? new();
        payload.TryAdd("appUrl", _options.AppBaseUrl.TrimEnd('/'));

        var subject = Fill(Text($"Email_{notification.Template}_Subject", notification.Culture), payload);
        var body = Fill(Text($"Email_{notification.Template}_Body", notification.Culture), payload);
        var footer = Text("Email_Footer", notification.Culture);
        var text = $"{body}\n\n—\n{footer}";

        var html = new StringBuilder("<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937\">");
        foreach (var paragraph in body.Split("\n\n"))
        {
            html.Append("<p>").Append(WebUtility.HtmlEncode(paragraph).Replace("\n", "<br>")).Append("</p>");
        }

        html.Append("<p style=\"color:#6b7280;font-size:12px\">").Append(WebUtility.HtmlEncode(footer)).Append("</p></div>");
        return (subject, text, html.ToString());
    }

    private static string Fill(string template, IReadOnlyDictionary<string, string> payload)
    {
        var result = template;
        foreach (var (key, value) in payload)
        {
            result = result.Replace("{" + key + "}", value);
        }

        return result;
    }
}

// E8 worker step: delivers due outbox rows. Rows are claimed with FOR UPDATE SKIP LOCKED plus a
// short lease (LockedUntil), so two API instances never send the same email, and a crashed
// instance's claim simply expires.
public class NotificationDispatcher
{
    public const int BatchSize = 20;
    private static readonly TimeSpan Lease = TimeSpan.FromMinutes(5);

    private readonly PakoDbContext _db;
    private readonly IEmailSender _sender;
    private readonly NotificationRenderer _renderer;
    private readonly PayslipDocumentService _payslips;
    private readonly ILogger<NotificationDispatcher> _logger;

    public NotificationDispatcher(
        PakoDbContext db, IEmailSender sender, NotificationRenderer renderer, PayslipDocumentService payslips,
        ILogger<NotificationDispatcher> logger)
    {
        _db = db;
        _sender = sender;
        _renderer = renderer;
        _payslips = payslips;
        _logger = logger;
    }

    public async Task<List<Guid>> ClaimDueAsync(DateTime now, CancellationToken cancellationToken = default)
    {
        var leaseUntil = now.Add(Lease);
        return await _db.Database.SqlQuery<Guid>($"""
            UPDATE notifications SET "LockedUntil" = {leaseUntil}
            WHERE "Id" IN (
                SELECT "Id" FROM notifications
                WHERE "State" = 'Pending' AND "NextAttemptAt" <= {now}
                  AND ("LockedUntil" IS NULL OR "LockedUntil" < {now})
                ORDER BY "CreatedAt"
                LIMIT {BatchSize}
                FOR UPDATE SKIP LOCKED)
            RETURNING "Id" AS "Value"
            """).ToListAsync(cancellationToken);
    }

    // Returns how many were sent.
    public async Task<int> DeliverDueAsync(DateTime now, CancellationToken cancellationToken = default)
    {
        var ids = await ClaimDueAsync(now, cancellationToken);
        if (ids.Count == 0) return 0;

        var rows = await _db.Notifications.Where(n => ids.Contains(n.Id)).ToListAsync(cancellationToken);
        var sent = 0;
        foreach (var notification in rows)
        {
            try
            {
                var (subject, text, html) = _renderer.Render(notification);
                var attachments = await AttachmentsAsync(notification);
                await _sender.SendAsync(new EmailMessage(notification.RecipientEmail, subject, text, html, attachments), cancellationToken);
                notification.MarkSent(DateTime.UtcNow);
                sent++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Notification {Id} ({Template}) to {To} failed (attempt {Attempt})",
                    notification.Id, notification.Template, notification.RecipientEmail, notification.Attempts + 1);
                notification.MarkAttemptFailed(ex.Message, DateTime.UtcNow);
            }

            await _db.SaveChangesAsync(cancellationToken);
        }

        return sent;
    }

    private async Task<IReadOnlyList<EmailAttachment>> AttachmentsAsync(Notification notification)
    {
        if (notification.AttachmentKind != NotificationAttachments.PayslipLine ||
            notification.AttachmentRefId is not { } lineId || notification.CompanyId is not { } companyId)
        {
            return Array.Empty<EmailAttachment>();
        }

        var runId = await _db.PayslipLines.AsNoTracking().Where(l => l.Id == lineId).Select(l => (Guid?)l.PayrollRunId).FirstOrDefaultAsync();
        if (runId is null) return Array.Empty<EmailAttachment>();

        var document = (await _payslips.LoadRunAsync(companyId, runId.Value, lineId: lineId)).SingleOrDefault();
        if (document is null) return Array.Empty<EmailAttachment>();

        var pdf = PayslipPdfRenderer.RenderPayslip(document, NotificationRenderer.Labels(notification.Culture),
            CultureInfo.GetCultureInfo(notification.Culture));
        return new[] { new EmailAttachment(PayslipPdfRenderer.FileName(document), PayslipPdfRenderer.PdfContentType, pdf) };
    }
}

public static class NotificationAttachments
{
    public const string PayslipLine = "PayslipLine";
}
