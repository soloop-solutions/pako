using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/journal-entries")]
[Authorize]
public class JournalEntriesController : ControllerBase
{
    private readonly PakoDbContext _db;

    public JournalEntriesController(PakoDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<JournalEntryResponse>>> List(Guid companyId)
    {
        var entries = await _db.JournalEntries.AsNoTracking()
            .Include(e => e.Lines)
            .Where(e => e.CompanyId == companyId)
            .OrderByDescending(e => e.Date)
            .ToListAsync();

        return Ok(entries.Select(ToResponse).ToList());
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(JournalEntryResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<JournalEntryResponse>> Create(Guid companyId, CreateJournalEntryRequest request)
    {
        var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.Id == request.JournalId);
        if (journal is null || journal.CompanyId != companyId)
        {
            return BadRequest("Invalid journal for this company.");
        }

        var accountIds = request.Lines.Select(l => l.AccountId).Distinct().ToList();
        var validAccountCount = await _db.Accounts.CountAsync(a => accountIds.Contains(a.Id) && a.CompanyId == companyId);
        if (validAccountCount != accountIds.Count)
        {
            return BadRequest("One or more accounts do not belong to this company.");
        }

        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            JournalId = request.JournalId,
            Date = request.Date,
            Reference = request.Reference,
            Lines = request.Lines.Select(l => new JournalEntryLine
            {
                Id = Guid.NewGuid(),
                AccountId = l.AccountId,
                PartnerId = l.PartnerId,
                Debit = l.Debit,
                Credit = l.Credit,
                Description = l.Description
            }).ToList()
        };

        _db.JournalEntries.Add(entry);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(entry));
    }

    [HttpPost("{id:guid}/post")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<JournalEntryResponse>> Post(Guid companyId, Guid id)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
        {
            return NotFound();
        }

        var entry = await _db.JournalEntries.Include(e => e.Lines)
            .FirstOrDefaultAsync(e => e.Id == id && e.CompanyId == companyId);
        if (entry is null)
        {
            return NotFound();
        }

        try
        {
            entry.Post(company);
        }
        catch (Exception ex) when (
            ex is UnbalancedJournalEntryException or
            AccountingLockDateViolationException or
            TaxLockDateViolationException or
            InvalidOperationException)
        {
            return BadRequest(ex.Message);
        }

        await _db.SaveChangesAsync();

        return Ok(ToResponse(entry));
    }

    private static JournalEntryResponse ToResponse(JournalEntry e) => new(
        e.Id,
        e.JournalId,
        e.Date,
        e.Reference,
        e.State.ToString(),
        e.SequenceNumber,
        e.PostedAtUtc,
        e.Lines.Select(l => new JournalEntryLineResponse(l.Id, l.AccountId, l.PartnerId, l.Debit, l.Credit, l.Description)).ToList());
}
