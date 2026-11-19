using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/month-locks")]
[Authorize]
public class MonthLocksController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public MonthLocksController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    [HttpGet]
    [RequireCompanyAccess(module: AccessModule.Settings)]
    public async Task<ActionResult<MonthLockYearResponse>> GetYear(Guid companyId, [FromQuery] int year)
    {
        if (year < 2000 || year > 2100)
            return BadRequest(_localizer["MonthLockInvalidYear"].Value);

        var locks = await _db.MonthLocks.AsNoTracking()
            .Where(m => m.CompanyId == companyId && m.Year == year)
            .ToListAsync();

        var userIds = locks.Where(m => m.LockedByUserId.HasValue).Select(m => m.LockedByUserId!.Value).Distinct().ToList();
        var emailMap = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.Email);

        var months = Enumerable.Range(1, 12).Select(month =>
        {
            var ml = locks.FirstOrDefault(l => l.Month == month);
            return new MonthLockResponse(
                year,
                month,
                ml?.IsLocked ?? false,
                ml?.LockedByUserId,
                ml?.LockedByUserId is { } uid ? emailMap.GetValueOrDefault(uid) : null,
                ml?.LockedAt);
        }).ToList();

        return Ok(new MonthLockYearResponse(year, months));
    }

    [HttpPost("lock")]
    [RequireCompanyAccess(module: AccessModule.Settings, approve: true)]
    public async Task<ActionResult<MonthLockYearResponse>> LockMonths(Guid companyId, LockMonthsRequest request)
    {
        if (request.Year < 2000 || request.Year > 2100)
            return BadRequest(_localizer["MonthLockInvalidYear"].Value);

        var now = DateTime.UtcNow;
        var currentYear = now.Year;
        var currentMonth = now.Month;

        foreach (var month in request.Months)
        {
            if (month < 1 || month > 12)
                return BadRequest(_localizer["MonthLockInvalidMonth"].Value);

            if (request.Year > currentYear || (request.Year == currentYear && month >= currentMonth))
                return BadRequest(_localizer["MonthLockCannotLockCurrentOrFuture"].Value);
        }

        var existingLocks = await _db.MonthLocks
            .Where(m => m.CompanyId == companyId && m.Year == request.Year && request.Months.Contains(m.Month))
            .ToListAsync();

        var userId = CurrentUserId;

        foreach (var month in request.Months)
        {
            var existing = existingLocks.FirstOrDefault(l => l.Month == month);
            if (existing is not null)
            {
                if (existing.IsLocked) continue;
                existing.IsLocked = true;
                existing.LockedByUserId = userId;
                existing.LockedAt = now;
                existing.UnlockedByUserId = null;
                existing.UnlockedAt = null;
                existing.UnlockReason = null;
            }
            else
            {
                _db.MonthLocks.Add(new MonthLock
                {
                    Id = Guid.NewGuid(),
                    CompanyId = companyId,
                    Year = request.Year,
                    Month = month,
                    IsLocked = true,
                    LockedByUserId = userId,
                    LockedAt = now,
                });
            }

            _db.MonthLockEvents.Add(new MonthLockEvent
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Year = request.Year,
                Month = month,
                Action = MonthLockAction.Lock,
                UserId = userId,
                Timestamp = now,
            });
        }

        AuditController.Stage(_db, companyId, "MonthLock", companyId.ToString(), "MonthsLocked",
            userId.ToString(), $"Year={request.Year}; Months=[{string.Join(",", request.Months)}]");
        await _db.SaveChangesAsync();

        return await GetYear(companyId, request.Year);
    }

    [HttpPost("unlock")]
    [RequireCompanyAccess(module: AccessModule.Settings, approve: true)]
    public async Task<ActionResult<MonthLockYearResponse>> UnlockMonth(Guid companyId, UnlockMonthRequest request)
    {
        if (request.Year < 2000 || request.Year > 2100)
            return BadRequest(_localizer["MonthLockInvalidYear"].Value);

        if (request.Month < 1 || request.Month > 12)
            return BadRequest(_localizer["MonthLockInvalidMonth"].Value);

        if (string.IsNullOrWhiteSpace(request.Reason))
            return BadRequest(_localizer["MonthLockUnlockReasonRequired"].Value);

        var ml = await _db.MonthLocks
            .FirstOrDefaultAsync(m => m.CompanyId == companyId && m.Year == request.Year && m.Month == request.Month);

        if (ml is null || !ml.IsLocked)
            return BadRequest(_localizer["MonthLockNotLocked"].Value);

        // Cannot unlock a month that falls on or before the hard lock date.
        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (company?.HardLockDate is { } hardLock)
        {
            var lastDayOfMonth = new DateOnly(request.Year, request.Month, DateTime.DaysInMonth(request.Year, request.Month));
            if (lastDayOfMonth <= hardLock)
                return BadRequest(_localizer["MonthLockBlockedByHardLock"].Value);
        }

        var now = DateTime.UtcNow;
        var userId = CurrentUserId;

        ml.IsLocked = false;
        ml.UnlockedByUserId = userId;
        ml.UnlockedAt = now;
        ml.UnlockReason = request.Reason.Trim();

        _db.MonthLockEvents.Add(new MonthLockEvent
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Year = request.Year,
            Month = request.Month,
            Action = MonthLockAction.Unlock,
            UserId = userId,
            Timestamp = now,
            Reason = request.Reason.Trim(),
        });

        AuditController.Stage(_db, companyId, "MonthLock", companyId.ToString(), "MonthUnlocked",
            userId.ToString(), $"Year={request.Year}; Month={request.Month}; Reason={request.Reason.Trim()}");
        await _db.SaveChangesAsync();

        return await GetYear(companyId, request.Year);
    }

    [HttpGet("history")]
    [RequireCompanyAccess(module: AccessModule.Settings)]
    public async Task<ActionResult<MonthLockHistoryResponse>> GetHistory(
        Guid companyId,
        [FromQuery] int? year = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        var query = _db.MonthLockEvents.AsNoTracking()
            .Where(e => e.CompanyId == companyId);

        if (year.HasValue)
            query = query.Where(e => e.Year == year.Value);

        var total = await query.CountAsync();

        var events = await query
            .OrderByDescending(e => e.Timestamp)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var userIds = events.Select(e => e.UserId).Distinct().ToList();
        var emailMap = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.Email);

        var items = events.Select(e => new MonthLockEventResponse(
            e.Id, e.Year, e.Month, e.Action,
            e.UserId, emailMap.GetValueOrDefault(e.UserId),
            e.Timestamp, e.Reason)).ToList();

        return Ok(new MonthLockHistoryResponse(items, total, page, pageSize));
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}
