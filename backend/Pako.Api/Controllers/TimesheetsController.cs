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

// G12: timesheets — entered by hand or imported from a clock system's CSV, approved per month
// into overtime/night/weekend/holiday payroll adjustments.
[ApiController]
[Route("api/companies/{companyId:guid}/time-entries")]
[Authorize]
public class TimesheetsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly TimesheetService _timesheets;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public TimesheetsController(PakoDbContext db, TimesheetService timesheets, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _timesheets = timesheets;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet(Name = "ListTimeEntries")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<TimeEntryResponse>>> List(Guid companyId, [FromQuery] DateOnly month, [FromQuery] Guid? employeeId = null)
    {
        var start = new DateOnly(month.Year, month.Month, 1);
        var end = start.AddMonths(1).AddDays(-1);
        var rows = await (
            from t in _db.TimeEntries.AsNoTracking()
            join e in _db.Employees.AsNoTracking() on t.EmployeeId equals e.Id
            where t.CompanyId == companyId && t.Date >= start && t.Date <= end && (employeeId == null || t.EmployeeId == employeeId)
            orderby e.Name, t.Date
            select new TimeEntryResponse(t.Id, t.EmployeeId, e.Name, t.Date, t.Hours, t.Kind, t.Source, t.Note, t.ApprovedAt != null))
            .Take(5000).ToListAsync();
        return Ok(rows);
    }

    [HttpGet("summary", Name = "GetTimesheetSummary")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<TimesheetSummaryRow>>> Summary(Guid companyId, [FromQuery] DateOnly month) =>
        Ok(await _timesheets.SummaryAsync(companyId, month));

    [HttpPost(Name = "CreateTimeEntry")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    [ProducesResponseType(typeof(TimeEntryResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<TimeEntryResponse>> Create(Guid companyId, SaveTimeEntryRequest request)
    {
        var employee = await _db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.Id == request.EmployeeId && e.CompanyId == companyId);
        if (employee is null) return BadRequest(_localizer["EmployeeNotFound"].Value);
        if (_timesheets.Validate(request.Hours) is { } error) return BadRequest(error);

        var kind = request.Kind ?? TimeEntry.KindFor(request.Date, await _timesheets.HolidaysAsync(companyId, request.Date, request.Date));
        var entry = new TimeEntry
        {
            Id = Guid.NewGuid(), CompanyId = companyId, EmployeeId = employee.Id, Date = request.Date, Hours = request.Hours, Kind = kind,
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim()
        };
        _db.TimeEntries.Add(entry);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created,
            new TimeEntryResponse(entry.Id, employee.Id, employee.Name, entry.Date, entry.Hours, entry.Kind, entry.Source, entry.Note, false));
    }

    [HttpDelete("{id:guid}", Name = "DeleteTimeEntry")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<IActionResult> Delete(Guid companyId, Guid id)
    {
        var entry = await _db.TimeEntries.FirstOrDefaultAsync(t => t.Id == id && t.CompanyId == companyId);
        if (entry is null) return NotFound();
        if (entry.IsApproved) return BadRequest(_localizer["TimeEntryApproved"].Value);
        _db.TimeEntries.Remove(entry);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("import", Name = "ImportTimeEntries")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    [Consumes("multipart/form-data")]
    public async Task<ActionResult<TimesheetImportResponse>> Import(Guid companyId, [FromForm] ImportTimesheetRequest request)
    {
        if (request.File is null || request.File.Length == 0 || request.File.Length > 5 * 1024 * 1024)
        {
            return BadRequest(_localizer["TimesheetImportFile"].Value);
        }
        await using var stream = request.File.OpenReadStream();
        return Ok(await _timesheets.ImportAsync(companyId, stream));
    }

    [HttpPost("approve-month", Name = "ApproveTimesheetMonth")]
    [RequireCompanyAccess(module: AccessModule.Hr, approve: true)]
    public async Task<ActionResult<List<TimesheetSummaryRow>>> ApproveMonth(Guid companyId, ApproveTimesheetMonthRequest request) =>
        Ok(await _timesheets.ApproveMonthAsync(companyId, request.Month, request.EmployeeId, CurrentUserId));
}
