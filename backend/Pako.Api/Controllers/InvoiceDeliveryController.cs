using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Hr;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Notifications;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// Email delivery: an invoice (or credit note, return…) as a PDF, and sending it to the customer.
// The PDF is rendered from InvoiceDocumentService — the same amounts as the invoice screen.
[ApiController]
[Route("api/companies/{companyId:guid}/invoices/{invoiceId:guid}")]
[Authorize]
public class InvoiceDeliveryController : ControllerBase
{
    public const int MaxRecipients = 5;
    public const int MaxMessageLength = 2000;

    private readonly PakoDbContext _db;
    private readonly InvoiceDocumentService _documents;
    private readonly NotificationOutbox _outbox;
    private readonly CompanyAccessContext _access;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public InvoiceDeliveryController(
        PakoDbContext db, InvoiceDocumentService documents, NotificationOutbox outbox, CompanyAccessContext access,
        IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _documents = documents;
        _outbox = outbox;
        _access = access;
        _localizer = localizer;
    }

    [HttpGet("pdf", Name = "GetInvoicePdf")]
    [ProducesPdf]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<IActionResult> Pdf(Guid companyId, Guid invoiceId)
    {
        if (!await VisibleAsync(companyId, invoiceId)) return NotFound();
        var document = await _documents.LoadAsync(companyId, invoiceId);
        if (document is null) return NotFound();
        var bytes = InvoicePdfRenderer.Render(document, key => _localizer[key].Value, CultureInfo.CurrentUICulture);
        return File(bytes, InvoicePdfRenderer.PdfContentType, InvoicePdfRenderer.FileName(document));
    }

    // Queues one email per recipient with the PDF attached (rendered when sent, in the email's language).
    [HttpPost("email", Name = "EmailInvoice")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<List<InvoiceEmailResponse>>> Email(Guid companyId, Guid invoiceId, EmailInvoiceRequest request)
    {
        if (!await VisibleAsync(companyId, invoiceId)) return NotFound();
        var document = await _documents.LoadAsync(companyId, invoiceId);
        if (document is null) return NotFound();
        if (document.State != InvoiceState.Posted) return BadRequest(_localizer["InvoiceEmailNotPosted"].Value);

        var recipients = (request.To ?? new List<string>())
            .Select(r => r.Trim()).Where(r => r.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (recipients.Count == 0 && !string.IsNullOrWhiteSpace(document.Customer.Email)) recipients.Add(document.Customer.Email!.Trim());
        if (recipients.Count == 0) return BadRequest(string.Format(_localizer["InvoiceEmailNoRecipient"].Value, document.Customer.Name));
        if (recipients.Count > MaxRecipients) return BadRequest(string.Format(_localizer["InvoiceEmailTooManyRecipients"].Value, MaxRecipients));
        if (recipients.FirstOrDefault(r => !NotificationOutbox.IsPlausibleEmail(r)) is { } bad)
            return BadRequest(string.Format(_localizer["InvoiceEmailInvalidAddress"].Value, bad));
        var message = request.Message?.Trim();
        if (message is { Length: > MaxMessageLength }) return BadRequest(string.Format(_localizer["InvoiceEmailMessageTooLong"].Value, MaxMessageLength));

        var culture = request.Culture is "en" ? "en" : NotificationOutbox.DefaultCulture;
        string Label(string key) => NotificationRenderer.Text(key, culture);
        var formatting = CultureInfo.GetCultureInfo(culture);
        var payload = new Dictionary<string, string>
        {
            ["company"] = document.Company.Name,
            ["customer"] = document.Customer.Name,
            ["document"] = InvoicePdfRenderer.Title(document.Type, Label),
            ["number"] = document.Number ?? string.Empty,
            ["total"] = $"{document.Totals.GrossAmount.ToString("N2", formatting)} {document.Currency}",
            ["dueDate"] = document.DueDate.ToString("dd.MM.yyyy", formatting),
            ["message"] = string.IsNullOrEmpty(message) ? string.Empty : message + "\n\n",
        };

        var before = _db.ChangeTracker.Entries<Notification>().Select(e => e.Entity.Id).ToHashSet();
        await _outbox.EnqueueAsync(companyId, NotificationTemplates.InvoiceSent,
            recipients.Select(r => new NotificationRecipient(r, culture)), payload, NotificationAttachments.Invoice, invoiceId);
        var queued = _db.ChangeTracker.Entries<Notification>().Select(e => e.Entity).Where(n => !before.Contains(n.Id)).ToList();
        AuditController.Stage(_db, companyId, "Invoice", invoiceId.ToString(), "Email",
            User.FindFirstValue(ClaimTypes.NameIdentifier), $"To={string.Join(", ", recipients)}");
        await _db.SaveChangesAsync();
        return Ok(queued.OrderBy(n => n.RecipientEmail).Select(ToResponse).ToList());
    }

    // What was sent for this invoice, newest first.
    [HttpGet("emails", Name = "ListInvoiceEmails")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<InvoiceEmailResponse>>> Emails(Guid companyId, Guid invoiceId)
    {
        if (!await VisibleAsync(companyId, invoiceId)) return NotFound();
        var rows = await Sent(companyId, invoiceId).OrderByDescending(n => n.CreatedAt).Take(100).ToListAsync();
        return Ok(rows.Select(ToResponse).ToList());
    }

    // Puts a failed email of this invoice back in the queue (Sales users may lack Settings access).
    [HttpPost("emails/{emailId:guid}/retry", Name = "RetryInvoiceEmail")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<InvoiceEmailResponse>> Retry(Guid companyId, Guid invoiceId, Guid emailId)
    {
        if (!await VisibleAsync(companyId, invoiceId)) return NotFound();
        // One conditional UPDATE: only a Failed row goes back to the queue, and two clicks can't race.
        await Sent(companyId, invoiceId).Where(n => n.Id == emailId && n.State == NotificationState.Failed)
            .ExecuteUpdateAsync(u => u
                .SetProperty(n => n.State, NotificationState.Pending)
                .SetProperty(n => n.Attempts, 0)
                .SetProperty(n => n.NextAttemptAt, DateTime.UtcNow)
                .SetProperty(n => n.LockedUntil, (DateTime?)null)
                .SetProperty(n => n.LastError, (string?)null));
        var row = await Sent(companyId, invoiceId).FirstOrDefaultAsync(n => n.Id == emailId);
        if (row is null) return NotFound();
        return Ok(ToResponse(row));
    }

    private IQueryable<Notification> Sent(Guid companyId, Guid invoiceId) => _db.Notifications.AsNoTracking()
        .Where(n => n.CompanyId == companyId && n.AttachmentKind == NotificationAttachments.Invoice && n.AttachmentRefId == invoiceId);

    private Task<bool> VisibleAsync(Guid companyId, Guid invoiceId) =>
        _db.Invoices.AsNoTracking().VisibleTo(_access).AnyAsync(i => i.Id == invoiceId && i.CompanyId == companyId);

    private static InvoiceEmailResponse ToResponse(Notification n) =>
        new(n.Id, n.RecipientEmail, n.State.ToString(), n.Attempts, n.LastError, n.CreatedAt, n.SentAt);
}
