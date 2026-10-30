using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Infrastructure;

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
    private readonly LeaveService _leave;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public LeaveController(PakoDbContext db, LeaveService leave, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _leave = leave;
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
        if (request.CarryOverMaxDays is < 0m || request.CarryOverExpiryMonth is < 1 or > 12)
        {
            return BadRequest(_localizer["LeaveCarryOverInvalid"].Value);
        }
        if (await _db.LeaveTypes.AnyAsync(t => t.CompanyId == companyId && t.Code == code && t.Id != type.Id))
        {
            return BadRequest(string.Format(_localizer["LeaveTypeCodeTaken"], code));
        }

        type.Code = code;
        type.Name = request.Name!.Trim();
        type.DefaultAnnualDays = request.DefaultAnnualDays;
        type.PayPercent = request.PayPercent;
        type.IsActive = request.IsActive;
        type.CarryOverMaxDays = request.CarryOverMaxDays;
        type.CarryOverExpiryMonth = request.CarryOverExpiryMonth;
        return null;
    }

    private static LeaveTypeResponse ToResponse(LeaveType t) =>
        new(t.Id, t.Code, t.Name, t.DefaultAnnualDays, t.PayPercent, t.IsActive, t.CarryOverMaxDays, t.CarryOverExpiryMonth);

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
        allocation.HasCustomDays = true;
        await _db.SaveChangesAsync();

        var balances = await ComputeBalancesAsync(companyId, request.Year, request.EmployeeId);
        return Ok(balances.Single(b => b.LeaveTypeId == request.LeaveTypeId));
    }

    // Removes an employee's override so the type's default applies again.
    [HttpDelete("allocations/{employeeId:guid}/{leaveTypeId:guid}/{year:int}", Name = "ResetLeaveAllocation")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> ResetAllocation(Guid companyId, Guid employeeId, Guid leaveTypeId, int year)
    {
        var allocation = await _db.LeaveAllocations.FirstOrDefaultAsync(a =>
            a.CompanyId == companyId && a.EmployeeId == employeeId && a.LeaveTypeId == leaveTypeId && a.Year == year);
        if (allocation is null) return NotFound();

        // Carried-over days live on the same row: keep them, drop only the custom entitlement.
        if (allocation.CarriedOverDays is > 0m)
        {
            allocation.HasCustomDays = false;
        }
        else
        {
            _db.LeaveAllocations.Remove(allocation);
        }

        await _db.SaveChangesAsync();
        return NoContent();
    }

    // F9: moves unused days of fromYear into fromYear + 1 for every type with a carry-over limit.
    // Runs by itself in the first week of January; this is for a late start or a backfill.
    // Idempotent: an allocation that already received its carry-over is never changed again.
    [HttpPost("carry-over", Name = "RunLeaveCarryOver")]
    [RequireCompanyAccess(module: AccessModule.Hr, approve: true)]
    public async Task<ActionResult<LeaveCarryOverResponse>> CarryOver(Guid companyId, [FromQuery] int fromYear)
    {
        var updated = await _leave.CarryOverAsync(companyId, fromYear);
        return Ok(new LeaveCarryOverResponse(fromYear, updated));
    }

    // One row per (active employee, active leave type that tracks an entitlement).
    [HttpGet("balances", Name = "ListLeaveBalances")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<LeaveBalanceResponse>>> Balances(Guid companyId, [FromQuery] int year, [FromQuery] Guid? employeeId = null)
    {
        await EnsureDefaultsAsync(companyId);
        return Ok(await ComputeBalancesAsync(companyId, year, employeeId));
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
        var result = await _leave.CreateAsync(companyId, request);
        if (result.Leave is null) return BadRequest(result.Error);

        return StatusCode(StatusCodes.Status201Created, (await ToResponsesAsync(companyId, new List<LeaveRequest> { result.Leave })).Single());
    }

    [HttpPost("requests/{id:guid}/approve", Name = "ApproveLeaveRequest")]
    [RequireCompanyAccess(module: AccessModule.Hr, approve: true)]
    public Task<ActionResult<LeaveRequestResponse>> Approve(Guid companyId, Guid id) => DecideAsync(companyId, id, approve: true);

    [HttpPost("requests/{id:guid}/reject", Name = "RejectLeaveRequest")]
    [RequireCompanyAccess(module: AccessModule.Hr, approve: true)]
    public Task<ActionResult<LeaveRequestResponse>> Reject(Guid companyId, Guid id) => DecideAsync(companyId, id, approve: false);

    [HttpPost("requests/{id:guid}/cancel", Name = "CancelLeaveRequest")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<ActionResult<LeaveRequestResponse>> Cancel(Guid companyId, Guid id)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (leave is null) return NotFound();

        var result = await _leave.CancelAsync(leave);
        if (result.Leave is null) return BadRequest(result.Error);
        return Ok((await ToResponsesAsync(companyId, new List<LeaveRequest> { leave })).Single());
    }

    private async Task<ActionResult<LeaveRequestResponse>> DecideAsync(Guid companyId, Guid id, bool approve)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId);
        if (leave is null) return NotFound();

        var result = await _leave.DecideAsync(leave, approve, CurrentUserId);
        if (result.Leave is null) return BadRequest(result.Error);
        return Ok((await ToResponsesAsync(companyId, new List<LeaveRequest> { leave })).Single());
    }

    private Task<List<LeaveRequestResponse>> ToResponsesAsync(Guid companyId, List<LeaveRequest> requests) =>
        _leave.ToResponsesAsync(companyId, requests);

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

    private Task<List<LeaveBalanceResponse>> ComputeBalancesAsync(Guid companyId, int year, Guid? employeeId) =>
        _leave.ComputeBalancesAsync(companyId, year, employeeId);

    private Task EnsureDefaultsAsync(Guid companyId) => _leave.EnsureDefaultsAsync(companyId);
}
