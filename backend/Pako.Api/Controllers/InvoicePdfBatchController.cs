using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Documents;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// Client request 2026-11-24 ("Print selected" on the invoice list): the chosen invoices as one PDF,
// each rendered exactly like GET invoices/{id}/pdf, in the order asked for.
[ApiController]
[Route("api/companies/{companyId:guid}/invoices")]
[Authorize]
public class InvoicePdfBatchController(PakoDbContext db, InvoiceDocumentService documents, CompanyAccessContext access,
    IStringLocalizer<ErrorMessages> localizer) : ControllerBase
{
    public const int MaxInvoices = 100;

    [HttpPost("pdf-batch", Name = "GetInvoicesPdf")]
    [ProducesPdf]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<IActionResult> Pdf(Guid companyId, InvoicePdfBatchRequest request)
    {
        var ids = (request.InvoiceIds ?? []).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(localizer["InvoicePdfBatchEmpty"].Value);
        if (ids.Count > MaxInvoices) return BadRequest(string.Format(localizer["InvoicePdfBatchTooMany"].Value, MaxInvoices));

        var visible = await db.Invoices.AsNoTracking().VisibleTo(access)
            .Where(i => i.CompanyId == companyId && ids.Contains(i.Id)).Select(i => i.Id).ToListAsync();
        if (visible.Count != ids.Count) return NotFound();

        var loaded = new List<InvoiceDocument>();
        foreach (var id in ids)
        {
            var document = await documents.LoadAsync(companyId, id);
            if (document is null) return NotFound();
            loaded.Add(document);
        }

        var bytes = InvoicePdfRenderer.RenderMany(loaded, key => localizer[key].Value, CultureInfo.CurrentUICulture);
        return File(bytes, InvoicePdfRenderer.PdfContentType, $"invoices-{DateTime.UtcNow:yyyyMMdd}.pdf");
    }
}
