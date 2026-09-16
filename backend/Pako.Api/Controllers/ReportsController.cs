using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
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

    public ReportsController(PakoDbContext db)
    {
        _db = db;
    }

    [HttpGet("profit-and-loss")]
    [RequireCompanyAccess]
    public async Task<ActionResult<ProfitAndLossResponse>> ProfitAndLoss(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var sums = await SumsByAccountAsync(companyId, from, to);

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

    [HttpGet("balance-sheet")]
    [RequireCompanyAccess]
    public async Task<ActionResult<BalanceSheetResponse>> BalanceSheet(Guid companyId, [FromQuery] DateOnly asOf)
    {
        var sums = await SumsByAccountAsync(companyId, from: null, to: asOf);

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
        var currentEarnings = NetIncome(sums);
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

    [HttpGet("vat-return")]
    [RequireCompanyAccess]
    public async Task<ActionResult<VatReturnResponse>> VatReturn(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
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

    // B10: one row per (posted document, VAT code) — see SalesBookLine's own comment for why
    // DocumentType is carried through rather than filtered on, and why that sidesteps the
    // still-open "sales return as nota kreditore" question rather than deciding it here.
    [HttpGet("sales-book")]
    [RequireCompanyAccess]
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

    [HttpGet("purchase-book")]
    [RequireCompanyAccess]
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

    private Task<Dictionary<Guid, Partner>> PartnersByIdAsync(IEnumerable<Guid> partnerIds) =>
        _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);

    private record TaxBookRow(
        Guid DocumentId, string? DocumentNumber, DateOnly IssueDate, string DocumentType,
        Guid PartnerId, string VatCode, decimal Rate, decimal NetAmount, decimal VatAmount);

    // Shared by SalesBook (Invoice-sourced, AtkBook.Shitje, Credit-normal per
    // DocumentLineCalculator's creditsOnNormalSide=true for invoices) and PurchaseBook
    // (Bill-sourced, AtkBook.Blerje/BlerjeImport/BlerjeInvestime, Debit-normal for bills) —
    // same shape, opposite sign convention, exactly mirroring DocumentLineCalculator's own
    // Invoice-vs-Bill split rather than VatReturn's TaxDefinition.Scope (Scope collapses every
    // reverse-charge code to TaxScope.Both, which VatReturn's Sale/Purchase branches silently
    // drop — this method sources the sign from which document type owns the entry instead, so it
    // doesn't inherit that gap).
    private async Task<List<TaxBookRow>> BuildTaxBookRowsAsync(Guid companyId, DateOnly from, DateOnly to, bool isSalesBook)
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
            documents = (await _db.Invoices.AsNoTracking()
                    .Where(i => i.CompanyId == companyId && i.State == InvoiceState.Posted && i.IssueDate >= from && i.IssueDate <= to)
                    .Select(i => new { i.Id, i.InvoiceNumber, i.IssueDate, i.DocumentType, i.PartnerId, i.JournalEntryId })
                    .ToListAsync())
                .Select(i => (i.Id, i.InvoiceNumber, i.IssueDate, i.DocumentType.ToString(), i.PartnerId, i.JournalEntryId))
                .ToList();
        }
        else
        {
            documents = (await _db.Bills.AsNoTracking()
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
                    doc.PartnerId, taxDefinition.Code ?? string.Empty, taxDefinition.Rate, net, vat));
            }
        }

        return rows;
    }

    [HttpGet("cit-addback")]
    [RequireCompanyAccess]
    public async Task<ActionResult<CitAddBackResponse>> CitAddBack(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var sums = await SumsByAccountAsync(companyId, from, to);

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
    [RequireCompanyAccess]
    public async Task<ActionResult<DebtAgingResponse>> DebtAging(Guid companyId, [FromQuery] DateOnly? asOf = null)
    {
        var today = asOf ?? DateOnly.FromDateTime(DateTime.UtcNow);

        var companyDefaultReceivableAccountId = (await _db.CompanyAccountDefaults.AsNoTracking()
            .FirstOrDefaultAsync(d => d.CompanyId == companyId))?.ReceivableAccountId ?? Guid.Empty;

        var invoices = await _db.Invoices.AsNoTracking()
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

    private async Task<List<(Account Account, decimal Debit, decimal Credit)>> SumsByAccountAsync(
        Guid companyId, DateOnly? from, DateOnly to)
    {
        var query = _db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted
                && l.JournalEntry.Date <= to);
        if (from is { } f)
        {
            query = query.Where(l => l.JournalEntry!.Date >= f);
        }

        var sums = await query
            .GroupBy(l => l.AccountId)
            .Select(g => new { AccountId = g.Key, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) })
            .ToListAsync();

        var accountIds = sums.Select(s => s.AccountId).ToList();
        var accounts = await _db.Accounts.AsNoTracking()
            .Where(a => accountIds.Contains(a.Id))
            .ToDictionaryAsync(a => a.Id);

        return sums
            .Where(s => accounts.ContainsKey(s.AccountId))
            .Select(s => (accounts[s.AccountId], s.Debit, s.Credit))
            .ToList();
    }

    private static decimal NetIncome(IEnumerable<(Account Account, decimal Debit, decimal Credit)> sums) =>
        sums.Where(s => AccountTypeDerivation.IsIncome(s.Account.AccountType)).Sum(s => s.Credit - s.Debit) -
        sums.Where(s => AccountTypeDerivation.IsExpense(s.Account.AccountType)).Sum(s => s.Debit - s.Credit);
}
