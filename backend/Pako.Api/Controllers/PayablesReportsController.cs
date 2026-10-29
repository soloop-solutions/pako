using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/reports")]
[Authorize]
public class PayablesReportsController : ControllerBase
{
    private static readonly Guid PrimeId = Guid.Parse("5b1f0c2e-1a11-4c01-9a04-000000000001");
    private static readonly Guid KedsId = Guid.Parse("5b1f0c2e-1a11-4c01-9a04-000000000002");
    private static readonly Guid TelekomId = Guid.Parse("5b1f0c2e-1a11-4c01-9a04-000000000003");
    private static readonly Guid SuppliesId = Guid.Parse("5b1f0c2e-1a11-4c01-9a04-000000000004");

    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;

    public PayablesReportsController(IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access)
    {
        _localizer = localizer;
        _access = access;
    }

    private ObjectResult ReportNotAvailableForScopedUser() =>
        StatusCode(StatusCodes.Status403Forbidden, _localizer["ReportNotAvailableForScopedUser"].Value);

    private FileContentResult Export(string sheet, string fileName, string header)
    {
        var bytes = ExcelExportService.BuildWorkbook(sheet, new[] { header }, new List<IReadOnlyList<object?>> { new object?[] { "stub" } });
        return File(bytes, ExcelExportService.XlsxContentType, fileName);
    }

    // CONTRACT STUB — replaced in T12
    [HttpGet("vendors/synthetic")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<VendorSyntheticResponse> VendorSynthetic(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] bool includeZero = false)
    {
        var lines = new List<VendorBalanceLine>
        {
            new(PrimeId, "Prime Properties L.L.C.", 500.00m, 500.00m, 1180.00m, 1180.00m),
            new(KedsId, "KEDS J.S.C.", 0.00m, 0.00m, 240.00m, 240.00m),
            new(TelekomId, "Telekomi i Kosoves J.S.C.", 100.00m, 100.00m, 354.00m, 354.00m),
            new(SuppliesId, "Kosova Office Supplies SH.P.K.", 0.00m, 450.00m, 150.00m, -300.00m),
        };
        return Ok(new VendorSyntheticResponse(from, to, lines, lines.Sum(l => l.Closing)));
    }

    // CONTRACT STUB — replaced in T12
    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("vendors/synthetic/export", Name = "VendorSyntheticExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult VendorSyntheticExport(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] bool includeZero = false) =>
        Export("Vendor Balances", $"vendor-synthetic-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx", "Vendor");

    // CONTRACT STUB — replaced in T12
    [HttpGet("vendors/{partnerId:guid}/statement")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<VendorStatementResponse> VendorStatement(
        Guid companyId, Guid partnerId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var rows = new List<VendorStatementRow>
        {
            new(new DateOnly(2026, 1, 2), "Bill", "BILL-0001", "Office rent January 2026", 0.00m, 1180.00m, 1680.00m),
            new(new DateOnly(2026, 1, 10), "Payment", "PAY-0001", "Bank transfer", 500.00m, 0.00m, 1180.00m),
        };
        return Ok(new VendorStatementResponse(partnerId, "Prime Properties L.L.C.", from, to, 500.00m, rows, 1180.00m));
    }

    // CONTRACT STUB — replaced in T12
    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("vendors/{partnerId:guid}/statement/export", Name = "VendorStatementExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult VendorStatementExport(
        Guid companyId, Guid partnerId, [FromQuery] DateOnly from, [FromQuery] DateOnly to) =>
        Export("Vendor Statement", $"vendor-statement-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx", "Date");

    // CONTRACT STUB — replaced in T13
    [HttpGet("payables-aging")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<PayablesAgingResponse> PayablesAging(Guid companyId, [FromQuery] DateOnly asOf)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        var lines = new List<PayablesAgingLine>
        {
            new(Guid.Parse("5b1f0c2e-1a11-4c01-9a05-000000000001"), "BILL-0001", PrimeId, "Prime Properties L.L.C.", new DateOnly(2026, 1, 2), new DateOnly(2026, 2, 1), 1180.00m, "Current"),
            new(Guid.Parse("5b1f0c2e-1a11-4c01-9a05-000000000002"), "BILL-0002", KedsId, "KEDS J.S.C.", new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 15), 240.00m, "1-30"),
            new(Guid.Parse("5b1f0c2e-1a11-4c01-9a05-000000000003"), "BILL-0003", TelekomId, "Telekomi i Kosoves J.S.C.", new DateOnly(2025, 11, 25), new DateOnly(2025, 12, 10), 234.00m, "46-60"),
            new(Guid.Parse("5b1f0c2e-1a11-4c01-9a05-000000000004"), "BILL-0004", TelekomId, "Telekomi i Kosoves J.S.C.", new DateOnly(2025, 10, 5), new DateOnly(2025, 10, 20), 120.00m, "91-180"),
        };
        var order = new[] { "Current", "1-30", "31-45", "46-60", "61-90", "91-180", "181-360", "Over360" };
        var buckets = order.Select(b => new AgingBucketTotal(b, lines.Where(l => l.Bucket == b).Sum(l => l.Outstanding))).ToList();
        return Ok(new PayablesAgingResponse(asOf, lines, buckets));
    }

    // CONTRACT STUB — replaced in T13
    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("payables-aging/export", Name = "PayablesAgingExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult PayablesAgingExport(Guid companyId, [FromQuery] DateOnly asOf)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Export("Payables Aging", $"payables-aging-{asOf:yyyyMMdd}.xlsx", "Bill");
    }

    // CONTRACT STUB — replaced in T14
    [HttpGet("purchases/by-vendor")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<List<PurchaseByVendorLine>> PurchasesByVendor(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Ok(new List<PurchaseByVendorLine>
        {
            new(PrimeId, "Prime Properties L.L.C.", 1000.00m, 0.00m, 180.00m, 1180.00m),
            new(KedsId, "KEDS J.S.C.", 203.39m, 0.00m, 36.61m, 240.00m),
            new(TelekomId, "Telekomi i Kosoves J.S.C.", 300.00m, 0.00m, 54.00m, 354.00m),
            new(SuppliesId, "Kosova Office Supplies SH.P.K.", 380.00m, 20.00m, 68.40m, 448.40m),
        });
    }

    // CONTRACT STUB — replaced in T14
    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("purchases/by-vendor/export", Name = "PurchasesByVendorExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult PurchasesByVendorExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Export("Purchases by Vendor", $"purchases-by-vendor-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx", "Vendor");
    }

    // CONTRACT STUB — replaced in T14
    [HttpGet("purchases/by-item")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<List<PurchaseByItemLine>> PurchasesByItem(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Ok(new List<PurchaseByItemLine>
        {
            new(null, null, "Office rent January 2026", null, 1.00m, 1000.00m, 180.00m, 1180.00m),
            new(Guid.Parse("5b1f0c2e-1a11-4c01-9a06-000000000001"), "SRV-ELE", "Electricity", "kWh", 1200.00m, 203.39m, 36.61m, 240.00m),
            new(Guid.Parse("5b1f0c2e-1a11-4c01-9a06-000000000002"), "SRV-NET", "Internet and telephony", "month", 1.00m, 300.00m, 54.00m, 354.00m),
            new(Guid.Parse("5b1f0c2e-1a11-4c01-9a06-000000000003"), "ITM-0007", "A4 printer paper", "pcs", 40.00m, 380.00m, 68.40m, 448.40m),
        });
    }

    // CONTRACT STUB — replaced in T14
    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("purchases/by-item/export", Name = "PurchasesByItemExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult PurchasesByItemExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Export("Purchases by Item", $"purchases-by-item-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx", "Item");
    }

    // CONTRACT STUB — replaced in T14
    [HttpGet("purchases/transactions")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<PaginatedResponse<PurchaseTransactionLine>> PurchaseTransactions(
        Guid companyId,
        [FromQuery] DateOnly from,
        [FromQuery] DateOnly to,
        [FromQuery] Guid? partnerId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null,
        [FromQuery] string? sort = null)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        var items = new List<PurchaseTransactionLine>
        {
            new(new DateOnly(2026, 1, 2), "BILL-0001", "Bill", "Prime Properties L.L.C.", null, "Office rent January 2026", 1.00m, 1000.00m, 1000.00m, 180.00m, 1180.00m),
            new(new DateOnly(2026, 1, 8), "BILL-0005", "Bill", "Kosova Office Supplies SH.P.K.", "ITM-0007", "A4 printer paper", 40.00m, 9.50m, 380.00m, 68.40m, 448.40m),
            new(new DateOnly(2026, 1, 15), "BILL-0002", "Bill", "KEDS J.S.C.", "SRV-ELE", "Electricity", 1200.00m, 0.169492m, 203.39m, 36.61m, 240.00m),
            new(new DateOnly(2026, 1, 20), "BILL-0006", "Bill", "Telekomi i Kosoves J.S.C.", "SRV-NET", "Internet and telephony", 1.00m, 300.00m, 300.00m, 54.00m, 354.00m),
        };
        return Ok(new PaginatedResponse<PurchaseTransactionLine>(items, items.Count, 1, 50));
    }

    // CONTRACT STUB — replaced in T14
    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("purchases/transactions/export", Name = "PurchaseTransactionsExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult PurchaseTransactionsExport(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] Guid? partnerId)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Export("Purchase Transactions", $"purchase-transactions-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx", "Date");
    }
}
