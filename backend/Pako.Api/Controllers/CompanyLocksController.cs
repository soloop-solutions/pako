using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// B4: lock dates and exceptions. Deliberately not on CompaniesController — that controller has
// exactly one write method by design (see its own doc comment) and locks are a distinct, more
// sensitive concern. Who may set a lock or grant an exception: anyone with write access to the
// company (RequireCompanyAccess(writeAccess: true)) — the same tier every other admin action on
// this API already uses (account CRUD, item CRUD, etc.), not a narrower owner-only tier. Chosen
// over "any firm member" (which would include read-only ClientViewer/firm-cascaded roles) because
// granting a lock exception is a real write action, not a viewing one.
[ApiController]
[Route("api/companies/{companyId:guid}/locks")]
[Authorize]
public class CompanyLocksController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public CompanyLocksController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    [HttpPut("soft")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<CompanyResponse>> SetSoftLock(Guid companyId, SetSoftLockRequest request)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return NotFound();

        switch (request.LockDateField)
        {
            case LockDateField.AccountingLockDate:
                company.AccountingLockDate = request.LockDate;
                break;
            case LockDateField.TaxLockDate:
                company.TaxLockDate = request.LockDate;
                break;
            case LockDateField.SaleLockDate:
                company.SaleLockDate = request.LockDate;
                break;
            case LockDateField.PurchaseLockDate:
                company.PurchaseLockDate = request.LockDate;
                break;
        }

        await _db.SaveChangesAsync();
        return Ok(ToResponse(company));
    }

    // B4 rules: the hard lock cannot be removed (SetHardLockRequest.LockDate is non-nullable — no
    // request shape can ask to clear it) and cannot move backwards; setting it requires that no
    // Draft journal entry remains on or before the requested date.
    [HttpPut("hard")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<CompanyResponse>> SetHardLock(Guid companyId, SetHardLockRequest request)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return NotFound();

        if (company.HardLockDate is { } currentHardLock && request.LockDate < currentHardLock)
        {
            return BadRequest(_localizer["HardLockCannotMoveBackwards"].Value);
        }

        var hasDraftEntriesInPeriod = await _db.JournalEntries.AsNoTracking()
            .AnyAsync(e => e.CompanyId == companyId && e.State == JournalEntryState.Draft && e.Date <= request.LockDate);
        if (hasDraftEntriesInPeriod)
        {
            return BadRequest(_localizer["HardLockBlockedByDraftEntries"].Value);
        }

        company.HardLockDate = request.LockDate;
        await _db.SaveChangesAsync();
        return Ok(ToResponse(company));
    }

    [HttpGet("exceptions")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<List<AccountLockExceptionResponse>>> ListExceptions(Guid companyId)
    {
        var exceptions = await _db.AccountLockExceptions.AsNoTracking()
            .Where(e => e.CompanyId == companyId)
            .OrderByDescending(e => e.CreatedAt)
            .ToListAsync();

        var now = DateTime.UtcNow;
        return Ok(exceptions.Select(e => ToResponse(e, now)).ToList());
    }

    [HttpPost("exceptions")]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(AccountLockExceptionResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<AccountLockExceptionResponse>> GrantException(Guid companyId, GrantLockExceptionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Reason))
        {
            return BadRequest(_localizer["LockExceptionReasonRequired"].Value);
        }

        if (request.EndsAt <= DateTime.UtcNow)
        {
            return BadRequest(_localizer["LockExceptionEndsAtMustBeFuture"].Value);
        }

        var exception = new AccountLockException
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            UserId = request.UserId,
            LockDateField = request.LockDateField,
            LockDate = request.LockDate,
            Reason = request.Reason.Trim(),
            EndsAt = request.EndsAt,
            GrantedByUserId = CurrentUserId
        };

        _db.AccountLockExceptions.Add(exception);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(exception, DateTime.UtcNow));
    }

    [HttpPost("exceptions/{exceptionId:guid}/revoke")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<AccountLockExceptionResponse>> RevokeException(Guid companyId, Guid exceptionId)
    {
        var exception = await _db.AccountLockExceptions.FirstOrDefaultAsync(e => e.Id == exceptionId && e.CompanyId == companyId);
        if (exception is null) return NotFound();

        if (exception.RevokedAt is not null)
        {
            return BadRequest(_localizer["LockExceptionAlreadyRevoked"].Value);
        }

        exception.RevokedAt = DateTime.UtcNow;
        exception.RevokedByUserId = CurrentUserId;
        await _db.SaveChangesAsync();

        return Ok(ToResponse(exception, DateTime.UtcNow));
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private static CompanyResponse ToResponse(Company c) =>
        new(c.Id, c.Name, c.FirmId, c.AccountingLockDate, c.TaxLockDate, c.EnabledProfiles, c.IsVatRegistered, c.AllowNumberOverride,
            c.SaleLockDate, c.PurchaseLockDate, c.HardLockDate);

    private static AccountLockExceptionResponse ToResponse(AccountLockException e, DateTime asOfUtc) =>
        new(e.Id, e.UserId, e.LockDateField, e.LockDate, e.Reason, e.EndsAt, e.CreatedAt, e.GrantedByUserId, e.RevokedAt, e.RevokedByUserId, e.IsLive(asOfUtc));
}
