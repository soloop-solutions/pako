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
public class StatementReportsController : ControllerBase
{
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;

    public StatementReportsController(IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access)
    {
        _localizer = localizer;
        _access = access;
    }

    private ObjectResult ReportNotAvailableForScopedUser() =>
        StatusCode(StatusCodes.Status403Forbidden, _localizer["ReportNotAvailableForScopedUser"].Value);

    private static Guid Id(int n) => new($"5b1f0c2e-1a11-4c01-9a03-{n:D12}");

    private IActionResult StubExport(string sheet, string file) =>
        File(ExcelExportService.BuildWorkbook(sheet, new[] { "Report" }, new List<IReadOnlyList<object?>> { new object?[] { "stub" } }),
            ExcelExportService.XlsxContentType, file);

    [HttpGet("general-ledger")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<PaginatedResponse<GeneralLedgerLine>> GeneralLedger(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] Guid? accountId, [FromQuery] Guid? partnerId,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null, [FromQuery] string? sort = null)
    {
        // CONTRACT STUB — replaced in T4
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        var entryId = Guid.Parse("5b1f0c2e-1a11-4c01-9a01-000000000001");
        var partner = Guid.Parse("5b1f0c2e-1a11-4c01-9a02-000000000001");
        var items = new List<GeneralLedgerLine>
        {
            new(entryId, "JE-2026-0001", new DateOnly(2026, 1, 5), "INV-0001", "120", "Trade receivables", partner, "Alba Trade SH.P.K.", "Sales invoice INV-0001", 1180.00m, 0.00m),
            new(entryId, "JE-2026-0001", new DateOnly(2026, 1, 5), "INV-0001", "701", "Revenue from sales", null, null, "Sales invoice INV-0001", 0.00m, 1000.00m),
            new(entryId, "JE-2026-0001", new DateOnly(2026, 1, 5), "INV-0001", "450", "VAT payable", null, null, "Sales invoice INV-0001", 0.00m, 180.00m),
        };
        return Ok(new PaginatedResponse<GeneralLedgerLine>(items, 3, 1, 50));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("general-ledger/export", Name = "GeneralLedgerExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult GeneralLedgerExport(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] Guid? accountId, [FromQuery] Guid? partnerId)
    {
        // CONTRACT STUB — replaced in T4
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return StubExport("General Ledger", $"general-ledger-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("profit-and-loss/monthly")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<MonthlyProfitAndLossResponse> MonthlyProfitAndLoss(Guid companyId, [FromQuery] int year)
    {
        // CONTRACT STUB — replaced in T6
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        static List<decimal> M(params decimal[] v) => v.ToList();
        var income = new MonthlyReportLine(Id(701), "701", "Revenue from sales",
            M(10000, 12000, 11000, 13000, 12000, 14000, 13000, 12000, 15000, 14000, 13000, 16000), 155000.00m);
        var cost = new MonthlyReportLine(Id(601), "601", "Cost of goods sold",
            M(4000, 4800, 4400, 5200, 4800, 5600, 5200, 4800, 6000, 5600, 5200, 6400), 62000.00m);
        var rent = new MonthlyReportLine(Id(621), "621", "Rent", M(1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000), 12000.00m);
        var salaries = new MonthlyReportLine(Id(622), "622", "Salaries", M(3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000), 36000.00m);
        return Ok(new MonthlyProfitAndLossResponse(2026,
            new() { income }, new() { cost }, new() { rent, salaries },
            M(6000, 7200, 6600, 7800, 7200, 8400, 7800, 7200, 9000, 8400, 7800, 9600),
            M(2000, 3200, 2600, 3800, 3200, 4400, 3800, 3200, 5000, 4400, 3800, 5600),
            93000.00m, 45000.00m));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("profit-and-loss/monthly/export", Name = "MonthlyProfitAndLossExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult MonthlyProfitAndLossExport(Guid companyId, [FromQuery] int year)
    {
        // CONTRACT STUB — replaced in T6
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return StubExport("Monthly P&L", $"profit-and-loss-monthly-{year}.xlsx");
    }

    [HttpGet("balance-sheet/comparative")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<BalanceSheetComparativeResponse> BalanceSheetComparative(
        Guid companyId, [FromQuery] DateOnly asOf, [FromQuery] DateOnly compareTo)
    {
        // CONTRACT STUB — replaced in T6
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Ok(new BalanceSheetComparativeResponse(new DateOnly(2026, 12, 31), new DateOnly(2025, 12, 31),
            new()
            {
                new(Id(100), "100", "Cash and bank", 45000.00m, 30000.00m, 15000.00m),
                new(Id(120), "120", "Trade receivables", 25000.00m, 20000.00m, 5000.00m),
                new(Id(210), "210", "Fixed assets", 60000.00m, 50000.00m, 10000.00m),
            },
            new()
            {
                new(Id(400), "400", "Trade payables", 20000.00m, 15000.00m, 5000.00m),
                new(Id(410), "410", "Bank loan", 40000.00m, 40000.00m, 0.00m),
            },
            new()
            {
                new(Id(500), "500", "Share capital", 10000.00m, 10000.00m, 0.00m),
                new(Id(560), "560", "Retained earnings", 60000.00m, 35000.00m, 25000.00m),
            },
            130000.00m, 130000.00m));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("balance-sheet/comparative/export", Name = "BalanceSheetComparativeExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult BalanceSheetComparativeExport(
        Guid companyId, [FromQuery] DateOnly asOf, [FromQuery] DateOnly compareTo)
    {
        // CONTRACT STUB — replaced in T6
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return StubExport("Comparative Balance Sheet", $"balance-sheet-comparative-{asOf:yyyyMMdd}.xlsx");
    }

    [HttpGet("cash-flow")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<CashFlowResponse> CashFlow(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T7
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Ok(new CashFlowResponse(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), 30000.00m, 45000.00m,
            new() { new(Id(120), "120", "Trade receivables", -5000.00m), new(Id(400), "400", "Trade payables", 5000.00m) },
            new() { new(Id(210), "210", "Fixed assets", -10000.00m) },
            new() { new(Id(560), "560", "Retained earnings (dividends paid)", -20000.00m) },
            15000.00m, 45000.00m, 0.00m));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("cash-flow/export", Name = "CashFlowExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult CashFlowExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T7
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return StubExport("Cash Flow", $"cash-flow-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("equity-statement")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<EquityStatementResponse> EquityStatement(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T7
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Ok(new EquityStatementResponse(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), 45000.00m, 45000.00m,
            new() { new(Id(560), "560", "Retained earnings (dividends paid)", -20000.00m) },
            70000.00m));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("equity-statement/export", Name = "EquityStatementExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult EquityStatementExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T7
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return StubExport("Equity Statement", $"equity-statement-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("expense-book")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<ExpenseBookResponse> ExpenseBook(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T8
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        static Guid E(int n) => new($"5b1f0c2e-1a11-4c01-9a01-{n:D12}");
        return Ok(new ExpenseBookResponse(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 31),
            new()
            {
                new(Id(621), "621", "Rent"),
                new(Id(622), "622", "Salaries"),
                new(Id(631), "631", "Utilities"),
            },
            new()
            {
                new(E(11), new DateOnly(2026, 1, 2), "BILL-0001", "Prime Properties L.L.C.", new() { 1000.00m, 0.00m, 0.00m }, 1000.00m),
                new(E(12), new DateOnly(2026, 1, 31), null, null, new() { 0.00m, 3000.00m, 0.00m }, 3000.00m),
                new(E(13), new DateOnly(2026, 1, 15), "BILL-0002", "KEDS J.S.C.", new() { 0.00m, 0.00m, 240.00m }, 240.00m),
            },
            new() { 1000.00m, 3000.00m, 240.00m }));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("expense-book/export", Name = "ExpenseBookExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult ExpenseBookExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T8
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return StubExport("Expense Book", $"expense-book-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("checks")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<ReportChecksResponse> Checks(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T9
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Ok(new ReportChecksResponse(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), new()
        {
            new("trialBalanceBalanced", true, 0.00m, 0.00m),
            new("balanceSheetBalanced", true, 130000.00m, 130000.00m),
            new("cashFlowReconciles", true, 45000.00m, 45000.00m),
        }));
    }
}
