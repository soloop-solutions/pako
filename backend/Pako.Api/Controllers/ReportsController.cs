using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/reports")]
[Authorize]
public class ReportsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;
    private readonly LedgerAggregator _ledger;
    private readonly TaxReportService _tax;
    private readonly ExportLabels _labels;

    public ReportsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, LedgerAggregator ledger, ExportLabels labels)
    {
        _labels = labels;
        _db = db;
        _localizer = localizer;
        _access = access;
        _ledger = ledger;
        _tax = new TaxReportService(db, access);
    }

    // HR module: the sales/purchase books and debt aging are per-document and are filtered to the
    // caller's visible partners. Every other report is a whole-ledger aggregate that can't be
    // partner-filtered without misstating it (hidden contra lines), so a partner-scoped user is
    // refused outright. Exports call their JSON action, so they inherit the same 403.
    private ObjectResult ReportNotAvailableForScopedUser() =>
        StatusCode(StatusCodes.Status403Forbidden, _localizer["ReportNotAvailableForScopedUser"].Value);

    [HttpGet("profit-and-loss")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<ProfitAndLossResponse>> ProfitAndLoss(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        var sums = await _ledger.SumsByAccountAsync(companyId, from, to);

        var income = sums.Where(s => AccountTypeDerivation.IsIncome(s.Account.AccountType))
            .Select(s => new ReportLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Credit - s.Debit))
            .OrderBy(l => l.AccountCode)
            .ToList();
        var expenses = sums.Where(s => AccountTypeDerivation.IsExpense(s.Account.AccountType))
            .Select(s => new ReportLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Debit - s.Credit))
            .OrderBy(l => l.AccountCode)
            .ToList();

        var totalIncome = income.Sum(l => l.Amount);
        var totalExpenses = expenses.Sum(l => l.Amount);

        return Ok(new ProfitAndLossResponse(from, to, income, expenses, totalIncome, totalExpenses, totalIncome - totalExpenses));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("profit-and-loss/export", Name = "ProfitAndLossExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> ProfitAndLossExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var result = await ProfitAndLoss(companyId, from, to);
        if (result.Result is not OkObjectResult ok || ok.Value is not ProfitAndLossResponse response)
        {
            return result.Result!;
        }

        var headers = new[] { _labels["Common_Section"], _labels["Common_AccountCode"], _labels["Common_AccountName"], _labels["Common_Amount"] };
        var rows = new List<IReadOnlyList<object?>>();
        var income = _labels["Common_Income"];
        var expenses = _labels["Common_Expenses"];
        rows.AddRange(response.Income.Select(l => (IReadOnlyList<object?>)new object?[] { income, l.AccountCode, l.AccountName, l.Amount }));
        rows.Add(new object?[] { income, null, _labels["Common_TotalIncome"], response.TotalIncome });
        rows.AddRange(response.Expenses.Select(l => (IReadOnlyList<object?>)new object?[] { expenses, l.AccountCode, l.AccountName, l.Amount }));
        rows.Add(new object?[] { expenses, null, _labels["Common_TotalExpenses"], response.TotalExpenses });
        rows.Add(new object?[] { null, null, _labels["Common_NetIncome"], response.NetIncome });

        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_Pnl"], headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"profit-and-loss-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("balance-sheet")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<BalanceSheetResponse>> BalanceSheet(Guid companyId, [FromQuery] DateOnly asOf)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Ok(await _ledger.BalanceSheetAsync(companyId, asOf));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("balance-sheet/export", Name = "BalanceSheetExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> BalanceSheetExport(Guid companyId, [FromQuery] DateOnly asOf)
    {
        var result = await BalanceSheet(companyId, asOf);
        if (result.Result is not OkObjectResult ok || ok.Value is not BalanceSheetResponse response)
        {
            return result.Result!;
        }

        var headers = new[] { _labels["Common_Section"], _labels["Common_AccountCode"], _labels["Common_AccountName"], _labels["Common_Amount"] };
        var rows = new List<IReadOnlyList<object?>>();
        var assets = _labels["Common_Assets"];
        var liabilities = _labels["Common_Liabilities"];
        var equity = _labels["Common_Equity"];
        rows.AddRange(response.Assets.Select(l => (IReadOnlyList<object?>)new object?[] { assets, l.AccountCode, l.AccountName, l.Amount }));
        rows.Add(new object?[] { assets, null, _labels["Common_TotalAssets"], response.TotalAssets });
        rows.AddRange(response.Liabilities.Select(l => (IReadOnlyList<object?>)new object?[] { liabilities, l.AccountCode, l.AccountName, l.Amount }));
        rows.Add(new object?[] { liabilities, null, _labels["Common_TotalLiabilities"], response.TotalLiabilities });
        rows.AddRange(response.Equity.Select(l => (IReadOnlyList<object?>)new object?[] { equity, l.AccountCode, l.AccountName, l.Amount }));
        rows.Add(new object?[] { equity, null, _labels["Common_TotalEquity"], response.TotalEquity });

        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_BalanceSheet"], headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"balance-sheet-{asOf:yyyyMMdd}.xlsx");
    }

    [HttpGet("vat-return")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<VatReturnResponse>> VatReturn(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Ok(await _tax.VatReturnAsync(companyId, from, to));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("vat-return/export", Name = "VatReturnExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> VatReturnExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var result = await VatReturn(companyId, from, to);
        if (result.Result is not OkObjectResult ok || ok.Value is not VatReturnResponse response)
        {
            return result.Result!;
        }

        var headers = new[] { _labels["Vat_Direction"], _labels["Vat_TaxCode"], _labels["Vat_Rate"], _labels["Common_Amount"] };
        var rows = new List<IReadOnlyList<object?>>();
        rows.AddRange(response.OutputVat.Select(l => (IReadOnlyList<object?>)new object?[] { _labels["Vat_Output"], l.Name, l.Rate, l.Amount }));
        rows.Add(new object?[] { _labels["Vat_Output"], null, _labels["Vat_TotalOutput"], response.TotalOutputVat });
        rows.AddRange(response.InputVat.Select(l => (IReadOnlyList<object?>)new object?[] { _labels["Vat_Input"], l.Name, l.Rate, l.Amount }));
        rows.Add(new object?[] { _labels["Vat_Input"], null, _labels["Vat_TotalInput"], response.TotalInputVat });
        rows.Add(new object?[] { null, null, _labels["Vat_NetDue"], response.NetVatDue });

        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_VatReturn"], headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"vat-return-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    // B10: one row per (posted document, VAT code) — see SalesBookLine's own comment for why
    // DocumentType is carried through rather than filtered on, and why that sidesteps the
    // still-open "sales return as nota kreditore" question rather than deciding it here.
    [HttpGet("sales-book")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<SalesBookResponse>> SalesBook(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var rows = await _tax.BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: true);
        var partnersById = await PartnersByIdAsync(rows.Select(r => r.PartnerId));

        var lines = rows
            .OrderBy(r => r.IssueDate).ThenBy(r => r.DocumentNumber)
            .Select(r =>
            {
                var partner = partnersById.GetValueOrDefault(r.PartnerId);
                return new SalesBookLine(
                    r.DocumentId, r.DocumentNumber, r.IssueDate, r.DocumentType, r.PartnerId,
                    partner?.Name ?? string.Empty, partner?.TaxNumber, partner?.FiscalNumber,
                    r.VatCode, r.Rate, r.NetAmount, r.VatAmount, r.NetAmount + r.VatAmount);
            })
            .ToList();

        return Ok(new SalesBookResponse(from, to, lines, lines.Sum(l => l.NetAmount), lines.Sum(l => l.VatAmount), lines.Sum(l => l.GrossAmount)));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("sales-book/export", Name = "SalesBookExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> SalesBookExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var vatRegistered = await ResolveVatRegisteredAsync(companyId);
        var salesRows = await _tax.BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: true, includeUnbooked: true);
        var purchaseRows = vatRegistered
            ? await _tax.BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: false)
            : new List<TaxReportService.TaxBookRow>();
        var partnersById = await PartnersByIdAsync(salesRows.Concat(purchaseRows).Select(r => r.PartnerId));

        var book = AtkBookMapper.SalesBook(
            vatRegistered, salesRows.Select(ToAtkRow), purchaseRows.Select(ToAtkRow), partnersById);

        AddUnplacedHeaders(book.Unplaced);
        var bytes = AtkTaxBookWorkbook.BuildSales(vatRegistered, book.Documents);
        return File(bytes, ExcelExportService.XlsxContentType, $"sales-book-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("purchase-book")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<PurchaseBookResponse>> PurchaseBook(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var rows = await _tax.BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: false);
        var partnersById = await PartnersByIdAsync(rows.Select(r => r.PartnerId));

        var lines = rows
            .OrderBy(r => r.IssueDate).ThenBy(r => r.DocumentNumber)
            .Select(r =>
            {
                var partner = partnersById.GetValueOrDefault(r.PartnerId);
                return new PurchaseBookLine(
                    r.DocumentId, r.DocumentNumber, r.IssueDate, r.DocumentType, r.PartnerId,
                    partner?.Name ?? string.Empty, partner?.TaxNumber, partner?.FiscalNumber,
                    r.VatCode, r.Rate, r.NetAmount, r.VatAmount, r.NetAmount + r.VatAmount);
            })
            .ToList();

        return Ok(new PurchaseBookResponse(from, to, lines, lines.Sum(l => l.NetAmount), lines.Sum(l => l.VatAmount), lines.Sum(l => l.GrossAmount)));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("purchase-book/export", Name = "PurchaseBookExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> PurchaseBookExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var vatRegistered = await ResolveVatRegisteredAsync(companyId);
        var rows = await _tax.BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: false, includeUnbooked: true);
        var partnersById = await PartnersByIdAsync(rows.Select(r => r.PartnerId));

        var book = AtkBookMapper.PurchaseBook(vatRegistered, rows.Select(ToAtkRow), partnersById);

        AddUnplacedHeaders(book.Unplaced);
        var bytes = AtkTaxBookWorkbook.BuildPurchases(vatRegistered, book.Documents);
        return File(bytes, ExcelExportService.XlsxContentType, $"purchase-book-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    private void AddUnplacedHeaders(IReadOnlyList<AtkUnplaced> unplaced)
    {
        if (HttpContext is null)
        {
            return;
        }

        const int maxLength = 1500;
        var items = unplaced
            .Select(u => $"{Ascii(u.DocumentNumber)}|{(u.VatCode.Length == 0 ? "-" : Ascii(u.VatCode))}|{u.NetAmount.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture)}")
            .ToList();
        var list = new System.Text.StringBuilder();
        var included = 0;
        foreach (var item in items)
        {
            if (list.Length + item.Length + 1 > maxLength)
            {
                break;
            }

            list.Append(list.Length == 0 ? item : ";" + item);
            included++;
        }

        if (included < items.Count)
        {
            list.Append($";+{items.Count - included} more");
        }

        Response.Headers["X-Atk-Unplaced-Count"] = unplaced.Count.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (list.Length > 0)
        {
            Response.Headers["X-Atk-Unplaced"] = list.ToString();
        }

        Response.Headers.Append("Access-Control-Expose-Headers", "X-Atk-Unplaced-Count, X-Atk-Unplaced");
    }

    private static string Ascii(string? value) =>
        new((value ?? string.Empty).Where(c => c is > ' ' and < '~' and not (';' or '|')).ToArray());

    private async Task<bool> ResolveVatRegisteredAsync(Guid companyId) =>
        await _db.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.IsVatRegistered).FirstOrDefaultAsync();

    private static AtkTaxRow ToAtkRow(TaxReportService.TaxBookRow r) =>
        new(r.DocumentId, r.DocumentNumber, r.IssueDate, r.PartnerId, r.VatCode, r.Rate, r.NetAmount,
            r.Direction, r.DeductiblePercent, r.IsReverseCharge, r.AtkBook, r.DocumentType);

    private Task<Dictionary<Guid, Partner>> PartnersByIdAsync(IEnumerable<Guid> partnerIds) =>
        _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);

    [HttpGet("cit-addback")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<CitAddBackResponse>> CitAddBack(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        var sums = await _ledger.SumsByAccountAsync(companyId, from, to);

        var nonDeductible = sums.Where(s => s.Account.CitDeductibility == CitDeductibility.Non)
            .Select(s => new ReportLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Debit - s.Credit))
            .OrderBy(l => l.AccountCode)
            .ToList();

        var limitFlagged = sums.Where(s => s.Account.CitDeductibility == CitDeductibility.Limit)
            .Select(s => new CitLimitFlaggedLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Debit - s.Credit, s.Account.CitLimitRule))
            .OrderBy(l => l.AccountCode)
            .ToList();

        return Ok(new CitAddBackResponse(
            from, to, nonDeductible, limitFlagged,
            nonDeductible.Sum(l => l.Amount), limitFlagged.Sum(l => l.Amount)));
    }

    // C6: reporting only — no journal entries here, just bucketing the outstanding balance the
    // reconciliation data already supports. Scoped to Invoice/DebitNote only (a DebitNote posts
    // identically to a normal invoice, see CLAUDE.md's Debit notes section) — CreditNote/
    // DownPayment are source documents netted against other invoices, never "debt" themselves.
    [HttpGet("debt-aging")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<DebtAgingResponse>> DebtAging(Guid companyId, [FromQuery] DateOnly? asOf = null)
    {
        var today = asOf ?? DateOnly.FromDateTime(DateTime.UtcNow);

        var companyDefaultReceivableAccountId = (await _db.CompanyAccountDefaults.AsNoTracking()
            .FirstOrDefaultAsync(d => d.CompanyId == companyId))?.ReceivableAccountId ?? Guid.Empty;

        var invoices = await _db.Invoices.AsNoTracking().VisibleTo(_access)
            .Where(i => i.CompanyId == companyId && i.State == InvoiceState.Posted && i.IssueDate <= today
                && (i.DocumentType == DocumentType.Invoice || i.DocumentType == DocumentType.DebitNote))
            .Select(i => new { i.Id, i.InvoiceNumber, i.PartnerId, i.IssueDate, i.DueDate, i.GraceDays, i.JournalEntryId })
            .ToListAsync();

        // B8: an invoice's AR line lives on its partner's resolved receivable account (override
        // or company default), not on one company-wide account — look each invoice's own partner
        // up so a partner with an override is still found, instead of silently reading 0 and
        // disappearing from the report.
        var partnerIds = invoices.Select(i => i.PartnerId).ToHashSet();
        var partnerReceivableOverridesById = await _db.Partners.AsNoTracking()
            .Where(p => partnerIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.ReceivableAccountId);
        Guid ReceivableAccountFor(Guid partnerId) =>
            partnerReceivableOverridesById.TryGetValue(partnerId, out var overrideId) && overrideId is { } id
                ? id
                : companyDefaultReceivableAccountId;

        var journalEntryIds = invoices.Where(i => i.JournalEntryId != null).Select(i => i.JournalEntryId!.Value).ToList();
        var relevantAccountIds = invoices.Select(i => ReceivableAccountFor(i.PartnerId)).ToHashSet();
        var totalsByJournalEntryAndAccount = (await _db.JournalEntryLines.AsNoTracking()
            .Where(l => journalEntryIds.Contains(l.JournalEntryId) && relevantAccountIds.Contains(l.AccountId))
            .GroupBy(l => new { l.JournalEntryId, l.AccountId })
            .Select(g => new { g.Key.JournalEntryId, g.Key.AccountId, Total = g.Sum(l => l.Debit) })
            .ToListAsync())
            .ToDictionary(g => (g.JournalEntryId, g.AccountId), g => g.Total);

        var invoiceIds = invoices.Select(i => i.Id).ToList();
        var reconciledByInvoiceId = await (
                from r in _db.Reconciliations.AsNoTracking()
                join l in _db.JournalEntryLines.AsNoTracking() on r.JournalEntryLineId equals l.Id
                where r.InvoiceId != null && invoiceIds.Contains(r.InvoiceId.Value) && l.JournalEntry!.Date <= today
                group r by r.InvoiceId!.Value into g
                select new { InvoiceId = g.Key, Reconciled = g.Sum(x => x.Amount) })
            .ToDictionaryAsync(g => g.InvoiceId, g => g.Reconciled);

        var lines = new List<DebtAgingLine>();
        foreach (var invoice in invoices)
        {
            var applicableAccountId = ReceivableAccountFor(invoice.PartnerId);
            var total = invoice.JournalEntryId is { } jeId && totalsByJournalEntryAndAccount.TryGetValue((jeId, applicableAccountId), out var t) ? t : 0m;
            var reconciled = reconciledByInvoiceId.GetValueOrDefault(invoice.Id);
            var outstanding = total - reconciled;
            if (outstanding <= 0.01m)
            {
                continue;
            }

            var graceDeadline = invoice.DueDate.AddDays(invoice.GraceDays ?? 0);
            var bucket = today <= invoice.DueDate ? "Current" : today <= graceDeadline ? "WithinGrace" : "Overdue";

            lines.Add(new DebtAgingLine(
                invoice.Id, invoice.InvoiceNumber, invoice.PartnerId, invoice.IssueDate, invoice.DueDate,
                invoice.GraceDays, outstanding, bucket));
        }

        lines = lines.OrderBy(l => l.DueDate).ToList();

        return Ok(new DebtAgingResponse(
            today,
            lines,
            lines.Where(l => l.Bucket == "Current").Sum(l => l.Outstanding),
            lines.Where(l => l.Bucket == "WithinGrace").Sum(l => l.Outstanding),
            lines.Where(l => l.Bucket == "Overdue").Sum(l => l.Outstanding)));
    }
}
