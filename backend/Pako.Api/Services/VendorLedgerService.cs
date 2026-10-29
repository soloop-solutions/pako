using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public class VendorLedgerService(PakoDbContext db, CompanyAccessContext access)
{
    public async Task<List<VendorBalanceLine>> BalancesAsync(Guid companyId, DateOnly from, DateOnly to, bool includeZero)
    {
        var lines = db.JournalEntryLines.AsNoTracking()
            .Where(l => l.PartnerId != null
                && l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted
                && l.JournalEntry.Date <= to
                && db.Accounts.Any(a => a.Id == l.AccountId && a.AccountType == AccountType.Payable));
        if (access.VisiblePartnerIds is { } ids)
        {
            lines = lines.Where(l => ids.Contains(l.PartnerId!.Value));
        }

        var sums = await lines
            .GroupBy(l => l.PartnerId!.Value)
            .Select(g => new
            {
                PartnerId = g.Key,
                Opening = g.Sum(l => l.JournalEntry!.Date < from ? l.Credit - l.Debit : 0m),
                Debit = g.Sum(l => l.JournalEntry!.Date >= from ? l.Debit : 0m),
                Credit = g.Sum(l => l.JournalEntry!.Date >= from ? l.Credit : 0m),
            })
            .ToListAsync();

        var partnerIds = sums.Select(s => s.PartnerId).ToList();
        var names = await db.Partners.AsNoTracking()
            .Where(p => p.CompanyId == companyId && partnerIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name);

        var result = sums
            .Where(s => includeZero || s.Opening != 0m || s.Debit != 0m || s.Credit != 0m)
            .Select(s => new VendorBalanceLine(
                s.PartnerId, names.GetValueOrDefault(s.PartnerId, string.Empty), s.Opening, s.Debit, s.Credit, s.Opening + s.Credit - s.Debit))
            .ToList();

        if (includeZero)
        {
            var listed = result.Select(r => r.PartnerId).ToHashSet();
            var idle = await db.Partners.AsNoTracking().VisibleTo(access)
                .Where(p => p.CompanyId == companyId && p.IsVendor)
                .ToListAsync();
            result.AddRange(idle.Where(p => !listed.Contains(p.Id)).Select(p => new VendorBalanceLine(p.Id, p.Name, 0m, 0m, 0m, 0m)));
        }

        return result.OrderBy(l => l.Name, StringComparer.OrdinalIgnoreCase).ThenBy(l => l.PartnerId).ToList();
    }

    public async Task<VendorStatementResponse?> StatementAsync(Guid companyId, Guid partnerId, DateOnly from, DateOnly to)
    {
        var partner = await db.Partners.AsNoTracking().VisibleTo(access)
            .FirstOrDefaultAsync(p => p.Id == partnerId && p.CompanyId == companyId);
        if (partner is null)
        {
            return null;
        }

        var lines = db.JournalEntryLines.AsNoTracking()
            .Where(l => l.PartnerId == partnerId
                && l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted
                && l.JournalEntry.Date <= to
                && db.Accounts.Any(a => a.Id == l.AccountId && a.AccountType == AccountType.Payable));

        var opening = from == DateOnly.MinValue
            ? 0m
            : await lines.Where(l => l.JournalEntry!.Date < from).SumAsync(l => l.Credit - l.Debit);

        var raw = await lines
            .Where(l => l.JournalEntry!.Date >= from)
            .Select(l => new
            {
                l.Id,
                l.JournalEntry!.Date,
                l.JournalEntry.SecureSequenceNumber,
                JournalType = db.Journals.Where(j => j.Id == l.JournalEntry.JournalId).Select(j => j.Type).First(),
                Document = l.JournalEntry.Reference,
                Description = l.Description ?? l.JournalEntry.Remarks,
                l.Debit,
                l.Credit,
            })
            .ToListAsync();

        var balance = opening;
        var rows = new List<VendorStatementRow>();
        foreach (var r in raw
            .OrderBy(r => r.Date)
            .ThenBy(r => r.SecureSequenceNumber is null)
            .ThenBy(r => r.SecureSequenceNumber)
            .ThenBy(r => r.Id))
        {
            balance += r.Credit - r.Debit;
            rows.Add(new VendorStatementRow(r.Date, r.JournalType.ToString(), r.Document, r.Description, r.Debit, r.Credit, balance));
        }

        return new VendorStatementResponse(partner.Id, partner.Name, from, to, opening, rows, balance);
    }

    public async Task<decimal> PayablesControlBalanceAsync(Guid companyId, DateOnly to) =>
        await db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted
                && l.JournalEntry.Date <= to
                && db.Accounts.Any(a => a.Id == l.AccountId && a.AccountType == AccountType.Payable))
            .SumAsync(l => l.Credit - l.Debit);
}
