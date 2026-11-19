using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public sealed class ExportNumberStyleFilter : IAsyncActionFilter
{
    private readonly PakoDbContext _db;

    public ExportNumberStyleFilter(PakoDbContext db) => _db = db;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var isXlsx = context.ActionDescriptor.EndpointMetadata.OfType<ProducesXlsxAttribute>().Any();
        if (isXlsx && context.RouteData.Values.TryGetValue("companyId", out var raw) && Guid.TryParse(raw?.ToString(), out var companyId))
        {
            ExcelExportService.CurrentNegativeStyle = await _db.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => c.NegativeNumberStyle)
                .FirstOrDefaultAsync();
        }

        await next();
    }
}
