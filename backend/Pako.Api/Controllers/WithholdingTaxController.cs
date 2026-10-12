using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/withholding-tax")]
[Authorize]
public class WithholdingTaxController : ControllerBase
{
    private static readonly WithholdingTaxEntryResponse FixtureEntry = new(
        Guid.Parse("7c1f0c0e-3b0a-4f5e-9a47-5a1d2e7b9c10"), 2025, "1010391632", "Ljubica Azemi",
        9m, 0m, 0m, 0.90m, 100m, 0m, 0m, 0m, 0m, 29m, 100m, "Kosova");

    private static readonly WithholdingTaxTotalsResponse FixtureTotals = new(9m, 0m, 0m, 0.90m, 100m, 0m, 0m, 0m, 0m);

    [HttpGet]
    [RequireCompanyAccess]
    public ActionResult<WithholdingTaxListResponse> List(
        Guid companyId,
        [FromQuery] int year,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null,
        [FromQuery] string? sort = null)
    {
        // CONTRACT STUB — replaced in WHT1
        return Ok(new WithholdingTaxListResponse([FixtureEntry], 1, 1, 50, FixtureTotals, 0.10m, 0.05m));
    }

    [HttpGet("countries")]
    [RequireCompanyAccess]
    public ActionResult<WithholdingTaxCountryListResponse> Countries(Guid companyId)
    {
        // CONTRACT STUB — replaced in WHT1
        return Ok(new WithholdingTaxCountryListResponse(["Kosova", "Shqiperia"], "Kosova"));
    }

    [HttpGet("{entryId:guid}")]
    [RequireCompanyAccess]
    public ActionResult<WithholdingTaxEntryResponse> Get(Guid companyId, Guid entryId)
    {
        // CONTRACT STUB — replaced in WHT1
        return Ok(FixtureEntry);
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(WithholdingTaxEntryResponse), StatusCodes.Status201Created)]
    public ActionResult<WithholdingTaxEntryResponse> Create(Guid companyId, SaveWithholdingTaxEntryRequest request)
    {
        // CONTRACT STUB — replaced in WHT1
        return StatusCode(StatusCodes.Status201Created, FixtureEntry);
    }

    [HttpPut("{entryId:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public ActionResult<WithholdingTaxEntryResponse> Update(Guid companyId, Guid entryId, SaveWithholdingTaxEntryRequest request)
    {
        // CONTRACT STUB — replaced in WHT1
        return Ok(FixtureEntry);
    }

    [HttpDelete("{entryId:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public IActionResult Delete(Guid companyId, Guid entryId)
    {
        // CONTRACT STUB — replaced in WHT1
        return NoContent();
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("export", Name = "WithholdingTaxExport")]
    [RequireCompanyAccess]
    public IActionResult Export(Guid companyId, [FromQuery] int year)
    {
        // CONTRACT STUB — replaced in WHT1
        return File(Array.Empty<byte>(), ExcelExportService.XlsxContentType, $"tatimi-ne-burim-{year}.xlsx");
    }
}
