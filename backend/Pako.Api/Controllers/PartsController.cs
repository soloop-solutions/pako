using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md §6.8 / P7 — auto parts: other makers' numbers for the same part (OEM and
// aftermarket cross-references) and the vehicles it fits, and a counter search over both.
[ApiController]
[Route("api/companies/{companyId:guid}/parts")]
[Authorize]
public class PartsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PriceListService _prices;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PartsController(PakoDbContext db, PriceListService prices, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _prices = prices;
        _localizer = localizer;
    }

    // Part numbers compare without spaces, dots, dashes or slashes, case-insensitive.
    public static string Normalize(string number) =>
        new(number.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());

    [HttpGet("{itemId:guid}", Name = "GetPartData")]
    [RequireCompanyAccess(module: AccessModule.Items)]
    public async Task<ActionResult<PartDataResponse>> Get(Guid companyId, Guid itemId)
    {
        if (!await _db.Items.AnyAsync(i => i.Id == itemId && i.CompanyId == companyId)) return NotFound();
        return Ok(await ResponseAsync(itemId));
    }

    // Replaces the item's references and fitments.
    [HttpPut("{itemId:guid}", Name = "SavePartData")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    public async Task<ActionResult<PartDataResponse>> Save(Guid companyId, Guid itemId, SavePartDataRequest request)
    {
        if (!await _db.Items.AnyAsync(i => i.Id == itemId && i.CompanyId == companyId)) return NotFound();
        var references = request.References ?? new();
        var fitments = request.Fitments ?? new();
        if (references.Count > 200 || fitments.Count > 500) return BadRequest(_localizer["StockDocumentTooManyLines"].Value);
        if (references.Any(r => string.IsNullOrWhiteSpace(r.Brand) || r.Brand.Trim().Length > 60 || Normalize(r.Number ?? "").Length is 0 or > 60)
            || fitments.Any(f => string.IsNullOrWhiteSpace(f.Make) || string.IsNullOrWhiteSpace(f.Model) || f.Make.Trim().Length > 60 || f.Model.Trim().Length > 60
                || f.YearFrom is < 1900 or > 2100 || f.YearTo is < 1900 or > 2100 || (f.YearFrom is { } a && f.YearTo is { } b && b < a)))
        {
            return BadRequest(_localizer["PartDataInvalid"].Value);
        }
        if (references.Select(r => (r.Brand.Trim().ToUpperInvariant(), Normalize(r.Number))).Distinct().Count() != references.Count)
        {
            return BadRequest(_localizer["PartDataInvalid"].Value);
        }
        await _db.ItemCrossReferences.Where(r => r.ItemId == itemId).ExecuteDeleteAsync();
        await _db.ItemFitments.Where(f => f.ItemId == itemId).ExecuteDeleteAsync();
        _db.ItemCrossReferences.AddRange(references.Select(r => new ItemCrossReference
        {
            Id = Guid.NewGuid(), ItemId = itemId, Brand = r.Brand.Trim(), Number = r.Number.Trim(), Normalized = Normalize(r.Number),
        }));
        _db.ItemFitments.AddRange(fitments.Select(f => new ItemFitment
        {
            Id = Guid.NewGuid(), ItemId = itemId, Make = f.Make.Trim(), Model = f.Model.Trim(), YearFrom = f.YearFrom, YearTo = f.YearTo,
            Engine = string.IsNullOrWhiteSpace(f.Engine) ? null : f.Engine.Trim(),
        }));
        await _db.SaveChangesAsync();
        return Ok(await ResponseAsync(itemId));
    }

    private async Task<PartDataResponse> ResponseAsync(Guid itemId)
    {
        var references = await _db.ItemCrossReferences.AsNoTracking().Where(r => r.ItemId == itemId).OrderBy(r => r.Brand).ThenBy(r => r.Number)
            .Select(r => new CrossReferenceResponse(r.Id, r.Brand, r.Number)).ToListAsync();
        var fitments = await _db.ItemFitments.AsNoTracking().Where(f => f.ItemId == itemId).OrderBy(f => f.Make).ThenBy(f => f.Model).ThenBy(f => f.YearFrom)
            .Select(f => new FitmentResponse(f.Id, f.Make, f.Model, f.YearFrom, f.YearTo, f.Engine)).ToListAsync();
        return new PartDataResponse(itemId, references, fitments);
    }

    // The counter search: a part number (our code, a barcode, or any maker's number), or a vehicle
    // (make, model, year). Priced and with stock for a warehouse when one is given.
    [HttpGet("search", Name = "SearchParts")]
    [RequireCompanyAccess(module: AccessModule.Items)]
    public async Task<ActionResult<List<PartSearchResult>>> Search(Guid companyId, [FromQuery] string? number = null, [FromQuery] string? make = null,
        [FromQuery] string? model = null, [FromQuery] int? year = null, [FromQuery] Guid? warehouseId = null)
    {
        var found = new List<(Guid ItemId, string Match, string? Brand, string? Number)>();
        if (!string.IsNullOrWhiteSpace(number))
        {
            var key = Normalize(number);
            if (key.Length == 0) return Ok(new List<PartSearchResult>());
            if (int.TryParse(key, out var code))
            {
                found.AddRange((await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.Code == code).Select(i => i.Id).ToListAsync())
                    .Select(id => (id, "code", (string?)null, (string?)null)));
            }
            found.AddRange((await _db.ItemBarcodes.AsNoTracking().Where(b => b.Barcode == number.Trim() && _db.Items.Any(i => i.Id == b.ItemId && i.CompanyId == companyId))
                .Select(b => b.ItemId).ToListAsync()).Select(id => (id, "barcode", (string?)null, (string?)null)));
            found.AddRange((await _db.ItemCrossReferences.AsNoTracking()
                    .Where(r => r.Normalized == key && _db.Items.Any(i => i.Id == r.ItemId && i.CompanyId == companyId))
                    .Select(r => new { r.ItemId, r.Brand, r.Number }).ToListAsync())
                .Select(r => (r.ItemId, "reference", (string?)r.Brand, (string?)r.Number)));
        }
        else if (!string.IsNullOrWhiteSpace(make))
        {
            var query = _db.ItemFitments.AsNoTracking().Where(f => _db.Items.Any(i => i.Id == f.ItemId && i.CompanyId == companyId)
                && f.Make.ToLower() == make.Trim().ToLower());
            if (!string.IsNullOrWhiteSpace(model)) query = query.Where(f => f.Model.ToLower() == model.Trim().ToLower());
            if (year is { } y) query = query.Where(f => (f.YearFrom == null || f.YearFrom <= y) && (f.YearTo == null || f.YearTo >= y));
            found.AddRange((await query.Select(f => f.ItemId).Distinct().Take(200).ToListAsync()).Select(id => (id, "fitment", (string?)null, (string?)null)));
        }
        else
        {
            return BadRequest(_localizer["PartSearchEmpty"].Value);
        }

        var ids = found.Select(f => f.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => ids.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var prices = (await _prices.ResolveAsync(companyId, warehouseId, DateOnly.FromDateTime(DateTime.UtcNow), ids)).ToDictionary(p => p.ItemId, p => p.Price);
        Dictionary<Guid, decimal> stock;
        if (warehouseId is { } w)
        {
            var location = await new StockService(_db, _localizer).StockLocationAsync(companyId, w);
            stock = await _db.StockBalances.AsNoTracking().Where(b => b.LocationId == location.Id && ids.Contains(b.ItemId)).ToDictionaryAsync(b => b.ItemId, b => b.Quantity);
        }
        else
        {
            stock = await _db.ItemCosts.AsNoTracking().Where(k => ids.Contains(k.ItemId)).ToDictionaryAsync(k => k.ItemId, k => k.Quantity);
        }
        return Ok(found.GroupBy(f => f.ItemId).Select(g => g.First()).Where(f => items.ContainsKey(f.ItemId)).Select(f =>
        {
            var item = items[f.ItemId];
            return new PartSearchResult(item.Id, item.Code, item.Name, f.Match, f.Brand, f.Number, prices.TryGetValue(item.Id, out var p) ? p : null,
                stock.GetValueOrDefault(item.Id));
        }).OrderBy(r => r.Name).ToList());
    }
}
