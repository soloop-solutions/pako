using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Authorization;

// Resolves whether the authenticated user has access to the {companyId} in the route, either
// directly (a Membership.CompanyId match) or via a firm-wide membership that cascades to every
// Company under that FirmId. This is the server-side enforcement kudofatura never had.
//
// HR module: a ClientStaff membership grants nothing by itself — the user's Employee record in
// this company (Employee.UserId) and that employee's Department decide, per AccessModule, whether
// the action may run, and the department's PartnerScope decides which partners' data the
// resolved CompanyAccessContext exposes. Every other role is unrestricted, as before.
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

    public CompanyAccessFilter(PakoDbContext db, CompanyAccessContext access, bool writeAccess, bool adminOnly, AccessModule module)
    {
        _db = db;
        _access = access;
        _writeAccess = writeAccess;
        _adminOnly = adminOnly;
        _module = module;
    }

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

        // A user can hold more than one applicable Membership on the same company (e.g. a
        // firm-cascaded FirmAccountant plus a direct company-scoped ClientViewer added to
        // restrict/override that specific member). Policy: most-permissive-wins — the union of
        // what every applicable membership grants, not an arbitrary single row (Postgres doesn't
        // guarantee row order, so picking one via FirstOrDefault made effective permissions
        // non-deterministic). Simpler and safer to reason about than "most specific wins."
        var roles = await _db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId &&
                (m.CompanyId == companyId || (company.FirmId != null && m.FirmId == company.FirmId)))
            .Select(m => m.Role)
            .ToListAsync();

        var classicRoles = roles.Where(r => r != MembershipRole.ClientStaff).ToList();
        var allowedByClassicRole = classicRoles.Count > 0 &&
            (!_writeAccess || classicRoles.Any(WriteCapableRoles.Contains)) &&
            (!_adminOnly || classicRoles.Any(AdminRoles.Contains));

        if (allowedByClassicRole)
        {
            _access.ResolveUnrestricted(companyId, userId, roles);
            await next();
            return;
        }

        if (roles.Contains(MembershipRole.ClientStaff) && !_adminOnly &&
            await TryResolveStaffAsync(companyId, userId, roles))
        {
            await next();
            return;
        }

        context.Result = new ForbidResult();
    }

    private async Task<bool> TryResolveStaffAsync(Guid companyId, Guid userId, IReadOnlyList<MembershipRole> roles)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var employee = await _db.Employees.AsNoTracking()
            .Where(e => e.CompanyId == companyId && e.UserId == userId && e.IsActive &&
                (e.TerminationDate == null || e.TerminationDate >= today))
            .Select(e => new { e.Id, e.DepartmentId })
            .FirstOrDefaultAsync();
        if (employee?.DepartmentId is null)
        {
            return false;
        }

        var department = await _db.Departments.AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == employee.DepartmentId && d.CompanyId == companyId && d.IsActive);
        if (department is null)
        {
            return false;
        }

        // Unannotated endpoints (AccessModule.None) are general reference data: readable, never
        // writable, by staff.
        var granted = _module == AccessModule.None
            ? (_writeAccess ? AccessLevel.None : AccessLevel.Read)
            : department.LevelFor(_module);
        var required = _writeAccess ? AccessLevel.Write : AccessLevel.Read;
        if (granted < required)
        {
            return false;
        }

        IReadOnlySet<Guid>? visiblePartnerIds = null;
        if (department.PartnerScope == PartnerScope.Assigned)
        {
            visiblePartnerIds = (await _db.EmployeePartnerAssignments.AsNoTracking()
                .Where(a => a.EmployeeId == employee.Id)
                .Select(a => a.PartnerId)
                .ToListAsync()).ToHashSet();
        }

        _access.ResolveStaff(companyId, userId, roles, employee.Id, department, visiblePartnerIds);
        return true;
    }
}
