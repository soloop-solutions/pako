using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Api.Authorization;

// Resolves whether the authenticated user has a direct Membership on the {firmId} in the route.
// Unlike CompanyAccessFilter there is no cascade to resolve here — Firm-scoped routes only ever
// check a Firm-scoped Membership row.
public class FirmAccessFilter : IAsyncActionFilter
{
    private readonly PakoDbContext _db;
    private readonly bool _adminOnly;

    public FirmAccessFilter(PakoDbContext db, bool adminOnly)
    {
        _db = db;
        _adminOnly = adminOnly;
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!context.RouteData.Values.TryGetValue("firmId", out var raw) ||
            !Guid.TryParse(raw?.ToString(), out var firmId))
        {
            context.Result = new BadRequestObjectResult("Missing or invalid firmId route value.");
            return;
        }

        var userIdValue = context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userIdValue is null || !Guid.TryParse(userIdValue, out var userId))
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        var firmExists = await _db.Firms.AsNoTracking().AnyAsync(f => f.Id == firmId);
        if (!firmExists)
        {
            context.Result = new NotFoundResult();
            return;
        }

        var membership = await _db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.FirmId == firmId)
            .FirstOrDefaultAsync();

        if (membership is null || (_adminOnly && membership.Role != MembershipRole.FirmAdmin))
        {
            context.Result = new ForbidResult();
            return;
        }

        await next();
    }
}
