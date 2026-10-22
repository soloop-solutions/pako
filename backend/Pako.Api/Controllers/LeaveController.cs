using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Hr;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Controllers;

// Leave types, yearly allocations and balances, requests with approval, and the public-holiday
// calendar that working-day counts (here and in payroll) skip. A company's leave types and
// holidays are seeded from Pako.Localization.Xk the first time any of them is read.
[ApiController]
[Route("api/companies/{companyId:guid}/leave")]
[Authorize]
public class LeaveController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public LeaveController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // ---- Types ----

    [HttpGet("types", Name = "ListLeaveTypes")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<LeaveTypeResponse>>> ListTypes(Guid companyId)
    {
        await EnsureDefaultsAsync(companyId);
        var types = await _db.LeaveTypes.AsNoTracking().Where(t => t.CompanyId == companyId).OrderBy(t => t.Code).ToListAsync();
        return Ok(types.Select(ToResponse).ToList());
    }

    [HttpPost("types", Name = "CreateLeaveType")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    [ProducesResponseType(typeof(LeaveTypeResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<LeaveTypeResponse>> CreateType(Guid companyId, SaveLeaveTypeRequest request)
    {
        var type = new LeaveType { Id = Guid.NewGuid(), CompanyId = companyId };
        var error = await ApplyTypeAsync(companyId, type, request);
        if (error is not null) return error;

        _db.LeaveTypes.Add(type);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(type));
    }

    [HttpPut("types/{id:guid}", Name = "UpdateLeaveType")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<ActionResult<LeaveTypeResponse>> UpdateType(Guid companyId, Guid id, SaveLeaveTypeRequest request)
    {
        var type = await _db.LeaveTypes.FirstOrDefaultAsync(t => t.Id == id && t.CompanyId == companyId);
        if (type is null) return NotFound();

        var error = await ApplyTypeAsync(companyId, type, request);
        if (error is not null) return error;

        await _db.SaveChangesAsync();
        return Ok(ToResponse(type));
    }

    private async Task<ActionResult?> ApplyTypeAsync(Guid companyId, LeaveType type, SaveLeaveTypeRequest request)
    {
        var code = request.Code?.Trim().ToUpperInvariant() ?? string.Empty;
        if (code.Length == 0) return BadRequest(_localizer["LeaveTypeCodeRequired"].Value);
        if (string.IsNullOrWhiteSpace(request.Name)) return BadRequest(_localizer["LeaveTypeNameRequired"].Value);
        if (request.PayPercent is < 0m or > 100m) return BadRequest(_localizer["LeavePayPercentInvalid"].Value);
        if (request.DefaultAnnualDays is < 0m) return BadRequest(_localizer["LeaveAllocationInvalid"].Value);
        if (await _db.LeaveTypes.AnyAsync(t => t.CompanyId == companyId && t.Code == code && t.Id != type.Id))
        {
            return BadRequest(string.Format(_localizer["LeaveTypeCodeTaken"], code));
        }

        type.Code = code;
        type.Name = request.Name!.Trim();
        type.DefaultAnnualDays = request.DefaultAnnualDays;
        type.PayPercent = request.PayPercent;
        type.IsActive = request.IsActive;
        return null;
    }

    private static LeaveTypeResponse ToResponse(LeaveType t) => new(t.Id, t.Code, t.Name, t.DefaultAnnualDays, t.PayPercent, t.IsActive);

    // ---- Allocations and balances ----

    // Sets (creates or replaces) one employee's entitlement for one type and year — e.g. extra
    // days by seniority or collective agreement on top of the type's default.
    [HttpPut("allocations", Name = "SetLeaveAllocation")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<ActionResult<LeaveBalanceResponse>> SetAllocation(Guid companyId, SaveLeaveAllocationRequest request)
    {
        if (request.Days < 0m) return BadRequest(_localizer["LeaveAllocationInvalid"].Value);
        if (!await _db.Employees.AnyAsync(e => e.Id == request.EmployeeId && e.CompanyId == companyId)) return BadRequest(_localizer["EmployeeNotFound"].Value);
        if (!await _db.LeaveTypes.AnyAsync(t => t.Id == request.LeaveTypeId && t.CompanyId == companyId)) return BadRequest(_localizer["LeaveTypeNotFound"].Value);

        var allocation = await _db.LeaveAllocations.FirstOrDefaultAsync(a =>
            a.EmployeeId == request.EmployeeId && a.LeaveTypeId == request.LeaveTypeId && a.Year == request.Year);
        if (allocation is null)
        {
            allocation = new LeaveAllocation
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                EmployeeId = request.EmployeeId,
                LeaveTypeId = request.LeaveTypeId,
                Year = request.Year
            };
            _db.LeaveAllocations.Add(allocation);
        }

        allocation.Days = request.Days;
        await _db.SaveChangesAsync();

        var balances = await ComputeBalancesAsync(companyId, request.Year, request.EmployeeId);
        return Ok(balances.Single(b => b.LeaveTypeId == request.LeaveTypeId));
    }

    // One row per (active employee, active leave type that tracks an entitlement).
    [HttpGet("balances", Name = "ListLeaveBalances")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<LeaveBalanceResponse>>> Balances(Guid companyId, [FromQuery] int year, [FromQuery] Guid? employeeId = null)
    {
        await EnsureDefaultsAsync(companyId);
        return Ok(await ComputeBalancesAsync(companyId, year, employeeId));
    }

    private async Task<List<LeaveBalanceResponse>> ComputeBalancesAsync(Guid companyId, int year, Guid? employeeId)
    {
        var employees = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.IsActive && (employeeId == null || e.Id == employeeId))
            .OrderBy(e => e.Name)
            .ToListAsync();
        var types = await _db.LeaveTypes.AsNoTracking().Where(t => t.CompanyId == companyId && t.IsActive).OrderBy(t => t.Code).ToListAsync();
        var allocations = await _db.LeaveAllocations.AsNoTracking().Where(a => a.CompanyId == companyId && a.Year == year).ToListAsync();
        var requests = await _db.LeaveRequests.AsNoTracking()
            .Where(r => r.CompanyId == companyId && r.StartDate.Year == year &&
                (r.State == LeaveRequestState.Approved || r.State == LeaveRequestState.Pending))
            .ToListAsync();

        var result = new List<LeaveBalanceResponse>();
        foreach (var employee in employees)
        {
            foreach (var type in types)
            {
                var allocation = allocations.FirstOrDefault(a => a.EmployeeId == employee.Id && a.LeaveTypeId == type.Id);
                if (allocation is null && type.DefaultAnnualDays is null)
                {
                    continue;
                }

                var allocated = allocation?.Days ?? type.DefaultAnnualDays ?? 0m;
                var ofType = requests.Where(r => r.EmployeeId == employee.Id && r.LeaveTypeId == type.Id).ToList();
                var taken = ofType.Where(r => r.State == LeaveRequestState.Approved).Sum(r => r.Days);
                var pending = ofType.Where(r => r.State == LeaveRequestState.Pending).Sum(r => r.Days);
                result.Add(new LeaveBalanceResponse(employee.Id, employee.Name, type.Id, type.Name, year, allocated, taken, pending, allocated - taken - pending));
            }
        }

        return result;
    }

    // ---- Requests ----

    [HttpGet("requests", Name = "ListLeaveRequests")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<PaginatedResponse<LeaveRequestResponse>>> ListRequests(
        Guid companyId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? state = null,
        [FromQuery] Guid? employeeId = null,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _db.LeaveRequests.AsNoTracking().Where(r => r.CompanyId == companyId);
        if (Enum.TryParse<LeaveRequestState>(state, true, out var parsedState)) query = query.Where(r => r.State == parsedState);
        if (employeeId is { } e) query = query.Where(r => r.EmployeeId == e);
        if (from is { } f) query = query.Where(r => r.EndDate >= f);
        if (to is { } t) query = query.Where(r => r.StartDate <= t);

        var total = await query.CountAsync();
        var requests = await query.OrderByDescending(r => r.StartDate).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new PaginatedResponse<LeaveRequestResponse>(await ToResponsesAsync(companyId, requests), total, page, pageSize));
    }

    [HttpPost("requests", Name = "CreateLeaveRequest")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    [ProducesResponseType(typeof(LeaveRequestResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<LeaveRequestResponse>> CreateRequest(Guid companyId, CreateLeaveRequestRequest request)
    {
        await EnsureDefaultsAsync(companyId);

        if (request.EndDate < request.StartDate) return BadRequest(_localizer["LeaveEndBeforeStart"].Value);
        if (!await _db.Employees.AnyAsync(e => e.Id == request.EmployeeId && e.CompanyId == companyId)) return BadRequest(_localizer["EmployeeNotFound"].Value);

        var type = await _db.LeaveTypes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == request.LeaveTypeId && t.CompanyId == companyId);
        if (type is null) return BadRequest(_localizer["LeaveTypeNotFound"].Value);

        var holidays = await HolidaySetAsync(companyId, request.StartDate, request.EndDate);
        var days = WorkingDays.Count(request.StartDate, request.EndDate, holidays);
        if (days == 0) return BadRequest(_localizer["LeaveNoWorkingDays"].Value);

        if (await _db.LeaveRequests.AnyAsync(r => r.EmployeeId == request.EmployeeId &&
                (r.State == LeaveRequestState.Pending || r.State == LeaveRequestState.Approved) &&
                r.StartDate <= request.EndDate && r.EndDate >= request.StartDate))
        {
            return BadRequest(_localizer["LeaveOverlaps"].Value);
        }

        var balance = (await ComputeBalancesAsync(companyId, request.StartDate.Year, request.EmployeeId))
            .FirstOrDefault(b => b.LeaveTypeId == type.Id);
        if (balance is not null && days > balance.Remaining)
        {
            return BadRequest(string.Format(_localizer["LeaveExceedsBalance"], days, balance.Remaining));
        }

        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            EmployeeId = request.EmployeeId,
            LeaveTypeId = type.Id,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            Days = days,
            Reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim()
        };
        _db.LeaveRequests.Add(leave);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, (await ToResponsesAsync(companyId, new List<LeaveRequest> { leave })).Single());
    }

    [HttpPost("requests/{id:guid}/approve", Name = "ApproveLeaveRequest")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public Task<ActionResult<LeaveRequestResponse>> Approve(Guid companyId, Guid id) => DecideAsync(companyId, id, approve: true);

    [HttpPost("requests/{id:guid}/reject", Name = "RejectLeaveRequest")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public Task<ActionResult<LeaveRequestResponse>> Reject(Guid companyId, Guid id) => DecideAsync(companyId, id, approve: false);

    [HttpPost("requests/{id:guid}/cancel", Name = "CancelLeaveRequest")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<ActionResult<LeaveRequestResponse>> Cancel(Guid companyId, Guid id)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (leave is null) return NotFound();

        try
        {
            leave.Cancel();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }

        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(companyId, new List<LeaveRequest> { leave })).Single());
    }

    private async Task<ActionResult<LeaveRequestResponse>> DecideAsync(Guid companyId, Guid id, bool approve)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (leave is null) return NotFound();
        if (leave.State != LeaveRequestState.Pending) return BadRequest(_localizer["LeaveRequestNotPending"].Value);

        leave.Decide(approve, CurrentUserId);
        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(companyId, new List<LeaveRequest> { leave })).Single());
    }

    private async Task<List<LeaveRequestResponse>> ToResponsesAsync(Guid companyId, List<LeaveRequest> requests)
    {
        var employeeIds = requests.Select(r => r.EmployeeId).Distinct().ToList();
        var names = await _db.Employees.AsNoTracking().Where(e => employeeIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id, e => e.Name);
        var types = await _db.LeaveTypes.AsNoTracking().Where(t => t.CompanyId == companyId).ToDictionaryAsync(t => t.Id, t => t.Name);

        return requests.Select(r => new LeaveRequestResponse(
            r.Id, r.EmployeeId, names.GetValueOrDefault(r.EmployeeId, string.Empty), r.LeaveTypeId,
            types.GetValueOrDefault(r.LeaveTypeId, string.Empty), r.StartDate, r.EndDate, r.Days, r.Reason,
            r.State.ToString(), r.DecidedAt, r.CreatedAt)).ToList();
    }

    // ---- Public holidays ----

    [HttpGet("holidays", Name = "ListPublicHolidays")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<PublicHolidayResponse>>> ListHolidays(Guid companyId, [FromQuery] int? year = null)
    {
        await EnsureDefaultsAsync(companyId);
        var query = _db.PublicHolidays.AsNoTracking().Where(h => h.CompanyId == companyId);
        if (year is { } y) query = query.Where(h => h.Date.Year == y);

        var holidays = await query.OrderBy(h => h.Date).ToListAsync();
        return Ok(holidays.Select(h => new PublicHolidayResponse(h.Id, h.Date, h.Name)).ToList());
    }

    [HttpPost("holidays", Name = "CreatePublicHoliday")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    [ProducesResponseType(typeof(PublicHolidayResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PublicHolidayResponse>> CreateHoliday(Guid companyId, SavePublicHolidayRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name)) return BadRequest(_localizer["HolidayNameRequired"].Value);
        if (await _db.PublicHolidays.AnyAsync(h => h.CompanyId == companyId && h.Date == request.Date))
        {
            return BadRequest(string.Format(_localizer["HolidayDateTaken"], request.Date.ToString("yyyy-MM-dd")));
        }

        var holiday = new PublicHoliday { Id = Guid.NewGuid(), CompanyId = companyId, Date = request.Date, Name = request.Name.Trim() };
        _db.PublicHolidays.Add(holiday);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, new PublicHolidayResponse(holiday.Id, holiday.Date, holiday.Name));
    }

    [HttpDelete("holidays/{id:guid}", Name = "DeletePublicHoliday")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<IActionResult> DeleteHoliday(Guid companyId, Guid id)
    {
        var holiday = await _db.PublicHolidays.FirstOrDefaultAsync(h => h.Id == id && h.CompanyId == companyId);
        if (holiday is null) return NotFound();

        _db.PublicHolidays.Remove(holiday);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<IReadOnlySet<DateOnly>> HolidaySetAsync(Guid companyId, DateOnly from, DateOnly to) =>
        (await _db.PublicHolidays.AsNoTracking()
            .Where(h => h.CompanyId == companyId && h.Date >= from && h.Date <= to)
            .Select(h => h.Date)
            .ToListAsync()).ToHashSet();

    // Seeds the Kosovo leave types and holiday calendar once per company. A company that has
    // edited or deleted them is never re-seeded: the check is "any rows at all", not per row.
    private async Task EnsureDefaultsAsync(Guid companyId)
    {
        var changed = false;
        if (!await _db.LeaveTypes.AnyAsync(t => t.CompanyId == companyId))
        {
            _db.LeaveTypes.AddRange(KosovoPayrollRules.LeaveTypes.Select(t => new LeaveType
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Code = t.Code,
                Name = t.NameSq,
                DefaultAnnualDays = t.DefaultAnnualDays,
                PayPercent = t.PayPercent
            }));
            changed = true;
        }

        if (!await _db.PublicHolidays.AnyAsync(h => h.CompanyId == companyId))
        {
            _db.PublicHolidays.AddRange(KosovoPayrollRules.PublicHolidays.Select(h => new PublicHoliday
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Date = h.Date,
                Name = h.NameSq
            }));
            changed = true;
        }

        if (changed)
        {
            await _db.SaveChangesAsync();
        }
    }
}
