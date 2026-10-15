using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// Departments carry the module permissions and partner scope of their ClientStaff members, so
// writing one is a security change: staff can never do it, even with HR Write — otherwise a
// staff user could grant their own department Accounting access. Only classic write roles can.
[ApiController]
[Route("api/companies/{companyId:guid}/departments")]
[Authorize]
public class DepartmentsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly CompanyAccessContext _access;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public DepartmentsController(PakoDbContext db, CompanyAccessContext access, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _access = access;
        _localizer = localizer;
    }

    // Unpaged: a company's departments are a short reference list the web renders as one tree.
    [HttpGet(Name = "ListDepartments")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<List<DepartmentResponse>>> List(Guid companyId)
    {
        var departments = await _db.Departments.AsNoTracking()
            .Where(d => d.CompanyId == companyId)
            .OrderBy(d => d.Code)
            .ToListAsync();

        return Ok(await ToResponsesAsync(companyId, departments));
    }

    [HttpGet("{id:guid}", Name = "GetDepartment")]
    [RequireCompanyAccess(module: AccessModule.Hr)]
    public async Task<ActionResult<DepartmentResponse>> Get(Guid companyId, Guid id)
    {
        var department = await _db.Departments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id && d.CompanyId == companyId);
        if (department is null) return NotFound();

        return Ok((await ToResponsesAsync(companyId, new List<Department> { department })).Single());
    }

    [HttpPost(Name = "CreateDepartment")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    [ProducesResponseType(typeof(DepartmentResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<DepartmentResponse>> Create(Guid companyId, SaveDepartmentRequest request)
    {
        if (_access.IsStaffAccess) return Forbid();

        var department = new Department { Id = Guid.NewGuid(), CompanyId = companyId };
        var error = await ApplyAsync(companyId, department, request);
        if (error is not null) return error;

        _db.Departments.Add(department);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, (await ToResponsesAsync(companyId, new List<Department> { department })).Single());
    }

    [HttpPut("{id:guid}", Name = "UpdateDepartment")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<ActionResult<DepartmentResponse>> Update(Guid companyId, Guid id, SaveDepartmentRequest request)
    {
        if (_access.IsStaffAccess) return Forbid();

        var department = await _db.Departments.FirstOrDefaultAsync(d => d.Id == id && d.CompanyId == companyId);
        if (department is null) return NotFound();

        var error = await ApplyAsync(companyId, department, request);
        if (error is not null) return error;

        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(companyId, new List<Department> { department })).Single());
    }

    // Only an unused department can be deleted; one with history is deactivated instead.
    [HttpDelete("{id:guid}", Name = "DeleteDepartment")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Hr)]
    public async Task<IActionResult> Delete(Guid companyId, Guid id)
    {
        if (_access.IsStaffAccess) return Forbid();

        var department = await _db.Departments.FirstOrDefaultAsync(d => d.Id == id && d.CompanyId == companyId);
        if (department is null) return NotFound();

        var inUse = await _db.Employees.AnyAsync(e => e.CompanyId == companyId && e.DepartmentId == id) ||
            await _db.Departments.AnyAsync(d => d.CompanyId == companyId && d.ParentId == id) ||
            await _db.PayslipLines.AnyAsync(l => l.DepartmentId == id);
        if (inUse) return BadRequest(_localizer["DepartmentInUse"].Value);

        _db.Departments.Remove(department);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<ActionResult?> ApplyAsync(Guid companyId, Department department, SaveDepartmentRequest request)
    {
        var code = request.Code?.Trim() ?? string.Empty;
        if (code.Length == 0) return BadRequest(_localizer["DepartmentCodeRequired"].Value);
        if (string.IsNullOrWhiteSpace(request.Name)) return BadRequest(_localizer["DepartmentNameRequired"].Value);

        if (await _db.Departments.AnyAsync(d => d.CompanyId == companyId && d.Code == code && d.Id != department.Id))
        {
            return BadRequest(string.Format(_localizer["DepartmentCodeTaken"], code));
        }

        if (request.ParentId is { } parentId)
        {
            // Walk up from the proposed parent; reaching this department means a cycle.
            var parents = await _db.Departments.AsNoTracking()
                .Where(d => d.CompanyId == companyId)
                .ToDictionaryAsync(d => d.Id, d => d.ParentId);
            if (!parents.ContainsKey(parentId)) return BadRequest(_localizer["DepartmentNotFound"].Value);

            for (Guid? cursor = parentId; cursor is { } current; cursor = parents.GetValueOrDefault(current))
            {
                if (current == department.Id) return BadRequest(_localizer["DepartmentParentCycle"].Value);
            }
        }

        if (request.ManagerEmployeeId is { } managerId &&
            !await _db.Employees.AnyAsync(e => e.Id == managerId && e.CompanyId == companyId))
        {
            return BadRequest(_localizer["EmployeeNotFound"].Value);
        }

        if (request.CostCenterId is { } costCenterId &&
            !await _db.CostCenters.AnyAsync(c => c.Id == costCenterId && c.CompanyId == companyId))
        {
            return BadRequest(_localizer["CostCenterNotFound"].Value);
        }

        department.Code = code;
        department.Name = request.Name!.Trim();
        department.ParentId = request.ParentId;
        department.ManagerEmployeeId = request.ManagerEmployeeId;
        department.CostCenterId = request.CostCenterId;
        department.IsActive = request.IsActive;
        department.SalesAccess = request.Permissions.Sales;
        department.PurchasesAccess = request.Permissions.Purchases;
        department.PartnersAccess = request.Permissions.Partners;
        department.AccountingAccess = request.Permissions.Accounting;
        department.ReportsAccess = request.Permissions.Reports;
        department.HrAccess = request.Permissions.Hr;
        department.PartnerScope = request.PartnerScope;
        return null;
    }

    private async Task<List<DepartmentResponse>> ToResponsesAsync(Guid companyId, List<Department> departments)
    {
        var ids = departments.Select(d => d.Id).ToList();
        var counts = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.IsActive && e.DepartmentId != null && ids.Contains(e.DepartmentId.Value))
            .GroupBy(e => e.DepartmentId!.Value)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count);

        var managerIds = departments.Where(d => d.ManagerEmployeeId != null).Select(d => d.ManagerEmployeeId!.Value).ToList();
        var managerNames = await _db.Employees.AsNoTracking()
            .Where(e => managerIds.Contains(e.Id))
            .ToDictionaryAsync(e => e.Id, e => e.Name);

        return departments.Select(d => new DepartmentResponse(
            d.Id,
            d.Code,
            d.Name,
            d.ParentId,
            d.ManagerEmployeeId,
            d.ManagerEmployeeId is { } m ? managerNames.GetValueOrDefault(m) : null,
            d.CostCenterId,
            new DepartmentPermissions(d.SalesAccess, d.PurchasesAccess, d.PartnersAccess, d.AccountingAccess, d.ReportsAccess, d.HrAccess),
            d.PartnerScope,
            d.IsActive,
            counts.GetValueOrDefault(d.Id))).ToList();
    }
}
