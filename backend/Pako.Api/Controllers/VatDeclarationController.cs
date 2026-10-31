using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/reports")]
[Authorize]
public class VatDeclarationController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;
    private readonly ExportLabels _labels;

    public VatDeclarationController(
        PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, ExportLabels labels)
    {
        _db = db;
        _localizer = localizer;
        _access = access;
        _labels = labels;
    }

    [HttpGet("vat-declaration", Name = "VatDeclaration")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<VatDeclarationResponse>> Declaration(
        Guid companyId, [FromQuery] int year, [FromQuery] int month,
        [FromQuery] decimal? carriedCredit = null, [FromQuery] decimal? refundRequested = null)
    {
        var (response, _, error) = await BuildAsync(companyId, year, month, carriedCredit, refundRequested);
        return error is not null ? error : Ok(response);
    }

    [ProducesXlsx]
    [HttpGet("vat-declaration/export", Name = "VatDeclarationExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> Export(
        Guid companyId, [FromQuery] int year, [FromQuery] int month,
        [FromQuery] decimal? carriedCredit = null, [FromQuery] decimal? refundRequested = null)
    {
        var (response, company, error) = await BuildAsync(companyId, year, month, carriedCredit, refundRequested);
        if (error is not null)
        {
            return error;
        }

        var bytes = VatDeclarationWorkbook.Build(
            _labels["Sheet_VatDeclaration"], _labels, response!, null, company?.Phone);
        return File(bytes, ExcelExportService.XlsxContentType, $"vat-declaration-{year:0000}-{month:00}.xlsx");
    }

    private async Task<(VatDeclarationResponse? Response, Pako.Domain.Companies.Company? Company, ObjectResult? Error)> BuildAsync(
        Guid companyId, int year, int month, decimal? carriedCredit, decimal? refundRequested)
    {
        if (_access.IsPartnerRestricted)
        {
            return (null, null, StatusCode(StatusCodes.Status403Forbidden, _localizer["ReportNotAvailableForScopedUser"].Value));
        }

        if (month is < 1 or > 12 || year is < 2000 or > 2100)
        {
            return (null, null, BadRequest(new { error = _localizer["VatDeclarationPeriodInvalid"].Value }));
        }

        if (carriedCredit is < 0m)
        {
            return (null, null, BadRequest(new { error = _localizer["VatDeclarationCarriedCreditInvalid"].Value }));
        }

        var refund = refundRequested ?? 0m;
        var result = await new VatDeclarationService(_db, _access).ComputeAsync(companyId, year, month, carriedCredit, refund);
        if (refund < 0m)
        {
            return (null, null, BadRequest(new { error = _localizer["VatDeclarationRefundNegative"].Value }));
        }

        if (refund > result.RemainingCredit)
        {
            return (null, null, BadRequest(new { error = _localizer["VatDeclarationRefundExceedsCredit"].Value }));
        }

        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        var address = company is null
            ? null
            : string.Join(", ", new[] { company.StreetAddress, company.AddressLine2, company.Municipality }
                .Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()));

        var response = new VatDeclarationResponse(
            year, month, company?.Name, company?.FiscalNumber, string.IsNullOrEmpty(address) ? null : address,
            VatDeclarationLayout.Build(result, key => _labels[key]),
            result.TotalVatCalculated, result.TotalVatDeductible, result.CarriedCredit, result.RemainingCredit,
            result.RefundRequested, result.CreditForNextPeriod, result.VatPayable);
        return (response, company, null);
    }
}
