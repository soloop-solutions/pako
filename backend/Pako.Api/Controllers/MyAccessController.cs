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
    private static readonly MembershipRole[] WriteCapableRoles =
    {
        MembershipRole.FirmAdmin, MembershipRole.FirmAccountant, MembershipRole.ClientAdmin
    };

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
        if (_access.IsStaffAccess && _access.Department is { } department)
        {
            var assigned = await _db.EmployeePartnerAssignments.AsNoTracking().CountAsync(a => a.EmployeeId == _access.EmployeeId);
            var modules = new ModuleAccessResponse(
                department.LevelFor(AccessModule.Sales),
                department.LevelFor(AccessModule.Purchases),
                department.LevelFor(AccessModule.Partners),
                department.LevelFor(AccessModule.Accounting),
                department.LevelFor(AccessModule.Reports),
                department.LevelFor(AccessModule.Hr));

            return Ok(new MyAccessResponse(
                IsStaff: true,
                CanWrite: new[] { modules.Sales, modules.Purchases, modules.Partners, modules.Accounting, modules.Reports, modules.Hr }
                    .Contains(AccessLevel.Write),
                IsAdmin: false,
                EmployeeId: _access.EmployeeId,
                DepartmentName: department.Name,
                PartnerRestricted: _access.IsPartnerRestricted,
                AssignedPartnerCount: assigned,
                Modules: modules));
        }

        var canWrite = _access.Roles.Any(WriteCapableRoles.Contains);
        var isAdmin = _access.Roles.Any(r => r is MembershipRole.FirmAdmin or MembershipRole.ClientAdmin);
        var level = canWrite ? AccessLevel.Write : AccessLevel.Read;
        return Ok(new MyAccessResponse(
            IsStaff: false,
            CanWrite: canWrite,
            IsAdmin: isAdmin,
            EmployeeId: null,
            DepartmentName: null,
            PartnerRestricted: false,
            AssignedPartnerCount: 0,
            Modules: new ModuleAccessResponse(level, level, level, level, level, level)));
    }
}
