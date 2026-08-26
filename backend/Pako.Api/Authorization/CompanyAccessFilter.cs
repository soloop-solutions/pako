using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Api.Authorization;

// Resolves whether the authenticated user has access to the {companyId} in the route, either
// directly (a Membership.CompanyId match) or via a firm-wide membership that cascades to every
// Company under that FirmId. This is the server-side enforcement kudofatura never had.
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
    private readonly bool _writeAccess;
    private readonly bool _adminOnly;

    public CompanyAccessFilter(PakoDbContext db, bool writeAccess, bool adminOnly = false)
    {
        _db = db;
        _writeAccess = writeAccess;
        _adminOnly = adminOnly;
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

        var membership = await _db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId &&
                (m.CompanyId == companyId || (company.FirmId != null && m.FirmId == company.FirmId)))
            .FirstOrDefaultAsync();

        if (membership is null ||
            (_writeAccess && !WriteCapableRoles.Contains(membership.Role)) ||
            (_adminOnly && !AdminRoles.Contains(membership.Role)))
        {
            context.Result = new ForbidResult();
            return;
        }

        await next();
    }
}
