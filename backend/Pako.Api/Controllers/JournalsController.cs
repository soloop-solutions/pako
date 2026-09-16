using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/journals")]
[Authorize]
public class JournalsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public JournalsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<JournalResponse>>> List(Guid companyId)
    {
        var journals = await _db.Journals.AsNoTracking()
            .Where(j => j.CompanyId == companyId)
            .OrderBy(j => j.Code)
            .ToListAsync();

        return Ok(journals.Select(ToResponse).ToList());
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(JournalResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<JournalResponse>> Create(Guid companyId, CreateJournalRequest request)
    {
        var journal = new Journal
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Type = request.Type,
            Code = request.Code,
            Name = request.Name,
            SequencePrefix = request.Code,
            SequenceNextNumber = 1,
            SequencePadding = 4
        };

        _db.Journals.Add(journal);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(journal));
    }

    // B15: seals every not-yet-secured Posted entry in this journal dated on or before UpTo into
    // the hash chain, in date order (oldest first, so PrevHash always points at a real
    // predecessor). Refuses if any Draft entry in this journal is dated on or before UpTo — a
    // later-posted entry with an earlier date would need to be inserted into the middle of an
    // already-sealed chain, which a hash chain can't do; post or discard it first. There is no
    // "unreconciled statement lines" check here (also named in the brief) — no bank-statement-
    // import feature exists in this codebase yet (see docs/ARCHITECTURE.md's own list of
    // prerequisites this repo doesn't have), so there is nothing to check; a documented gap, not
    // a silently skipped one.
    [HttpPost("{journalId:guid}/secure")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<SecureJournalResponse>> Secure(Guid companyId, Guid journalId, SecureJournalRequest request)
    {
        var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.Id == journalId && j.CompanyId == companyId);
        if (journal is null)
        {
            return NotFound();
        }

        var hasDraftInRange = await _db.JournalEntries.AsNoTracking()
            .AnyAsync(e => e.CompanyId == companyId && e.JournalId == journalId
                && e.State == JournalEntryState.Draft && e.Date <= request.UpTo);
        if (hasDraftInRange)
        {
            return BadRequest(_localizer["CannotSecurePastDraftEntries"].Value);
        }

        var lastSecured = await _db.JournalEntries.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.JournalId == journalId && e.SecureSequenceNumber != null)
            .OrderByDescending(e => e.SecureSequenceNumber)
            .FirstOrDefaultAsync();

        var toSecure = await _db.JournalEntries
            .Include(e => e.Lines)
            .Where(e => e.CompanyId == companyId && e.JournalId == journalId
                && e.State == JournalEntryState.Posted && e.Date <= request.UpTo && e.EntryHash == null)
            .OrderBy(e => e.Date).ThenBy(e => e.PostedAtUtc).ThenBy(e => e.Id)
            .ToListAsync();

        var previousHash = lastSecured?.EntryHash ?? HashChain.GenesisHash;
        var nextSequenceNumber = (lastSecured?.SecureSequenceNumber ?? 0) + 1;

        foreach (var entry in toSecure)
        {
            entry.PrevHash = previousHash;
            entry.EntryHash = HashChain.ComputeEntryHash(previousHash, entry);
            entry.SecureSequenceNumber = nextSequenceNumber;
            previousHash = entry.EntryHash;
            nextSequenceNumber++;
        }

        await _db.SaveChangesAsync();

        var latestHash = previousHash == HashChain.GenesisHash ? null : previousHash;
        var latestSequenceNumber = toSecure.Count > 0 ? nextSequenceNumber - 1 : lastSecured?.SecureSequenceNumber;
        return Ok(new SecureJournalResponse(toSecure.Count, latestHash, latestSequenceNumber));
    }

    private static JournalResponse ToResponse(Journal j) =>
        new(j.Id, j.Type, j.Code, j.Name, j.SequencePrefix, j.SequenceNextNumber, j.SequencePadding);
}
