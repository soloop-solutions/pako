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

    public ReportsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, LedgerAggregator ledger)
    {
        _db = db;
        _localizer = localizer;
        _access = access;
        _ledger = ledger;
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

        var headers = new[] { "Section", "Account Code", "Account Name", "Amount" };
        var rows = new List<IReadOnlyList<object?>>();
        rows.AddRange(response.Income.Select(l => (IReadOnlyList<object?>)new object?[] { "Income", l.AccountCode, l.AccountName, l.Amount }));
        rows.Add(new object?[] { "Income", null, "Total Income", response.TotalIncome });
        rows.AddRange(response.Expenses.Select(l => (IReadOnlyList<object?>)new object?[] { "Expenses", l.AccountCode, l.AccountName, l.Amount }));
        rows.Add(new object?[] { "Expenses", null, "Total Expenses", response.TotalExpenses });
        rows.Add(new object?[] { null, null, "Net Income", response.NetIncome });

        var bytes = ExcelExportService.BuildWorkbook("Profit and Loss", headers, rows);
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

        var sums = await _ledger.SumsByAccountAsync(companyId, from: null, to: asOf);

        var assets = sums.Where(s => AccountTypeDerivation.IsAsset(s.Account.AccountType))
            .Select(s => new ReportLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Debit - s.Credit))
            .OrderBy(l => l.AccountCode)
            .ToList();
        var liabilities = sums.Where(s => AccountTypeDerivation.IsLiability(s.Account.AccountType))
            .Select(s => new ReportLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Credit - s.Debit))
            .OrderBy(l => l.AccountCode)
            .ToList();
        // CurrentYearEarnings is excluded here and added back below as a computed line — R05
        // blocks manual postings to it, so its own ledger balance is always zero; the real net
        // income figure is what belongs on the balance sheet, attributed to that real account.
        var equity = sums.Where(s => s.Account.AccountType == AccountType.Equity)
            .Select(s => new ReportLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Credit - s.Debit))
            .OrderBy(l => l.AccountCode)
            .ToList();

        // B13: the real CurrentYearEarnings account (304100) every v2-seeded company has, rather
        // than a synthetic Guid.Empty/"3999" row — falls back to the old synthetic row only if a
        // company genuinely has none (the legacy 16-account template some tests still seed from).
        var currentEarnings = LedgerAggregator.NetIncome(sums);
        var currentYearEarningsAccount = await _db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.CompanyId == companyId && a.AccountType == AccountType.CurrentYearEarnings);
        equity.Add(currentYearEarningsAccount is { } cye
            ? new ReportLine(cye.Id, cye.Code, cye.Name, currentEarnings)
            : new ReportLine(Guid.Empty, "3999", "Current Earnings", currentEarnings));

        var totalAssets = assets.Sum(l => l.Amount);
        var totalLiabilities = liabilities.Sum(l => l.Amount);
        var totalEquity = equity.Sum(l => l.Amount);

        return Ok(new BalanceSheetResponse(
            asOf, assets, liabilities, equity, currentEarnings, totalAssets, totalLiabilities, totalEquity));
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

        var headers = new[] { "Section", "Account Code", "Account Name", "Amount" };
        var rows = new List<IReadOnlyList<object?>>();
        rows.AddRange(response.Assets.Select(l => (IReadOnlyList<object?>)new object?[] { "Assets", l.AccountCode, l.AccountName, l.Amount }));
        rows.Add(new object?[] { "Assets", null, "Total Assets", response.TotalAssets });
        rows.AddRange(response.Liabilities.Select(l => (IReadOnlyList<object?>)new object?[] { "Liabilities", l.AccountCode, l.AccountName, l.Amount }));
        rows.Add(new object?[] { "Liabilities", null, "Total Liabilities", response.TotalLiabilities });
        rows.AddRange(response.Equity.Select(l => (IReadOnlyList<object?>)new object?[] { "Equity", l.AccountCode, l.AccountName, l.Amount }));
        rows.Add(new object?[] { "Equity", null, "Total Equity", response.TotalEquity });

        var bytes = ExcelExportService.BuildWorkbook("Balance Sheet", headers, rows);
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

        var repartitionAccountsByTax = (await _db.TaxRepartitionLines.AsNoTracking()
                .Select(r => new { r.TaxDefinitionId, r.AccountId })
                .ToListAsync())
            .Select(r => (r.TaxDefinitionId, r.AccountId))
            .ToHashSet();

        var taxedLines = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted
                && l.JournalEntry.Date >= from && l.JournalEntry.Date <= to
                && l.TaxId != null)
            .Select(l => new { TaxId = l.TaxId!.Value, l.AccountId, l.Debit, l.Credit })
            .ToListAsync();

        var taxPostingLines = taxedLines.Where(l => repartitionAccountsByTax.Contains((l.TaxId, l.AccountId)));

        var grouped = taxPostingLines
            .GroupBy(l => l.TaxId)
            .Select(g => new { TaxDefinitionId = g.Key, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) })
            .ToList();

        var taxDefinitionIds = grouped.Select(g => g.TaxDefinitionId).ToList();
        var taxDefinitions = await _db.TaxDefinitions.AsNoTracking()
            .Where(t => taxDefinitionIds.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id);

        var output = new List<VatReturnLine>();
        var input = new List<VatReturnLine>();

        foreach (var g in grouped)
        {
            if (!taxDefinitions.TryGetValue(g.TaxDefinitionId, out var taxDefinition))
            {
                continue;
            }

            if (taxDefinition.Scope == TaxScope.Sale)
            {
                output.Add(new VatReturnLine(taxDefinition.Id, taxDefinition.Name, taxDefinition.Rate, g.Credit - g.Debit));
            }
            else if (taxDefinition.Scope == TaxScope.Purchase)
            {
                input.Add(new VatReturnLine(taxDefinition.Id, taxDefinition.Name, taxDefinition.Rate, g.Debit - g.Credit));
            }
        }

        output = output.OrderBy(l => l.Name).ToList();
        input = input.OrderBy(l => l.Name).ToList();

        var totalOutput = output.Sum(l => l.Amount);
        var totalInput = input.Sum(l => l.Amount);

        return Ok(new VatReturnResponse(from, to, output, input, totalOutput, totalInput, totalOutput - totalInput));
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

        var headers = new[] { "Direction", "Tax Code", "Rate", "Amount" };
        var rows = new List<IReadOnlyList<object?>>();
        rows.AddRange(response.OutputVat.Select(l => (IReadOnlyList<object?>)new object?[] { "Output", l.Name, l.Rate, l.Amount }));
        rows.Add(new object?[] { "Output", null, "Total Output VAT", response.TotalOutputVat });
        rows.AddRange(response.InputVat.Select(l => (IReadOnlyList<object?>)new object?[] { "Input", l.Name, l.Rate, l.Amount }));
        rows.Add(new object?[] { "Input", null, "Total Input VAT", response.TotalInputVat });
        rows.Add(new object?[] { null, null, "Net VAT Due", response.NetVatDue });

        var bytes = ExcelExportService.BuildWorkbook("VAT Return", headers, rows);
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
        var rows = await BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: true);
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
        var salesRows = await BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: true, includeUnbooked: true);
        var purchaseRows = vatRegistered
            ? await BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: false)
            : new List<TaxBookRow>();
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
        var rows = await BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: false);
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
        var rows = await BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: false, includeUnbooked: true);
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

    private static AtkTaxRow ToAtkRow(TaxBookRow r) =>
        new(r.DocumentId, r.DocumentNumber, r.IssueDate, r.PartnerId, r.VatCode, r.Rate, r.NetAmount,
            r.Direction, r.DeductiblePercent, r.IsReverseCharge, r.AtkBook, r.DocumentType);

    private Task<Dictionary<Guid, Partner>> PartnersByIdAsync(IEnumerable<Guid> partnerIds) =>
        _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);

    private record TaxBookRow(
        Guid DocumentId, string? DocumentNumber, DateOnly IssueDate, string DocumentType,
        Guid PartnerId, string VatCode, decimal Rate, decimal NetAmount, decimal VatAmount,
        TaxDirection? Direction = null, decimal? DeductiblePercent = null, bool IsReverseCharge = false, TaxAtkBook? AtkBook = null);

    // Shared by SalesBook (Invoice-sourced, AtkBook.Shitje, Credit-normal per
    // DocumentLineCalculator's creditsOnNormalSide=true for invoices) and PurchaseBook
    // (Bill-sourced, AtkBook.Blerje/BlerjeImport/BlerjeInvestime, Debit-normal for bills) —
    // same shape, opposite sign convention, exactly mirroring DocumentLineCalculator's own
    // Invoice-vs-Bill split rather than VatReturn's TaxDefinition.Scope (Scope collapses every
    // reverse-charge code to TaxScope.Both, which VatReturn's Sale/Purchase branches silently
    // drop — this method sources the sign from which document type owns the entry instead, so it
    // doesn't inherit that gap).
    private async Task<List<TaxBookRow>> BuildTaxBookRowsAsync(Guid companyId, DateOnly from, DateOnly to, bool isSalesBook, bool includeUnbooked = false)
    {
        var atkBooks = isSalesBook
            ? new[] { TaxAtkBook.Shitje }
            : new[] { TaxAtkBook.Blerje, TaxAtkBook.BlerjeImport, TaxAtkBook.BlerjeInvestime };

        var taxDefinitions = await _db.TaxDefinitions.AsNoTracking()
            .Where(t => t.CompanyId == companyId && t.AtkBook != null && atkBooks.Contains(t.AtkBook!.Value))
            .Include(t => t.RepartitionLines)
            .ToListAsync();
        var taxDefinitionsById = taxDefinitions.ToDictionary(t => t.Id);
        var taxIds = taxDefinitionsById.Keys.ToHashSet();
        var repartitionAccountsByTax = taxDefinitions
            .SelectMany(t => t.RepartitionLines.Select(r => (t.Id, r.AccountId)))
            .ToHashSet();

        var defaults = await _db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);
        var reverseChargeInputAccountId = defaults?.ReverseChargeInputVatAccountId;
        var reverseChargeOutputAccountId = defaults?.ReverseChargeOutputVatAccountId;

        List<(Guid DocumentId, string? DocumentNumber, DateOnly IssueDate, string DocumentType, Guid PartnerId, Guid? JournalEntryId)> documents;
        if (isSalesBook)
        {
            documents = (await _db.Invoices.AsNoTracking().VisibleTo(_access)
                    .Where(i => i.CompanyId == companyId && i.State == InvoiceState.Posted && i.IssueDate >= from && i.IssueDate <= to)
                    .Select(i => new { i.Id, i.InvoiceNumber, i.IssueDate, i.DocumentType, i.PartnerId, i.JournalEntryId })
                    .ToListAsync())
                .Select(i => (i.Id, i.InvoiceNumber, i.IssueDate, i.DocumentType.ToString(), i.PartnerId, i.JournalEntryId))
                .ToList();
        }
        else
        {
            documents = (await _db.Bills.AsNoTracking().VisibleTo(_access)
                    .Where(b => b.CompanyId == companyId && b.State == Pako.Domain.Bills.BillState.Posted && b.IssueDate >= from && b.IssueDate <= to)
                    .Select(b => new { b.Id, b.VendorReference, b.IssueDate, b.DocumentType, b.PartnerId, b.JournalEntryId })
                    .ToListAsync())
                .Select(b => (b.Id, b.VendorReference, b.IssueDate, b.DocumentType.ToString(), b.PartnerId, b.JournalEntryId))
                .ToList();
        }

        var journalEntryIds = documents.Where(d => d.JournalEntryId != null).Select(d => d.JournalEntryId!.Value).ToList();
        var lines = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => journalEntryIds.Contains(l.JournalEntryId) && l.TaxId != null && taxIds.Contains(l.TaxId!.Value))
            .Select(l => new { l.JournalEntryId, TaxId = l.TaxId!.Value, l.AccountId, l.Debit, l.Credit })
            .ToListAsync();
        var linesByJournalEntry = lines.ToLookup(l => l.JournalEntryId);

        var rows = new List<TaxBookRow>();
        foreach (var doc in documents)
        {
            if (doc.JournalEntryId is not { } jeId)
            {
                continue;
            }

            foreach (var taxGroup in linesByJournalEntry[jeId].GroupBy(l => l.TaxId))
            {
                var taxDefinition = taxDefinitionsById[taxGroup.Key];
                var net = 0m;
                var vat = 0m;

                foreach (var line in taxGroup)
                {
                    var signedAmount = isSalesBook ? line.Credit - line.Debit : line.Debit - line.Credit;

                    // Known limitation: RC18/RC00 (reverse charge) post two self-balancing lines —
                    // debit input VAT, credit output VAT, same amount — so only the input side
                    // counts toward this book's VAT figure; the output side is excluded from both
                    // buckets rather than miscounted as a net purchase amount. VatReturn has the
                    // same reverse-charge gap today (Scope.Both matches neither of its Sale/
                    // Purchase branches, so these codes are silently absent there entirely) — this
                    // book is a strict improvement: the document still appears, net amount intact.
                    if (reverseChargeOutputAccountId is { } outId && line.AccountId == outId)
                    {
                        continue;
                    }

                    if (reverseChargeInputAccountId is { } inId && line.AccountId == inId)
                    {
                        vat += signedAmount;
                    }
                    else if (repartitionAccountsByTax.Contains((taxGroup.Key, line.AccountId)))
                    {
                        vat += signedAmount;
                    }
                    else
                    {
                        net += signedAmount;
                    }
                }

                if (net == 0m && vat == 0m)
                {
                    continue;
                }

                rows.Add(new TaxBookRow(
                    doc.DocumentId, doc.DocumentNumber, doc.IssueDate, doc.DocumentType,
                    doc.PartnerId, taxDefinition.Code ?? string.Empty, taxDefinition.Rate, net, vat,
                    taxDefinition.Direction, taxDefinition.DeductiblePercent, taxDefinition.IsReverseCharge, taxDefinition.AtkBook));
            }
        }

        if (includeUnbooked)
        {
            var allTaxDefinitions = await _db.TaxDefinitions.AsNoTracking()
                .Where(t => t.CompanyId == companyId)
                .Include(t => t.RepartitionLines)
                .ToListAsync();
            var taxAccountIds = allTaxDefinitions.SelectMany(t => t.RepartitionLines.Select(r => r.AccountId)).ToHashSet();
            if (reverseChargeInputAccountId is { } rcIn) taxAccountIds.Add(rcIn);
            if (reverseChargeOutputAccountId is { } rcOut) taxAccountIds.Add(rcOut);

            var bookAccountIds = (await _db.Accounts.AsNoTracking()
                    .Where(a => a.CompanyId == companyId && !a.IsControl)
                    .Select(a => new { a.Id, a.AccountType })
                    .ToListAsync())
                .Where(a => !taxAccountIds.Contains(a.Id) && (isSalesBook
                    ? AccountTypeDerivation.IsIncome(a.AccountType)
                    : (AccountTypeDerivation.IsExpense(a.AccountType) && a.AccountType != AccountType.Depreciation)
                        || a.AccountType is AccountType.FixedAsset or AccountType.NonCurrentAsset or AccountType.CurrentAsset))
                .Select(a => a.Id)
                .ToHashSet();

            var entryIds = documents.Where(d => d.JournalEntryId != null).Select(d => d.JournalEntryId!.Value).ToList();
            var unbookedLines = await _db.JournalEntryLines.AsNoTracking()
                .Where(l => entryIds.Contains(l.JournalEntryId) && bookAccountIds.Contains(l.AccountId)
                    && (l.TaxId == null || !taxIds.Contains(l.TaxId.Value)))
                .Select(l => new { l.JournalEntryId, l.Debit, l.Credit })
                .ToListAsync();
            var netByEntry = unbookedLines
                .GroupBy(l => l.JournalEntryId)
                .ToDictionary(g => g.Key, g => g.Sum(l => isSalesBook ? l.Credit - l.Debit : l.Debit - l.Credit));

            foreach (var doc in documents)
            {
                var net = doc.JournalEntryId is { } entryId ? netByEntry.GetValueOrDefault(entryId) : 0m;
                var hasRows = rows.Any(r => r.DocumentId == doc.DocumentId);
                if (net != 0m || !hasRows)
                {
                    rows.Add(new TaxBookRow(
                        doc.DocumentId, doc.DocumentNumber, doc.IssueDate, doc.DocumentType,
                        doc.PartnerId, string.Empty, 0m, net, 0m));
                }
            }
        }

        return rows;
    }

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
            .Where(i => i.CompanyId == companyId && i.State == InvoiceState.Posted
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
        var reconciledByInvoiceId = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.InvoiceId != null && invoiceIds.Contains(r.InvoiceId.Value))
            .GroupBy(r => r.InvoiceId!.Value)
            .Select(g => new { InvoiceId = g.Key, Reconciled = g.Sum(r => r.Amount) })
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
