using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Pako.Api.Services;

public sealed class ProducesPdfAttribute : ProducesAttribute
{
    public ProducesPdfAttribute() : base(DashboardPdfRenderer.PdfContentType)
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
