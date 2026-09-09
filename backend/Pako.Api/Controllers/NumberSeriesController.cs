using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/number-series")]
[Authorize]
public class NumberSeriesController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly NumberSeriesService _numberSeries;

    public NumberSeriesController(PakoDbContext db, NumberSeriesService numberSeries)
    {
        _db = db;
        _numberSeries = numberSeries;
    }

    // B1: list all series for a company (settings page).
    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<NumberSeriesResponse>>> List(Guid companyId)
    {
        var series = await _db.NumberSeriesSet.AsNoTracking()
            .Where(s => s.CompanyId == companyId)
            .OrderBy(s => s.DocumentType).ThenByDescending(s => s.Year)
            .ToListAsync();

        return Ok(series.Select(s => new NumberSeriesResponse(s.Id, s.DocumentType, s.Year, s.Pattern, s.NextValue)).ToList());
    }

    // B1: update the pattern for a series (settings page). Only the pattern changes — NextValue
    // continues from where it was, preserving monotonicity. The old pattern's already-issued
    // documents keep their numbers (D3: never renumber issued documents).
    [HttpPut("{seriesId:guid}")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<ActionResult<NumberSeriesResponse>> UpdatePattern(
        Guid companyId, Guid seriesId, UpdateNumberSeriesPatternRequest request)
    {
        var series = await _db.NumberSeriesSet
            .FirstOrDefaultAsync(s => s.Id == seriesId && s.CompanyId == companyId);

        if (series == null) return NotFound();

        if (string.IsNullOrWhiteSpace(request.Pattern))
            return BadRequest("Pattern is required.");
        if (request.Pattern.Length > 64)
            return BadRequest("Pattern must be 64 characters or fewer.");
        if (!request.Pattern.Contains("{seq"))
            return BadRequest("Pattern must contain a {seq} or {seq:Dn} placeholder.");

        series.Pattern = request.Pattern.Trim();
        await _db.SaveChangesAsync();

        return Ok(new NumberSeriesResponse(series.Id, series.DocumentType, series.Year, series.Pattern, series.NextValue));
    }

    // B2: preview the next number without reserving it.
    [HttpGet("preview")]
    [RequireCompanyAccess]
    public async Task<ActionResult<NumberPreviewResponse>> Preview(
        Guid companyId, [FromQuery] string documentType)
    {
        if (string.IsNullOrWhiteSpace(documentType))
            return BadRequest("documentType query parameter is required.");

        var year = DateTime.UtcNow.Year;
        var number = await _numberSeries.PreviewNextAsync(companyId, documentType, year);

        return Ok(new NumberPreviewResponse(number, true));
    }

    // B4: manual number override on a posted invoice. Requires AllowNumberOverride on the company
    // + adminOnly access. Writes to DocumentNumberAudit.
    [HttpPost("/api/companies/{companyId:guid}/invoices/{invoiceId:guid}/override-number")]
    [RequireCompanyAccess(writeAccess: true, adminOnly: true)]
    public async Task<ActionResult> OverrideInvoiceNumber(
        Guid companyId, Guid invoiceId, OverrideNumberRequest request)
    {
        var company = await _db.Companies.FindAsync(companyId);
        if (company == null) return NotFound();
        if (!company.AllowNumberOverride)
            return BadRequest("Number override is not enabled for this company. Enable it in Settings.");

        var invoice = await _db.Invoices
            .FirstOrDefaultAsync(i => i.Id == invoiceId && i.CompanyId == companyId);
        if (invoice == null) return NotFound();
        if (invoice.State != Domain.Invoicing.InvoiceState.Posted)
            return BadRequest("Only posted invoices can have their number overridden.");

        if (string.IsNullOrWhiteSpace(request.NewNumber))
            return BadRequest("New number is required.");

        var newNumber = request.NewNumber.Trim();

        // Check uniqueness within this company's invoices.
        var duplicate = await _db.Invoices.AnyAsync(i =>
            i.CompanyId == companyId && i.InvoiceNumber == newNumber && i.Id != invoiceId);
        if (duplicate)
            return BadRequest($"Number \"{newNumber}\" is already used by another document in this company.");

        var oldNumber = invoice.InvoiceNumber;
        invoice.InvoiceNumber = newNumber;

        // Write audit trail.
        var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        _db.DocumentNumberAudits.Add(new DocumentNumberAudit
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            DocumentId = invoiceId,
            UserId = userId,
            OldNumber = oldNumber,
            NewNumber = newNumber
        });

        await _db.SaveChangesAsync();

        return Ok(new { oldNumber, newNumber });
    }

    // B3: gap detection report for a specific document type and year.
    [HttpGet("gaps")]
    [RequireCompanyAccess]
    public async Task<ActionResult<GapReportResponse>> GapReport(
        Guid companyId,
        [FromQuery] string documentType,
        [FromQuery] int? year = null)
    {
        if (string.IsNullOrWhiteSpace(documentType))
            return BadRequest("documentType query parameter is required.");

        var reportYear = year ?? DateTime.UtcNow.Year;

        var series = await _db.NumberSeriesSet.AsNoTracking()
            .FirstOrDefaultAsync(s => s.CompanyId == companyId && s.DocumentType == documentType && s.Year == reportYear);

        if (series == null)
            return Ok(new GapReportResponse(documentType, reportYear, new List<GapReportEntry>()));

        // Get all issued numbers for this company+type by querying invoice/bill tables.
        var issuedNumbers = new HashSet<int>();

        if (documentType is "Invoice" or "CreditNote" or "DebitNote" or "DownPayment" or "SalesReturn" or "Proforma")
        {
            var invoiceNumbers = await _db.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == companyId && i.InvoiceNumber != null)
                .Select(i => i.InvoiceNumber!)
                .ToListAsync();

            foreach (var num in invoiceNumbers)
            {
                var seqValue = ExtractSequenceValue(num);
                if (seqValue.HasValue) issuedNumbers.Add(seqValue.Value);
            }
        }

        var maxIssued = issuedNumbers.Count > 0 ? issuedNumbers.Max() : 0;
        var gaps = new List<GapReportEntry>();

        for (var i = 1; i <= maxIssued; i++)
        {
            if (!issuedNumbers.Contains(i))
            {
                var formatted = NumberSeriesService.FormatNumber(series.Pattern, i, reportYear);
                gaps.Add(new GapReportEntry(i, formatted));
            }
        }

        return Ok(new GapReportResponse(documentType, reportYear, gaps));
    }

    private static int? ExtractSequenceValue(string number)
    {
        var match = Regex.Match(number, @"\d+");
        return match.Success && int.TryParse(match.Value, out var val) ? val : null;
    }
}
