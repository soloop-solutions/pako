using Pako.Domain.Companies;

namespace Pako.Api.Contracts;

public record CreateItemRequest(
    string Name,
    string Unit,
    ItemType Type = ItemType.Goods,
    Guid? DefaultTaxDefinitionId = null,
    Guid? DefaultRevenueAccountId = null,
    Guid? DefaultExpenseAccountId = null,
    Guid? DefaultInventoryAccountId = null,
    decimal? DefaultUnitPrice = null);

public record UpdateItemRequest(
    string Name,
    string Unit,
    ItemType Type = ItemType.Goods,
    Guid? DefaultTaxDefinitionId = null,
    Guid? DefaultRevenueAccountId = null,
    Guid? DefaultExpenseAccountId = null,
    Guid? DefaultInventoryAccountId = null,
    decimal? DefaultUnitPrice = null);

public record AddBarcodeRequest(string Barcode);

public record ItemBarcodeResponse(Guid Id, string Barcode);

public record ItemResponse(
    Guid Id,
    int Code,
    string Name,
    string Unit,
    ItemType Type,
    Guid? DefaultTaxDefinitionId,
    Guid? DefaultRevenueAccountId,
    Guid? DefaultExpenseAccountId,
    Guid? DefaultInventoryAccountId,
    decimal? DefaultUnitPrice,
    List<ItemBarcodeResponse> Barcodes);

// B7: the one paginated-list shape — ?page=&pageSize=&search=&sort= in, { items, total, page,
// pageSize } out. Proved here on Items (including the 35,000-row/index-backed verify criterion);
// retrofitting Partners/Invoices/Bills/JournalEntries onto this same shape is deliberately NOT
// done in this task — see AI_BACKEND_AGENT.md section 5's explicit stop condition ("a task would
// require changing a response shape another task already shipped"). Those four endpoints already
// return a plain List<T> that a substantial, live part of apps/web/ consumes as an array; wrapping
// them would be a real breaking change with its own frontend-side migration (already scoped
// separately as F8 in docs/FRONTEND_BRIEF.md — "retro-fit the grid onto invoices, bills, partners
// and journal entries as B7 lands each one"), not something to do unilaterally from the backend
// lane in the same commit that defines the shape.
public record PaginatedResponse<T>(List<T> Items, int Total, int Page, int PageSize);
