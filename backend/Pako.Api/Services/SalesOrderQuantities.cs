using Microsoft.EntityFrameworkCore;
using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/POS_PLAN.md P6: what a sales order line has had delivered and invoiced, in the item's base
// unit (delivery lines are in base units; order and invoice lines hold Quantity × UnitFactor). Read
// back from posted documents every time, so the order always agrees with stock and the ledger.
public static class SalesOrderQuantities
{
    // Delivered per order line: goods sent on posted delivery notes (and, when asked, on drafts),
    // plus goods a posted invoice took out of stock itself (an order line invoiced with no delivery).
    public static async Task<Dictionary<Guid, decimal>> DeliveredAsync(PakoDbContext db, IReadOnlyCollection<Guid> lineIds,
        bool includeDrafts = false, Guid? exceptDocumentId = null)
    {
        if (lineIds.Count == 0) return new();
        var deliveries = await db.StockDocumentLines.AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId.Value)
                && l.StockDocument!.Type == StockDocumentType.Delivery && l.StockDocumentId != exceptDocumentId
                && (l.StockDocument.State == StockDocumentState.Posted || (includeDrafts && l.StockDocument.State == StockDocumentState.Draft)))
            .GroupBy(l => l.SalesOrderLineId!.Value).Select(g => new { g.Key, Quantity = g.Sum(l => l.Quantity) })
            .ToDictionaryAsync(g => g.Key, g => g.Quantity);
        var direct = await db.InvoiceLines.AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId.Value) && l.DeliveryLineId == null
                && l.Invoice!.State == InvoiceState.Posted && l.Invoice.DocumentType == DocumentType.Invoice)
            .GroupBy(l => l.SalesOrderLineId!.Value).Select(g => new { g.Key, Quantity = g.Sum(l => l.Quantity * l.UnitFactor) })
            .ToDictionaryAsync(g => g.Key, g => g.Quantity);
        return lineIds.ToDictionary(id => id, id => deliveries.GetValueOrDefault(id) + direct.GetValueOrDefault(id));
    }

    // Invoiced per order line: posted invoices, and drafts still waiting.
    public static async Task<Dictionary<Guid, (decimal Posted, decimal Draft)>> InvoicedAsync(PakoDbContext db, IReadOnlyCollection<Guid> lineIds)
    {
        if (lineIds.Count == 0) return new();
        var rows = await db.InvoiceLines.AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId.Value)
                && l.Invoice!.State != InvoiceState.Cancelled && l.Invoice.DocumentType == DocumentType.Invoice)
            .Select(l => new { LineId = l.SalesOrderLineId!.Value, Quantity = l.Quantity * l.UnitFactor, Posted = l.Invoice!.State == InvoiceState.Posted })
            .ToListAsync();
        return rows.GroupBy(r => r.LineId).ToDictionary(g => g.Key,
            g => (g.Where(r => r.Posted).Sum(r => r.Quantity), g.Where(r => !r.Posted).Sum(r => r.Quantity)));
    }

    // Invoiced per delivery line (base units): posted invoices, plus drafts when asked, except one.
    public static async Task<Dictionary<Guid, decimal>> InvoicedDeliveriesAsync(PakoDbContext db, IReadOnlyCollection<Guid> deliveryLineIds,
        bool includeDrafts = false, Guid? exceptInvoiceId = null)
    {
        if (deliveryLineIds.Count == 0) return new();
        return await db.InvoiceLines.AsNoTracking()
            .Where(l => l.DeliveryLineId != null && deliveryLineIds.Contains(l.DeliveryLineId.Value) && l.InvoiceId != exceptInvoiceId
                && l.Invoice!.DocumentType == DocumentType.Invoice
                && (l.Invoice.State == InvoiceState.Posted || (includeDrafts && l.Invoice.State == InvoiceState.Draft)))
            .GroupBy(l => l.DeliveryLineId!.Value).Select(g => new { g.Key, Quantity = g.Sum(l => l.Quantity * l.UnitFactor) })
            .ToDictionaryAsync(g => g.Key, g => g.Quantity);
    }
}
