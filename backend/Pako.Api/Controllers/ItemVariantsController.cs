using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md P2 (fashion): attributes (size, colour …) and the variants of a template item.
// Each variant is an ordinary item, so stock, prices, barcodes and documents need nothing new.
[ApiController]
[Route("api/companies/{companyId:guid}/items")]
[Authorize]
public class ItemVariantsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly NumberSeriesService _numberSeries;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public ItemVariantsController(PakoDbContext db, NumberSeriesService numberSeries, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _numberSeries = numberSeries;
        _localizer = localizer;
    }

    // ---- Attributes ----

    [HttpGet("attributes", Name = "ListItemAttributes")]
    [RequireCompanyAccess(module: AccessModule.Items)]
    public async Task<ActionResult<List<ItemAttributeResponse>>> Attributes(Guid companyId)
    {
        var attributes = await _db.ItemAttributes.AsNoTracking().Include(a => a.Values).Where(a => a.CompanyId == companyId)
            .OrderBy(a => a.SortOrder).ThenBy(a => a.Name).ToListAsync();
        return Ok(attributes.Select(ToResponse).ToList());
    }

    [HttpPost("attributes", Name = "CreateItemAttribute")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    [ProducesResponseType(typeof(ItemAttributeResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ItemAttributeResponse>> CreateAttribute(Guid companyId, SaveItemAttributeRequest request)
    {
        var attribute = new ItemAttribute { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyAsync(companyId, attribute, request) is { } error) return BadRequest(error);
        _db.ItemAttributes.Add(attribute);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(attribute));
    }

    [HttpPut("attributes/{attributeId:guid}", Name = "UpdateItemAttribute")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    public async Task<ActionResult<ItemAttributeResponse>> UpdateAttribute(Guid companyId, Guid attributeId, SaveItemAttributeRequest request)
    {
        var attribute = await _db.ItemAttributes.Include(a => a.Values).FirstOrDefaultAsync(a => a.Id == attributeId && a.CompanyId == companyId);
        if (attribute is null) return NotFound();
        if (await ApplyAsync(companyId, attribute, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok(ToResponse(attribute));
    }

    private async Task<string?> ApplyAsync(Guid companyId, ItemAttribute attribute, SaveItemAttributeRequest r)
    {
        var name = (r.Name ?? "").Trim();
        if (name.Length == 0 || r.Values is null || r.Values.Count == 0 || r.Values.Any(v => string.IsNullOrWhiteSpace(v.Value)))
        {
            return _localizer["ItemAttributeInvalid"].Value;
        }
        if (r.Values.Select(v => v.Value.Trim().ToUpperInvariant()).Distinct().Count() != r.Values.Count) return _localizer["ItemAttributeInvalid"].Value;
        if (await _db.ItemAttributes.AnyAsync(a => a.CompanyId == companyId && a.Name == name && a.Id != attribute.Id)) return _localizer["ItemAttributeTaken"].Value;

        // A value a variant uses can be renamed but not removed.
        var kept = r.Values.Where(v => v.Id != null).Select(v => v.Id!.Value).ToHashSet();
        var removed = attribute.Values.Where(v => !kept.Contains(v.Id)).ToList();
        var removedIds = removed.Select(v => v.Id).ToList();
        if (removed.Count > 0 && await _db.ItemVariantValues.AnyAsync(v => removedIds.Contains(v.AttributeValueId))) return _localizer["ItemAttributeValueInUse"].Value;
        _db.ItemAttributeValues.RemoveRange(removed);
        foreach (var v in removed) attribute.Values.Remove(v);

        attribute.Name = name;
        attribute.SortOrder = r.SortOrder;
        foreach (var v in r.Values)
        {
            var existing = v.Id is { } id ? attribute.Values.FirstOrDefault(x => x.Id == id) : null;
            if (existing is null)
            {
                var added = new ItemAttributeValue { Id = Guid.NewGuid(), AttributeId = attribute.Id, Value = v.Value.Trim(), SortOrder = v.SortOrder };
                attribute.Values.Add(added);
                if (_db.Entry(attribute).State != EntityState.Detached) _db.ItemAttributeValues.Add(added);
            }
            else
            {
                existing.Value = v.Value.Trim();
                existing.SortOrder = v.SortOrder;
            }
        }
        return null;
    }

    private static ItemAttributeResponse ToResponse(ItemAttribute a) => new(a.Id, a.Name, a.SortOrder,
        a.Values.OrderBy(v => v.SortOrder).ThenBy(v => v.Value).Select(v => new ItemAttributeValueResponse(v.Id, v.Value, v.SortOrder)).ToList());

    // ---- Variants ----

    [HttpGet("{itemId:guid}/variants", Name = "ListItemVariants")]
    [RequireCompanyAccess(module: AccessModule.Items)]
    public async Task<ActionResult<List<ItemVariantResponse>>> Variants(Guid companyId, Guid itemId)
    {
        if (!await _db.Items.AnyAsync(i => i.Id == itemId && i.CompanyId == companyId)) return NotFound();
        return Ok(await VariantsAsync(companyId, itemId));
    }

    // Turns an item into a template (when it hasn't moved stock) and creates a variant for every
    // combination of the chosen values that doesn't exist yet. Variants copy the template's price,
    // tax, accounts, category, units and tracking; codes come from the item series.
    [HttpPost("{itemId:guid}/variants", Name = "GenerateItemVariants")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    public async Task<ActionResult<List<ItemVariantResponse>>> Generate(Guid companyId, Guid itemId, GenerateVariantsRequest request)
    {
        var template = await _db.Items.FirstOrDefaultAsync(i => i.Id == itemId && i.CompanyId == companyId);
        if (template is null) return NotFound();
        if (template.VariantOfItemId != null) return BadRequest(_localizer["ItemVariantOfVariant"].Value);
        if (!template.IsVariantTemplate && await _db.StockMoves.AnyAsync(m => m.ItemId == itemId)) return BadRequest(_localizer["ItemTemplateHasStock"].Value);

        var valueIds = request.AttributeValueIds.Distinct().ToList();
        var values = await (from v in _db.ItemAttributeValues
                            join a in _db.ItemAttributes on v.AttributeId equals a.Id
                            where a.CompanyId == companyId && valueIds.Contains(v.Id)
                            select new { v.Id, v.Value, v.SortOrder, a.Name, AttributeId = a.Id, AttributeOrder = a.SortOrder }).ToListAsync();
        if (values.Count == 0 || values.Count != valueIds.Count) return BadRequest(_localizer["ItemAttributeInvalid"].Value);

        // The cartesian product, attribute by attribute.
        var axes = values.GroupBy(v => v.AttributeId).OrderBy(g => g.First().AttributeOrder).ThenBy(g => g.First().Name)
            .Select(g => g.OrderBy(v => v.SortOrder).ThenBy(v => v.Value).ToList()).ToList();
        IEnumerable<List<(Guid Id, string Value)>> combos = new[] { new List<(Guid, string)>() };
        foreach (var axis in axes) combos = combos.SelectMany(c => axis.Select(v => c.Append((v.Id, v.Value)).ToList()));
        var combinations = combos.ToList();
        if (combinations.Count > 500) return BadRequest(_localizer["ItemVariantsTooMany"].Value);

        var existing = (await _db.ItemVariantValues.AsNoTracking()
                .Where(v => _db.Items.Any(i => i.Id == v.ItemId && i.VariantOfItemId == itemId)).ToListAsync())
            .GroupBy(v => v.ItemId).Select(g => g.Select(v => v.AttributeValueId).OrderBy(x => x).ToList()).ToList();

        var taken = (await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId).Select(i => i.Code).ToListAsync()).ToHashSet();
        var nextCode = int.Parse(await _numberSeries.ReserveNextAsync(companyId, "Item", DateTime.UtcNow.Year));
        template.IsVariantTemplate = true;
        foreach (var combo in combinations)
        {
            var ids = combo.Select(c => c.Id).OrderBy(x => x).ToList();
            if (existing.Any(e => e.SequenceEqual(ids))) continue;
            // Codes continue from the item series (derived from saved items, so the variants of
            // this batch count on from it), skipping codes already taken.
            while (taken.Contains(nextCode)) nextCode++;
            var code = nextCode++;
            taken.Add(code);
            var variant = new Item
            {
                Id = Guid.NewGuid(), CompanyId = companyId, Code = code, Name = $"{template.Name} {string.Join(" / ", combo.Select(c => c.Value))}",
                Description = template.Description, Unit = template.Unit, Type = template.Type, DefaultTaxDefinitionId = template.DefaultTaxDefinitionId,
                DefaultRevenueAccountId = template.DefaultRevenueAccountId, DefaultExpenseAccountId = template.DefaultExpenseAccountId,
                DefaultInventoryAccountId = template.DefaultInventoryAccountId, DefaultUnitPrice = template.DefaultUnitPrice, CategoryId = template.CategoryId,
                TrackInventory = template.TrackInventory, MinimumStock = template.MinimumStock, TrackLots = template.TrackLots,
                PurchaseUnit = template.PurchaseUnit, PurchaseUnitFactor = template.PurchaseUnitFactor, SalesUnit = template.SalesUnit,
                SalesUnitFactor = template.SalesUnitFactor, MinimumAge = template.MinimumAge, TrackSerials = template.TrackSerials,
                WarrantyMonths = template.WarrantyMonths, VariantOfItemId = template.Id,
            };
            _db.Items.Add(variant);
            _db.ItemVariantValues.AddRange(ids.Select(id => new ItemVariantValue { ItemId = variant.Id, AttributeValueId = id }));
        }
        await _db.SaveChangesAsync();
        return Ok(await VariantsAsync(companyId, itemId));
    }

    private async Task<List<ItemVariantResponse>> VariantsAsync(Guid companyId, Guid templateId)
    {
        var variants = await _db.Items.AsNoTracking().Include(i => i.Barcodes).Where(i => i.CompanyId == companyId && i.VariantOfItemId == templateId)
            .OrderBy(i => i.Code).ToListAsync();
        var ids = variants.Select(v => v.Id).ToList();
        var labels = await VariantLabelsAsync(_db, ids);
        var valueIds = await _db.ItemVariantValues.AsNoTracking().Where(v => ids.Contains(v.ItemId)).ToListAsync();
        var onHand = await _db.ItemCosts.AsNoTracking().Where(k => ids.Contains(k.ItemId)).ToDictionaryAsync(k => k.ItemId, k => k.Quantity);
        return variants.Select(v => new ItemVariantResponse(v.Id, v.Code, v.Name, labels.GetValueOrDefault(v.Id) ?? "",
            valueIds.Where(x => x.ItemId == v.Id).Select(x => x.AttributeValueId).ToList(), v.Barcodes.Select(b => b.Barcode).ToList(),
            v.DefaultUnitPrice, onHand.GetValueOrDefault(v.Id), true)).ToList();
    }

    // ---- Recipes (P3) ----

    [HttpGet("{itemId:guid}/recipe", Name = "GetItemRecipe")]
    [RequireCompanyAccess(module: AccessModule.Items)]
    public async Task<ActionResult<List<RecipeLineResponse>>> Recipe(Guid companyId, Guid itemId)
    {
        if (!await _db.Items.AnyAsync(i => i.Id == itemId && i.CompanyId == companyId)) return NotFound();
        return Ok(await RecipeAsync(itemId));
    }

    [HttpPut("{itemId:guid}/recipe", Name = "SaveItemRecipe")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    public async Task<ActionResult<List<RecipeLineResponse>>> SaveRecipe(Guid companyId, Guid itemId, SaveRecipeRequest request)
    {
        if (!await _db.Items.AnyAsync(i => i.Id == itemId && i.CompanyId == companyId)) return NotFound();
        var lines = request.Lines ?? new();
        if (lines.Any(l => l.Quantity <= 0 || l.WastePercent is < 0 or >= 100 || l.IngredientItemId == itemId)
            || lines.Select(l => l.IngredientItemId).Distinct().Count() != lines.Count)
        {
            return BadRequest(_localizer["RecipeInvalid"].Value);
        }
        var ingredientIds = lines.Select(l => l.IngredientItemId).ToList();
        if (await _db.Items.CountAsync(i => i.CompanyId == companyId && ingredientIds.Contains(i.Id)) != ingredientIds.Count) return BadRequest(_localizer["PosItemNotFound"].Value);
        // No loops: no ingredient may (through its own recipe) contain this item.
        var seen = new HashSet<Guid>();
        var frontier = ingredientIds.ToList();
        for (var depth = 0; depth < Services.PosService.RecipeDepth && frontier.Count > 0; depth++)
        {
            if (frontier.Contains(itemId)) return BadRequest(_localizer["RecipeLoop"].Value);
            seen.UnionWith(frontier);
            frontier = (await _db.RecipeLines.AsNoTracking().Where(r => frontier.Contains(r.ItemId)).Select(r => r.IngredientItemId).ToListAsync())
                .Where(id => !seen.Contains(id) || id == itemId).Distinct().ToList();
        }
        if (frontier.Count > 0) return BadRequest(_localizer["RecipeLoop"].Value);

        _db.RecipeLines.RemoveRange(await _db.RecipeLines.Where(r => r.ItemId == itemId).ToListAsync());
        _db.RecipeLines.AddRange(lines.Select((l, i) => new Pako.Domain.Inventory.RecipeLine
        {
            Id = Guid.NewGuid(), ItemId = itemId, IngredientItemId = l.IngredientItemId, Quantity = l.Quantity, WastePercent = l.WastePercent, SortOrder = i,
        }));
        await _db.SaveChangesAsync();
        return Ok(await RecipeAsync(itemId));
    }

    private async Task<List<RecipeLineResponse>> RecipeAsync(Guid itemId) =>
        await (from r in _db.RecipeLines.AsNoTracking()
               join i in _db.Items.AsNoTracking() on r.IngredientItemId equals i.Id
               where r.ItemId == itemId
               orderby r.SortOrder
               select new RecipeLineResponse(r.IngredientItemId, i.Name, i.Unit, r.Quantity, r.WastePercent, r.SortOrder)).ToListAsync();

    // "M / Blue": a variant's values in attribute order.
    public static async Task<Dictionary<Guid, string>> VariantLabelsAsync(PakoDbContext db, IReadOnlyCollection<Guid> itemIds)
    {
        if (itemIds.Count == 0) return new();
        var rows = await (from vv in db.ItemVariantValues.AsNoTracking()
                          join v in db.ItemAttributeValues.AsNoTracking() on vv.AttributeValueId equals v.Id
                          join a in db.ItemAttributes.AsNoTracking() on v.AttributeId equals a.Id
                          where itemIds.Contains(vv.ItemId)
                          select new { vv.ItemId, v.Value, a.SortOrder, a.Name }).ToListAsync();
        return rows.GroupBy(r => r.ItemId).ToDictionary(g => g.Key,
            g => string.Join(" / ", g.OrderBy(r => r.SortOrder).ThenBy(r => r.Name).Select(r => r.Value)));
    }
}
