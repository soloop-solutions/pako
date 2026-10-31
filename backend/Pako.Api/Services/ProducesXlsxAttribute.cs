using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Pako.Api.Services;

public sealed class ProducesXlsxAttribute : ProducesAttribute
{
    public ProducesXlsxAttribute() : base(ExcelExportService.XlsxContentType)
    {
    }

    public override void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is ObjectResult)
        {
            return;
        }

        base.OnResultExecuting(context);
    }
}
