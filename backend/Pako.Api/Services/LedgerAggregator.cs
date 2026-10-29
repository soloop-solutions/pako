using Microsoft.EntityFrameworkCore;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public record AccountSums(Account Account, decimal Debit, decimal Credit);

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

    public static decimal NetIncome(IEnumerable<AccountSums> sums) =>
        sums.Where(s => AccountTypeDerivation.IsIncome(s.Account.AccountType)).Sum(s => s.Credit - s.Debit) -
        sums.Where(s => AccountTypeDerivation.IsExpense(s.Account.AccountType)).Sum(s => s.Debit - s.Credit);
}
