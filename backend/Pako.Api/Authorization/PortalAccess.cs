using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Authorization;

// Client feedback phase 5 — the customer portal. Who is asking, for which company, and as which
// customer. Set by PortalAccessFilter; every portal query is scoped to PartnerId, never to an id
// the browser sends.
public class PortalContext
{
    private bool _resolved;

    public Guid CompanyId { get; private set; }
    public Guid UserId { get; private set; }
    public Guid PartnerId { get; private set; }

    public void Resolve(Guid companyId, Guid userId, Guid partnerId)
    {
        CompanyId = companyId;
        UserId = userId;
        PartnerId = partnerId;
        _resolved = true;
    }

    public void EnsureResolved()
    {
        if (!_resolved) throw new InvalidOperationException("PortalContext used outside [RequirePortalAccess].");
    }
}

// The only way into api/portal/companies/{companyId}: an active ClientCustomer membership of this
// company naming one of its customers, while the company is open and has the Sales area on.
// Staff memberships do not pass: the portal is the customer's view, not a back door to theirs.
public class RequirePortalAccessAttribute : TypeFilterAttribute
{
    public RequirePortalAccessAttribute() : base(typeof(PortalAccessFilter))
    {
    }
}

public class PortalAccessFilter : IAsyncActionFilter
{
    private readonly PakoDbContext _db;
    private readonly PortalContext _portal;

    public PortalAccessFilter(PakoDbContext db, PortalContext portal)
    {
        _db = db;
        _portal = portal;
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!context.RouteData.Values.TryGetValue("companyId", out var raw) || !Guid.TryParse(raw?.ToString(), out var companyId))
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

        var partnerId = await _db.Memberships.AsNoTracking()
            .Where(m => m.UserId == userId && m.CompanyId == companyId && m.IsActive && m.Role == MembershipRole.ClientCustomer && m.PartnerId != null)
            .Select(m => m.PartnerId)
            .FirstOrDefaultAsync();
        var company = partnerId is null ? null : await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        var isCustomer = partnerId is { } p && await _db.Partners.AsNoTracking().AnyAsync(x => x.Id == p && x.CompanyId == companyId && x.IsCustomer);
        if (company is null || company.IsArchived || !isCustomer || !AppModules.IsEnabled(company.EnabledModules, AccessModule.Sales))
        {
            context.Result = new ForbidResult();
            return;
        }

        _portal.Resolve(companyId, userId, partnerId!.Value);
        await next();
    }
}
