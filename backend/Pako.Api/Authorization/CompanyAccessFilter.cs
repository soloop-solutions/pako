using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Authorization;

// Resolves whether the authenticated user may run this action in the {companyId} of the route:
// directly (a Membership.CompanyId match) or through a firm-wide membership that cascades to every
// Company under that FirmId. Deactivated memberships (Membership.IsActive = false) grant nothing,
// so deactivating a user takes effect on their very next request.
//
// docs/USER_ACCESS_PLAN.md: a ClientStaff membership grants what its CompanyRole grants — one level
// per AccessModule (None/Read/Write/Approve) and a partner scope. Firm admins/accountants and
// company admins have full access; a ClientViewer reads everything.
public class CompanyAccessFilter : IAsyncActionFilter
{
    private static readonly MembershipRole[] WriteCapableRoles =
    {
        MembershipRole.FirmAdmin, MembershipRole.FirmAccountant, MembershipRole.ClientAdmin
    };

    private static readonly MembershipRole[] AdminRoles =
    {
        MembershipRole.FirmAdmin, MembershipRole.ClientAdmin
    };

    private readonly PakoDbContext _db;
    private readonly CompanyAccessContext _access;
    private readonly bool _writeAccess;
    private readonly bool _adminOnly;
    private readonly AccessModule _module;
    private readonly bool _approve;

    public CompanyAccessFilter(PakoDbContext db, CompanyAccessContext access, bool writeAccess, bool adminOnly, AccessModule module, bool approve = false)
    {
        _db = db;
        _access = access;
        _writeAccess = writeAccess || approve;
        _adminOnly = adminOnly;
        _module = module;
        _approve = approve;
    }

    private AccessLevel Required => _approve ? AccessLevel.Approve : _writeAccess ? AccessLevel.Write : AccessLevel.Read;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!context.RouteData.Values.TryGetValue("companyId", out var raw) ||
            !Guid.TryParse(raw?.ToString(), out var companyId))
        {
            context.Result = new BadRequestObjectResult("Missing or invalid companyId route value.");
            return;
        }

        var userIdValue = context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userIdValue is null || !Guid.TryParse(userIdValue, out var userId))
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
        {
            context.Result = new NotFoundResult();
            return;
        }

        // A user can hold more than one applicable membership on the same company (e.g. a
        // firm-cascaded FirmAccountant plus a direct company membership). Most-permissive wins.
        var memberships = await _db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.IsActive &&
                (m.CompanyId == companyId || (company.FirmId != null && m.FirmId == company.FirmId)))
            .OrderBy(m => m.CreatedAt)
            .Select(m => new { m.Role, m.CompanyRoleId })
            .ToListAsync();
        var roles = memberships.Select(m => m.Role).ToList();

        var classicRoles = roles.Where(r => r != MembershipRole.ClientStaff).ToList();
        var allowedByClassicRole = classicRoles.Count > 0 &&
            (!_writeAccess || classicRoles.Any(WriteCapableRoles.Contains)) &&
            (!_adminOnly || classicRoles.Any(AdminRoles.Contains));

        if (allowedByClassicRole)
        {
            var level = classicRoles.Any(WriteCapableRoles.Contains) ? AccessLevel.Approve : AccessLevel.Read;
            _access.ResolveUnrestricted(companyId, userId, roles, level);
            if (RefuseDisabledModule(context, company.EnabledModules)) return;
            _access.ApplyCompanyModules(company.EnabledModules);
            await next();
            return;
        }

        var roleId = memberships.Where(m => m.Role == MembershipRole.ClientStaff && m.CompanyRoleId != null)
            .Select(m => m.CompanyRoleId).FirstOrDefault();
        if (roles.Contains(MembershipRole.ClientStaff) && await TryResolveStaffAsync(companyId, userId, roles, roleId))
        {
            if (RefuseDisabledModule(context, company.EnabledModules)) return;
            _access.ApplyCompanyModules(company.EnabledModules);
            await next();
            return;
        }

        context.Result = new ForbidResult();
    }

    // A module the platform administrator switched off for this company is refused — checked only
    // after membership, so a non-member can't use it to learn which companies exist or what they use.
    private bool RefuseDisabledModule(ActionExecutingContext context, AppModule enabled)
    {
        if (AppModules.IsEnabled(enabled, _module)) return false;
        var localizer = context.HttpContext.RequestServices.GetService<IStringLocalizer<ErrorMessages>>();
        context.Result = new ObjectResult(localizer?["ModuleDisabled"].Value ?? "This module is not enabled for this company.")
        {
            StatusCode = StatusCodes.Status403Forbidden
        };
        return true;
    }

    private async Task<bool> TryResolveStaffAsync(Guid companyId, Guid userId, IReadOnlyList<MembershipRole> roles, Guid? roleId)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var employee = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.UserId == userId && e.IsActive &&
                (e.TerminationDate == null || e.TerminationDate >= today))
            .Select(e => new { e.Id, e.DepartmentId })
            .FirstOrDefaultAsync();
        var department = employee?.DepartmentId is { } d
            ? await _db.Departments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == d && x.CompanyId == companyId)
            : null;
        var role = roleId is { } id
            ? await _db.CompanyRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id && r.CompanyId == companyId)
            : null;

        // Self-service needs only the linked employee, whatever the role says. Partner visibility
        // is fail-closed (no partners): me/* endpoints never return partner data.
        if (_module == AccessModule.Self)
        {
            if (employee is null) return false;
            _access.ResolveStaff(companyId, userId, roles, role ?? new CompanyRole { CompanyId = companyId, Name = "Self" },
                employee.Id, department, new HashSet<Guid>());
            return true;
        }

        // A staff user without a role (added before roles, or through the old members endpoint)
        // gets what the built-in Employee role gives: reference data and "My HR", nothing else.
        role ??= new CompanyRole { CompanyId = companyId, Name = "Employee", BuiltInKey = "employee" };

        // adminOnly actions (user management) need Users: Approve on the role.
        if (_adminOnly && !role.CanManageUsers) return false;

        // Unannotated endpoints (AccessModule.None) are general reference data: readable, never
        // writable, by staff.
        var granted = _module == AccessModule.None
            ? (_writeAccess ? AccessLevel.None : AccessLevel.Read)
            : role.LevelFor(_module);
        if (!_adminOnly && granted < Required) return false;

        IReadOnlySet<Guid>? visiblePartnerIds = null;
        if (role.PartnerScope == PartnerScope.Assigned)
        {
            visiblePartnerIds = employee is null
                ? new HashSet<Guid>()
                : (await _db.EmployeePartnerAssignments.AsNoTracking()
                    .Where(a => a.EmployeeId == employee.Id)
                    .Select(a => a.PartnerId)
                    .ToListAsync()).ToHashSet();
        }

        _access.ResolveStaff(companyId, userId, roles, role, employee?.Id, department, visiblePartnerIds);
        return true;
    }
}
