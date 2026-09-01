using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
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

        var income = sums.Where(s => s.Account.AccountType == AccountType.Income)
            .Select(s => new ReportLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Credit - s.Debit))
            .OrderBy(l => l.AccountCode)
            .ToList();
        var expenses = sums.Where(s => s.Account.AccountType == AccountType.Expense)
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

        var assets = sums.Where(s => s.Account.AccountType == AccountType.Asset)
            .Select(s => new ReportLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Debit - s.Credit))
            .OrderBy(l => l.AccountCode)
            .ToList();
        var liabilities = sums.Where(s => s.Account.AccountType == AccountType.Liability)
            .Select(s => new ReportLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Credit - s.Debit))
            .OrderBy(l => l.AccountCode)
            .ToList();
        var equity = sums.Where(s => s.Account.AccountType == AccountType.Equity)
            .Select(s => new ReportLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Credit - s.Debit))
            .OrderBy(l => l.AccountCode)
            .ToList();

        var currentEarnings = NetIncome(sums);
        equity.Add(new ReportLine(Guid.Empty, "3999", "Current Earnings", currentEarnings));

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
        sums.Where(s => s.Account.AccountType == AccountType.Income).Sum(s => s.Credit - s.Debit) -
        sums.Where(s => s.Account.AccountType == AccountType.Expense).Sum(s => s.Debit - s.Credit);
}
