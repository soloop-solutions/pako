using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;

namespace Pako.Api.Controllers;

// I14: a firm's payroll month at a glance — which client is posted, which is late for EDI.
[ApiController]
[Authorize]
public class FirmPayrollController : ControllerBase
{
    private readonly FirmPayrollService _overview;

    public FirmPayrollController(FirmPayrollService overview)
    {
        _overview = overview;
    }

    // month: any day of the payroll month; default = last month (the one whose EDI falls due now).
    [HttpGet("api/firms/{firmId:guid}/payroll-overview", Name = "GetFirmPayrollOverview")]
    [RequireFirmAccess]
    public async Task<ActionResult<FirmPayrollOverviewResponse>> Overview(Guid firmId, [FromQuery] DateOnly? month = null)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var result = await _overview.OverviewAsync(firmId, month ?? today.AddMonths(-1), today);
        return result is null ? NotFound() : Ok(result);
    }
}
