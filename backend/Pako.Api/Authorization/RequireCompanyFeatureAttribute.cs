using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Api.Authorization;

// docs/COMPANY_TYPES.md: a vertical pack's endpoints answer 403 when the company doesn't use the
// pack (any one of the named packs is enough). Runs after RequireCompanyAccess (Order 1), so a
// non-member still learns nothing about the company.
public class RequireCompanyFeatureAttribute : TypeFilterAttribute
{
    public RequireCompanyFeatureAttribute(CompanyFeature anyOf) : base(typeof(CompanyFeatureFilter))
    {
        Arguments = new object[] { anyOf };
        Order = 1;
    }
}

public class CompanyFeatureFilter : IAsyncActionFilter
{
    private readonly PakoDbContext _db;
    private readonly CompanyFeature _anyOf;

    public CompanyFeatureFilter(PakoDbContext db, CompanyFeature anyOf)
    {
        _db = db;
        _anyOf = anyOf;
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (context.RouteData.Values.TryGetValue("companyId", out var raw) && Guid.TryParse(raw?.ToString(), out var companyId))
        {
            var enabled = await _db.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => (CompanyFeature?)c.EnabledFeatures).FirstOrDefaultAsync();
            if (enabled is { } features && (features & _anyOf) == CompanyFeature.None)
            {
                var localizer = context.HttpContext.RequestServices.GetService<IStringLocalizer<ErrorMessages>>();
                context.Result = new ObjectResult(localizer?["FeatureDisabled"].Value ?? "This feature is not enabled for this company.")
                {
                    StatusCode = StatusCodes.Status403Forbidden
                };
                return;
            }
        }
        await next();
    }
}
