using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Localization;
using Pako.Domain.Desktop;

namespace Pako.Api.Desktop;

public sealed class LicenseEnforcementFilter(
    DesktopLicenseService licenses,
    IStringLocalizer<ErrorMessages> localizer) : IAsyncResourceFilter
{
    public const string Code = "LicenseReadOnly";

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        if (IsExempt(request))
        {
            await next();
            return;
        }

        var state = await licenses.EvaluateAsync(context.HttpContext.RequestAborted);
        if (state.Status != LicenseStatus.ReadOnly)
        {
            await next();
            return;
        }

        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status403Forbidden,
            Title = localizer[Code].Value,
            Instance = request.Path
        };
        problem.Extensions["code"] = Code;
        context.Result = new ObjectResult(problem)
        {
            StatusCode = StatusCodes.Status403Forbidden,
            ContentTypes = { "application/problem+json" }
        };
    }

    private static bool IsExempt(HttpRequest request) =>
        HttpMethods.IsGet(request.Method)
        || HttpMethods.IsHead(request.Method)
        || HttpMethods.IsOptions(request.Method)
        || request.Path.StartsWithSegments("/api/auth", StringComparison.OrdinalIgnoreCase)
        || request.Path.StartsWithSegments("/api/desktop", StringComparison.OrdinalIgnoreCase);
}
