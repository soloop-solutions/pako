using System.Globalization;
using System.Reflection;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Tests;

public class ExportValidationTests : IAsyncLifetime
{
    private static readonly DateOnly Jan = new(2026, 1, 1);
    private static readonly DateOnly Oct = new(2026, 10, 31);

    private PakoDbContext _db = null!;
    private Guid _companyId;

    public async Task InitializeAsync()
    {
        _db = await PostgresTestDatabase.CreateAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        _db.Companies.Add(company);
        await _db.SaveChangesAsync();
        _companyId = company.Id;
    }

    public async Task DisposeAsync() => await _db.DisposeAsync();

    private static ExportLabels Labels() => new(new NullStringLocalizer<ErrorMessages>());
    private static NullStringLocalizer<ErrorMessages> Loc() => new();

    private record Case(string Name, MethodInfo Action, Func<ExportValidationTests, Task<IActionResult>> Run, string MessageKey);

    private static MethodInfo M<T>(string name) => typeof(T).GetMethod(name)!;

    private static IEnumerable<Case> Cases()
    {
        const string Range = "ReportDateRangeInvalid";
        yield return new("TrialBalance", M<LedgerController>("TrialBalanceExport"),
            t => new LedgerController(t._db, Loc(), Labels()).TrialBalanceExport(t._companyId, Oct, Jan), Range);
        yield return new("GeneralLedger", M<GeneralLedgerReportController>("GeneralLedgerExport"),
            t => new GeneralLedgerReportController(t._db, Loc(), CompanyAccessContext.Unrestricted(), Labels()).GeneralLedgerExport(t._companyId, Oct, Jan, null, null), Range);
        yield return new("ExpenseBook", M<ExpenseBookController>("ExpenseBookExport"),
            t => new ExpenseBookController(t._db, Loc(), CompanyAccessContext.Unrestricted(), Labels()).ExpenseBookExport(t._companyId, Oct, Jan), Range);
        yield return new("CashFlow", M<StatementReportsController>("CashFlowExport"),
            t => new StatementReportsController(Loc(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(t._db), Labels()).CashFlowExport(t._companyId, Oct, Jan), Range);
        yield return new("EquityStatement", M<StatementReportsController>("EquityStatementExport"),
            t => new StatementReportsController(Loc(), CompanyAccessContext.Unrestricted(), new LedgerAggregator(t._db), Labels()).EquityStatementExport(t._companyId, Oct, Jan), Range);
        yield return new("VendorSynthetic", M<PayablesReportsController>("VendorSyntheticExport"),
            t => Payables(t).VendorSyntheticExport(t._companyId, Oct, Jan, true), Range);
        yield return new("VendorStatement", M<PayablesReportsController>("VendorStatementExport"),
            t => Payables(t).VendorStatementExport(t._companyId, Guid.NewGuid(), Oct, Jan), Range);
        yield return new("PurchasesByVendor", M<PayablesReportsController>("PurchasesByVendorExport"),
            t => Payables(t).PurchasesByVendorExport(t._companyId, Oct, Jan), Range);
        yield return new("PurchasesByItem", M<PayablesReportsController>("PurchasesByItemExport"),
            t => Payables(t).PurchasesByItemExport(t._companyId, Oct, Jan), Range);
        yield return new("PurchaseTransactions", M<PayablesReportsController>("PurchaseTransactionsExport"),
            t => Payables(t).PurchaseTransactionsExport(t._companyId, Oct, Jan, null), Range);
        yield return new("VatDeclarationMonth", M<VatDeclarationController>("Export"),
            t => Vat(t).Export(t._companyId, 2026, 13), "VatDeclarationPeriodInvalid");
        yield return new("VatDeclarationRefund", M<VatDeclarationController>("Export"),
            t => Vat(t).Export(t._companyId, 2026, 10, null, 5m), "VatDeclarationRefundInvalid");
    }

    private static PayablesReportsController Payables(ExportValidationTests t) =>
        new(Loc(), CompanyAccessContext.Unrestricted(), new VendorLedgerService(t._db, CompanyAccessContext.Unrestricted()), Labels());

    private static VatDeclarationController Vat(ExportValidationTests t) =>
        new(t._db, Loc(), CompanyAccessContext.Unrestricted(), Labels());

    public static IEnumerable<object[]> CaseNames() => Cases().Select(c => new object[] { c.Name });

    [Theory]
    [MemberData(nameof(CaseNames))]
    public async Task Export_InvalidParameters_Returns400WithLocalizedError(string name)
    {
        var c = Cases().Single(x => x.Name == name);
        foreach (var (culture, expectedPrefix) in new[] { ("en", "The "), ("sq", "") })
        {
            var previous = CultureInfo.CurrentUICulture;
            CultureInfo.CurrentUICulture = new CultureInfo(culture);
            try
            {
                var expected = Loc()[c.MessageKey].Value;
                Assert.NotEqual(c.MessageKey, expected);
                var result = await c.Run(this);

                var (status, body) = await ExecuteThroughMvcAsync(c.Action, result);

                Assert.Equal(400, status);
                Assert.Contains(expected, body);
                Assert.StartsWith(expectedPrefix, expected);
            }
            finally
            {
                CultureInfo.CurrentUICulture = previous;
            }
        }
    }

    [Fact]
    public void EveryExportActionUsesTheNegotiationSafeAttribute()
    {
        var offenders = typeof(ReportsController).Assembly.GetTypes()
            .Where(t => typeof(ControllerBase).IsAssignableFrom(t))
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            .Where(m => m.GetCustomAttributes<ProducesAttribute>().Any(a => a.GetType() == typeof(ProducesAttribute) && a.ContentTypes.Contains(ExcelExportService.XlsxContentType)))
            .Select(m => $"{m.DeclaringType!.Name}.{m.Name}")
            .ToList();

        Assert.Empty(offenders);
    }

    private static async Task<(int Status, string Body)> ExecuteThroughMvcAsync(MethodInfo action, IActionResult result)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddControllers();
        var provider = services.BuildServiceProvider();

        var http = new DefaultHttpContext { RequestServices = provider };
        var body = new MemoryStream();
        http.Response.Body = body;
        var actionContext = new ActionContext(http, new RouteData(), new ActionDescriptor());

        var executing = new ResultExecutingContext(actionContext, new List<IFilterMetadata>(), result, new object());
        foreach (var filter in action.GetCustomAttributes().OfType<IResultFilter>())
        {
            filter.OnResultExecuting(executing);
        }

        await result.ExecuteResultAsync(actionContext);
        return (http.Response.StatusCode, Encoding.UTF8.GetString(body.ToArray()));
    }
}
