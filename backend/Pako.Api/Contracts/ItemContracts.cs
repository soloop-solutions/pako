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
    decimal? DefaultUnitPrice = null,
    string? Description = null,
    // docs/INVENTORY_PLAN.md: category (D9), stock tracking (D5, Goods only), low-stock threshold.
    Guid? CategoryId = null,
    bool TrackInventory = false,
    decimal? MinimumStock = null,
    // §12 P8: quantities per lot with expiry dates (stock-tracked goods only).
    bool TrackLots = false,
    // §12 P7: optional purchase and sales units, each a named multiple of Unit (the base unit).
    string? PurchaseUnit = null,
    decimal? PurchaseUnitFactor = null,
    string? SalesUnit = null,
    decimal? SalesUnitFactor = null,
    // docs/POS_PLAN.md P2: till settings.
    string? Plu = null,
    bool SellByWeight = false,
    bool OpenPrice = false,
    int? MinimumAge = null,
    Guid? DepositItemId = null,
    // P2: serial numbers (IMEI) per unit sold, and the warranty they carry.
    bool TrackSerials = false,
    int? WarrantyMonths = null,
    // P4: bookable service (minutes, buffer); a package of sessions of another item; a membership period.
    bool IsBookable = false,
    int? DurationMinutes = null,
    int? BufferMinutes = null,
    Guid? PackageServiceItemId = null,
    int? PackageSessions = null,
    int? PackageValidDays = null,
    int? MembershipDays = null,
    // P7 pharmacy: ATC code, active ingredient, prescription-only, controlled, state price cap.
    string? AtcCode = null,
    string? ActiveIngredient = null,
    bool IsPrescriptionOnly = false,
    bool IsControlled = false,
    decimal? MaxRetailPrice = null,
    // P7 agency items: the principal it is sold for, and the commission kept (percent).
    Guid? AgencyPartnerId = null,
    decimal? AgencyCommissionPercent = null);

public record UpdateItemRequest(
    string Name,
    string Unit,
    ItemType Type = ItemType.Goods,
    Guid? DefaultTaxDefinitionId = null,
    Guid? DefaultRevenueAccountId = null,
    Guid? DefaultExpenseAccountId = null,
    Guid? DefaultInventoryAccountId = null,
    decimal? DefaultUnitPrice = null,
    string? Description = null,
    Guid? CategoryId = null,
    bool TrackInventory = false,
    decimal? MinimumStock = null,
    // §12 P8: quantities per lot with expiry dates (stock-tracked goods only).
    bool TrackLots = false,
    // §12 P7: optional purchase and sales units, each a named multiple of Unit (the base unit).
    string? PurchaseUnit = null,
    decimal? PurchaseUnitFactor = null,
    string? SalesUnit = null,
    decimal? SalesUnitFactor = null,
    // docs/POS_PLAN.md P2: till settings.
    string? Plu = null,
    bool SellByWeight = false,
    bool OpenPrice = false,
    int? MinimumAge = null,
    Guid? DepositItemId = null,
    // P2: serial numbers (IMEI) per unit sold, and the warranty they carry.
    bool TrackSerials = false,
    int? WarrantyMonths = null,
    // P4: bookable service (minutes, buffer); a package of sessions of another item; a membership period.
    bool IsBookable = false,
    int? DurationMinutes = null,
    int? BufferMinutes = null,
    Guid? PackageServiceItemId = null,
    int? PackageSessions = null,
    int? PackageValidDays = null,
    int? MembershipDays = null,
    // P7 pharmacy: ATC code, active ingredient, prescription-only, controlled, state price cap.
    string? AtcCode = null,
    string? ActiveIngredient = null,
    bool IsPrescriptionOnly = false,
    bool IsControlled = false,
    decimal? MaxRetailPrice = null,
    // P7 agency items: the principal it is sold for, and the commission kept (percent).
    Guid? AgencyPartnerId = null,
    decimal? AgencyCommissionPercent = null);

public record AddBarcodeRequest(string Barcode);

public record ItemBarcodeResponse(Guid Id, string Barcode);

public record ItemResponse(
    Guid Id,
    int Code,
    string Name,
    string? Description,
    string Unit,
    ItemType Type,
    Guid? DefaultTaxDefinitionId,
    Guid? DefaultRevenueAccountId,
    Guid? DefaultExpenseAccountId,
    Guid? DefaultInventoryAccountId,
    decimal? DefaultUnitPrice,
    List<ItemBarcodeResponse> Barcodes,
    Guid? CategoryId = null,
    bool TrackInventory = false,
    decimal? MinimumStock = null,
    // True once stock has moved: tracking can't be switched off and the type can't change.
    bool HasStockMoves = false,
    bool TrackLots = false,
    string? PurchaseUnit = null,
    decimal? PurchaseUnitFactor = null,
    string? SalesUnit = null,
    decimal? SalesUnitFactor = null,
    // docs/POS_PLAN.md P2: till settings.
    string? Plu = null,
    bool SellByWeight = false,
    bool OpenPrice = false,
    int? MinimumAge = null,
    Guid? DepositItemId = null,
    bool TrackSerials = false,
    int? WarrantyMonths = null,
    // P2 variants: a template (not sold itself) or a variant of one, with its attribute values.
    bool IsVariantTemplate = false,
    Guid? VariantOfItemId = null,
    string? VariantLabel = null,
    bool IsBookable = false,
    int? DurationMinutes = null,
    int? BufferMinutes = null,
    Guid? PackageServiceItemId = null,
    int? PackageSessions = null,
    int? PackageValidDays = null,
    int? MembershipDays = null,
    Guid? ProductionCenterId = null,
    string? AtcCode = null,
    string? ActiveIngredient = null,
    bool IsPrescriptionOnly = false,
    bool IsControlled = false,
    decimal? MaxRetailPrice = null,
    Guid? AgencyPartnerId = null,
    decimal? AgencyCommissionPercent = null);

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

// ---- P2: variants ----

public record ItemAttributeResponse(Guid Id, string Name, int SortOrder, List<ItemAttributeValueResponse> Values);
public record ItemAttributeValueResponse(Guid Id, string Value, int SortOrder);
// Values are matched by id; a value without an id is added. Values can't be removed once a variant uses them.
public record SaveItemAttributeRequest(string Name, int SortOrder, List<SaveItemAttributeValueRequest> Values);
public record SaveItemAttributeValueRequest(Guid? Id, string Value, int SortOrder);

// Every combination of the chosen values (one or more values per attribute) becomes a variant,
// unless it exists already.
public record GenerateVariantsRequest(List<Guid> AttributeValueIds);
public record ItemVariantResponse(Guid ItemId, int Code, string Name, string Label, List<Guid> AttributeValueIds, List<string> Barcodes,
    decimal? Price, decimal OnHand, bool IsActive);

// ---- P3: recipes ----

public record RecipeLineResponse(Guid IngredientItemId, string IngredientName, string Unit, decimal Quantity, decimal WastePercent, int SortOrder);
// Replaces the item's recipe (empty: no recipe — the item itself moves stock).
public record SaveRecipeRequest(List<SaveRecipeLineRequest> Lines);
public record SaveRecipeLineRequest(Guid IngredientItemId, decimal Quantity, decimal WastePercent = 0m);

