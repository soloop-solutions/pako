using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Controllers;

// Statutory payroll values: the Kosovo defaults (from code, read-only) and the firm's dated
// overrides, which apply to every company of the firm from their EffectiveFrom. Existing payroll
// runs keep the values they were computed with (PayrollRun.ParametersSnapshot).
[ApiController]
[Authorize]
public class StatutoryParametersController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PayrollParameterProvider _parameters;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public StatutoryParametersController(PakoDbContext db, PayrollParameterProvider parameters, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _parameters = parameters;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("api/firms/{firmId:guid}/statutory-parameters", Name = "ListStatutoryParameters")]
    [RequireFirmAccess]
    public async Task<ActionResult<List<StatutoryParameterResponse>>> List(Guid firmId)
    {
        var overrides = await _db.StatutoryParameters.AsNoTracking().Where(p => p.FirmId == firmId).ToListAsync();
        var rows = KosovoStatutoryDefaults.All
            .Select(d => new StatutoryParameterResponse(null, d.Key, d.EffectiveFrom, d.Value, false, d.NeedsVerification, null))
            .Concat(overrides.Select(o => new StatutoryParameterResponse(o.Id, o.Key, o.EffectiveFrom, o.Value, true, false, o.Source)))
            .OrderBy(r => r.Key).ThenByDescending(r => r.EffectiveFrom).ThenByDescending(r => r.IsOverride)
            .ToList();
        return Ok(rows);
    }

    [HttpPost("api/firms/{firmId:guid}/statutory-parameters", Name = "CreateStatutoryParameter")]
    [RequireFirmAccess(adminOnly: true)]
    [ProducesResponseType(typeof(StatutoryParameterResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<StatutoryParameterResponse>> Create(Guid firmId, CreateStatutoryParameterRequest request)
    {
        if (!StatutoryParameterKeys.All.Contains(request.Key)) return BadRequest(_localizer["StatutoryParameterUnknownKey"].Value);
        if (request.Value < 0m || (StatutoryParameterKeys.IsRate(request.Key) && request.Value >= 1m))
        {
            return BadRequest(_localizer["StatutoryParameterValueInvalid"].Value);
        }

        if (await _db.StatutoryParameters.AnyAsync(p => p.FirmId == firmId && p.Key == request.Key && p.EffectiveFrom == request.EffectiveFrom))
        {
            return BadRequest(_localizer["StatutoryParameterDuplicate"].Value);
        }

        var parameter = new StatutoryParameter
        {
            Id = Guid.NewGuid(),
            FirmId = firmId,
            Key = request.Key,
            EffectiveFrom = request.EffectiveFrom,
            Value = request.Value,
            Source = string.IsNullOrWhiteSpace(request.Source) ? null : request.Source.Trim(),
            CreatedByUserId = CurrentUserId,
            CreatedAt = DateTimeOffset.UtcNow
        };
        _db.StatutoryParameters.Add(parameter);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created,
            new StatutoryParameterResponse(parameter.Id, parameter.Key, parameter.EffectiveFrom, parameter.Value, true, false, parameter.Source));
    }

    [HttpDelete("api/firms/{firmId:guid}/statutory-parameters/{id:guid}", Name = "DeleteStatutoryParameter")]
    [RequireFirmAccess(adminOnly: true)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(Guid firmId, Guid id)
    {
        var parameter = await _db.StatutoryParameters.FirstOrDefaultAsync(p => p.Id == id && p.FirmId == firmId);
        if (parameter is null) return NotFound();

        _db.StatutoryParameters.Remove(parameter);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // The values a payroll run for this company would use on the date.
    [HttpGet("api/companies/{companyId:guid}/payroll-parameters", Name = "GetPayrollParameters")]
    [RequireCompanyAccess(module: AccessModule.Payroll)]
    public async Task<ActionResult<PayrollParameters>> ForCompany(Guid companyId, [FromQuery] DateOnly? date = null)
    {
        var on = date ?? DateOnly.FromDateTime(DateTime.UtcNow);
        return Ok(await _parameters.ForCompanyAsync(companyId, on));
    }
}
