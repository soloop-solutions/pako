using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Auth;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Hubs;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md P3: the restaurant menu around the item register — production centres,
// modifier groups and combos (Pos: Approve), and what the till reads to take orders (Pos: Read).
[ApiController]
[Route("api/companies/{companyId:guid}/pos")]
[Authorize]
public class PosMenuController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PosMenuController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    // ---- Production centres ----

    [HttpGet("production-centers", Name = "ListProductionCenters")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<ProductionCenterResponse>>> Centers(Guid companyId) =>
        Ok(await _db.PosProductionCenters.AsNoTracking().Where(c => c.CompanyId == companyId).OrderBy(c => c.Name)
            .Select(c => new ProductionCenterResponse(c.Id, c.StoreId, c.Name, c.Kind, c.PrinterName, c.IsActive)).ToListAsync());

    [HttpPost("production-centers", Name = "CreateProductionCenter")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(ProductionCenterResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ProductionCenterResponse>> CreateCenter(Guid companyId, SaveProductionCenterRequest request)
    {
        var center = new ProductionCenter { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyAsync(companyId, center, request) is { } error) return BadRequest(error);
        _db.PosProductionCenters.Add(center);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, new ProductionCenterResponse(center.Id, center.StoreId, center.Name, center.Kind, center.PrinterName, center.IsActive));
    }

    [HttpPut("production-centers/{centerId:guid}", Name = "UpdateProductionCenter")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<ProductionCenterResponse>> UpdateCenter(Guid companyId, Guid centerId, SaveProductionCenterRequest request)
    {
        var center = await _db.PosProductionCenters.FirstOrDefaultAsync(c => c.Id == centerId && c.CompanyId == companyId);
        if (center is null) return NotFound();
        if (await ApplyAsync(companyId, center, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok(new ProductionCenterResponse(center.Id, center.StoreId, center.Name, center.Kind, center.PrinterName, center.IsActive));
    }

    private async Task<string?> ApplyAsync(Guid companyId, ProductionCenter c, SaveProductionCenterRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name)) return _localizer["PosStoreFieldsRequired"].Value;
        if (r.StoreId is { } s && !await _db.PosStores.AnyAsync(x => x.Id == s && x.CompanyId == companyId)) return _localizer["PosStoreNotFound"].Value;
        (c.Name, c.Kind, c.StoreId, c.PrinterName, c.IsActive) = (r.Name.Trim(), r.Kind, r.StoreId,
            string.IsNullOrWhiteSpace(r.PrinterName) ? null : r.PrinterName.Trim(), r.IsActive);
        return null;
    }

    // Which centre makes an item (null: none — it isn't sent to a kitchen).
    [HttpPut("items/{itemId:guid}/production-center", Name = "SetItemProductionCenter")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<IActionResult> SetItemCenter(Guid companyId, Guid itemId, [FromQuery] Guid? centerId)
    {
        var item = await _db.Items.FirstOrDefaultAsync(i => i.Id == itemId && i.CompanyId == companyId);
        if (item is null) return NotFound();
        if (centerId is { } c && !await _db.PosProductionCenters.AnyAsync(x => x.Id == c && x.CompanyId == companyId)) return BadRequest(_localizer["PosItemNotFound"].Value);
        item.ProductionCenterId = centerId;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ---- Modifier groups ----

    [HttpGet("modifier-groups", Name = "ListModifierGroups")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<ModifierGroupResponse>>> Groups(Guid companyId) => Ok(await GroupsAsync(companyId, activeOnly: false));

    [HttpPost("modifier-groups", Name = "CreateModifierGroup")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(ModifierGroupResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ModifierGroupResponse>> CreateGroup(Guid companyId, SaveModifierGroupRequest request)
    {
        var group = new ModifierGroup { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyAsync(companyId, group, request, isNew: true) is { } error) return BadRequest(error);
        _db.PosModifierGroups.Add(group);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await GroupsAsync(companyId, false, group.Id)).Single());
    }

    [HttpPut("modifier-groups/{groupId:guid}", Name = "UpdateModifierGroup")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<ModifierGroupResponse>> UpdateGroup(Guid companyId, Guid groupId, SaveModifierGroupRequest request)
    {
        var group = await _db.PosModifierGroups.Include(g => g.Modifiers).FirstOrDefaultAsync(g => g.Id == groupId && g.CompanyId == companyId);
        if (group is null) return NotFound();
        if (await ApplyAsync(companyId, group, request, isNew: false) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await GroupsAsync(companyId, false, group.Id)).Single());
    }

    private async Task<string?> ApplyAsync(Guid companyId, ModifierGroup g, SaveModifierGroupRequest r, bool isNew)
    {
        if (string.IsNullOrWhiteSpace(r.Name) || r.MinSelect < 0 || r.MaxSelect < 0 || (r.MaxSelect > 0 && r.MinSelect > r.MaxSelect)
            || r.Modifiers is null || r.Modifiers.Count == 0 || r.Modifiers.Any(m => string.IsNullOrWhiteSpace(m.Name)))
        {
            return _localizer["PosModifierGroupInvalid"].Value;
        }
        var ingredientIds = r.Modifiers.Where(m => m.IngredientItemId != null).Select(m => m.IngredientItemId!.Value).Distinct().ToList();
        var itemIds = (r.ItemIds ?? new()).Distinct().ToList();
        var known = await _db.Items.Where(i => i.CompanyId == companyId).Select(i => i.Id)
            .Where(id => ingredientIds.Contains(id) || itemIds.Contains(id)).ToListAsync();
        if (ingredientIds.Concat(itemIds).Distinct().Count() != known.Count) return _localizer["PosItemNotFound"].Value;

        (g.Name, g.MinSelect, g.MaxSelect, g.IsActive) = (r.Name.Trim(), r.MinSelect, r.MaxSelect, r.IsActive);
        // Modifiers already on tab lines keep their row: one left out is switched off, not deleted.
        foreach (var existing in g.Modifiers.Where(m => r.Modifiers.All(x => x.Id != m.Id))) existing.IsActive = false;
        foreach (var m in r.Modifiers)
        {
            var modifier = m.Id is { } id ? g.Modifiers.FirstOrDefault(x => x.Id == id) : null;
            if (modifier is null)
            {
                modifier = new Modifier { Id = Guid.NewGuid(), GroupId = g.Id };
                g.Modifiers.Add(modifier);
                if (!isNew) _db.PosModifiers.Add(modifier);
            }
            (modifier.Name, modifier.PriceDelta, modifier.IngredientItemId, modifier.IngredientQuantity, modifier.SortOrder, modifier.IsActive) =
                (m.Name.Trim(), m.PriceDelta, m.IngredientItemId, m.IngredientItemId is null ? null : m.IngredientQuantity, m.SortOrder, m.IsActive);
        }
        if (r.ItemIds is not null)
        {
            _db.PosItemModifierGroups.RemoveRange(await _db.PosItemModifierGroups.Where(x => x.GroupId == g.Id).ToListAsync());
            _db.PosItemModifierGroups.AddRange(itemIds.Select((id, i) => new ItemModifierGroup { ItemId = id, GroupId = g.Id, SortOrder = i }));
        }
        return null;
    }

    private async Task<List<ModifierGroupResponse>> GroupsAsync(Guid companyId, bool activeOnly, Guid? only = null)
    {
        var query = _db.PosModifierGroups.AsNoTracking().Include(g => g.Modifiers).Where(g => g.CompanyId == companyId);
        if (activeOnly) query = query.Where(g => g.IsActive);
        if (only is { } id) query = query.Where(g => g.Id == id);
        var groups = await query.OrderBy(g => g.Name).ToListAsync();
        var groupIds = groups.Select(g => g.Id).ToList();
        var links = await _db.PosItemModifierGroups.AsNoTracking().Where(x => groupIds.Contains(x.GroupId)).ToListAsync();
        return groups.Select(g => new ModifierGroupResponse(g.Id, g.Name, g.MinSelect, g.MaxSelect, g.IsActive,
            g.Modifiers.Where(m => !activeOnly || m.IsActive).OrderBy(m => m.SortOrder).ThenBy(m => m.Name)
                .Select(m => new ModifierResponse(m.Id, m.Name, m.PriceDelta, m.IngredientItemId, m.IngredientQuantity, m.SortOrder, m.IsActive)).ToList(),
            links.Where(x => x.GroupId == g.Id).OrderBy(x => x.SortOrder).Select(x => x.ItemId).ToList())).ToList();
    }

    // ---- Combos ----

    [HttpGet("items/{itemId:guid}/combo", Name = "GetCombo")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<ComboSlotResponse>>> Combo(Guid companyId, Guid itemId)
    {
        if (!await _db.Items.AnyAsync(i => i.Id == itemId && i.CompanyId == companyId)) return NotFound();
        return Ok((await CombosAsync(new[] { itemId })).GetValueOrDefault(itemId) ?? new());
    }

    // Replaces an item's combo slots (none: it isn't a combo).
    [HttpPut("items/{itemId:guid}/combo", Name = "SaveCombo")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<List<ComboSlotResponse>>> SaveCombo(Guid companyId, Guid itemId, SaveComboRequest request)
    {
        if (!await _db.Items.AnyAsync(i => i.Id == itemId && i.CompanyId == companyId)) return NotFound();
        if (request.Slots.Any(s => string.IsNullOrWhiteSpace(s.Name) || s.MinSelect < 0 || s.MaxSelect < 1 || s.MinSelect > s.MaxSelect || s.Choices.Count == 0))
        {
            return BadRequest(_localizer["PosComboSetupInvalid"].Value);
        }
        var choiceIds = request.Slots.SelectMany(s => s.Choices).Select(c => c.ItemId).Distinct().ToList();
        if (choiceIds.Contains(itemId) || await _db.Items.CountAsync(i => i.CompanyId == companyId && choiceIds.Contains(i.Id)) != choiceIds.Count)
        {
            return BadRequest(_localizer["PosItemNotFound"].Value);
        }
        _db.PosComboSlots.RemoveRange(await _db.PosComboSlots.Where(s => s.ComboItemId == itemId).ToListAsync());
        _db.PosComboSlots.AddRange(request.Slots.Select((s, i) =>
        {
            var slot = new ComboSlot { Id = Guid.NewGuid(), ComboItemId = itemId, Name = s.Name.Trim(), MinSelect = s.MinSelect, MaxSelect = s.MaxSelect, SortOrder = i };
            slot.Choices = s.Choices.Select(c => new ComboChoice { Id = Guid.NewGuid(), SlotId = slot.Id, ItemId = c.ItemId, PriceDelta = c.PriceDelta }).ToList();
            return slot;
        }));
        await _db.SaveChangesAsync();
        return Ok((await CombosAsync(new[] { itemId })).GetValueOrDefault(itemId) ?? new());
    }

    private async Task<Dictionary<Guid, List<ComboSlotResponse>>> CombosAsync(IReadOnlyCollection<Guid>? itemIds, Guid? companyId = null)
    {
        var query = _db.PosComboSlots.AsNoTracking().Include(s => s.Choices).AsQueryable();
        if (itemIds is not null) query = query.Where(s => itemIds.Contains(s.ComboItemId));
        if (companyId is { } c) query = query.Where(s => _db.Items.Any(i => i.Id == s.ComboItemId && i.CompanyId == c));
        var slots = await query.ToListAsync();
        return slots.GroupBy(s => s.ComboItemId).ToDictionary(g => g.Key, g => g.OrderBy(s => s.SortOrder)
            .Select(s => new ComboSlotResponse(s.Id, s.Name, s.MinSelect, s.MaxSelect, s.SortOrder,
                s.Choices.Select(c => new ComboChoiceResponse(c.ItemId, c.PriceDelta)).ToList())).ToList());
    }

    // ---- What the till reads ----

    [HttpGet("menu", Name = "GetPosMenu")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PosMenuResponse>> Menu(Guid companyId)
    {
        var centers = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.ProductionCenterId != null)
            .ToDictionaryAsync(i => i.Id, i => i.ProductionCenterId!.Value);
        var list = await _db.PosProductionCenters.AsNoTracking().Where(c => c.CompanyId == companyId && c.IsActive).OrderBy(c => c.Name)
            .Select(c => new ProductionCenterResponse(c.Id, c.StoreId, c.Name, c.Kind, c.PrinterName, c.IsActive)).ToListAsync();
        return Ok(new PosMenuResponse(await GroupsAsync(companyId, activeOnly: true), await CombosAsync(null, companyId), centers, list));
    }
}

// docs/POS_PLAN.md P3: the QR menu on a table — anonymous, reached only through the table's
// printed code; guests can see the menu and ask for dishes, which wait for a waiter to accept.
[ApiController]
[Route("api/public/menu/{token}")]
[AllowAnonymous]
[EnableRateLimiting(AuthRateLimit.Policy)]
public class PublicMenuController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PriceListService _prices;
    private readonly TabService _tabs;
    private readonly PosNotifier _notify;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PublicMenuController(PakoDbContext db, PriceListService prices, TabService tabs, PosNotifier notify, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _prices = prices;
        _tabs = tabs;
        _notify = notify;
        _localizer = localizer;
    }

    private async Task<(DiningTable Table, Store Store)?> FindAsync(string token)
    {
        var table = await _db.PosTables.AsNoTracking().FirstOrDefaultAsync(t => t.QrToken == token && t.IsActive);
        if (table is null) return null;
        var floor = await _db.PosFloors.AsNoTracking().FirstAsync(f => f.Id == table.FloorId);
        var store = await _db.PosStores.AsNoTracking().FirstAsync(s => s.Id == floor.StoreId);
        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == store.CompanyId);
        // The POS module must be on for the company.
        return store.IsActive && company.EnabledModules.HasFlag(AppModule.Pos) ? (table, store) : null;
    }

    [HttpGet(Name = "GetPublicMenu")]
    public async Task<ActionResult<PublicMenuResponse>> Get(string token)
    {
        if (await FindAsync(token) is not { } found) return NotFound();
        var (table, store) = found;
        var items = await _db.Items.AsNoTracking().Where(i => i.CompanyId == store.CompanyId && i.ProductionCenterId != null && !i.IsVariantTemplate)
            .OrderBy(i => i.Name).ToListAsync();
        var prices = (await _prices.ResolveAsync(store.CompanyId, store.WarehouseId, DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)),
            items.Select(i => i.Id).ToList(), store.PriceListId)).ToDictionary(p => p.ItemId, p => p.Price);
        var categoryIds = items.Where(i => i.CategoryId != null).Select(i => i.CategoryId!.Value).Distinct().ToList();
        var categories = await _db.ItemCategories.AsNoTracking().Where(c => categoryIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name);
        var itemIds = items.Select(i => i.Id).ToList();
        var links = await _db.PosItemModifierGroups.AsNoTracking().Where(x => itemIds.Contains(x.ItemId)).ToListAsync();
        var groupIds = links.Select(x => x.GroupId).Distinct().ToList();
        var groups = await _db.PosModifierGroups.AsNoTracking().Include(g => g.Modifiers).Where(g => groupIds.Contains(g.Id) && g.IsActive).ToListAsync();
        return Ok(new PublicMenuResponse(store.Name, table.Name,
            items.Where(i => prices.ContainsKey(i.Id) && !i.OpenPrice).Select(i => new PublicMenuItemResponse(i.Id, i.Name, i.Description, prices[i.Id],
                i.CategoryId is { } c ? categories.GetValueOrDefault(c) : null)).ToList(),
            groups.Select(g => new ModifierGroupResponse(g.Id, g.Name, g.MinSelect, g.MaxSelect, true,
                g.Modifiers.Where(m => m.IsActive).OrderBy(m => m.SortOrder).Select(m => new ModifierResponse(m.Id, m.Name, m.PriceDelta, null, null, m.SortOrder, true)).ToList(),
                links.Where(x => x.GroupId == g.Id).Select(x => x.ItemId).ToList())).ToList()));
    }

    // Adds the guest's choices to the table's open tab (or opens one) as requests for a waiter.
    [HttpPost("order", Name = "PlacePublicOrder")]
    public async Task<IActionResult> Order(string token, PublicOrderRequest request)
    {
        if (await FindAsync(token) is not { } found) return NotFound();
        var (table, store) = found;
        if (request.Lines is null || request.Lines.Count is 0 or > 30 || request.Lines.Any(l => l.Quantity is <= 0 or > 20)) return BadRequest(_localizer["PosOrderNoLines"].Value);
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        var tab = await _db.PosTabs.Include(t => t.Lines)
            .FirstOrDefaultAsync(t => t.TableId == table.Id && (t.State == TabState.Open || t.State == TabState.PreBilled));
        try
        {
            tab ??= await _tabs.OpenAsync(store.CompanyId, store, new OpenTabRequest(store.Id, table.Id), Guid.Empty, "QR");
            // The guest's general note rides on the first line (the waiter sees it with the request).
            static string? Clip(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim()[..Math.Min(text.Trim().Length, 120)];
            var general = Clip(request.Note);
            await _tabs.AddLinesAsync(store.CompanyId, tab, store,
                request.Lines.Select((l, i) => new AddTabLineRequest(l.ItemId, l.Quantity, null, null, 1,
                    i == 0 && general is not null ? string.Join(" · ", new[] { Clip(l.Note), general }.Where(x => x is not null)) : Clip(l.Note),
                    l.ModifierIds)).ToList(), TabLineState.Requested);
            await _db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
        }
        catch (PosException ex)
        {
            return BadRequest(ex.Message);
        }
        await _notify.TabsChangedAsync(store.Id);
        return NoContent();
    }
}
