using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Domain.Invoicing;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

/// <summary>
/// Item 28: assembles a transaction timeline for a document from existing data — no new entity
/// or migration needed. Events are derived from journal entries, reconciliations, and related
/// documents already in the database.
/// </summary>
[ApiController]
[Route("api/companies/{companyId:guid}/timeline")]
[Authorize]
public class TimelineController : ControllerBase
{
    private readonly PakoDbContext _db;

    public TimelineController(PakoDbContext db) => _db = db;

    public record TimelineEvent(string EventType, string Description, DateTime OccurredAt, string? RelatedDocumentId, string? RelatedDocumentLabel);
    public record TimelineResponse(List<TimelineEvent> Events);

    [HttpGet("invoice/{invoiceId:guid}")]
    [RequireCompanyAccess]
    public async Task<ActionResult<TimelineResponse>> InvoiceTimeline(Guid companyId, Guid invoiceId)
    {
        var invoice = await _db.Invoices.AsNoTracking()
            .FirstOrDefaultAsync(i => i.Id == invoiceId && i.CompanyId == companyId);
        if (invoice is null) return NotFound();

        var events = new List<TimelineEvent>
        {
            new("Created", $"Document created", invoice.CreatedAt, null, null)
        };

        // Posted event from journal entry
        if (invoice.JournalEntryId is { } jeId)
        {
            var je = await _db.JournalEntries.AsNoTracking().FirstOrDefaultAsync(j => j.Id == jeId);
            if (je is not null)
            {
                events.Add(new("Posted", $"Document posted as {invoice.InvoiceNumber}",
                    je.PostedAtUtc ?? invoice.CreatedAt, null, null));
            }
        }

        // Reconciliations (payments)
        var reconciliations = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.InvoiceId == invoiceId)
            .OrderBy(r => r.ReconciledAt)
            .ToListAsync();
        foreach (var r in reconciliations)
        {
            events.Add(new("Payment", $"Payment of {r.Amount:F2} recorded",
                r.ReconciledAt, null, null));
        }

        // Credit notes / returns applied against this invoice (their AR line used as settlement)
        if (invoice.JournalEntryId is { } journalEntryId)
        {
            var controlLineReconciliations = await _db.Reconciliations.AsNoTracking()
                .Join(_db.JournalEntryLines,
                    r => r.JournalEntryLineId,
                    l => l.Id,
                    (r, l) => new { r, l })
                .Where(x => x.r.InvoiceId == invoiceId || x.l.JournalEntryId == journalEntryId)
                .Select(x => x.r)
                .Distinct()
                .ToListAsync();

            // Already counted above — skip duplicates
        }

        // Related returns
        var returns = await _db.Invoices.AsNoTracking()
            .Where(i => i.OriginalInvoiceId == invoiceId && i.CompanyId == companyId)
            .ToListAsync();
        foreach (var ret in returns)
        {
            var eventType = ret.DocumentType == DocumentType.SalesReturn ? "Return" : "CreditNote";
            events.Add(new(eventType, $"{ret.InvoiceNumber ?? "Draft"} created",
                ret.CreatedAt, ret.Id.ToString(), ret.InvoiceNumber));

            if (ret.State == InvoiceState.Posted)
            {
                events.Add(new($"{eventType}Posted", $"{ret.InvoiceNumber} posted",
                    ret.CreatedAt, ret.Id.ToString(), ret.InvoiceNumber));
            }
        }

        events.Sort((a, b) => a.OccurredAt.CompareTo(b.OccurredAt));
        return Ok(new TimelineResponse(events));
    }
}
