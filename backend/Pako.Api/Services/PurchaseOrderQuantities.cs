using Microsoft.EntityFrameworkCore;
using Pako.Domain.Bills;
using Pako.Domain.Inventory;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/INVENTORY_PLAN.md §12 P5/P6: what an order line has had delivered and billed, in the item's
// base unit (order lines and receipts are in base units; a bill line holds Quantity × UnitFactor of
// them). Shared by the order screens and receipt posting, so both count the same way.
public static class PurchaseOrderQuantities
{
    // Delivered per order line: goods counted in on posted receipts (and, when asked, on receipts
    // still in draft), plus goods a posted bill brought in directly (its quantity not matched to a
    // receipt) — both put the order's stock on the shelf.
    public static async Task<Dictionary<Guid, decimal>> ReceivedAsync(PakoDbContext db, IReadOnlyCollection<Guid> lineIds,
        bool includeDraftReceipts = false, Guid? exceptDocumentId = null)
    {
        if (lineIds.Count == 0) return new();
        var receipts = await db.StockDocumentLines.AsNoTracking()
            .Where(l => l.PurchaseOrderLineId != null && lineIds.Contains(l.PurchaseOrderLineId.Value)
                && l.StockDocument!.Type == StockDocumentType.Receipt && l.StockDocumentId != exceptDocumentId
                && (l.StockDocument.State == StockDocumentState.Posted || (includeDraftReceipts && l.StockDocument.State == StockDocumentState.Draft)))
            .GroupBy(l => l.PurchaseOrderLineId!.Value).Select(g => new { g.Key, Quantity = g.Sum(l => l.Quantity) })
            .ToDictionaryAsync(g => g.Key, g => g.Quantity);
        var billLines = await db.BillLines.AsNoTracking()
            .Where(l => l.PurchaseOrderLineId != null && lineIds.Contains(l.PurchaseOrderLineId.Value)
                && l.Bill!.State == BillState.Posted && l.Bill.DocumentType == DocumentType.Bill)
            .Select(l => new { l.Id, OrderLine = l.PurchaseOrderLineId!.Value, Quantity = l.Quantity * l.UnitFactor })
            .ToListAsync();
        var billLineIds = billLines.Select(l => l.Id).ToList();
        // Receipt matches are already in base units.
        var matched = await db.ReceiptMatches.AsNoTracking().Where(m => billLineIds.Contains(m.BillLineId))
            .GroupBy(m => m.BillLineId).Select(g => new { g.Key, Quantity = g.Sum(m => m.Quantity) })
            .ToDictionaryAsync(g => g.Key, g => g.Quantity);
        var direct = billLines.GroupBy(l => l.OrderLine)
            .ToDictionary(g => g.Key, g => g.Sum(l => Math.Max(0m, l.Quantity - matched.GetValueOrDefault(l.Id))));
        return lineIds.ToDictionary(id => id, id => receipts.GetValueOrDefault(id) + direct.GetValueOrDefault(id));
    }

    // Billed per order line: posted bills, and drafts still waiting.
    public static async Task<Dictionary<Guid, (decimal Posted, decimal Draft)>> BilledAsync(PakoDbContext db, IReadOnlyCollection<Guid> lineIds)
    {
        if (lineIds.Count == 0) return new();
        var rows = await db.BillLines.AsNoTracking()
            .Where(l => l.PurchaseOrderLineId != null && lineIds.Contains(l.PurchaseOrderLineId.Value)
                && l.Bill!.State != BillState.Cancelled && l.Bill.DocumentType == DocumentType.Bill)
            .Select(l => new { LineId = l.PurchaseOrderLineId!.Value, Quantity = l.Quantity * l.UnitFactor, Posted = l.Bill!.State == BillState.Posted })
            .ToListAsync();
        return rows.GroupBy(r => r.LineId).ToDictionary(g => g.Key,
            g => (g.Where(r => r.Posted).Sum(r => r.Quantity), g.Where(r => !r.Posted).Sum(r => r.Quantity)));
    }
}
