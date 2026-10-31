using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Infrastructure;

namespace Pako.Api.Authorization;

// Global: a signed-in request from an account a platform administrator disabled is refused, so
// disabling takes effect at once rather than when the token expires.
public class ActiveUserFilter : IAsyncAuthorizationFilter
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public ActiveUserFilter(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var id = context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (id is null || !Guid.TryParse(id, out var userId)) return;
        if (await _db.Users.AsNoTracking().AnyAsync(u => u.Id == userId && u.IsDisabled))
        {
            context.Result = new ObjectResult(_localizer["AccountDisabled"].Value) { StatusCode = StatusCodes.Status401Unauthorized };
        }
    }
}

// Platform administration endpoints: the account must be a platform administrator, checked
// against the database on every request (never trusted from the token).
public class RequirePlatformAdminAttribute : TypeFilterAttribute
{
    public RequirePlatformAdminAttribute() : base(typeof(PlatformAdminFilter)) { }
}

public class PlatformAdminFilter : IAsyncAuthorizationFilter
{
    private readonly PakoDbContext _db;

    public PlatformAdminFilter(PakoDbContext db) => _db = db;

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var id = context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (id is null || !Guid.TryParse(id, out var userId))
        {
            context.Result = new UnauthorizedResult();
            return;
        }
        if (!await _db.Users.AsNoTracking().AnyAsync(u => u.Id == userId && u.IsPlatformAdmin && !u.IsDisabled))
        {
            context.Result = new ForbidResult();
        }
    }
}
