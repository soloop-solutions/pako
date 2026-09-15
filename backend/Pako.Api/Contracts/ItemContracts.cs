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

// B7: paginated response wrapper — other controllers can adopt this shape later.
public record PaginatedResponse<T>(List<T> Items, int Total);
