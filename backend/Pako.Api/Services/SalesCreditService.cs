using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/POS_PLAN.md P6: a customer's credit position for B2B selling. The credit limit counts the
// open receivable plus confirmed orders not yet invoiced; the overdue block looks at invoices whose
// due date is more than Partner.OverdueBlockDays behind and which still have money open.
public class SalesCreditService
{
    private readonly PakoDbContext _db;

    public SalesCreditService(PakoDbContext db) => _db = db;

    public async Task<CreditStatusResponse?> StatusAsync(Guid companyId, Guid partnerId, Guid? exceptOrderId = null)
    {
        var partner = await _db.Partners.AsNoTracking().FirstOrDefaultAsync(p => p.Id == partnerId && p.CompanyId == companyId);
        if (partner is null) return null;
        var receivable = partner.ReceivableAccountId
            ?? await _db.CompanyAccountDefaults.AsNoTracking().Where(d => d.CompanyId == companyId).Select(d => (Guid?)d.ReceivableAccountId).FirstOrDefaultAsync()
            ?? Guid.Empty;

        var outstanding = Math.Max(0m, await _db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntry!.CompanyId == companyId && l.JournalEntry.State == JournalEntryState.Posted
                && l.AccountId == receivable && l.PartnerId == partnerId)
            .SumAsync(l => l.Debit - l.Credit));

        var openOrders = await OpenOrdersAsync(companyId, partnerId, exceptOrderId);

        // Invoices past due with money still open: the receivable each put on, less what was matched to it.
        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        var due = await _db.Invoices.AsNoTracking()
            .Where(i => i.CompanyId == companyId && i.PartnerId == partnerId && i.State == InvoiceState.Posted && i.DueDate < today
                && (i.DocumentType == DocumentType.Invoice || i.DocumentType == DocumentType.DebitNote) && i.JournalEntryId != null)
            .Select(i => new
            {
                i.DueDate,
                Amount = _db.JournalEntryLines.Where(l => l.JournalEntryId == i.JournalEntryId && l.AccountId == receivable).Sum(l => (decimal?)l.Debit) ?? 0m,
                Paid = _db.Reconciliations.Where(r => r.InvoiceId == i.Id).Sum(r => (decimal?)r.Amount) ?? 0m,
            })
            .ToListAsync();
        var overdue = due.Where(d => d.Amount - d.Paid > 0.005m).ToList();
        var oldest = overdue.Count == 0 ? 0 : today.DayNumber - overdue.Min(d => d.DueDate).DayNumber;
        var blocked = partner.OverdueBlockDays is { } days && overdue.Any(d => today.DayNumber - d.DueDate.DayNumber > days);

        return new CreditStatusResponse(partnerId, partner.CreditLimit, outstanding, openOrders,
            partner.CreditLimit is { } limit ? limit - outstanding - openOrders : null,
            overdue.Sum(d => d.Amount - d.Paid), oldest, partner.OverdueBlockDays, blocked);
    }

    // Confirmed orders' value not yet invoiced (posted invoices only).
    public async Task<decimal> OpenOrdersAsync(Guid companyId, Guid partnerId, Guid? exceptOrderId)
    {
        var lines = await _db.SalesOrderLines.AsNoTracking()
            .Where(l => l.SalesOrder!.CompanyId == companyId && l.SalesOrder.PartnerId == partnerId && l.SalesOrderId != exceptOrderId
                && l.SalesOrder.State == SalesOrderState.Confirmed)
            .ToListAsync();
        if (lines.Count == 0) return 0m;
        var invoiced = await SalesOrderQuantities.InvoicedAsync(_db, lines.Select(l => l.Id).ToList());
        return lines.Sum(l => l.OpenGross(invoiced.GetValueOrDefault(l.Id).Posted));
    }
}
