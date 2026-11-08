using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// The home dashboard: figures for a period with an optional comparison period, and the company's
// saved widget layout. Any member may read it; each section is filled only for the areas their
// role can see. Changing the layout needs Settings: Edit.
[ApiController]
[Route("api/companies/{companyId:guid}/dashboard")]
[Authorize]
public class DashboardController : ControllerBase
{
    public const int MaxWidgets = 40;

    // Widget key → the visuals it may be drawn as. Mirrors the web catalogue
    // (apps/web/src/pages/dashboard/catalog.ts); unknown keys or visuals are refused.
    public static readonly IReadOnlyDictionary<string, string[]> Catalog = BuildCatalog();

    private static Dictionary<string, string[]> BuildCatalog()
    {
        var tiles = new[] { "tile", "sparkline", "hero" };
        var catalog = new Dictionary<string, string[]>();
        foreach (var kpi in new[] { "revenue", "expenses", "netProfit", "grossProfit", "netMargin", "cash", "receivables",
                     "payables", "overdueReceivables", "overduePayables", "salesNet", "purchasesNet", "invoiceCount",
                     "averageInvoice", "payrollCost", "headcount", "stockValue", "lowStock", "stockMargin" })
        {
            catalog[$"kpi.{kpi}"] = tiles;
        }
        catalog["revenueTrend"] = ["line", "area", "column"];
        catalog["revenueVsExpenses"] = ["column", "line"];
        catalog["profitTrend"] = ["column", "line", "area"];
        catalog["cashTrend"] = ["area", "line"];
        catalog["payrollTrend"] = ["column", "line"];
        catalog["revenueBreakdown"] = ["bar", "stacked", "table"];
        catalog["expenseBreakdown"] = ["bar", "stacked", "table"];
        catalog["topCustomers"] = ["bar", "table"];
        catalog["topVendors"] = ["bar", "table"];
        catalog["topItems"] = ["bar", "table"];
        catalog["receivablesAging"] = ["column", "stacked", "table"];
        catalog["payablesAging"] = ["column", "stacked", "table"];
        catalog["headcountByDepartment"] = ["bar", "table"];
        catalog["stockByItem"] = ["bar", "table"];
        return catalog;
    }

    // What a company sees before anyone customises it: the "Owner overview" preset.
    public static readonly List<DashboardWidgetConfig> DefaultWidgets =
    [
        new("kpi.revenue", "sparkline", 1, true),
        new("kpi.netProfit", "sparkline", 1, true),
        new("kpi.cash", "sparkline", 1, true),
        new("kpi.overdueReceivables", "tile", 1, false),
        new("revenueVsExpenses", "column", 4, true),
        new("profitTrend", "line", 2, true),
        new("cashTrend", "area", 2, false),
        new("topCustomers", "bar", 2, true),
        new("expenseBreakdown", "bar", 2, true),
        new("receivablesAging", "column", 2, false),
        new("payablesAging", "column", 2, false),
    ];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly PakoDbContext _db;
    private readonly DashboardService _dashboard;
    private readonly CompanyAccessContext _access;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ExportLabels _labels;

    public DashboardController(PakoDbContext db, DashboardService dashboard, CompanyAccessContext access,
        IStringLocalizer<ErrorMessages> localizer, ExportLabels? labels = null)
    {
        _labels = labels ?? new ExportLabels(localizer);
        _db = db;
        _dashboard = dashboard;
        _access = access;
        _localizer = localizer;
    }

    [HttpGet(Name = "GetDashboard")]
    [RequireCompanyAccess]
    public async Task<ActionResult<DashboardResponse>> Get(
        Guid companyId,
        [FromQuery] DateOnly from,
        [FromQuery] DateOnly to,
        [FromQuery] DateOnly? compareFrom = null,
        [FromQuery] DateOnly? compareTo = null,
        [FromQuery] string? granularity = null)
    {
        if (from > to || to.DayNumber - from.DayNumber > 3660
            || (compareFrom is { } cf && compareTo is { } ct && (cf > ct || ct.DayNumber - cf.DayNumber > 3660)))
        {
            return BadRequest(_localizer["DashboardInvalidPeriod"].Value);
        }

        return Ok(await _dashboard.BuildAsync(companyId, from, to, compareFrom, compareTo, granularity));
    }

    [ProducesPdf]
    [HttpGet("pdf", Name = "GetDashboardPdf")]
    [RequireCompanyAccess]
    public async Task<IActionResult> Pdf(
        Guid companyId,
        [FromQuery] DateOnly from,
        [FromQuery] DateOnly to,
        [FromQuery] DateOnly? compareFrom = null,
        [FromQuery] DateOnly? compareTo = null,
        [FromQuery] string? granularity = null)
    {
        if (from > to || to.DayNumber - from.DayNumber > 3660
            || (compareFrom is { } cf && compareTo is { } ct && (cf > ct || ct.DayNumber - cf.DayNumber > 3660)))
        {
            return BadRequest(new { error = _localizer["DashboardInvalidPeriod"].Value });
        }

        var data = await _dashboard.BuildAsync(companyId, from, to, compareFrom, compareTo, granularity);
        var widgets = DashboardPdfRenderer.Printable((await LoadWidgetsAsync(companyId)).Widgets, data);
        if (widgets.Count == 0)
        {
            return BadRequest(new { error = _localizer["DashboardPdfNothing"].Value });
        }

        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
        var bytes = DashboardPdfRenderer.Render(new DashboardPdfInput(
            DocumentIssuer.From(company), LogoBytes(company.LogoUrl), company.FunctionalCurrency, data, widgets,
            key => _labels[key], CultureInfo.CurrentUICulture, PosService.LocalTime(DateTime.UtcNow)));
        return File(bytes, DashboardPdfRenderer.PdfContentType, $"dashboard-{from:yyyyMMdd}-{to:yyyyMMdd}.pdf");
    }

    private static byte[]? LogoBytes(string? logoUrl)
    {
        const string marker = ";base64,";
        if (logoUrl is null || !logoUrl.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)
            || logoUrl.StartsWith("data:image/svg", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        var at = logoUrl.IndexOf(marker, StringComparison.Ordinal);
        try
        {
            return at < 0 ? null : Convert.FromBase64String(logoUrl[(at + marker.Length)..]);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private async Task<DashboardLayoutResponse> LoadWidgetsAsync(Guid companyId)
    {
        var canEdit = _access.LevelFor(AccessModule.Settings) >= AccessLevel.Write;
        var saved = await _db.DashboardLayouts.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);
        if (saved is null)
        {
            return new DashboardLayoutResponse(DefaultWidgets, true, canEdit, null);
        }

        var widgets = JsonSerializer.Deserialize<List<DashboardWidgetConfig>>(saved.WidgetsJson, Json) ?? [];
        widgets = widgets.Where(w => Catalog.TryGetValue(w.Key, out var visuals) && visuals.Contains(w.Visual)).ToList();
        return new DashboardLayoutResponse(widgets, false, canEdit, saved.UpdatedAt);
    }

    [HttpGet("layout", Name = "GetDashboardLayout")]
    [RequireCompanyAccess]
    public async Task<ActionResult<DashboardLayoutResponse>> GetLayout(Guid companyId)
    {
        return Ok(await LoadWidgetsAsync(companyId));
    }

    [HttpPut("layout", Name = "SaveDashboardLayout")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    public async Task<ActionResult<DashboardLayoutResponse>> SaveLayout(Guid companyId, SaveDashboardLayoutRequest request)
    {
        var widgets = request.Widgets ?? [];
        if (widgets.Count > MaxWidgets
            || widgets.Any(w => !Catalog.TryGetValue(w.Key ?? string.Empty, out var visuals) || !visuals.Contains(w.Visual)
                || w.Size is < 1 or > 4))
        {
            return BadRequest(_localizer["DashboardInvalidLayout"].Value);
        }

        var layout = await _db.DashboardLayouts.FirstOrDefaultAsync(d => d.CompanyId == companyId);
        if (layout is null)
        {
            layout = new DashboardLayout { Id = Guid.NewGuid(), CompanyId = companyId };
            _db.DashboardLayouts.Add(layout);
        }
        layout.WidgetsJson = JsonSerializer.Serialize(widgets, Json);
        layout.UpdatedAt = DateTime.UtcNow;
        layout.UpdatedByUserId = _access.UserId;
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (_db.Entry(layout).State == EntityState.Added)
        {
            // Someone saved the company's first layout at the same moment: update theirs instead.
            _db.Entry(layout).State = EntityState.Detached;
            var existing = await _db.DashboardLayouts.FirstAsync(d => d.CompanyId == companyId);
            existing.WidgetsJson = layout.WidgetsJson;
            existing.UpdatedAt = layout.UpdatedAt;
            existing.UpdatedByUserId = layout.UpdatedByUserId;
            await _db.SaveChangesAsync();
            layout = existing;
        }

        return Ok(new DashboardLayoutResponse(widgets, false, true, layout.UpdatedAt));
    }

    // Back to the built-in layout.
    [HttpDelete("layout", Name = "ResetDashboardLayout")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Settings)]
    public async Task<ActionResult<DashboardLayoutResponse>> ResetLayout(Guid companyId)
    {
        var saved = await _db.DashboardLayouts.Where(d => d.CompanyId == companyId).ToListAsync();
        _db.DashboardLayouts.RemoveRange(saved);
        await _db.SaveChangesAsync();
        return Ok(new DashboardLayoutResponse(DefaultWidgets, true, true, null));
    }
}
