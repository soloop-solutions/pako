using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// J15 (option 2 of docs/HR_MASTER_PLAN.md): one partner's account — opening balance, every
// receivable/payable movement in the period, closing balance. Partner-centric by nature, so it is
// safe to show partner-restricted staff for their own partners, where the general ledger is not
// (filtering a ledger by partner hides the contra lines).
public class PartnerStatementService
{
    private readonly PakoDbContext _db;

    public PartnerStatementService(PakoDbContext db)
    {
        _db = db;
    }

    public async Task<PartnerStatementResponse?> StatementAsync(Guid companyId, Guid partnerId, DateOnly from, DateOnly to)
    {
        var partner = await _db.Partners.AsNoTracking().FirstOrDefaultAsync(p => p.Id == partnerId && p.CompanyId == companyId);
        if (partner is null) return null;

        // Posted and cancelled (stornoed) entries both count: a cancelled entry and its reversal
        // net to zero, exactly as in the ledger.
        var movements = from l in _db.JournalEntryLines.AsNoTracking()
            join e in _db.JournalEntries.AsNoTracking() on l.JournalEntryId equals e.Id
            join a in _db.Accounts.AsNoTracking() on l.AccountId equals a.Id
            where e.CompanyId == companyId && e.State != JournalEntryState.Draft && l.PartnerId == partnerId &&
                (a.AccountType == AccountType.Receivable || a.AccountType == AccountType.Payable)
            select new { e.Date, e.Reference, e.SequenceNumber, l.Description, a.Code, l.Debit, l.Credit, e.PostedAtUtc };

        var opening = await movements.Where(m => m.Date < from).SumAsync(m => m.Debit - m.Credit);
        var rows = await movements.Where(m => m.Date >= from && m.Date <= to)
            .OrderBy(m => m.Date).ThenBy(m => m.PostedAtUtc)
            .Take(5000)
            .ToListAsync();

        var balance = opening;
        var lines = new List<PartnerStatementLine>(rows.Count);
        foreach (var row in rows)
        {
            balance += row.Debit - row.Credit;
            lines.Add(new PartnerStatementLine(row.Date, row.Reference ?? row.SequenceNumber, row.Description, row.Code, row.Debit, row.Credit, balance));
        }

        return new PartnerStatementResponse(partner.Id, partner.Name, from, to, opening,
            rows.Sum(r => r.Debit), rows.Sum(r => r.Credit), balance, lines);
    }
}
