using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Documents;
using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// Client feedback phase 5 — what the customer portal reads and prices. Prices come from
// PriceListService (the customer's list, wholesale tier, shop/company list, default price) with the
// period discount rule of the day; line money from SalesOrderLine.Gross and the tax service, the same
// way a staff-made sales order is priced, so what the customer saw is what the order holds.
public class PortalService
{
    public const int MaxLines = 200;

    private readonly PakoDbContext _db;
    private readonly PriceListService _prices;
    private readonly ITaxComputationService _tax;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PortalService(PakoDbContext db, PriceListService prices, ITaxComputationService tax, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _prices = prices;
        _tax = tax;
        _localizer = localizer;
    }

    public static DateOnly Today => DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));

    // ---- Companies ----

    public async Task<List<PortalCompanyResponse>> CompaniesAsync(Guid userId)
    {
        var rows = await (
            from m in _db.Memberships.AsNoTracking()
            join c in _db.Companies.AsNoTracking() on m.CompanyId equals c.Id
            join p in _db.Partners.AsNoTracking() on m.PartnerId equals p.Id
            where m.UserId == userId && m.IsActive && m.Role == MembershipRole.ClientCustomer && !c.IsArchived && p.IsCustomer
            orderby c.Name
            select new { c.Id, c.Name, PartnerId = p.Id, PartnerName = p.Name, c.LogoUrl, c.EnabledModules })
            .ToListAsync();
        return rows.Where(r => AppModules.IsEnabled(r.EnabledModules, Pako.Domain.Hr.AccessModule.Sales))
            .Select(r => new PortalCompanyResponse(r.Id, r.Name, r.PartnerId, r.PartnerName, r.LogoUrl)).ToList();
    }

    // ---- Catalogue ----

    // Items the company sells that have a price for this customer: active, not a variant template.
    private IQueryable<Item> Sellable(Guid companyId) =>
        _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.IsActive && !i.IsVariantTemplate
            && (i.DefaultUnitPrice != null || i.WholesalePrice != null
                || _db.PriceListPrices.Any(p => p.ItemId == i.Id && p.MinQuantity == 0)));

    public async Task<List<PortalCategoryResponse>> CategoriesAsync(Guid companyId)
    {
        var ids = await Sellable(companyId).Where(i => i.CategoryId != null).Select(i => i.CategoryId!.Value).Distinct().ToListAsync();
        return await _db.ItemCategories.AsNoTracking().Where(c => ids.Contains(c.Id)).OrderBy(c => c.Name)
            .Select(c => new PortalCategoryResponse(c.Id, c.Name)).ToListAsync();
    }

    public async Task<PaginatedResponse<PortalCatalogueItemResponse>> CatalogueAsync(Guid companyId, Guid partnerId, string? search,
        Guid? categoryId, int page, int pageSize)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = Sellable(companyId);
        if (categoryId is { } category) query = query.Where(i => i.CategoryId == category);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = LikePattern.Contains(search);
            query = query.Where(i => EF.Functions.ILike(i.Name, pattern, LikePattern.EscapeChar)
                || (i.Description != null && EF.Functions.ILike(i.Description, pattern, LikePattern.EscapeChar))
                || i.Barcodes.Any(b => b.Barcode == search.Trim()));
        }
        var total = await query.CountAsync();
        var items = await query.OrderBy(i => i.Name).ThenBy(i => i.Code).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var ids = items.Select(i => i.Id).ToList();
        var prices = (await _prices.ResolveAsync(companyId, null, Today, ids, partnerId: partnerId)).ToDictionary(p => p.ItemId);
        var categoryIds = items.Where(i => i.CategoryId != null).Select(i => i.CategoryId!.Value).Distinct().ToList();
        var categories = await _db.ItemCategories.AsNoTracking().Where(c => categoryIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name);
        var inStock = await InStockAsync(companyId, items.Where(i => i.TrackInventory).Select(i => i.Id).ToList());

        var rows = items.Select(i =>
        {
            var price = prices.GetValueOrDefault(i.Id);
            var unitPrice = price?.Price ?? 0m;
            var discount = price?.DiscountPercent ?? 0m;
            var units = (price?.Units ?? new()).Select(u => new PortalUnitPriceResponse(u.UnitName, u.Factor, u.Price)).ToList();
            return new PortalCatalogueItemResponse(i.Id, i.Code, i.Name, i.Description, i.CategoryId,
                i.CategoryId is { } c ? categories.GetValueOrDefault(c) : null, i.Unit, unitPrice, discount,
                new SalesOrderLine { Quantity = 1m, UnitPrice = unitPrice, DiscountPercent = discount }.Gross,
                i.TrackInventory ? inStock.Contains(i.Id) : null, units);
        }).ToList();
        return new PaginatedResponse<PortalCatalogueItemResponse>(rows, total, page, pageSize);
    }

    // Tracked items with a positive quantity in some warehouse (internal locations only).
    private async Task<HashSet<Guid>> InStockAsync(Guid companyId, List<Guid> itemIds)
    {
        if (itemIds.Count == 0) return new HashSet<Guid>();
        var internalLocations = _db.StockLocations.Where(l => l.CompanyId == companyId && l.Usage == LocationUsage.Internal).Select(l => l.Id);
        var rows = await _db.StockBalances.AsNoTracking()
            .Where(b => b.CompanyId == companyId && itemIds.Contains(b.ItemId) && internalLocations.Contains(b.LocationId))
            .GroupBy(b => b.ItemId).Select(g => new { g.Key, Quantity = g.Sum(b => b.Quantity) })
            .ToListAsync();
        return rows.Where(r => r.Quantity > 0).Select(r => r.Key).ToHashSet();
    }

    // ---- Pricing a cart / an order ----

    public record PricedLines(List<SalesOrderLine>? Lines, string? Error);

    // The customer's lines as sales order lines, priced for this customer today. Errors name the
    // first problem in the customer's words.
    public async Task<PricedLines> PriceAsync(Guid companyId, Guid partnerId, List<PortalOrderLineRequest>? requested)
    {
        if (requested is null || requested.Count == 0) return new(null, _localizer["PortalOrderEmpty"].Value);
        if (requested.Count > MaxLines) return new(null, string.Format(_localizer["PortalOrderTooManyLines"].Value, MaxLines));
        if (requested.Any(l => l.Quantity <= 0 || l.Quantity > 1_000_000m)) return new(null, _localizer["LineQuantityMustBePositive"].Value);

        var ids = requested.Select(l => l.ItemId).Distinct().ToList();
        var items = await Sellable(companyId).Where(i => ids.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        if (ids.Any(id => !items.ContainsKey(id))) return new(null, _localizer["PortalItemUnavailable"].Value);

        var lines = new List<SalesOrderLine>();
        var baseQuantities = new Dictionary<Guid, decimal>();
        foreach (var line in requested)
        {
            var item = items[line.ItemId];
            if (StockService.ResolveUnit(item, line.UnitName) is not { } unit)
            {
                return new(null, string.Format(_localizer["LineUnitUnknown"].Value, line.UnitName));
            }
            baseQuantities[item.Id] = baseQuantities.GetValueOrDefault(item.Id) + line.Quantity * unit.Factor;
            lines.Add(new SalesOrderLine
            {
                Id = Guid.NewGuid(), ItemId = item.Id, Description = item.Name, Quantity = line.Quantity, UnitName = unit.Name,
                UnitFactor = unit.Factor, TaxDefinitionId = item.DefaultTaxDefinitionId, SortOrder = lines.Count,
            });
        }

        // Volume tiers look at the whole quantity of the item on the order.
        var prices = (await _prices.ResolveAsync(companyId, null, Today, ids, partnerId: partnerId, quantities: baseQuantities))
            .ToDictionary(p => p.ItemId);
        foreach (var line in lines)
        {
            if (prices.GetValueOrDefault(line.ItemId!.Value) is not { } price) return new(null, _localizer["PortalItemUnavailable"].Value);
            line.UnitPrice = line.UnitName is null
                ? price.Price
                : price.Units?.FirstOrDefault(u => string.Equals(u.UnitName, line.UnitName, StringComparison.OrdinalIgnoreCase))?.Price
                    ?? Math.Round(price.Price * line.UnitFactor, 4, MidpointRounding.AwayFromZero);
            line.DiscountPercent = price.DiscountPercent ?? 0m;
        }
        return new(lines, null);
    }

    // Net, VAT and gross of order lines, exactly as SalesOrdersController shows them.
    public async Task<(List<PortalPricedLineResponse> Lines, decimal Net, decimal Vat, decimal Gross)> AmountsAsync(IEnumerable<SalesOrderLine> lines)
    {
        var list = lines.OrderBy(l => l.SortOrder).ToList();
        var taxIds = list.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines).Where(t => taxIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
        var rows = list.Select(l =>
        {
            var gross = l.Gross;
            var net = l.TaxDefinitionId is { } t && taxes.TryGetValue(t, out var tax) ? _tax.ComputeFromGross(gross, tax).NetAmount : gross;
            return new PortalPricedLineResponse(l.ItemId, l.Description, l.Quantity, l.UnitName, l.UnitPrice, l.DiscountPercent, net, gross - net, gross);
        }).ToList();
        return (rows, rows.Sum(r => r.Net), rows.Sum(r => r.Vat), rows.Sum(r => r.Gross));
    }

    // ---- Orders ----

    public static string Status(SalesOrderState state) => state switch
    {
        SalesOrderState.Draft => "Submitted",
        _ => state.ToString(),
    };

    // What the customer calls the order before the company numbers it.
    public static string Reference(SalesOrder order) => order.Number ?? order.QuoteNumber ?? $"WEB-{order.Id.ToString("N")[..8].ToUpperInvariant()}";

    public async Task<List<PortalDocumentResponse>> InvoicesForOrderAsync(SalesOrder order)
    {
        var lineIds = order.Lines.Select(l => l.Id).ToList();
        return await _db.Invoices.AsNoTracking()
            .Where(i => i.CompanyId == order.CompanyId && i.PartnerId == order.PartnerId && i.State == InvoiceState.Posted
                && i.Lines.Any(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId.Value)))
            .OrderBy(i => i.IssueDate)
            .Select(i => new PortalDocumentResponse(i.Id, i.InvoiceNumber, i.IssueDate))
            .ToListAsync();
    }

    // ---- Invoices ----

    // The documents a customer sees: posted, never drafts or proformas.
    public static readonly DocumentType[] VisibleDocumentTypes =
        { DocumentType.Invoice, DocumentType.DebitNote, DocumentType.CreditNote, DocumentType.SalesReturn, DocumentType.DownPayment };

    public IQueryable<Invoice> Invoices(Guid companyId, Guid partnerId) =>
        _db.Invoices.AsNoTracking().Where(i => i.CompanyId == companyId && i.PartnerId == partnerId && i.State == InvoiceState.Posted
            && VisibleDocumentTypes.Contains(i.DocumentType));

    // Each invoice's total from its lines (the posting calculator), and for invoices and debit notes
    // what is still open: the receivable it put on less the payments matched to it.
    public async Task<Dictionary<Guid, (DocumentLineAmounts Total, decimal? Open)>> TotalsAsync(Guid companyId, Guid partnerId, List<Invoice> invoices)
    {
        var taxIds = invoices.SelectMany(i => i.Lines).Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == companyId && taxIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
        var receivable = await ReceivableAccountAsync(companyId, partnerId);
        var withOpen = invoices.Where(i => i.DocumentType is DocumentType.Invoice or DocumentType.DebitNote && i.JournalEntryId != null).ToList();
        var entryIds = withOpen.Select(i => i.JournalEntryId!.Value).ToList();
        var invoiceIds = withOpen.Select(i => i.Id).ToList();
        var charged = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => entryIds.Contains(l.JournalEntryId) && l.AccountId == receivable)
            .GroupBy(l => l.JournalEntryId).Select(g => new { g.Key, Amount = g.Sum(l => l.Debit) })
            .ToDictionaryAsync(g => g.Key, g => g.Amount);
        var paid = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.InvoiceId != null && invoiceIds.Contains(r.InvoiceId.Value))
            .GroupBy(r => r.InvoiceId!.Value).Select(g => new { g.Key, Amount = g.Sum(r => r.Amount) })
            .ToDictionaryAsync(g => g.Key, g => g.Amount);

        return invoices.ToDictionary(i => i.Id, i =>
        {
            var total = DocumentLineAmounts.Sum(i.Lines.Select(l => LineAmounts(l, i.PriceMode, taxes)));
            decimal? open = i.DocumentType is DocumentType.Invoice or DocumentType.DebitNote && i.JournalEntryId is { } je
                ? Math.Max(0m, charged.GetValueOrDefault(je) - paid.GetValueOrDefault(i.Id))
                : null;
            return (total, open);
        });
    }

    public DocumentLineAmounts LineAmounts(InvoiceLine line, PriceMode mode, IReadOnlyDictionary<Guid, TaxDefinition> taxes) =>
        DocumentLineCalculator.Amounts(line.Quantity, line.UnitPrice, line.DiscountPercent,
            line.TaxDefinitionId is { } t ? taxes.GetValueOrDefault(t) : null, _tax, mode);

    public async Task<Dictionary<Guid, TaxDefinition>> TaxesForAsync(Guid companyId, IEnumerable<InvoiceLine> lines)
    {
        var ids = lines.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        return await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == companyId && ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
    }

    private async Task<Guid> ReceivableAccountAsync(Guid companyId, Guid partnerId) =>
        await _db.Partners.AsNoTracking().Where(p => p.Id == partnerId).Select(p => p.ReceivableAccountId).FirstOrDefaultAsync()
        ?? await _db.CompanyAccountDefaults.AsNoTracking().Where(d => d.CompanyId == companyId).Select(d => (Guid?)d.ReceivableAccountId).FirstOrDefaultAsync()
        ?? Guid.Empty;
}
