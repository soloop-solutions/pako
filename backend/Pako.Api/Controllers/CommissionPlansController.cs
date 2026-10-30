using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// G11: commission plans an employee can be put on (Employee.CommissionPlanId).
[ApiController]
[Route("api/companies/{companyId:guid}/commission-plans")]
[Authorize]
public class CommissionPlansController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public CommissionPlansController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    [HttpGet(Name = "ListCommissionPlans")]
    [RequireCompanyAccess(module: AccessModule.Payroll)]
    public async Task<ActionResult<List<CommissionPlanResponse>>> List(Guid companyId)
    {
        var plans = await _db.CommissionPlans.AsNoTracking().Where(p => p.CompanyId == companyId).OrderBy(p => p.Name).ToListAsync();
        var counts = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.IsActive && e.CommissionPlanId != null)
            .GroupBy(e => e.CommissionPlanId!.Value)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count);
        return Ok(plans.Select(p => ToResponse(p, counts.GetValueOrDefault(p.Id))).ToList());
    }

    [HttpPost(Name = "CreateCommissionPlan")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Payroll)]
    [ProducesResponseType(typeof(CommissionPlanResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<CommissionPlanResponse>> Create(Guid companyId, SaveCommissionPlanRequest request)
    {
        var plan = new CommissionPlan { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyAsync(companyId, plan, request) is { } error) return error;
        _db.CommissionPlans.Add(plan);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(plan, 0));
    }

    [HttpPut("{id:guid}", Name = "UpdateCommissionPlan")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Payroll)]
    public async Task<ActionResult<CommissionPlanResponse>> Update(Guid companyId, Guid id, SaveCommissionPlanRequest request)
    {
        var plan = await _db.CommissionPlans.FirstOrDefaultAsync(p => p.Id == id && p.CompanyId == companyId);
        if (plan is null) return NotFound();
        if (await ApplyAsync(companyId, plan, request) is { } error) return error;
        await _db.SaveChangesAsync();
        var count = await _db.Employees.CountAsync(e => e.CommissionPlanId == plan.Id && e.IsActive);
        return Ok(ToResponse(plan, count));
    }

    private async Task<ActionResult?> ApplyAsync(Guid companyId, CommissionPlan plan, SaveCommissionPlanRequest request)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length == 0) return BadRequest(_localizer["CommissionPlanNameRequired"].Value);
        if (request.Rate is <= 0m or >= 1m) return BadRequest(_localizer["CommissionRateInvalid"].Value);
        if (request.MinThreshold is < 0m) return BadRequest(_localizer["CommissionRateInvalid"].Value);
        if (await _db.CommissionPlans.AnyAsync(p => p.CompanyId == companyId && p.Name == name && p.Id != plan.Id))
        {
            return BadRequest(_localizer["CommissionPlanNameTaken"].Value);
        }

        plan.Name = name;
        plan.Basis = request.Basis;
        plan.Rate = request.Rate;
        plan.MinThreshold = request.MinThreshold;
        plan.IsActive = request.IsActive;
        return null;
    }

    private static CommissionPlanResponse ToResponse(CommissionPlan p, int employees) =>
        new(p.Id, p.Name, p.Basis, p.Rate, p.MinThreshold, p.IsActive, employees);
}
