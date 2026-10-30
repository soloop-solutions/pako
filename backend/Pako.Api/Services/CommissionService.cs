using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Domain.Invoicing;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// G11: commission on the partners assigned to an employee. Amounts come from each posted
// invoice's own journal entry — net = its revenue lines, gross = its receivable line — so the
// basis is exactly what was booked (VAT excluded, credit notes and returns negative), never a
// recomputation. Partner windows follow assignment dates, so a partner that moved mid-month is
// split between the two employees.
public class CommissionService
{
    private static readonly DocumentType[] SalesDocuments =
        { DocumentType.Invoice, DocumentType.DebitNote, DocumentType.CreditNote, DocumentType.SalesReturn };

    private readonly PakoDbContext _db;

    public CommissionService(PakoDbContext db)
    {
        _db = db;
    }

    private record Window(Guid PartnerId, DateOnly From, DateOnly To);

    private async Task<List<Window>> WindowsAsync(Guid employeeId, DateOnly periodStart, DateOnly periodEnd)
    {
        var current = await _db.EmployeePartnerAssignments.AsNoTracking()
            .Where(a => a.EmployeeId == employeeId)
            .Select(a => new { a.PartnerId, From = a.AssignedFrom, To = (DateOnly?)null })
            .ToListAsync();
        var ended = await _db.EmployeePartnerAssignmentPeriods.AsNoTracking()
            .Where(a => a.EmployeeId == employeeId && a.AssignedTo >= periodStart)
            .Select(a => new { a.PartnerId, From = a.AssignedFrom, To = (DateOnly?)a.AssignedTo })
            .ToListAsync();

        return current.Concat(ended)
            .Select(a => new Window(
                a.PartnerId,
                a.From is { } f && f > periodStart ? f : periodStart,
                a.To is { } t && t < periodEnd ? t : periodEnd))
            .Where(w => w.From <= w.To)
            .ToList();
    }

    public async Task<List<CommissionBasisItemResponse>> BasisAsync(Guid companyId, Guid employeeId, CommissionBasis basis, DateOnly periodStart, DateOnly periodEnd)
    {
        var windows = await WindowsAsync(employeeId, periodStart, periodEnd);
        if (windows.Count == 0) return new List<CommissionBasisItemResponse>();
        var partnerIds = windows.Select(w => w.PartnerId).Distinct().ToList();

        // Invoices that may matter: by issue date for InvoicedNet; any posted one of the partners
        // for PaidNet (a payment this month can settle an older invoice).
        var query = _db.Invoices.AsNoTracking()
            .Where(i => i.CompanyId == companyId && i.State == InvoiceState.Posted && i.JournalEntryId != null &&
                partnerIds.Contains(i.PartnerId) && SalesDocuments.Contains(i.DocumentType));
        if (basis == CommissionBasis.InvoicedNet)
        {
            query = query.Where(i => i.IssueDate >= periodStart && i.IssueDate <= periodEnd);
        }

        var invoices = await query
            .Select(i => new
            {
                i.Id, i.InvoiceNumber, i.IssueDate, i.PartnerId, i.DocumentType, JournalEntryId = i.JournalEntryId!.Value,
                RevenueAccounts = i.Lines.Select(l => l.RevenueAccountId).Distinct().ToList()
            })
            .ToListAsync();
        if (invoices.Count == 0) return new List<CommissionBasisItemResponse>();

        var entryIds = invoices.Select(i => i.JournalEntryId).ToList();
        var entryLines = (await _db.JournalEntryLines.AsNoTracking()
                .Where(l => entryIds.Contains(l.JournalEntryId))
                .Select(l => new { l.JournalEntryId, l.AccountId, l.PartnerId, l.Debit, l.Credit })
                .ToListAsync())
            .ToLookup(l => l.JournalEntryId);
        var partnerNames = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);

        var amounts = invoices.ToDictionary(i => i.Id, i =>
        {
            var lines = entryLines[i.JournalEntryId].ToList();
            var net = lines.Where(l => i.RevenueAccounts.Contains(l.AccountId)).Sum(l => l.Credit - l.Debit);
            var gross = Math.Abs(lines.Where(l => l.PartnerId == i.PartnerId).Sum(l => l.Debit - l.Credit));
            return (Net: net, Gross: gross);
        });

        bool InWindow(Guid partnerId, DateOnly date) => windows.Any(w => w.PartnerId == partnerId && w.From <= date && date <= w.To);

        var items = new List<CommissionBasisItemResponse>();
        if (basis == CommissionBasis.InvoicedNet)
        {
            foreach (var invoice in invoices.Where(i => InWindow(i.PartnerId, i.IssueDate)).OrderBy(i => i.IssueDate))
            {
                var net = amounts[invoice.Id].Net;
                items.Add(new CommissionBasisItemResponse(invoice.Id, invoice.InvoiceNumber, invoice.IssueDate, invoice.PartnerId,
                    partnerNames.GetValueOrDefault(invoice.PartnerId, string.Empty), invoice.DocumentType, net, net, null));
            }

            return items;
        }

        // PaidNet: payments matched to invoices, dated by the payment entry. A match whose
        // counterpart is another invoice's entry (a credit note offset) is not cash and is skipped.
        var payable = invoices.Where(i => i.DocumentType is DocumentType.Invoice or DocumentType.DebitNote).ToDictionary(i => i.Id);
        var invoiceEntryIds = await _db.Invoices.AsNoTracking()
            .Where(i => i.CompanyId == companyId && i.JournalEntryId != null)
            .Select(i => i.JournalEntryId!.Value)
            .ToListAsync();
        var invoiceEntrySet = invoiceEntryIds.ToHashSet();
        var payableIds = payable.Keys.ToList();
        var matches = await (
            from r in _db.Reconciliations.AsNoTracking()
            join l in _db.JournalEntryLines.AsNoTracking() on r.JournalEntryLineId equals l.Id
            join e in _db.JournalEntries.AsNoTracking() on l.JournalEntryId equals e.Id
            where r.InvoiceId != null && payableIds.Contains(r.InvoiceId.Value) && e.Date >= periodStart && e.Date <= periodEnd
            select new { InvoiceId = r.InvoiceId!.Value, r.Amount, e.Date, EntryId = e.Id }).ToListAsync();

        foreach (var match in matches.Where(m => !invoiceEntrySet.Contains(m.EntryId)).OrderBy(m => m.Date))
        {
            var invoice = payable[match.InvoiceId];
            if (!InWindow(invoice.PartnerId, match.Date)) continue;

            var (net, gross) = amounts[invoice.Id];
            var counted = gross == 0m ? 0m : Math.Round(match.Amount * net / gross, 2, MidpointRounding.AwayFromZero);
            items.Add(new CommissionBasisItemResponse(invoice.Id, invoice.InvoiceNumber, invoice.IssueDate, invoice.PartnerId,
                partnerNames.GetValueOrDefault(invoice.PartnerId, string.Empty), invoice.DocumentType, net, counted, match.Date));
        }

        return items;
    }

    // "Calculate commissions" for one month: replaces the month's unconsumed plan-computed
    // commission adjustments. An employee whose computed commission a run already consumed is
    // left alone (Locked), so recalculating can never pay twice.
    public async Task<List<CommissionResultResponse>> CalculateAsync(Guid companyId, DateOnly anyDayInMonth)
    {
        var period = new DateOnly(anyDayInMonth.Year, anyDayInMonth.Month, 1);
        var periodEnd = period.AddMonths(1).AddDays(-1);

        var plans = await _db.CommissionPlans.AsNoTracking().Where(p => p.CompanyId == companyId && p.IsActive).ToDictionaryAsync(p => p.Id);
        var employees = (await _db.Employees.AsNoTracking()
                .Where(e => e.CompanyId == companyId && e.IsActive && e.CommissionPlanId != null)
                .OrderBy(e => e.Name)
                .ToListAsync())
            .Where(e => plans.ContainsKey(e.CommissionPlanId!.Value) && e.IsEmployedDuring(period, periodEnd))
            .ToList();
        var employeeIds = employees.Select(e => e.Id).ToList();
        var existing = await _db.PayrollAdjustments
            .Where(a => a.CompanyId == companyId && a.Period == period && a.CommissionPlanId != null && employeeIds.Contains(a.EmployeeId))
            .ToListAsync();

        var results = new List<CommissionResultResponse>();
        foreach (var employee in employees)
        {
            var plan = plans[employee.CommissionPlanId!.Value];
            var mine = existing.Where(a => a.EmployeeId == employee.Id).ToList();
            if (mine.Any(a => a.PayrollRunId != null))
            {
                var used = mine.First(a => a.PayrollRunId != null);
                results.Add(new CommissionResultResponse(employee.Id, employee.Name, plan.Name, used.CommissionBasisAmount ?? 0m, used.Amount, true, used.Id));
                continue;
            }

            _db.PayrollAdjustments.RemoveRange(mine);
            var basis = (await BasisAsync(companyId, employee.Id, plan.Basis, period, periodEnd)).Sum(i => i.CountedAmount);
            var amount = plan.CommissionFor(basis);
            Guid? adjustmentId = null;
            if (amount > 0m)
            {
                var adjustment = new PayrollAdjustment
                {
                    Id = Guid.NewGuid(),
                    CompanyId = companyId,
                    EmployeeId = employee.Id,
                    Period = period,
                    Kind = PayrollAdjustmentKind.Commission,
                    Description = plan.Name,
                    Amount = amount,
                    CommissionPlanId = plan.Id,
                    CommissionBasisAmount = basis
                };
                _db.PayrollAdjustments.Add(adjustment);
                adjustmentId = adjustment.Id;
            }

            results.Add(new CommissionResultResponse(employee.Id, employee.Name, plan.Name, basis, amount, false, adjustmentId));
        }

        await _db.SaveChangesAsync();
        return results;
    }
}
