using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Inventory;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/vehicles")]
[Authorize]
public class VehiclesController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly StockService _stock;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public VehiclesController(PakoDbContext db, StockService stock, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _stock = stock;
        _localizer = localizer;
    }

    [HttpGet(Name = "ListVehicles")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<PaginatedResponse<VehicleResponse>>> List(Guid companyId, [FromQuery] string? search = null,
        [FromQuery] bool includeArchived = false, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.Vehicles.AsNoTracking().Where(v => v.CompanyId == companyId);
        if (!includeArchived) query = query.Where(v => !v.IsArchived);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = LikePattern.Contains(search);
            query = query.Where(v => EF.Functions.ILike(v.Plate, pattern, LikePattern.EscapeChar) || (v.Make != null && EF.Functions.ILike(v.Make, pattern, LikePattern.EscapeChar))
                || (v.Model != null && EF.Functions.ILike(v.Model, pattern, LikePattern.EscapeChar)));
        }
        var total = await query.CountAsync();
        var vehicles = await query.OrderBy(v => v.Plate).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var names = await WarehouseNamesAsync(companyId);
        return Ok(new PaginatedResponse<VehicleResponse>(vehicles.Select(v => ToResponse(v, names)).ToList(), total, page, pageSize));
    }

    [HttpGet("{id:guid}", Name = "GetVehicle")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<VehicleResponse>> Get(Guid companyId, Guid id)
    {
        var vehicle = await _db.Vehicles.AsNoTracking().FirstOrDefaultAsync(v => v.Id == id && v.CompanyId == companyId);
        return vehicle is null ? NotFound() : Ok(ToResponse(vehicle, await WarehouseNamesAsync(companyId)));
    }

    [HttpPost(Name = "CreateVehicle")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Inventory)]
    [ProducesResponseType(typeof(VehicleResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<VehicleResponse>> Create(Guid companyId, SaveVehicleRequest request)
    {
        var vehicle = new Vehicle { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyAsync(companyId, vehicle, request) is { } error) return BadRequest(error);
        _db.Vehicles.Add(vehicle);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(vehicle, await WarehouseNamesAsync(companyId)));
    }

    [HttpPut("{id:guid}", Name = "UpdateVehicle")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Inventory)]
    public async Task<ActionResult<VehicleResponse>> Update(Guid companyId, Guid id, SaveVehicleRequest request)
    {
        var vehicle = await _db.Vehicles.FirstOrDefaultAsync(v => v.Id == id && v.CompanyId == companyId);
        if (vehicle is null) return NotFound();
        if (await ApplyAsync(companyId, vehicle, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok(ToResponse(vehicle, await WarehouseNamesAsync(companyId)));
    }

    [HttpPost("{id:guid}/archive", Name = "ArchiveVehicle")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Inventory)]
    public async Task<ActionResult<VehicleResponse>> Archive(Guid companyId, Guid id)
    {
        var vehicle = await _db.Vehicles.FirstOrDefaultAsync(v => v.Id == id && v.CompanyId == companyId);
        if (vehicle is null) return NotFound();
        if (vehicle.StockWarehouseId is { } warehouseId)
        {
            var location = await _stock.StockLocationAsync(companyId, warehouseId);
            if (await _db.StockBalances.AnyAsync(b => b.LocationId == location.Id && b.Quantity != 0))
            {
                return BadRequest(_localizer["WarehouseHasStock"].Value);
            }
        }
        vehicle.IsArchived = true;
        await _db.SaveChangesAsync();
        return Ok(ToResponse(vehicle, await WarehouseNamesAsync(companyId)));
    }

    [HttpPost("{id:guid}/restore", Name = "RestoreVehicle")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Inventory)]
    public async Task<ActionResult<VehicleResponse>> Restore(Guid companyId, Guid id)
    {
        var vehicle = await _db.Vehicles.FirstOrDefaultAsync(v => v.Id == id && v.CompanyId == companyId);
        if (vehicle is null) return NotFound();
        vehicle.IsArchived = false;
        await _db.SaveChangesAsync();
        return Ok(ToResponse(vehicle, await WarehouseNamesAsync(companyId)));
    }

    private async Task<string?> ApplyAsync(Guid companyId, Vehicle vehicle, SaveVehicleRequest r)
    {
        var plate = (r.Plate ?? string.Empty).Trim().ToUpperInvariant();
        if (plate.Length == 0 || plate.Length > 20 || r.CapacityKg is < 0 || !Enum.IsDefined(r.Type) || !Enum.IsDefined(r.Status))
        {
            return _localizer["VehicleInvalid"].Value;
        }
        if (await _db.Vehicles.AnyAsync(v => v.CompanyId == companyId && v.Plate == plate && v.Id != vehicle.Id)) return _localizer["VehiclePlateTaken"].Value;

        var warehouseId = r.StockWarehouseId;
        if (warehouseId is null && r.CreateStockWarehouse && vehicle.StockWarehouseId is null)
        {
            var code = $"VEH-{plate.Replace(" ", "")}";
            if (code.Length > 20) code = code[..20];
            if (await _db.Warehouses.AnyAsync(w => w.CompanyId == companyId && w.Code == code)) return _localizer["WarehouseCodeTaken"].Value;
            var warehouse = await _stock.CreateWarehouseAsync(companyId, code, plate, null);
            warehouseId = warehouse.Id;
        }
        else if (warehouseId is null)
        {
            warehouseId = vehicle.StockWarehouseId;
        }
        if (warehouseId is { } id && warehouseId != vehicle.StockWarehouseId)
        {
            var usable = await _db.Warehouses.AnyAsync(w => w.Id == id && w.CompanyId == companyId && w.IsActive)
                && !await _db.Vehicles.AnyAsync(v => v.StockWarehouseId == id && v.Id != vehicle.Id);
            if (!usable && !_db.ChangeTracker.Entries<Warehouse>().Any(e => e.Entity.Id == id && e.State == EntityState.Added)) return _localizer["VehicleWarehouseInvalid"].Value;
        }

        if (r.DriverUserId is { } driver && !await CompanyMembers.ExistsAsync(_db, companyId, driver)) return _localizer["VehicleDriverInvalid"].Value;

        vehicle.Plate = plate;
        vehicle.Make = Blank(r.Make);
        vehicle.Model = Blank(r.Model);
        vehicle.Type = r.Type;
        vehicle.Status = r.Status;
        vehicle.DriverUserId = r.DriverUserId;
        vehicle.CapacityKg = r.CapacityKg;
        vehicle.Notes = Blank(r.Notes);
        vehicle.StockWarehouseId = warehouseId;
        return null;
    }

    private async Task<Dictionary<Guid, string>> WarehouseNamesAsync(Guid companyId) =>
        await _db.Warehouses.AsNoTracking().Where(w => w.CompanyId == companyId).ToDictionaryAsync(w => w.Id, w => w.Name);

    private static VehicleResponse ToResponse(Vehicle v, Dictionary<Guid, string> warehouses) => new(v.Id, v.Plate, v.Make, v.Model, v.Type, v.Status,
        v.DriverUserId, v.CapacityKg, v.Notes, v.StockWarehouseId, v.StockWarehouseId is { } w ? warehouses.GetValueOrDefault(w) : null, v.IsArchived);

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
