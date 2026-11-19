using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Pako.Api.Services.Notifications;

// "Email" in appsettings. Secrets come from the environment: Email__Password, Email__Api__ApiKey.
public class EmailOptions
{
    public const string Section = "Email";
    public const string LogMode = "Log";
    public const string SmtpMode = "Smtp";
    public const string ApiMode = "Api";

    // "Log" (default: nothing leaves the machine), "Smtp", or "Api" (an HTTP email API; docs/EMAIL.md).
    public string Mode { get; set; } = LogMode;

    public EmailApiOptions Api { get; set; } = new();
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
    public bool ShowLinksToAdmins => IsMode(LogMode);

    public bool IsMode(string mode) => string.Equals(Mode, mode, StringComparison.OrdinalIgnoreCase);

    // Largest attachment set one message may carry; a bigger PDF fails for good rather than retrying.
    public int MaxAttachmentBytes { get; set; } = 10 * 1024 * 1024;

    // Refuses a configuration that would queue mail that never leaves, or send links nobody can open.
    // Empty when the configuration is usable.
    public IReadOnlyList<string> Problems()
    {
        var problems = new List<string>();
        if (IsMode(LogMode)) return problems;
        if (!IsMode(SmtpMode) && !IsMode(ApiMode)) problems.Add($"Email:Mode '{Mode}' is not Log, Smtp or Api.");
        if (IsMode(SmtpMode) && string.IsNullOrWhiteSpace(Host)) problems.Add("Email:Host is required with Email:Mode=Smtp.");
        if (IsMode(ApiMode))
        {
            if (!Uri.TryCreate(Api.Url, UriKind.Absolute, out var url) || url.Scheme != Uri.UriSchemeHttps)
                problems.Add("Email:Api:Url must be an https URL with Email:Mode=Api.");
            if (string.IsNullOrWhiteSpace(Api.ApiKey)) problems.Add("Email:Api:ApiKey is required with Email:Mode=Api (set Email__Api__ApiKey).");
        }

        if (string.IsNullOrWhiteSpace(FromAddress) || FromAddress.EndsWith(".local", StringComparison.OrdinalIgnoreCase) || !FromAddress.Contains('@'))
            problems.Add("Email:FromAddress must be a real address on the sending domain (e.g. no-reply@pako domain).");
        // http only on this machine (trying real delivery locally); anything users open must be https.
        if (!Uri.TryCreate(AppBaseUrl, UriKind.Absolute, out var app) || (app.Scheme != Uri.UriSchemeHttps && !app.IsLoopback))
            problems.Add("Email:AppBaseUrl must be the web app's https URL: links in emails point there.");
        return problems;
    }

    // Log mode only: also write each message as an .eml file here, to open in a mail client.
    public string? PickupDirectory { get; set; }

    // Links in emails point here (the web app).
    public string AppBaseUrl { get; set; } = "http://localhost:5173";
}

public class EmailApiOptions
{
    // Where messages are POSTed, one JSON message per request. Default: Resend (docs/EMAIL.md).
    public const string ResendUrl = "https://api.resend.com/emails";
    public string? Url { get; set; } = ResendUrl;
    public string? ApiKey { get; set; }

    // Header carrying the key; with "Authorization" the value is "Bearer {key}", otherwise the key as is
    // (e.g. AuthHeader = "X-Api-Key").
    public string AuthHeader { get; set; } = "Authorization";
    public int TimeoutSeconds { get; set; } = 15;
}

public record EmailAttachment(string FileName, string ContentType, byte[] Content);

// MessageId: a stable id for this message (the outbox row's), sent as an idempotency key so a retry after
// a timeout cannot deliver it twice when the API honours it.
public record EmailMessage(
    string To, string Subject, string TextBody, string HtmlBody, IReadOnlyList<EmailAttachment> Attachments, string? MessageId = null);

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

// The provider refused this message itself (bad address, rejected content). Retrying cannot help; every
// other exception from a sender is treated as temporary and retried with backoff.
public class PermanentEmailFailure(string message) : Exception(message);

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

// Email:Mode=Api — every message goes to one HTTP email API (docs/EMAIL.md). The JSON shape is built in
// Payload() only, so adapting to the API's exact contract changes nothing else.
public class ApiEmailSender : IEmailSender
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _http;
    private readonly EmailOptions _options;

    public ApiEmailSender(HttpClient http, IOptions<EmailOptions> options)
    {
        _http = http;
        _options = options.Value;
    }

    // Resend's POST /emails body (https://resend.com/docs/api-reference/emails/send-email). The only
    // place that knows the provider's shape. Resend takes the attachment's type from its file name.
    public static object Payload(EmailOptions options, EmailMessage message) => new
    {
        From = Sender(options),
        To = new[] { message.To },
        message.Subject,
        Html = message.HtmlBody,
        Text = message.TextBody,
        Attachments = message.Attachments.Count == 0
            ? null
            : message.Attachments.Select(a => new { Filename = a.FileName, Content = Convert.ToBase64String(a.Content) }).ToArray(),
    };

    // "PAKO <no-reply@…>"; a name with RFC 5322 specials is quoted.
    public static string Sender(EmailOptions options)
    {
        var name = options.FromName?.Trim();
        if (string.IsNullOrEmpty(name)) return options.FromAddress;
        if (name.IndexOfAny(new[] { '"', ',', '<', '>', '@', ';', ':', '(', ')', '[', ']', '\\', '.' }) >= 0)
            name = "\"" + name.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        return $"{name} <{options.FromAddress}>";
    }

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        var url = _options.Api.Url ?? throw new InvalidOperationException("Email:Api:Url is not configured (Email:Mode=Api).");
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(Payload(_options, message), Json), Encoding.UTF8, "application/json"),
        };
        var key = _options.Api.ApiKey ?? string.Empty;
        if (string.Equals(_options.Api.AuthHeader, "Authorization", StringComparison.OrdinalIgnoreCase))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        else
            request.Headers.TryAddWithoutValidation(_options.Api.AuthHeader, key);
        if (message.MessageId is { } id) request.Headers.TryAddWithoutValidation("Idempotency-Key", id);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, _options.Api.TimeoutSeconds)));
        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, timeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException($"The email API did not answer within {_options.Api.TimeoutSeconds} s.");
        }

        using (response)
        {
            if (response.IsSuccessStatusCode) return;
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            var detail = $"Email API answered {(int)response.StatusCode} {response.ReasonPhrase}: {Truncate(body)}";
            var status = response.StatusCode;
            var temporary = (int)status >= 500 || status is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests;
            if (temporary) throw new HttpRequestException(detail, null, status);
            throw new PermanentEmailFailure(detail);
        }
    }

    private static string Truncate(string body) => body.Length > 500 ? body[..500] : body;
}
