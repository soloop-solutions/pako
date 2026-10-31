using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Reporting;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/reports")]
[Authorize]
public class PayablesReportsController : ControllerBase
{
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;
    private readonly VendorLedgerService _vendors;
    private readonly ExportLabels _labels;

    public PayablesReportsController(IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, VendorLedgerService vendors, ExportLabels labels)
    {
        _labels = labels;
        _localizer = localizer;
        _access = access;
        _vendors = vendors;
    }

    [HttpGet("vendors/synthetic", Name = "VendorSynthetic")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<VendorSyntheticResponse>> VendorSynthetic(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] bool includeZero = false)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        var lines = await _vendors.BalancesAsync(companyId, from, to, includeZero);
        return Ok(new VendorSyntheticResponse(from, to, lines, lines.Sum(l => l.Closing)));
    }

    [ProducesXlsx]
    [HttpGet("vendors/synthetic/export", Name = "VendorSyntheticExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> VendorSyntheticExport(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] bool includeZero = false)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        var lines = await _vendors.BalancesAsync(companyId, from, to, includeZero);
        var rows = lines
            .Select(l => (IReadOnlyList<object?>)new object?[] { l.Name, l.Opening, l.Debit, l.Credit, l.Closing })
            .ToList();
        rows.Add(new object?[] { _labels["Common_Total"], lines.Sum(l => l.Opening), lines.Sum(l => l.Debit), lines.Sum(l => l.Credit), lines.Sum(l => l.Closing) });
        var bytes = ExcelExportService.BuildWorkbook(
            _labels["Sheet_VendorBalances"], new[] { _labels["Common_Vendor"], _labels["Common_Opening"], _labels["Common_Debit"], _labels["Common_Credit"], _labels["Common_Closing"] }, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"vendor-synthetic-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("vendors/{partnerId:guid}/statement", Name = "VendorStatement")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<VendorStatementResponse>> VendorStatement(
        Guid companyId, Guid partnerId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        var statement = await _vendors.StatementAsync(companyId, partnerId, from, to);
        if (statement is null)
        {
            return NotFound(new { error = _localizer["VendorNotFound"].Value });
        }

        return Ok(statement);
    }

    [ProducesXlsx]
    [HttpGet("vendors/{partnerId:guid}/statement/export", Name = "VendorStatementExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> VendorStatementExport(
        Guid companyId, Guid partnerId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        var statement = await _vendors.StatementAsync(companyId, partnerId, from, to);
        if (statement is null)
        {
            return NotFound(new { error = _localizer["VendorNotFound"].Value });
        }

        var rows = new List<IReadOnlyList<object?>> { new object?[] { from == DateOnly.MinValue ? null : from, _labels["Common_Opening"], null, null, null, null, statement.Opening } };
        rows.AddRange(statement.Rows.Select(r =>
            (IReadOnlyList<object?>)new object?[] { r.Date, _labels.Journal(r.Type), r.DocumentNumber, r.Description, r.Debit, r.Credit, r.Balance }));
        rows.Add(new object?[] { null, _labels["Common_Total"], null, null, statement.TotalDebit, statement.TotalCredit, null });
        rows.Add(new object?[] { to, _labels["Common_Closing"], null, null, null, null, statement.Closing });
        var headerBlock = new (string Label, object? Value)[]
        {
            (_labels["Common_Vendor"], statement.Name), (_labels["Common_From"], from == DateOnly.MinValue ? null : from), (_labels["Common_To"], to)
        };
        var bytes = ExcelExportService.BuildWorkbook(
            _labels["Sheet_VendorStatement"], headerBlock, new[] { _labels["Common_Date"], _labels["Common_Type"], _labels["Common_Document"], _labels["Common_Description"], _labels["Common_Debit"], _labels["Common_Credit"], _labels["Common_Balance"] }, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"vendor-statement-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("payables-aging", Name = "PayablesAging")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<PayablesAgingResponse>> PayablesAging(Guid companyId, [FromQuery] DateOnly asOf)
    {
        var date = asOf == default ? DateOnly.FromDateTime(DateTime.UtcNow) : asOf;
        return Ok(await _vendors.PayablesAgingAsync(companyId, date));
    }

    [ProducesXlsx]
    [HttpGet("payables-aging/export", Name = "PayablesAgingExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> PayablesAgingExport(Guid companyId, [FromQuery] DateOnly asOf)
    {
        var date = asOf == default ? DateOnly.FromDateTime(DateTime.UtcNow) : asOf;
        var aging = await _vendors.PayablesAgingAsync(companyId, date);
        var rows = aging.Lines
            .Select(l => (IReadOnlyList<object?>)new object?[] { l.BillNumber, l.PartnerName, l.IssueDate, l.DueDate, l.Outstanding, _labels.Bucket(l.Bucket) })
            .ToList();
        rows.AddRange(aging.Buckets.Select(b => (IReadOnlyList<object?>)new object?[] { _labels["Common_Total"], null, null, null, b.Total, _labels.Bucket(b.Bucket) }));

        var matrixRows = aging.VendorMatrix
            .Select(v => (IReadOnlyList<object?>)v.Buckets.Select(b => (object?)b.Total).Prepend(v.PartnerName).Append(v.Total).ToArray())
            .ToList();
        var matrix = PayablesAgingMatrix.Build(
            aging.Lines.Select(l => new AgingMatrixInput(l.PartnerId, l.PartnerName, l.Bucket, l.Outstanding)),
            aging.Buckets.Select(b => b.Bucket).ToList());
        matrixRows.Add(matrix.BucketTotals.Select(t => (object?)t).Prepend(_labels["Common_Total"]).Append(matrix.GrandTotal).ToArray());

        var bytes = ExcelExportService.BuildWorkbook(new[]
        {
            new ExportSheet(
                _labels["Sheet_PayablesAging"], null,
                new[] { _labels["Ap_Bill"], _labels["Common_Vendor"], _labels["Ap_IssueDate"], _labels["Ap_DueDate"], _labels["Ap_Outstanding"], _labels["Ap_Bucket"] }, rows),
            new ExportSheet(
                _labels["Sheet_Matrix"], null,
                aging.Buckets.Select(b => _labels.Bucket(b.Bucket)).Prepend(_labels["Common_Vendor"]).Append(_labels["Common_Total"]).ToArray(), matrixRows)
        });
        return File(bytes, ExcelExportService.XlsxContentType, $"payables-aging-{date:yyyyMMdd}.xlsx");
    }

    [HttpGet("purchases/by-vendor", Name = "PurchasesByVendor")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<PurchaseByVendorResponse>> PurchasesByVendor(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        var lines = await _vendors.PurchasesByVendorAsync(companyId, from, to);
        var totals = ReportTotals.NetVatGross(lines.Select(l => (l.NetAmount, l.VatAmount, l.GrossAmount)));
        return Ok(new PurchaseByVendorResponse(from, to, lines, totals.Net, lines.Sum(l => l.DiscountAmount), totals.Vat, totals.Gross));
    }

    [ProducesXlsx]
    [HttpGet("purchases/by-vendor/export", Name = "PurchasesByVendorExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> PurchasesByVendorExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        var lines = await _vendors.PurchasesByVendorAsync(companyId, from, to);
        var rows = lines
            .Select(l => (IReadOnlyList<object?>)new object?[] { l.Name, l.NetAmount, l.DiscountAmount, l.VatAmount, l.GrossAmount })
            .ToList();
        rows.Add(new object?[] { _labels["Common_Total"], lines.Sum(l => l.NetAmount), lines.Sum(l => l.DiscountAmount), lines.Sum(l => l.VatAmount), lines.Sum(l => l.GrossAmount) });
        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_PurchasesByVendor"], new[] { _labels["Common_Vendor"], _labels["Common_Net"], _labels["Common_Discount"], _labels["Common_Vat"], _labels["Common_Gross"] }, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"purchases-by-vendor-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("purchases/by-item", Name = "PurchasesByItem")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<PurchaseByItemResponse>> PurchasesByItem(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        var lines = await _vendors.PurchasesByItemAsync(companyId, from, to);
        var totals = ReportTotals.NetVatGross(lines.Select(l => (l.NetAmount, l.VatAmount, l.GrossAmount)));
        return Ok(new PurchaseByItemResponse(from, to, lines, totals.Net, totals.Vat, totals.Gross));
    }

    [ProducesXlsx]
    [HttpGet("purchases/by-item/export", Name = "PurchasesByItemExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> PurchasesByItemExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        var lines = await _vendors.PurchasesByItemAsync(companyId, from, to);
        var rows = lines
            .Select(l => (IReadOnlyList<object?>)new object?[] { l.ItemCode, l.Description, l.Unit, l.Quantity, l.NetAmount, l.VatAmount, l.GrossAmount })
            .ToList();
        rows.Add(new object?[] { _labels["Common_Total"], null, null, null, lines.Sum(l => l.NetAmount), lines.Sum(l => l.VatAmount), lines.Sum(l => l.GrossAmount) });
        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_PurchasesByItem"], new[] { _labels["Common_ItemCode"], _labels["Common_Description"], _labels["Common_Unit"], _labels["Common_Quantity"], _labels["Common_Net"], _labels["Common_Vat"], _labels["Common_Gross"] }, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"purchases-by-item-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("purchases/transactions", Name = "PurchaseTransactions")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<PurchaseTransactionsResponse>> PurchaseTransactions(
        Guid companyId,
        [FromQuery] DateOnly from,
        [FromQuery] DateOnly to,
        [FromQuery] Guid? partnerId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null,
        [FromQuery] string? sort = null)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        page = Math.Clamp(page, 1, 1_000_000);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var all = await _vendors.PurchaseTransactionsAsync(companyId, from, to, partnerId, search, sort);
        var items = all.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        var totals = ReportTotals.NetVatGross(all.Select(l => (l.NetAmount, l.VatAmount, l.GrossAmount)));
        return Ok(new PurchaseTransactionsResponse(items, all.Count, page, pageSize, totals.Net, totals.Vat, totals.Gross));
    }

    [ProducesXlsx]
    [HttpGet("purchases/transactions/export", Name = "PurchaseTransactionsExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> PurchaseTransactionsExport(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] Guid? partnerId)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        var lines = await _vendors.PurchaseTransactionsAsync(companyId, from, to, partnerId, null, null);
        var rows = lines
            .Select(l => (IReadOnlyList<object?>)new object?[]
            {
                l.Date, l.DocumentNumber, l.DocumentType, l.PartnerName, l.ItemCode, l.Description,
                l.Quantity, l.UnitPrice, l.NetAmount, l.VatAmount, l.GrossAmount
            })
            .ToList();
        var totals = ReportTotals.NetVatGross(lines.Select(l => (l.NetAmount, l.VatAmount, l.GrossAmount)));
        rows.Add(new object?[] { null, null, null, null, null, _labels["Common_Total"], null, null, totals.Net, totals.Vat, totals.Gross });
        var bytes = ExcelExportService.BuildWorkbook(
            _labels["Sheet_PurchaseTransactions"],
            new[]
            {
                _labels["Common_Date"], _labels["Common_Document"], _labels["Common_Type"], _labels["Common_Vendor"], _labels["Common_ItemCode"], _labels["Common_Description"],
                _labels["Common_Quantity"], _labels["Common_UnitPrice"], _labels["Common_Net"], _labels["Common_Vat"], _labels["Common_Gross"]
            },
            rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"purchase-transactions-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }
}
