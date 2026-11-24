using System.Globalization;
using System.Net;
using System.Resources;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
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

        var html = BuildHtml(body, footer);
        return (subject, text, html);
    }

    // Matches http/https URLs in the body text so they can be rendered as action buttons.
    private static readonly Regex UrlPattern = new(@"https?://\S+", RegexOptions.Compiled);

    private static string BuildHtml(string body, string footer)
    {
        var html = new StringBuilder();

        // Outer wrapper — centered, light background (works in Gmail, Outlook, Apple Mail)
        html.Append("""
            <div style="margin:0;padding:0;background-color:#f3f4f6;width:100%">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f3f4f6">
            <tr><td align="center" style="padding:32px 16px">
            <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;width:100%">
            """);

        // Header — brand bar
        html.Append("""
            <tr><td style="background-color:#140f5a;border-radius:12px 12px 0 0;padding:24px 32px;text-align:center">
            <span style="color:#ffffff;font-family:Inter,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:1px">PAKO</span>
            </td></tr>
            """);

        // Body card
        html.Append("""
            <tr><td style="background-color:#ffffff;padding:32px;font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937">
            """);

        foreach (var paragraph in body.Split("\n\n"))
        {
            var encoded = WebUtility.HtmlEncode(paragraph).Replace("\n", "<br>");

            // If the paragraph contains a URL, extract it and render an action button instead
            var match = UrlPattern.Match(paragraph);
            if (match.Success)
            {
                var url = match.Value;
                // Text before the URL (the label, e.g. "Accept the invitation and set your password:")
                var label = paragraph[..match.Index].TrimEnd(' ', ':').Trim();
                // Text after the URL
                var after = paragraph[(match.Index + match.Length)..].Trim();

                if (!string.IsNullOrEmpty(label))
                    html.Append("<p style=\"margin:0 0 8px\">").Append(WebUtility.HtmlEncode(label)).Append("</p>");

                // Action button — centered, brand color
                html.Append("""
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0">
                    <tr><td align="center">
                    """);
                html.Append("<a href=\"").Append(WebUtility.HtmlEncode(url)).Append("\" target=\"_blank\" style=\"")
                    .Append("display:inline-block;background-color:#2563eb;color:#ffffff;")
                    .Append("font-family:Inter,Arial,sans-serif;font-size:14px;font-weight:600;")
                    .Append("text-decoration:none;padding:12px 32px;border-radius:8px\">");
                // Use the label text as button text, or a sensible fallback
                html.Append(WebUtility.HtmlEncode(!string.IsNullOrEmpty(label) ? label : url));
                html.Append("</a>");
                html.Append("</td></tr></table>");

                // Fallback link for clients that hide buttons
                html.Append("<p style=\"margin:4px 0 12px;font-size:12px;color:#6b7280;word-break:break-all\">")
                    .Append("<a href=\"").Append(WebUtility.HtmlEncode(url)).Append("\" style=\"color:#2563eb\">")
                    .Append(WebUtility.HtmlEncode(url)).Append("</a></p>");

                if (!string.IsNullOrEmpty(after))
                    html.Append("<p style=\"margin:0 0 12px\">").Append(WebUtility.HtmlEncode(after)).Append("</p>");
            }
            else
            {
                html.Append("<p style=\"margin:0 0 12px\">").Append(encoded).Append("</p>");
            }
        }

        html.Append("</td></tr>");

        // Footer
        html.Append("<tr><td style=\"background-color:#f9fafb;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;")
            .Append("font-family:Inter,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;border-top:1px solid #e5e7eb\">")
            .Append(WebUtility.HtmlEncode(footer))
            .Append("</td></tr>");

        html.Append("</table></td></tr></table></div>");
        return html.ToString();
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
    private readonly InvoiceDocumentService _invoices;
    private readonly EmailOptions _options;
    private readonly ILogger<NotificationDispatcher> _logger;

    public NotificationDispatcher(
        PakoDbContext db, IEmailSender sender, NotificationRenderer renderer, PayslipDocumentService payslips,
        ILogger<NotificationDispatcher> logger, InvoiceDocumentService? invoices = null, IOptions<EmailOptions>? options = null)
    {
        _db = db;
        _sender = sender;
        _renderer = renderer;
        _payslips = payslips;
        _logger = logger;
        _invoices = invoices ?? new InvoiceDocumentService(db, new Pako.Domain.Tax.TaxComputationService());
        _options = options?.Value ?? new EmailOptions();
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
                if (attachments.Sum(a => (long)a.Content.Length) > _options.MaxAttachmentBytes)
                {
                    throw new PermanentEmailFailure($"Attachments exceed {_options.MaxAttachmentBytes / (1024 * 1024)} MB.");
                }

                await _sender.SendAsync(
                    new EmailMessage(notification.RecipientEmail, subject, text, html, attachments, notification.Id.ToString("N")), cancellationToken);
                notification.MarkSent(DateTime.UtcNow);
                sent++;
            }
            catch (PermanentEmailFailure ex)
            {
                _logger.LogWarning("Notification {Id} ({Template}) to {To} refused for good: {Error}",
                    notification.Id, notification.Template, notification.RecipientEmail, ex.Message);
                notification.MarkFailedPermanently(ex.Message);
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
        if (notification.AttachmentRefId is not { } refId || notification.CompanyId is not { } companyId)
        {
            return Array.Empty<EmailAttachment>();
        }

        return notification.AttachmentKind switch
        {
            NotificationAttachments.PayslipLine => await PayslipAsync(notification, companyId, refId),
            NotificationAttachments.Invoice => await InvoiceAsync(notification, companyId, refId),
            _ => Array.Empty<EmailAttachment>(),
        };
    }

    // The invoice PDF in the email's language. An invoice that no longer exists cannot be sent at all.
    private async Task<IReadOnlyList<EmailAttachment>> InvoiceAsync(Notification notification, Guid companyId, Guid invoiceId)
    {
        var document = await _invoices.LoadAsync(companyId, invoiceId)
            ?? throw new PermanentEmailFailure("The invoice no longer exists.");
        var pdf = InvoicePdfRenderer.Render(document, NotificationRenderer.Labels(notification.Culture),
            CultureInfo.GetCultureInfo(notification.Culture));
        return new[] { new EmailAttachment(InvoicePdfRenderer.FileName(document), InvoicePdfRenderer.PdfContentType, pdf) };
    }

    private async Task<IReadOnlyList<EmailAttachment>> PayslipAsync(Notification notification, Guid companyId, Guid lineId)
    {

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
    public const string Invoice = "Invoice";
}
