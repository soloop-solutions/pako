using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// 40_Cost_Centers: the company's analytic cost centers. Departments point at one so payroll
// expense lines carry it. No delete — journal lines may already reference a cost center.
[ApiController]
[Route("api/companies/{companyId:guid}/cost-centers")]
[Authorize]
public class CostCentersController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public CostCentersController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    // Readable by anyone with company access: the department form (HR) and journal entry lines
    // (Accounting) both pick from it, and it carries no amounts.
    [HttpGet(Name = "ListCostCenters")]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<CostCenterResponse>>> List(Guid companyId)
    {
        var costCenters = await _db.CostCenters.AsNoTracking()
            .Where(c => c.CompanyId == companyId)
            .OrderBy(c => c.Code)
            .ToListAsync();
        return Ok(costCenters.Select(ToResponse).ToList());
    }

    [HttpPost(Name = "CreateCostCenter")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    [ProducesResponseType(typeof(CostCenterResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<CostCenterResponse>> Create(Guid companyId, SaveCostCenterRequest request)
    {
        var costCenter = new CostCenter { Id = Guid.NewGuid(), CompanyId = companyId };
        var error = await ApplyAsync(companyId, costCenter, request);
        if (error is not null) return error;

        _db.CostCenters.Add(costCenter);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(costCenter));
    }

    [HttpPut("{id:guid}", Name = "UpdateCostCenter")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    public async Task<ActionResult<CostCenterResponse>> Update(Guid companyId, Guid id, SaveCostCenterRequest request)
    {
        var costCenter = await _db.CostCenters.FirstOrDefaultAsync(c => c.Id == id && c.CompanyId == companyId);
        if (costCenter is null) return NotFound();

        var error = await ApplyAsync(companyId, costCenter, request);
        if (error is not null) return error;

        await _db.SaveChangesAsync();
        return Ok(ToResponse(costCenter));
    }

    private async Task<ActionResult?> ApplyAsync(Guid companyId, CostCenter costCenter, SaveCostCenterRequest request)
    {
        var code = request.Code?.Trim().ToUpperInvariant() ?? string.Empty;
        if (code.Length == 0 || code.Length > 16) return BadRequest(_localizer["CostCenterCodeRequired"].Value);
        if (string.IsNullOrWhiteSpace(request.Name)) return BadRequest(_localizer["CostCenterNameRequired"].Value);
        if (await _db.CostCenters.AnyAsync(c => c.CompanyId == companyId && c.Code == code && c.Id != costCenter.Id))
        {
            return BadRequest(string.Format(_localizer["CostCenterCodeTaken"], code));
        }

        costCenter.Code = code;
        costCenter.Name = request.Name.Trim();
        costCenter.NameEn = string.IsNullOrWhiteSpace(request.NameEn) ? costCenter.Name : request.NameEn.Trim();
        return null;
    }

    private static CostCenterResponse ToResponse(CostCenter c) => new(c.Id, c.Code, c.Name, c.NameEn);
}
