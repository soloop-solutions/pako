using System.Security.Claims;
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

// docs/POS_PLAN.md §6.8 / P7 — fuel stations: tanks and nozzles (Pos: Approve sets them up), meter
// readings at each shift close and tank dips (Pos: Write), the day's reconciliation of litres pumped
// against litres sold and stock against dips, and fleet cards. The pump controller itself (pre-set,
// authorise, read the sale) is hardware integration left for the forecourt pack's pilot.
[ApiController]
[Route("api/companies/{companyId:guid}/pos/forecourt")]
[Authorize]
public class PosForecourtController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PosForecourtController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    // ---- Tanks and nozzles ----

    [HttpGet("tanks", Name = "ListPosFuelTanks")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<TankResponse>>> Tanks(Guid companyId, [FromQuery] Guid storeId)
    {
        var tanks = await _db.PosFuelTanks.AsNoTracking().Where(t => t.CompanyId == companyId && t.StoreId == storeId).OrderBy(t => t.Name).ToListAsync();
        return Ok(await TankResponsesAsync(tanks));
    }

    [HttpPost("tanks", Name = "CreatePosFuelTank")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(TankResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<TankResponse>> CreateTank(Guid companyId, SaveTankRequest request)
    {
        var tank = new FuelTank { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyTankAsync(companyId, tank, request) is { } error) return BadRequest(error);
        _db.PosFuelTanks.Add(tank);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await TankResponsesAsync(new() { tank }))[0]);
    }

    [HttpPut("tanks/{tankId:guid}", Name = "UpdatePosFuelTank")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<TankResponse>> UpdateTank(Guid companyId, Guid tankId, SaveTankRequest request)
    {
        var tank = await _db.PosFuelTanks.FirstOrDefaultAsync(t => t.Id == tankId && t.CompanyId == companyId);
        if (tank is null) return NotFound();
        if (await ApplyTankAsync(companyId, tank, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await TankResponsesAsync(new() { tank }))[0]);
    }

    private async Task<string?> ApplyTankAsync(Guid companyId, FuelTank tank, SaveTankRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Trim().Length > 60 || r.Capacity <= 0) return _localizer["PosFuelSetupInvalid"].Value;
        if (!await _db.PosStores.AnyAsync(s => s.Id == r.StoreId && s.CompanyId == companyId)) return _localizer["PosStoreNotFound"].Value;
        if (!await _db.Items.AnyAsync(i => i.Id == r.ItemId && i.CompanyId == companyId && i.TrackInventory)) return _localizer["PosFuelGradeInvalid"].Value;
        if (await _db.PosFuelTanks.AnyAsync(t => t.StoreId == r.StoreId && t.Id != tank.Id && t.Name == r.Name.Trim())) return _localizer["PosFuelSetupInvalid"].Value;
        (tank.StoreId, tank.Name, tank.ItemId, tank.Capacity, tank.IsActive) = (r.StoreId, r.Name.Trim(), r.ItemId, r.Capacity, r.IsActive);
        return null;
    }

    private async Task<List<TankResponse>> TankResponsesAsync(List<FuelTank> tanks)
    {
        var itemIds = tanks.Select(t => t.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.Name);
        var ids = tanks.Select(t => t.Id).ToList();
        var dips = (await _db.PosTankDips.AsNoTracking().Where(d => ids.Contains(d.TankId)).ToListAsync())
            .GroupBy(d => d.TankId).ToDictionary(g => g.Key, g => g.OrderByDescending(d => d.MeasuredAt).First());
        return tanks.Select(t => new TankResponse(t.Id, t.StoreId, t.Name, t.ItemId, items.GetValueOrDefault(t.ItemId) ?? "?", t.Capacity, t.IsActive,
            dips.GetValueOrDefault(t.Id)?.Volume, dips.GetValueOrDefault(t.Id)?.MeasuredAt)).ToList();
    }

    [HttpGet("nozzles", Name = "ListPosFuelNozzles")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<NozzleResponse>>> Nozzles(Guid companyId, [FromQuery] Guid storeId)
    {
        var nozzles = await _db.PosFuelNozzles.AsNoTracking().Where(n => n.CompanyId == companyId && n.StoreId == storeId)
            .OrderBy(n => n.Pump).ThenBy(n => n.Number).ToListAsync();
        return Ok(await NozzleResponsesAsync(nozzles));
    }

    [HttpPost("nozzles", Name = "CreatePosFuelNozzle")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(NozzleResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<NozzleResponse>> CreateNozzle(Guid companyId, SaveNozzleRequest request)
    {
        var nozzle = new FuelNozzle { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyNozzleAsync(companyId, nozzle, request) is { } error) return BadRequest(error);
        _db.PosFuelNozzles.Add(nozzle);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await NozzleResponsesAsync(new() { nozzle }))[0]);
    }

    [HttpPut("nozzles/{nozzleId:guid}", Name = "UpdatePosFuelNozzle")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<NozzleResponse>> UpdateNozzle(Guid companyId, Guid nozzleId, SaveNozzleRequest request)
    {
        var nozzle = await _db.PosFuelNozzles.FirstOrDefaultAsync(n => n.Id == nozzleId && n.CompanyId == companyId);
        if (nozzle is null) return NotFound();
        if (await ApplyNozzleAsync(companyId, nozzle, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await NozzleResponsesAsync(new() { nozzle }))[0]);
    }

    private async Task<string?> ApplyNozzleAsync(Guid companyId, FuelNozzle nozzle, SaveNozzleRequest r)
    {
        if (r.Pump is < 1 or > 99 || r.Number is < 1 or > 9) return _localizer["PosFuelSetupInvalid"].Value;
        if (!await _db.PosFuelTanks.AnyAsync(t => t.Id == r.TankId && t.CompanyId == companyId && t.StoreId == r.StoreId)) return _localizer["PosFuelSetupInvalid"].Value;
        if (await _db.PosFuelNozzles.AnyAsync(n => n.StoreId == r.StoreId && n.Id != nozzle.Id && n.Pump == r.Pump && n.Number == r.Number))
        {
            return _localizer["PosFuelSetupInvalid"].Value;
        }
        (nozzle.StoreId, nozzle.Pump, nozzle.Number, nozzle.TankId, nozzle.IsActive) = (r.StoreId, r.Pump, r.Number, r.TankId, r.IsActive);
        return null;
    }

    private async Task<List<NozzleResponse>> NozzleResponsesAsync(List<FuelNozzle> nozzles)
    {
        var tankIds = nozzles.Select(n => n.TankId).Distinct().ToList();
        var tanks = await _db.PosFuelTanks.AsNoTracking().Where(t => tankIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
        var itemIds = tanks.Values.Select(t => t.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.Name);
        var ids = nozzles.Select(n => n.Id).ToList();
        var last = (await _db.PosMeterReadings.AsNoTracking().Where(r => ids.Contains(r.NozzleId)).ToListAsync())
            .GroupBy(r => r.NozzleId).ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.Date).ThenByDescending(r => r.CreatedAt).First().Closing);
        return nozzles.Select(n =>
        {
            var tank = tanks[n.TankId];
            return new NozzleResponse(n.Id, n.StoreId, n.Pump, n.Number, n.TankId, tank.Name, tank.ItemId, items.GetValueOrDefault(tank.ItemId) ?? "?", n.IsActive,
                last.TryGetValue(n.Id, out var closing) ? closing : null);
        }).ToList();
    }

    // ---- Readings and dips ----

    // A shift's totaliser readings. Each nozzle's opening must be its previous closing (a meter
    // only counts up); a gap is refused so it gets explained.
    [HttpPost("readings", Name = "SavePosMeterReadings")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<ForecourtReconciliationResponse>> SaveReadings(Guid companyId, SaveMeterReadingsRequest request)
    {
        if (request.Readings is null || request.Readings.Count == 0) return BadRequest(_localizer["PosMeterInvalid"].Value);
        var nozzleIds = request.Readings.Select(r => r.NozzleId).ToList();
        if (nozzleIds.Distinct().Count() != nozzleIds.Count) return BadRequest(_localizer["PosMeterInvalid"].Value);
        var nozzles = await _db.PosFuelNozzles.AsNoTracking().Where(n => nozzleIds.Contains(n.Id) && n.CompanyId == companyId && n.StoreId == request.StoreId)
            .ToDictionaryAsync(n => n.Id);
        if (nozzles.Count != nozzleIds.Count) return BadRequest(_localizer["PosMeterInvalid"].Value);
        if (request.SessionId is { } sessionId && !await _db.PosSessions.AnyAsync(s => s.Id == sessionId && s.CompanyId == companyId))
        {
            return BadRequest(_localizer["PosSessionNotOpen"].Value);
        }
        var previous = (await _db.PosMeterReadings.AsNoTracking().Where(r => nozzleIds.Contains(r.NozzleId)).ToListAsync())
            .GroupBy(r => r.NozzleId).ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.Date).ThenByDescending(r => r.CreatedAt).First().Closing);
        foreach (var r in request.Readings)
        {
            if (r.Opening < 0 || r.Closing < r.Opening) return BadRequest(_localizer["PosMeterInvalid"].Value);
            if (previous.TryGetValue(r.NozzleId, out var last) && r.Opening != last)
            {
                var n = nozzles[r.NozzleId];
                return BadRequest(string.Format(_localizer["PosMeterGap"].Value, n.Pump, n.Number, last));
            }
            _db.PosMeterReadings.Add(new MeterReading
            {
                Id = Guid.NewGuid(), CompanyId = companyId, NozzleId = r.NozzleId, Date = request.Date, SessionId = request.SessionId,
                Opening = r.Opening, Closing = r.Closing, UserId = CurrentUserId,
            });
        }
        await _db.SaveChangesAsync();
        return Ok(await ReconcileAsync(companyId, request.StoreId, request.Date));
    }

    [HttpPost("dips", Name = "AddPosTankDip")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<TankResponse>> Dip(Guid companyId, TankDipRequest request)
    {
        var tank = await _db.PosFuelTanks.AsNoTracking().FirstOrDefaultAsync(t => t.Id == request.TankId && t.CompanyId == companyId);
        if (tank is null) return NotFound();
        if (request.Volume < 0 || request.Water < 0 || request.Volume > tank.Capacity) return BadRequest(_localizer["PosDipInvalid"].Value);
        _db.PosTankDips.Add(new TankDip
        {
            Id = Guid.NewGuid(), CompanyId = companyId, TankId = tank.Id, Volume = request.Volume, Water = request.Water, UserId = CurrentUserId,
            MeasuredAt = request.MeasuredAt is { } at ? DateTime.SpecifyKind(at, DateTimeKind.Utc) : DateTime.UtcNow,
        });
        await _db.SaveChangesAsync();
        return Ok((await TankResponsesAsync(new() { tank }))[0]);
    }

    [HttpGet("reconciliation", Name = "GetPosForecourtReconciliation")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<ForecourtReconciliationResponse>> Reconciliation(Guid companyId, [FromQuery] Guid storeId, [FromQuery] DateOnly date)
    {
        if (!await _db.PosStores.AnyAsync(s => s.Id == storeId && s.CompanyId == companyId)) return NotFound();
        return Ok(await ReconcileAsync(companyId, storeId, date));
    }

    // Per nozzle: litres the meters counted against litres the till sold on that nozzle. Per grade:
    // the same in total (sales without a nozzle too), and the book stock against the day's dips.
    private async Task<ForecourtReconciliationResponse> ReconcileAsync(Guid companyId, Guid storeId, DateOnly date)
    {
        var store = await _db.PosStores.AsNoTracking().FirstAsync(s => s.Id == storeId);
        var tanks = await _db.PosFuelTanks.AsNoTracking().Where(t => t.StoreId == storeId && t.CompanyId == companyId).ToListAsync();
        var nozzles = await _db.PosFuelNozzles.AsNoTracking().Where(n => n.StoreId == storeId && n.CompanyId == companyId)
            .OrderBy(n => n.Pump).ThenBy(n => n.Number).ToListAsync();
        var nozzleIds = nozzles.Select(n => n.Id).ToList();
        var pumped = (await _db.PosMeterReadings.AsNoTracking().Where(r => nozzleIds.Contains(r.NozzleId) && r.Date == date).ToListAsync())
            .GroupBy(r => r.NozzleId).ToDictionary(g => g.Key, g => g.Sum(r => r.Closing - r.Opening));
        var grades = tanks.Select(t => t.ItemId).Distinct().ToList();
        var sold = await (from l in _db.PosOrderLines.AsNoTracking()
                          join o in _db.PosOrders.AsNoTracking() on l.OrderId equals o.Id
                          join s in _db.PosSessions.AsNoTracking() on o.SessionId equals s.Id
                          where o.StoreId == storeId && s.BusinessDate == date && l.ItemId != null && grades.Contains(l.ItemId.Value)
                          select new { ItemId = l.ItemId!.Value, l.NozzleId, Litres = (o.Kind == PosOrderKind.Sale ? 1m : -1m) * l.Quantity * l.UnitFactor })
            .ToListAsync();
        var items = await _db.Items.AsNoTracking().Where(i => grades.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.Name);

        var nozzleRows = nozzles.Select(n =>
        {
            var itemId = tanks.First(t => t.Id == n.TankId).ItemId;
            var p = pumped.GetValueOrDefault(n.Id);
            var s = sold.Where(x => x.NozzleId == n.Id).Sum(x => x.Litres);
            return new ForecourtNozzleRow(n.Id, n.Pump, n.Number, items.GetValueOrDefault(itemId) ?? "?", p, s, s - p);
        }).ToList();

        var location = await new StockService(_db, _localizer).StockLocationAsync(companyId, store.WarehouseId);
        var book = await _db.StockBalances.AsNoTracking().Where(b => b.LocationId == location.Id && grades.Contains(b.ItemId))
            .ToDictionaryAsync(b => b.ItemId, b => b.Quantity);
        var dayStart = PosService.UtcFromLocal(date.ToDateTime(TimeOnly.MinValue));
        var dayEnd = PosService.UtcFromLocal(date.AddDays(1).ToDateTime(TimeOnly.MinValue));
        var tankIds = tanks.Select(t => t.Id).ToList();
        var dips = (await _db.PosTankDips.AsNoTracking().Where(d => tankIds.Contains(d.TankId) && d.MeasuredAt >= dayStart && d.MeasuredAt < dayEnd).ToListAsync())
            .GroupBy(d => d.TankId).ToDictionary(g => g.Key, g => g.OrderByDescending(d => d.MeasuredAt).First().Volume);
        var gradeRows = grades.Select(itemId =>
        {
            var gradeTanks = tanks.Where(t => t.ItemId == itemId).ToList();
            var gradeNozzles = nozzles.Where(n => gradeTanks.Any(t => t.Id == n.TankId)).Select(n => n.Id).ToHashSet();
            var p = pumped.Where(x => gradeNozzles.Contains(x.Key)).Sum(x => x.Value);
            var s = sold.Where(x => x.ItemId == itemId).Sum(x => x.Litres);
            var stock = book.GetValueOrDefault(itemId);
            decimal? dipped = gradeTanks.All(t => dips.ContainsKey(t.Id)) ? gradeTanks.Sum(t => dips[t.Id]) : null;
            return new ForecourtGradeRow(itemId, items.GetValueOrDefault(itemId) ?? "?", p, s, s - p, stock, dipped, dipped - stock);
        }).OrderBy(r => r.ItemName).ToList();
        return new ForecourtReconciliationResponse(storeId, date, nozzleRows, gradeRows);
    }

    // ---- Fleet cards ----

    [HttpGet("fleet-cards", Name = "ListPosFleetCards")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<FleetCardResponse>>> FleetCards(Guid companyId, [FromQuery] string? search = null)
    {
        var query = _db.PosFleetCards.AsNoTracking().Where(c => c.CompanyId == companyId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(c => EF.Functions.ILike(c.Number, pattern) || (c.VehiclePlate != null && EF.Functions.ILike(c.VehiclePlate, pattern)));
        }
        return Ok(await CardResponsesAsync(await query.OrderBy(c => c.Number).Take(500).ToListAsync()));
    }

    [HttpPost("fleet-cards", Name = "CreatePosFleetCard")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(FleetCardResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<FleetCardResponse>> CreateFleetCard(Guid companyId, SaveFleetCardRequest request)
    {
        var card = new FleetCard { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyCardAsync(companyId, card, request) is { } error) return BadRequest(error);
        _db.PosFleetCards.Add(card);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await CardResponsesAsync(new() { card }))[0]);
    }

    [HttpPut("fleet-cards/{cardId:guid}", Name = "UpdatePosFleetCard")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<FleetCardResponse>> UpdateFleetCard(Guid companyId, Guid cardId, SaveFleetCardRequest request)
    {
        var card = await _db.PosFleetCards.FirstOrDefaultAsync(c => c.Id == cardId && c.CompanyId == companyId);
        if (card is null) return NotFound();
        if (await ApplyCardAsync(companyId, card, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await CardResponsesAsync(new() { card }))[0]);
    }

    // The till looks a card up when it is shown (swiped or typed).
    [HttpGet("fleet-cards/lookup", Name = "LookupPosFleetCard")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<FleetCardResponse>> LookupFleetCard(Guid companyId, [FromQuery] string number)
    {
        var card = await _db.PosFleetCards.AsNoTracking().FirstOrDefaultAsync(c => c.CompanyId == companyId && c.Number == (number ?? "").Trim() && c.IsActive);
        return card is null ? NotFound() : Ok((await CardResponsesAsync(new() { card }))[0]);
    }

    private async Task<string?> ApplyCardAsync(Guid companyId, FleetCard card, SaveFleetCardRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Number) || r.Number.Trim().Length > 40 || r.LimitPerFill is <= 0) return _localizer["PosFleetCardInvalid"].Value;
        if (!await _db.Partners.AnyAsync(p => p.Id == r.PartnerId && p.CompanyId == companyId && p.IsCustomer)) return _localizer["InvalidCustomerPartner"].Value;
        if (await _db.PosFleetCards.AnyAsync(c => c.CompanyId == companyId && c.Id != card.Id && c.Number == r.Number.Trim())) return _localizer["PosFleetCardInvalid"].Value;
        (card.Number, card.PartnerId, card.VehiclePlate, card.DriverName, card.LimitPerFill, card.FuelOnly, card.IsActive) =
            (r.Number.Trim(), r.PartnerId, Blank(r.VehiclePlate)?.ToUpperInvariant(), Blank(r.DriverName), r.LimitPerFill, r.FuelOnly, r.IsActive);
        return null;
    }

    private async Task<List<FleetCardResponse>> CardResponsesAsync(List<FleetCard> cards)
    {
        var ids = cards.Select(c => c.PartnerId).Distinct().ToList();
        var names = await _db.Partners.AsNoTracking().Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        return cards.Select(c => new FleetCardResponse(c.Id, c.Number, c.PartnerId, names.GetValueOrDefault(c.PartnerId) ?? "?", c.VehiclePlate, c.DriverName,
            c.LimitPerFill, c.FuelOnly, c.IsActive)).ToList();
    }
}
