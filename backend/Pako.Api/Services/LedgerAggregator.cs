using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Domain.Ledger;
using Pako.Domain.Reporting;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public record AccountSums(Account Account, decimal Debit, decimal Credit);

public record CashFlowComputation(decimal Opening, decimal NetIncome, decimal Closing, CashFlowResult Result);

public record MonthlyAccountSums(Account Account, int Month, decimal Debit, decimal Credit);

public class LedgerAggregator(PakoDbContext db)
{
    public async Task<List<AccountSums>> SumsByAccountAsync(Guid companyId, DateOnly? from, DateOnly to)
    {
        var query = db.JournalEntryLines.AsNoTracking()
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
        var accounts = await db.Accounts.AsNoTracking()
            .Where(a => accountIds.Contains(a.Id))
            .ToDictionaryAsync(a => a.Id);

        return sums
            .Where(s => accounts.ContainsKey(s.AccountId))
            .Select(s => new AccountSums(accounts[s.AccountId], s.Debit, s.Credit))
            .ToList();
    }

    public async Task<List<MonthlyAccountSums>> SumsByAccountAndMonthAsync(Guid companyId, int year)
    {
        var start = new DateOnly(year, 1, 1);
        var end = new DateOnly(year, 12, 31);
        var sums = await db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted
                && l.JournalEntry.Date >= start
                && l.JournalEntry.Date <= end)
            .GroupBy(l => new { l.AccountId, l.JournalEntry!.Date.Month })
            .Select(g => new { g.Key.AccountId, g.Key.Month, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) })
            .ToListAsync();

        var accountIds = sums.Select(s => s.AccountId).Distinct().ToList();
        var accounts = await db.Accounts.AsNoTracking()
            .Where(a => accountIds.Contains(a.Id))
            .ToDictionaryAsync(a => a.Id);

        return sums
            .Where(s => accounts.ContainsKey(s.AccountId))
            .Select(s => new MonthlyAccountSums(accounts[s.AccountId], s.Month, s.Debit, s.Credit))
            .ToList();
    }

    public async Task<BalanceSheetResponse> BalanceSheetAsync(Guid companyId, DateOnly asOf)
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
        var equity = sums.Where(s => s.Account.AccountType == AccountType.Equity)
            .Select(s => new ReportLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Credit - s.Debit))
            .OrderBy(l => l.AccountCode)
            .ToList();

        var currentEarnings = NetIncome(sums);
        var currentYearEarningsAccount = await db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.CompanyId == companyId && a.AccountType == AccountType.CurrentYearEarnings);
        equity.Add(currentYearEarningsAccount is { } cye
            ? new ReportLine(cye.Id, cye.Code, cye.Name, currentEarnings)
            : new ReportLine(Guid.Empty, "3999", "Current Earnings", currentEarnings));

        return new BalanceSheetResponse(
            asOf, assets, liabilities, equity, currentEarnings,
            assets.Sum(l => l.Amount), liabilities.Sum(l => l.Amount), equity.Sum(l => l.Amount));
    }

    public async Task<decimal> NetIncomeByIdentityAsync(Guid companyId, DateOnly from, DateOnly to)
    {
        static decimal AssetsLessLiabilities(IEnumerable<AccountSums> sums) =>
            sums.Where(s => AccountTypeDerivation.IsAsset(s.Account.AccountType)).Sum(s => s.Debit - s.Credit) -
            sums.Where(s => AccountTypeDerivation.IsLiability(s.Account.AccountType)).Sum(s => s.Credit - s.Debit);

        var closing = AssetsLessLiabilities(await SumsByAccountAsync(companyId, null, to));
        var opening = from == DateOnly.MinValue ? 0m : AssetsLessLiabilities(await SumsByAccountAsync(companyId, null, from.AddDays(-1)));
        var equityMovements = (await SumsByAccountAsync(companyId, from, to))
            .Where(s => s.Account.AccountType == AccountType.Equity)
            .Sum(s => s.Credit - s.Debit);

        return closing - opening - equityMovements;
    }

    public async Task<CashFlowComputation> CashFlowAsync(Guid companyId, DateOnly from, DateOnly to)
    {
        static decimal CashBalance(IEnumerable<AccountSums> sums) =>
            sums.Where(s => s.Account.AccountType == AccountType.Cash).Sum(s => s.Debit - s.Credit);

        var opening = from == DateOnly.MinValue ? 0m : CashBalance(await SumsByAccountAsync(companyId, null, from.AddDays(-1)));
        var closing = CashBalance(await SumsByAccountAsync(companyId, null, to));
        var period = await SumsByAccountAsync(companyId, from, to);

        var movements = period
            .Where(s => s.Account.AccountType is not (AccountType.Cash or AccountType.CurrentYearEarnings or AccountType.OffBalance)
                && !AccountTypeDerivation.IsIncome(s.Account.AccountType)
                && !AccountTypeDerivation.IsExpense(s.Account.AccountType)
                && (s.Debit != 0m || s.Credit != 0m))
            .Select(s => new AccountMovement(s.Account.Id, s.Account.Code, s.Account.Name, s.Account.CashFlowCategory, s.Debit, s.Credit))
            .OrderBy(m => m.Code, StringComparer.Ordinal);

        var netIncome = NetIncome(period);
        return new CashFlowComputation(opening, netIncome, closing, CashFlowStatement.Calculate(netIncome, movements, opening, closing));
    }

    public static decimal NetIncome(IEnumerable<AccountSums> sums) =>
        sums.Where(s => AccountTypeDerivation.IsIncome(s.Account.AccountType)).Sum(s => s.Credit - s.Debit) -
        sums.Where(s => AccountTypeDerivation.IsExpense(s.Account.AccountType)).Sum(s => s.Debit - s.Credit);
}
