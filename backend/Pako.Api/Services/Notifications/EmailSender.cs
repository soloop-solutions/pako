using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Pako.Api.Services.Notifications;

// "Email" in appsettings. Secrets (Password) come from the environment: Email__Password.
public class EmailOptions
{
    public const string Section = "Email";

    // "Log" (default: nothing leaves the machine) or "Smtp".
    public string Mode { get; set; } = "Log";
    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public bool UseStartTls { get; set; } = true;
    public string? UserName { get; set; }
    public string? Password { get; set; }
    public string FromAddress { get; set; } = "no-reply@pako.local";
    public string FromName { get; set; } = "PAKO";

    // Invitation and password-reset links are shown to the admin who created them only while email
    // isn't really sent (Log mode), so they can be passed on by hand. With real email, a link only
    // ever reaches the person it is for — never a third party who could use it.
    public bool ShowLinksToAdmins => !string.Equals(Mode, "Smtp", StringComparison.OrdinalIgnoreCase);

    // Log mode only: also write each message as an .eml file here, to open in a mail client.
    public string? PickupDirectory { get; set; }

    // Links in emails point here (the web app).
    public string AppBaseUrl { get; set; } = "http://localhost:5173";
}

public record EmailAttachment(string FileName, string ContentType, byte[] Content);

public record EmailMessage(string To, string Subject, string TextBody, string HtmlBody, IReadOnlyList<EmailAttachment> Attachments);

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

internal static class MimeBuilder
{
    public static MimeMessage Build(EmailOptions options, EmailMessage message)
    {
        var mime = new MimeMessage();
        mime.From.Add(new MailboxAddress(options.FromName, options.FromAddress));
        mime.To.Add(MailboxAddress.Parse(message.To));
        mime.Subject = message.Subject;
        var body = new BodyBuilder { TextBody = message.TextBody, HtmlBody = message.HtmlBody };
        foreach (var attachment in message.Attachments)
        {
            body.Attachments.Add(attachment.FileName, attachment.Content, ContentType.Parse(attachment.ContentType));
        }

        mime.Body = body.ToMessageBody();
        return mime;
    }
}

public class SmtpEmailSender : IEmailSender
{
    private readonly EmailOptions _options;

    public SmtpEmailSender(IOptions<EmailOptions> options)
    {
        _options = options.Value;
    }

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        var host = _options.Host ?? throw new InvalidOperationException("Email:Host is not configured (Email:Mode=Smtp).");
        using var client = new SmtpClient();
        await client.ConnectAsync(host, _options.Port,
            _options.UseStartTls ? SecureSocketOptions.StartTls : SecureSocketOptions.Auto, cancellationToken);
        if (!string.IsNullOrEmpty(_options.UserName))
        {
            await client.AuthenticateAsync(_options.UserName, _options.Password ?? string.Empty, cancellationToken);
        }

        await client.SendAsync(MimeBuilder.Build(_options, message), cancellationToken);
        await client.DisconnectAsync(true, cancellationToken);
    }
}

// Development and tests: logs the message instead of sending it.
public class LogEmailSender : IEmailSender
{
    private readonly EmailOptions _options;
    private readonly ILogger<LogEmailSender> _logger;

    public LogEmailSender(IOptions<EmailOptions> options, ILogger<LogEmailSender> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Email (not sent, Email:Mode=Log) to {To}: {Subject} [{Attachments} attachment(s)]",
            message.To, message.Subject, message.Attachments.Count);
        if (string.IsNullOrWhiteSpace(_options.PickupDirectory)) return;

        Directory.CreateDirectory(_options.PickupDirectory);
        var path = Path.Combine(_options.PickupDirectory, $"{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}.eml");
        await MimeBuilder.Build(_options, message).WriteToAsync(path, cancellationToken);
    }
}
