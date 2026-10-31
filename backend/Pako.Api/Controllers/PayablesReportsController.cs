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

    public PayablesReportsController(IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, VendorLedgerService vendors)
    {
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

    [Produces(ExcelExportService.XlsxContentType)]
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
        rows.Add(new object?[] { "Total", lines.Sum(l => l.Opening), lines.Sum(l => l.Debit), lines.Sum(l => l.Credit), lines.Sum(l => l.Closing) });
        var bytes = ExcelExportService.BuildWorkbook(
            "Vendor Balances", new[] { "Vendor", "Opening", "Debit", "Credit", "Closing" }, rows);
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

    [Produces(ExcelExportService.XlsxContentType)]
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

        var rows = new List<IReadOnlyList<object?>> { new object?[] { from == DateOnly.MinValue ? null : from, "Opening", null, null, null, null, statement.Opening } };
        rows.AddRange(statement.Rows.Select(r =>
            (IReadOnlyList<object?>)new object?[] { r.Date, r.Type, r.DocumentNumber, r.Description, r.Debit, r.Credit, r.Balance }));
        rows.Add(new object?[] { to, "Closing", null, null, null, null, statement.Closing });
        var headerBlock = new (string Label, object? Value)[]
        {
            ("Vendor", statement.Name), ("From", from == DateOnly.MinValue ? null : from), ("To", to)
        };
        var bytes = ExcelExportService.BuildWorkbook(
            "Vendor Statement", headerBlock, new[] { "Date", "Type", "Document", "Description", "Debit", "Credit", "Balance" }, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"vendor-statement-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("payables-aging", Name = "PayablesAging")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<PayablesAgingResponse>> PayablesAging(Guid companyId, [FromQuery] DateOnly asOf)
    {
        var date = asOf == default ? DateOnly.FromDateTime(DateTime.UtcNow) : asOf;
        return Ok(await _vendors.PayablesAgingAsync(companyId, date));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("payables-aging/export", Name = "PayablesAgingExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> PayablesAgingExport(Guid companyId, [FromQuery] DateOnly asOf)
    {
        var date = asOf == default ? DateOnly.FromDateTime(DateTime.UtcNow) : asOf;
        var aging = await _vendors.PayablesAgingAsync(companyId, date);
        var rows = aging.Lines
            .Select(l => (IReadOnlyList<object?>)new object?[] { l.BillNumber, l.PartnerName, l.IssueDate, l.DueDate, l.Outstanding, l.Bucket })
            .ToList();
        rows.AddRange(aging.Buckets.Select(b => (IReadOnlyList<object?>)new object?[] { "Total", null, null, null, b.Total, b.Bucket }));
        var bytes = ExcelExportService.BuildWorkbook(
            "Payables Aging", new[] { "Bill", "Vendor", "Issue date", "Due date", "Outstanding", "Bucket" }, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"payables-aging-{date:yyyyMMdd}.xlsx");
    }

    [HttpGet("purchases/by-vendor", Name = "PurchasesByVendor")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<List<PurchaseByVendorLine>>> PurchasesByVendor(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        return Ok(await _vendors.PurchasesByVendorAsync(companyId, from, to));
    }

    [Produces(ExcelExportService.XlsxContentType)]
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
        rows.Add(new object?[] { "Total", lines.Sum(l => l.NetAmount), lines.Sum(l => l.DiscountAmount), lines.Sum(l => l.VatAmount), lines.Sum(l => l.GrossAmount) });
        var bytes = ExcelExportService.BuildWorkbook("Purchases by Vendor", new[] { "Vendor", "Net", "Discount", "VAT", "Gross" }, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"purchases-by-vendor-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("purchases/by-item", Name = "PurchasesByItem")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<List<PurchaseByItemLine>>> PurchasesByItem(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        return Ok(await _vendors.PurchasesByItemAsync(companyId, from, to));
    }

    [Produces(ExcelExportService.XlsxContentType)]
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
        rows.Add(new object?[] { "Total", null, null, null, lines.Sum(l => l.NetAmount), lines.Sum(l => l.VatAmount), lines.Sum(l => l.GrossAmount) });
        var bytes = ExcelExportService.BuildWorkbook("Purchases by Item", new[] { "Item Code", "Description", "Unit", "Quantity", "Net", "VAT", "Gross" }, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"purchases-by-item-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("purchases/transactions", Name = "PurchaseTransactions")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<PaginatedResponse<PurchaseTransactionLine>>> PurchaseTransactions(
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
        return Ok(new PaginatedResponse<PurchaseTransactionLine>(items, all.Count, page, pageSize));
    }

    [Produces(ExcelExportService.XlsxContentType)]
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
        rows.Add(new object?[] { null, null, null, null, null, "Total", null, null, totals.Net, totals.Vat, totals.Gross });
        var bytes = ExcelExportService.BuildWorkbook(
            "Purchase Transactions",
            new[] { "Date", "Document", "Type", "Vendor", "Item Code", "Description", "Quantity", "Unit Price", "Net", "VAT", "Gross" },
            rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"purchase-transactions-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }
}
