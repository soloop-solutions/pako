using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// What the signed-in user may do in this company, so the web can hide nav items and buttons it
// would only get 403s from. Display only — the server enforces every rule independently.
[ApiController]
[Route("api/companies/{companyId:guid}/my-access")]
[Authorize]
public class MyAccessController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly CompanyAccessContext _access;

    public MyAccessController(PakoDbContext db, CompanyAccessContext access)
    {
        _db = db;
        _access = access;
    }

    [HttpGet(Name = "GetMyAccess")]
    [RequireCompanyAccess]
    public async Task<ActionResult<MyAccessResponse>> Get(Guid companyId)
    {
        var linked = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.UserId == _access.UserId && e.IsActive)
            .Select(e => (Guid?)e.Id)
            .FirstOrDefaultAsync();
        // "My HR" belongs to the HR module: without it there is no self-service.
        if (!AppModules.IsEnabled(_access.EnabledModules, AccessModule.Self))
        {
            linked = null;
        }
        var isManager = linked is { } me && await _db.Employees.AnyAsync(e => e.ManagerId == me && e.IsActive && e.Id != me);

        var modules = new ModuleAccessResponse(
            _access.LevelFor(AccessModule.Sales),
            _access.LevelFor(AccessModule.Purchases),
            _access.LevelFor(AccessModule.Partners),
            _access.LevelFor(AccessModule.Accounting),
            _access.LevelFor(AccessModule.Reports),
            _access.LevelFor(AccessModule.Hr),
            _access.LevelFor(AccessModule.Items),
            _access.LevelFor(AccessModule.Payroll),
            _access.LevelFor(AccessModule.Settings),
            _access.LevelFor(AccessModule.Users));

        if (_access.IsStaffAccess && _access.Role is { } role)
        {
            var assigned = _access.EmployeeId is { } employeeId
                ? await _db.EmployeePartnerAssignments.AsNoTracking().CountAsync(a => a.EmployeeId == employeeId)
                : 0;
            return Ok(new MyAccessResponse(
                IsStaff: true,
                CanWrite: CompanyRole.Areas.Any(a => role.LevelFor(a) >= AccessLevel.Write),
                IsAdmin: role.CanManageUsers,
                EmployeeId: _access.EmployeeId,
                DepartmentName: _access.Department?.Name,
                PartnerRestricted: _access.IsPartnerRestricted,
                AssignedPartnerCount: assigned,
                Modules: modules,
                LinkedEmployeeId: linked,
                IsTeamManager: isManager,
                RoleName: role.Name,
                CanManageUsers: role.CanManageUsers));
        }

        var isAdmin = _access.Roles.Any(r => r is MembershipRole.FirmAdmin or MembershipRole.ClientAdmin);
        var roleName = _access.Roles.Contains(MembershipRole.FirmAdmin) ? "FirmAdmin"
            : _access.Roles.Contains(MembershipRole.FirmAccountant) ? "FirmAccountant"
            : _access.Roles.Contains(MembershipRole.ClientAdmin) ? "Administrator"
            : "ReadOnly";
        return Ok(new MyAccessResponse(
            IsStaff: false,
            CanWrite: _access.LevelFor(AccessModule.Sales) >= AccessLevel.Write,
            IsAdmin: isAdmin,
            EmployeeId: null,
            DepartmentName: null,
            PartnerRestricted: false,
            AssignedPartnerCount: 0,
            Modules: modules,
            LinkedEmployeeId: linked,
            IsTeamManager: isManager,
            RoleName: roleName,
            CanManageUsers: isAdmin));
    }
}
