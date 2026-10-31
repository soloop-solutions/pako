using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Documents;
using Pako.Domain.Ledger;
using Pako.Domain.Reporting;
using Pako.Domain.Tax;
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

        var totals = ReportTotals.Ledger(rows.Select(r => (r.Debit, r.Credit)));
        return new VendorStatementResponse(partner.Id, partner.Name, from, to, opening, rows, balance, totals.Debit, totals.Credit);
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
            .Where(b => b.CompanyId == companyId && b.State == BillState.Posted && b.DocumentType == DocumentType.Bill && b.IssueDate <= asOf)
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
        var reconciledByBillId = await (
                from r in db.Reconciliations.AsNoTracking()
                join l in db.JournalEntryLines.AsNoTracking() on r.JournalEntryLineId equals l.Id
                where r.BillId != null && billIds.Contains(r.BillId.Value) && l.JournalEntry!.Date <= asOf
                group r by r.BillId!.Value into g
                select new { BillId = g.Key, Reconciled = g.Sum(x => x.Amount) })
            .ToDictionaryAsync(g => g.BillId, g => g.Reconciled);

        var lines = new List<PayablesAgingLine>();
        foreach (var bill in bills)
        {
            var total = bill.JournalEntryId is { } jeId
                && creditByEntryAndAccount.TryGetValue((jeId, PayableAccountFor(bill.PartnerId)), out var t) ? t : 0m;
            var outstanding = total - reconciledByBillId.GetValueOrDefault(bill.Id);
            if (outstanding <= 0.01m)
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
        var matrix = PayablesAgingMatrix.Build(
            lines.Select(l => new AgingMatrixInput(l.PartnerId, l.PartnerName, l.Bucket, l.Outstanding)), AgingBuckets);
        var vendorMatrix = matrix.Rows
            .Select(r => new PayablesAgingVendorRow(
                r.PartnerId, r.PartnerName,
                AgingBuckets.Select((b, i) => new AgingBucketTotal(b, r.BucketAmounts[i])).ToList(),
                r.Total))
            .ToList();
        return new PayablesAgingResponse(asOf, lines, buckets, vendorMatrix, matrix.GrandTotal);
    }

    private record PurchaseRow(
        DateOnly Date, string? DocumentNumber, string DocumentType, Guid PartnerId, string PartnerName,
        Guid? ItemId, int? ItemCode, string? ItemName, string? Unit, string Description,
        decimal Quantity, decimal UnitPrice, decimal Net, decimal Discount, decimal Vat, decimal Gross, Guid LineId);

    private async Task<List<PurchaseRow>> PurchaseRowsAsync(Guid companyId, DateOnly from, DateOnly to, Guid? partnerId)
    {
        var billsQuery = db.Bills.AsNoTracking().VisibleTo(access)
            .Where(b => b.CompanyId == companyId && b.State == BillState.Posted && b.IssueDate >= from && b.IssueDate <= to);
        if (partnerId is { } pid)
        {
            billsQuery = billsQuery.Where(b => b.PartnerId == pid);
        }

        var bills = await billsQuery.Include(b => b.Lines).ToListAsync();
        var partnerIds = bills.Select(b => b.PartnerId).ToHashSet();
        var partnerNames = await db.Partners.AsNoTracking()
            .Where(p => p.CompanyId == companyId && partnerIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name);
        var itemIds = bills.SelectMany(b => b.Lines).Where(l => l.ItemId != null).Select(l => l.ItemId!.Value).ToHashSet();
        var items = await db.Items.AsNoTracking()
            .Where(i => i.CompanyId == companyId && itemIds.Contains(i.Id))
            .ToDictionaryAsync(i => i.Id);
        var taxDefinitions = await db.TaxDefinitions.AsNoTracking()
            .Where(t => t.CompanyId == companyId)
            .Include(t => t.RepartitionLines)
            .ToDictionaryAsync(t => t.Id);

        var rows = new List<PurchaseRow>();
        foreach (var bill in bills)
        {
            var isCreditNote = bill.DocumentType is Pako.Domain.Bills.DocumentType.CreditNote or Pako.Domain.Bills.DocumentType.PurchaseReturn;
            var sign = isCreditNote ? -1m : 1m;
            var partnerName = partnerNames.GetValueOrDefault(bill.PartnerId, string.Empty);
            foreach (var line in bill.Lines)
            {
                TaxDefinition? taxDefinition = null;
                if (line.TaxDefinitionId is { } taxId)
                {
                    taxDefinitions.TryGetValue(taxId, out taxDefinition);
                }

                DocumentLineResult Calc(decimal discountPercent) => DocumentLineCalculator.Calculate(
                    line.Quantity, line.UnitPrice, discountPercent, line.ExpenseAccountId, line.Description,
                    taxDefinition, isCreditNote, creditsOnNormalSide: false,
                    TaxComputation, Guid.Empty, Guid.Empty, bill.PriceMode);
                var result = Calc(line.DiscountPercent);
                var undiscounted = line.DiscountPercent == 0m ? result : Calc(0m);
                Item? item = null;
                if (line.ItemId is { } itemId)
                {
                    items.TryGetValue(itemId, out item);
                }

                var vat = taxDefinition is { IsReverseCharge: true }
                    ? Math.Round(result.NetAmount * taxDefinition.Rate, 2, MidpointRounding.AwayFromZero)
                    : result.Gross - result.NetAmount;

                rows.Add(new PurchaseRow(
                    bill.IssueDate, bill.VendorReference, bill.DocumentType.ToString(), bill.PartnerId, partnerName,
                    line.ItemId, item?.Code, item?.Name, string.IsNullOrEmpty(item?.Unit) ? null : item.Unit, line.Description,
                    sign * line.Quantity, line.UnitPrice, sign * result.NetAmount,
                    sign * (undiscounted.NetAmount - result.NetAmount), sign * vat, sign * result.Gross,
                    line.Id));
            }
        }

        return rows;
    }

    private static readonly TaxComputationService TaxComputation = new();

    public async Task<List<PurchaseByVendorLine>> PurchasesByVendorAsync(Guid companyId, DateOnly from, DateOnly to) =>
        (await PurchaseRowsAsync(companyId, from, to, null))
            .GroupBy(r => r.PartnerId)
            .Select(g => new PurchaseByVendorLine(
                g.Key, g.First().PartnerName, g.Sum(r => r.Net), g.Sum(r => r.Discount), g.Sum(r => r.Vat), g.Sum(r => r.Gross)))
            .OrderBy(l => l.Name, StringComparer.OrdinalIgnoreCase).ThenBy(l => l.PartnerId)
            .ToList();

    public async Task<List<PurchaseByItemLine>> PurchasesByItemAsync(Guid companyId, DateOnly from, DateOnly to) =>
        (await PurchaseRowsAsync(companyId, from, to, null))
            .GroupBy(r => r.ItemId is { } id ? (object)id : r.Description)
            .Select(g =>
            {
                var first = g.First();
                return new
                {
                    first.ItemCode,
                    Line = new PurchaseByItemLine(
                        first.ItemId, first.ItemCode?.ToString(), first.ItemId is null ? first.Description : first.ItemName ?? first.Description,
                        first.Unit, g.Sum(r => r.Quantity), g.Sum(r => r.Net), g.Sum(r => r.Vat), g.Sum(r => r.Gross))
                };
            })
            .OrderBy(x => x.ItemCode ?? int.MinValue)
            .ThenBy(x => x.Line.Description, StringComparer.OrdinalIgnoreCase)
            .Select(x => x.Line)
            .ToList();

    public async Task<List<PurchaseTransactionLine>> PurchaseTransactionsAsync(
        Guid companyId, DateOnly from, DateOnly to, Guid? partnerId, string? search, string? sort)
    {
        var rows = await PurchaseRowsAsync(companyId, from, to, partnerId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            bool Has(string? value) => value != null && value.Contains(term, StringComparison.OrdinalIgnoreCase);
            rows = rows.Where(r => Has(r.PartnerName) || Has(r.DocumentNumber) || Has(r.ItemCode?.ToString()) || Has(r.Description)).ToList();
        }

        var descending = sort is not null && sort.StartsWith('-');
        var sortField = descending ? sort![1..] : sort;
        Func<PurchaseRow, object?> key = sortField?.ToLowerInvariant() switch
        {
            "vendor" => r => r.PartnerName.ToLowerInvariant(),
            "document" => r => r.DocumentNumber?.ToLowerInvariant() ?? string.Empty,
            "net" => r => r.Net,
            "gross" => r => r.Gross,
            _ => r => r.Date,
        };
        var ordered = descending ? rows.OrderByDescending(key) : rows.OrderBy(key);
        return ordered
            .ThenBy(r => r.Date)
            .ThenBy(r => r.DocumentNumber, StringComparer.Ordinal)
            .ThenBy(r => r.Description, StringComparer.Ordinal)
            .ThenBy(r => r.LineId)
            .Select(r => new PurchaseTransactionLine(
                r.Date, r.DocumentNumber, r.DocumentType, r.PartnerName, r.ItemCode?.ToString(), r.Description,
                r.Quantity, r.UnitPrice, r.Net, r.Vat, r.Gross))
            .ToList();
    }

    public async Task<decimal> PayablesControlBalanceAsync(Guid companyId, DateOnly to) =>
        await db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State == JournalEntryState.Posted
                && l.JournalEntry.Date <= to
                && db.Accounts.Any(a => a.Id == l.AccountId && a.AccountType == AccountType.Payable))
            .SumAsync(l => l.Credit - l.Debit);
}
