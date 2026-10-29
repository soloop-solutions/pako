using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Bills;
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

    private static readonly string[] AgingBuckets = { "Current", "1-30", "31-45", "46-60", "61-90", "91-180", "181-360", "Over360" };

    private static string AgingBucket(int daysPastDue) => daysPastDue switch
    {
        <= 0 => "Current",
        <= 30 => "1-30",
        <= 45 => "31-45",
        <= 60 => "46-60",
        <= 90 => "61-90",
        <= 180 => "91-180",
        <= 360 => "181-360",
        _ => "Over360",
    };

    public async Task<PayablesAgingResponse> PayablesAgingAsync(Guid companyId, DateOnly asOf)
    {
        var companyDefaultPayableAccountId = (await db.CompanyAccountDefaults.AsNoTracking()
            .FirstOrDefaultAsync(d => d.CompanyId == companyId))?.PayableAccountId ?? Guid.Empty;

        var bills = await db.Bills.AsNoTracking().VisibleTo(access)
            .Where(b => b.CompanyId == companyId && b.State == BillState.Posted && b.DocumentType == DocumentType.Bill)
            .Select(b => new { b.Id, b.VendorReference, b.PartnerId, b.IssueDate, b.DueDate, b.JournalEntryId })
            .ToListAsync();

        var partnerIds = bills.Select(b => b.PartnerId).ToHashSet();
        var partners = await db.Partners.AsNoTracking()
            .Where(p => p.CompanyId == companyId && partnerIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => new { p.Name, p.PayableAccountId });
        Guid PayableAccountFor(Guid partnerId) =>
            partners.TryGetValue(partnerId, out var p) && p.PayableAccountId is { } id ? id : companyDefaultPayableAccountId;

        var journalEntryIds = bills.Where(b => b.JournalEntryId != null).Select(b => b.JournalEntryId!.Value).ToList();
        var relevantAccountIds = bills.Select(b => PayableAccountFor(b.PartnerId)).ToHashSet();
        var creditByEntryAndAccount = (await db.JournalEntryLines.AsNoTracking()
            .Where(l => journalEntryIds.Contains(l.JournalEntryId) && relevantAccountIds.Contains(l.AccountId))
            .GroupBy(l => new { l.JournalEntryId, l.AccountId })
            .Select(g => new { g.Key.JournalEntryId, g.Key.AccountId, Total = g.Sum(l => l.Credit) })
            .ToListAsync())
            .ToDictionary(g => (g.JournalEntryId, g.AccountId), g => g.Total);

        var billIds = bills.Select(b => b.Id).ToList();
        var reconciledByBillId = await db.Reconciliations.AsNoTracking()
            .Where(r => r.BillId != null && billIds.Contains(r.BillId.Value))
            .GroupBy(r => r.BillId!.Value)
            .Select(g => new { BillId = g.Key, Reconciled = g.Sum(r => r.Amount) })
            .ToDictionaryAsync(g => g.BillId, g => g.Reconciled);

        var lines = new List<PayablesAgingLine>();
        foreach (var bill in bills)
        {
            var total = bill.JournalEntryId is { } jeId
                && creditByEntryAndAccount.TryGetValue((jeId, PayableAccountFor(bill.PartnerId)), out var t) ? t : 0m;
            var outstanding = total - reconciledByBillId.GetValueOrDefault(bill.Id);
            if (outstanding <= 0m)
            {
                continue;
            }

            lines.Add(new PayablesAgingLine(
                bill.Id, bill.VendorReference, bill.PartnerId,
                partners.TryGetValue(bill.PartnerId, out var partner) ? partner.Name : string.Empty,
                bill.IssueDate, bill.DueDate, outstanding,
                AgingBucket(asOf.DayNumber - bill.DueDate.DayNumber)));
        }

        lines = lines.OrderBy(l => l.DueDate).ThenBy(l => l.BillNumber, StringComparer.Ordinal).ToList();
        var buckets = AgingBuckets
            .Select(b => new AgingBucketTotal(b, lines.Where(l => l.Bucket == b).Sum(l => l.Outstanding)))
            .ToList();
        return new PayablesAgingResponse(asOf, lines, buckets);
    }

    public async Task<decimal> PayablesControlBalanceAsync(Guid companyId, DateOnly to) =>
        await db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted
                && l.JournalEntry.Date <= to
                && db.Accounts.Any(a => a.Id == l.AccountId && a.AccountType == AccountType.Payable))
            .SumAsync(l => l.Credit - l.Debit);
}
