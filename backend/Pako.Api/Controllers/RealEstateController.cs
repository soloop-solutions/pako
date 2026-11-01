using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Projects;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/ERP_VERTICALS_PLAN.md §2 — real estate sales, phase 1 (Sales). Buildings carry a ledger
// project; units are reserved, then sold on a contract with an installment plan (or given to the
// landowner in compensation). Installments become draft invoices tagged with the building's project;
// what is paid is read back from the invoices.
[ApiController]
[Route("api/companies/{companyId:guid}/real-estate")]
[Authorize]
public class RealEstateController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public RealEstateController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    private static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
    private static DateOnly Today => DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));

    // ---- Buildings and units ----

    [HttpGet("buildings", Name = "ListBuildings")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<BuildingResponse>>> Buildings(Guid companyId)
    {
        var buildings = await _db.Buildings.AsNoTracking().Where(b => b.CompanyId == companyId).OrderBy(b => b.Name).ToListAsync();
        return Ok(await BuildingResponsesAsync(buildings));
    }

    [HttpPost("buildings", Name = "CreateBuilding")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(BuildingResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<BuildingResponse>> CreateBuilding(Guid companyId, SaveBuildingRequest request)
    {
        if (await ValidateBuildingAsync(companyId, null, request) is { } error) return BadRequest(error);
        var project = await ProjectBilling.NewProjectAsync(_db, companyId, request.ProjectCode ?? "", request.Name);
        if (project is null) return BadRequest(_localizer["SiteProjectCodeInvalid"].Value);
        var building = new Building
        {
            Id = Guid.NewGuid(), CompanyId = companyId, ProjectId = project.Id, Name = request.Name.Trim(), SaleItemId = request.SaleItemId,
            Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim(),
        };
        _db.Buildings.Add(building);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await BuildingResponsesAsync(new() { building }))[0]);
    }

    [HttpPut("buildings/{buildingId:guid}", Name = "UpdateBuilding")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<BuildingResponse>> UpdateBuilding(Guid companyId, Guid buildingId, SaveBuildingRequest request)
    {
        var building = await _db.Buildings.FirstOrDefaultAsync(b => b.Id == buildingId && b.CompanyId == companyId);
        if (building is null) return NotFound();
        if (await ValidateBuildingAsync(companyId, buildingId, request) is { } error) return BadRequest(error);
        (building.Name, building.SaleItemId, building.Address) = (request.Name.Trim(), request.SaleItemId,
            string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim());
        await _db.SaveChangesAsync();
        return Ok((await BuildingResponsesAsync(new() { building }))[0]);
    }

    private async Task<string?> ValidateBuildingAsync(Guid companyId, Guid? id, SaveBuildingRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Trim().Length > 160) return _localizer["BuildingInvalid"].Value;
        if (await _db.Buildings.AnyAsync(b => b.CompanyId == companyId && b.Id != id && b.Name == r.Name.Trim())) return _localizer["BuildingInvalid"].Value;
        if (!await _db.Items.AnyAsync(i => i.Id == r.SaleItemId && i.CompanyId == companyId)) return _localizer["SiteBillingItemInvalid"].Value;
        return null;
    }

    private async Task<List<BuildingResponse>> BuildingResponsesAsync(List<Building> buildings)
    {
        var ids = buildings.Select(b => b.Id).ToList();
        var units = await _db.PropertyUnits.AsNoTracking().Where(u => ids.Contains(u.BuildingId)).Select(u => new { u.BuildingId, u.State }).ToListAsync();
        var projectIds = buildings.Select(b => b.ProjectId).ToList();
        var projects = await _db.Projects.AsNoTracking().Where(p => projectIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Code);
        return buildings.Select(b =>
        {
            var own = units.Where(u => u.BuildingId == b.Id).ToList();
            return new BuildingResponse(b.Id, b.ProjectId, projects.GetValueOrDefault(b.ProjectId) ?? "?", b.Name, b.Address, b.SaleItemId, own.Count,
                own.Count(u => u.State == UnitState.Available), own.Count(u => u.State == UnitState.Reserved),
                own.Count(u => u.State is UnitState.Sold or UnitState.Compensation), own.Count(u => u.State == UnitState.Rented));
        }).ToList();
    }

    [HttpGet("units", Name = "ListPropertyUnits")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<UnitResponse>>> Units(Guid companyId, [FromQuery] Guid? buildingId = null, [FromQuery] UnitState? state = null)
    {
        var query = _db.PropertyUnits.AsNoTracking().Where(u => u.CompanyId == companyId);
        if (buildingId is { } b) query = query.Where(u => u.BuildingId == b);
        if (state is { } s) query = query.Where(u => u.State == s);
        return Ok(await UnitResponsesAsync(await query.ToListAsync()));
    }

    [HttpPost("units", Name = "CreatePropertyUnit")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(UnitResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<UnitResponse>> CreateUnit(Guid companyId, SaveUnitRequest request)
    {
        var unit = new PropertyUnit { Id = Guid.NewGuid(), CompanyId = companyId, State = UnitState.Available };
        if (await ApplyUnitAsync(companyId, unit, request) is { } error) return BadRequest(error);
        _db.PropertyUnits.Add(unit);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await UnitResponsesAsync(new() { unit }))[0]);
    }

    [HttpPut("units/{unitId:guid}", Name = "UpdatePropertyUnit")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<UnitResponse>> UpdateUnit(Guid companyId, Guid unitId, SaveUnitRequest request)
    {
        var unit = await _db.PropertyUnits.FirstOrDefaultAsync(u => u.Id == unitId && u.CompanyId == companyId);
        if (unit is null) return NotFound();
        if (await ApplyUnitAsync(companyId, unit, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await UnitResponsesAsync(new() { unit }))[0]);
    }

    private async Task<string?> ApplyUnitAsync(Guid companyId, PropertyUnit unit, SaveUnitRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Number) || r.Number.Trim().Length > 20 || r.Area < 0 || r.ListPrice < 0) return _localizer["UnitInvalid"].Value;
        if (!await _db.Buildings.AnyAsync(b => b.Id == r.BuildingId && b.CompanyId == companyId)) return _localizer["UnitInvalid"].Value;
        if (await _db.PropertyUnits.AnyAsync(u => u.BuildingId == r.BuildingId && u.Id != unit.Id && u.Number == r.Number.Trim())) return _localizer["UnitInvalid"].Value;
        (unit.BuildingId, unit.Number, unit.Kind, unit.Area, unit.ListPrice, unit.Floor) =
            (r.BuildingId, r.Number.Trim(), r.Kind, r.Area, Money(r.ListPrice), string.IsNullOrWhiteSpace(r.Floor) ? null : r.Floor.Trim());
        return null;
    }

    // Who holds the unit: the active reservation's partner, the buyer, or the tenant.
    private async Task<List<UnitResponse>> UnitResponsesAsync(List<PropertyUnit> units)
    {
        var ids = units.Select(u => u.Id).ToList();
        var buildingIds = units.Select(u => u.BuildingId).Distinct().ToList();
        var buildings = await _db.Buildings.AsNoTracking().Where(b => buildingIds.Contains(b.Id)).ToDictionaryAsync(b => b.Id, b => b.Name);
        var holders = (await _db.UnitReservations.AsNoTracking().Where(r => ids.Contains(r.UnitId) && r.State == ReservationState.Active)
                .Select(r => new { r.UnitId, r.PartnerId }).ToListAsync())
            .Concat(await _db.UnitSaleContracts.AsNoTracking().Where(c => ids.Contains(c.UnitId) && c.State != ContractState.Cancelled)
                .Select(c => new { c.UnitId, PartnerId = c.BuyerPartnerId }).ToListAsync())
            .Concat(await _db.Leases.AsNoTracking().Where(l => l.UnitId != null && ids.Contains(l.UnitId.Value) && l.State == LeaseState.Active)
                .Select(l => new { UnitId = l.UnitId!.Value, PartnerId = l.TenantPartnerId }).ToListAsync())
            .GroupBy(h => h.UnitId).ToDictionary(g => g.Key, g => g.Last().PartnerId);
        var partnerIds = holders.Values.Distinct().ToList();
        var partners = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        return units.OrderBy(u => buildings.GetValueOrDefault(u.BuildingId)).ThenBy(u => u.Floor).ThenBy(u => u.Number)
            .Select(u => new UnitResponse(u.Id, u.BuildingId, buildings.GetValueOrDefault(u.BuildingId) ?? "?", u.Number, u.Floor, u.Kind, u.Area, u.ListPrice, u.State,
                u.Area > 0 ? Money(u.ListPrice / u.Area) : null,
                holders.TryGetValue(u.Id, out var holder) ? partners.GetValueOrDefault(holder) : null)).ToList();
    }

    // ---- Reservations ----

    [HttpGet("reservations", Name = "ListUnitReservations")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<ReservationResponse>>> Reservations(Guid companyId, [FromQuery] ReservationState? state = null)
    {
        // Reservations past their date lapse and free the unit.
        await ExpireAsync(companyId);
        var query = _db.UnitReservations.AsNoTracking().Where(r => _db.PropertyUnits.Any(u => u.Id == r.UnitId && u.CompanyId == companyId));
        if (state is { } s) query = query.Where(r => r.State == s);
        return Ok(await ReservationResponsesAsync(await query.OrderByDescending(r => r.Date).ToListAsync()));
    }

    private async Task ExpireAsync(Guid companyId)
    {
        var today = Today;
        var lapsed = await _db.UnitReservations.Where(r => r.State == ReservationState.Active && r.ExpiresOn < today
            && _db.PropertyUnits.Any(u => u.Id == r.UnitId && u.CompanyId == companyId)).ToListAsync();
        if (lapsed.Count == 0) return;
        var unitIds = lapsed.Select(r => r.UnitId).ToList();
        foreach (var unit in await _db.PropertyUnits.Where(u => unitIds.Contains(u.Id) && u.State == UnitState.Reserved).ToListAsync()) unit.State = UnitState.Available;
        foreach (var r in lapsed) r.State = ReservationState.Expired;
        await _db.SaveChangesAsync();
    }

    [HttpPost("reservations", Name = "CreateUnitReservation")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(ReservationResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ReservationResponse>> Reserve(Guid companyId, SaveReservationRequest request)
    {
        await ExpireAsync(companyId);
        var unit = await _db.PropertyUnits.FirstOrDefaultAsync(u => u.Id == request.UnitId && u.CompanyId == companyId);
        if (unit is null) return NotFound();
        if (unit.State != UnitState.Available) return BadRequest(_localizer["UnitNotAvailable"].Value);
        if (!await _db.Partners.AnyAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId && p.IsCustomer)) return BadRequest(_localizer["InvalidCustomerPartner"].Value);
        if (request.ExpiresOn < request.Date || request.Deposit < 0) return BadRequest(_localizer["ReservationInvalid"].Value);
        var reservation = new UnitReservation
        {
            Id = Guid.NewGuid(), UnitId = unit.Id, PartnerId = request.PartnerId, Date = request.Date, ExpiresOn = request.ExpiresOn, Deposit = Money(request.Deposit),
            State = ReservationState.Active, Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
        };
        unit.State = UnitState.Reserved;
        _db.UnitReservations.Add(reservation);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await ReservationResponsesAsync(new() { reservation }))[0]);
    }

    [HttpPost("reservations/{reservationId:guid}/cancel", Name = "CancelUnitReservation")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<ReservationResponse>> CancelReservation(Guid companyId, Guid reservationId)
    {
        var reservation = await _db.UnitReservations.FirstOrDefaultAsync(r => r.Id == reservationId && _db.PropertyUnits.Any(u => u.Id == r.UnitId && u.CompanyId == companyId));
        if (reservation is null) return NotFound();
        if (reservation.State != ReservationState.Active) return BadRequest(_localizer["ReservationInvalid"].Value);
        reservation.State = ReservationState.Cancelled;
        var unit = await _db.PropertyUnits.FirstAsync(u => u.Id == reservation.UnitId);
        if (unit.State == UnitState.Reserved) unit.State = UnitState.Available;
        await _db.SaveChangesAsync();
        return Ok((await ReservationResponsesAsync(new() { reservation }))[0]);
    }

    private async Task<List<ReservationResponse>> ReservationResponsesAsync(List<UnitReservation> rows)
    {
        var unitIds = rows.Select(r => r.UnitId).Distinct().ToList();
        var units = await _db.PropertyUnits.AsNoTracking().Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Number);
        var partnerIds = rows.Select(r => r.PartnerId).Distinct().ToList();
        var partners = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        return rows.Select(r => new ReservationResponse(r.Id, r.UnitId, units.GetValueOrDefault(r.UnitId) ?? "?", r.PartnerId, partners.GetValueOrDefault(r.PartnerId) ?? "?",
            r.Date, r.ExpiresOn, r.Deposit, r.State, r.Notes)).ToList();
    }

    // ---- Sale contracts ----

    [HttpGet("contracts", Name = "ListUnitSaleContracts")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<SaleContractResponse>>> Contracts(Guid companyId, [FromQuery] Guid? buildingId = null, [FromQuery] ContractState? state = null)
    {
        var query = _db.UnitSaleContracts.AsNoTracking().Include(c => c.Installments).Where(c => c.CompanyId == companyId);
        if (buildingId is { } b) query = query.Where(c => _db.PropertyUnits.Any(u => u.Id == c.UnitId && u.BuildingId == b));
        if (state is { } s) query = query.Where(c => c.State == s);
        return Ok(await ContractResponsesAsync(await query.OrderByDescending(c => c.ContractDate).ToListAsync()));
    }

    [HttpGet("contracts/{contractId:guid}", Name = "GetUnitSaleContract")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<SaleContractResponse>> Contract(Guid companyId, Guid contractId)
    {
        var contract = await _db.UnitSaleContracts.AsNoTracking().Include(c => c.Installments).FirstOrDefaultAsync(c => c.Id == contractId && c.CompanyId == companyId);
        return contract is null ? NotFound() : Ok((await ContractResponsesAsync(new() { contract }))[0]);
    }

    // The unit is sold (or given in compensation); a reservation of the same buyer converts. The plan
    // must add up to the price: an explicit one, or a down payment plus equal monthly installments
    // (the last takes the rounding).
    [HttpPost("contracts", Name = "CreateUnitSaleContract")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(SaleContractResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<SaleContractResponse>> CreateContract(Guid companyId, SaveSaleContractRequest request)
    {
        await ExpireAsync(companyId);
        var unit = await _db.PropertyUnits.FirstOrDefaultAsync(u => u.Id == request.UnitId && u.CompanyId == companyId);
        if (unit is null) return NotFound();
        if (!await _db.Partners.AnyAsync(p => p.Id == request.BuyerPartnerId && p.CompanyId == companyId && p.IsCustomer)) return BadRequest(_localizer["InvalidCustomerPartner"].Value);
        UnitReservation? reservation = null;
        if (unit.State == UnitState.Reserved)
        {
            reservation = await _db.UnitReservations.FirstOrDefaultAsync(r => r.UnitId == unit.Id && r.State == ReservationState.Active);
            if (reservation is null || reservation.PartnerId != request.BuyerPartnerId) return BadRequest(_localizer["UnitNotAvailable"].Value);
        }
        else if (unit.State != UnitState.Available)
        {
            return BadRequest(_localizer["UnitNotAvailable"].Value);
        }
        if (request.Price <= 0) return BadRequest(_localizer["ContractPlanInvalid"].Value);
        var price = Money(request.Price);

        List<(DateOnly Due, decimal Amount)> plan;
        if (request.Installments is { Count: > 0 } explicitPlan)
        {
            plan = explicitPlan.OrderBy(i => i.DueDate).Select(i => (i.DueDate, Money(i.Amount))).ToList();
        }
        else
        {
            plan = new();
            var down = Money(request.DownPayment);
            if (down > 0) plan.Add((request.ContractDate, down));
            var count = request.InstallmentCount;
            var rest = price - down;
            if (count > 0 && rest > 0)
            {
                var each = Money(rest / count);
                var first = request.FirstInstallment ?? request.ContractDate.AddMonths(1);
                for (var i = 0; i < count; i++) plan.Add((first.AddMonths(i), i == count - 1 ? rest - each * (count - 1) : each));
            }
            else if (rest > 0)
            {
                plan.Add((request.ContractDate, rest));
            }
        }
        if (plan.Count is 0 or > 360 || plan.Any(p => p.Amount <= 0) || plan.Sum(p => p.Amount) != price) return BadRequest(_localizer["ContractPlanInvalid"].Value);

        var count2 = await _db.UnitSaleContracts.CountAsync(c => c.CompanyId == companyId);
        var contract = new UnitSaleContract
        {
            Id = Guid.NewGuid(), CompanyId = companyId, UnitId = unit.Id, BuyerPartnerId = request.BuyerPartnerId, Number = $"KSH-{count2 + 1:D4}", Kind = request.Kind,
            ContractDate = request.ContractDate, Price = price, State = ContractState.Active, Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
        };
        contract.Installments = plan.Select((p, i) => new Installment { Id = Guid.NewGuid(), ContractId = contract.Id, Number = i + 1, DueDate = p.Due, Amount = p.Amount }).ToList();
        unit.State = request.Kind == ContractKind.Compensation ? UnitState.Compensation : UnitState.Sold;
        if (reservation is not null) reservation.State = ReservationState.Converted;
        _db.UnitSaleContracts.Add(contract);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await ContractResponsesAsync(new() { contract }))[0]);
    }

    // One draft invoice for the chosen installments (each a line on the building's sale item).
    [HttpPost("contracts/{contractId:guid}/invoice", Name = "InvoiceInstallments")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<Guid>> InvoiceInstallments(Guid companyId, Guid contractId, InvoiceInstallmentsRequest request)
    {
        var contract = await _db.UnitSaleContracts.Include(c => c.Installments).FirstOrDefaultAsync(c => c.Id == contractId && c.CompanyId == companyId);
        if (contract is null) return NotFound();
        if (contract.State != ContractState.Active) return BadRequest(_localizer["ContractNotActive"].Value);
        var chosen = contract.Installments.Where(i => request.InstallmentIds.Contains(i.Id)).OrderBy(i => i.Number).ToList();
        if (chosen.Count == 0 || chosen.Count != request.InstallmentIds.Distinct().Count() || chosen.Any(i => i.InvoiceId != null))
        {
            return BadRequest(_localizer["InstallmentsInvalid"].Value);
        }
        var unit = await _db.PropertyUnits.AsNoTracking().FirstAsync(u => u.Id == contract.UnitId);
        var building = await _db.Buildings.AsNoTracking().FirstAsync(b => b.Id == unit.BuildingId);
        var item = await _db.Items.AsNoTracking().FirstAsync(i => i.Id == building.SaleItemId);
        var total = contract.Installments.Count;
        var charges = chosen.Select(i => new ProjectBilling.Charge(item,
            string.Format(_localizer["InstallmentLine"].Value, i.Number, total, building.Name, unit.Number, contract.Number), 1m, i.Amount)).ToList();
        var issue = request.IssueDate ?? Today;
        var invoice = await ProjectBilling.DraftAsync(_db, companyId, contract.BuyerPartnerId, issue, chosen.Max(i => i.DueDate) < issue ? issue : chosen.Max(i => i.DueDate),
            building.ProjectId, charges, contract.Number);
        foreach (var i in chosen) i.InvoiceId = invoice.Id;
        await _db.SaveChangesAsync();
        return Ok(invoice.Id);
    }

    // Only before anything was invoiced; the unit is free again.
    [HttpPost("contracts/{contractId:guid}/cancel", Name = "CancelUnitSaleContract")]
    [RequireCompanyAccess(module: AccessModule.Sales, approve: true)]
    public async Task<ActionResult<SaleContractResponse>> CancelContract(Guid companyId, Guid contractId)
    {
        var contract = await _db.UnitSaleContracts.Include(c => c.Installments).FirstOrDefaultAsync(c => c.Id == contractId && c.CompanyId == companyId);
        if (contract is null) return NotFound();
        if (contract.State != ContractState.Active || contract.Installments.Any(i => i.InvoiceId != null)) return BadRequest(_localizer["ContractHasInvoices"].Value);
        contract.State = ContractState.Cancelled;
        var unit = await _db.PropertyUnits.FirstAsync(u => u.Id == contract.UnitId);
        unit.State = UnitState.Available;
        await _db.SaveChangesAsync();
        return Ok((await ContractResponsesAsync(new() { contract }))[0]);
    }

    private async Task<List<SaleContractResponse>> ContractResponsesAsync(List<UnitSaleContract> contracts)
    {
        var unitIds = contracts.Select(c => c.UnitId).Distinct().ToList();
        var units = await _db.PropertyUnits.AsNoTracking().Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        var buildingIds = units.Values.Select(u => u.BuildingId).Distinct().ToList();
        var buildings = await _db.Buildings.AsNoTracking().Where(b => buildingIds.Contains(b.Id)).ToDictionaryAsync(b => b.Id, b => b.Name);
        var partnerIds = contracts.Select(c => c.BuyerPartnerId).Distinct().ToList();
        var partners = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        var invoiceIds = contracts.SelectMany(c => c.Installments).Where(i => i.InvoiceId != null).Select(i => i.InvoiceId!.Value).Distinct().ToList();
        var numbers = await _db.Invoices.AsNoTracking().Where(i => invoiceIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.InvoiceNumber);
        var open = contracts.Count == 0 ? new() : await ProjectBilling.OpenAsync(_db, contracts[0].CompanyId, invoiceIds);
        var today = Today;
        return contracts.Select(c =>
        {
            var unit = units[c.UnitId];
            // An invoice's open amount is shared over its installments in order.
            var installments = new List<InstallmentResponse>();
            foreach (var group in c.Installments.OrderBy(i => i.Number).GroupBy(i => i.InvoiceId))
            {
                var remaining = group.Key is { } invoiceId ? open.TryGetValue(invoiceId, out var o) ? o.Open : group.Sum(i => i.Amount) : 0m;
                var paidFirst = group.Sum(i => i.Amount) - remaining;
                foreach (var i in group)
                {
                    var paid = Math.Min(paidFirst, i.Amount);
                    paidFirst -= paid;
                    var stillOpen = i.InvoiceId is null ? i.Amount : i.Amount - paid;
                    installments.Add(new InstallmentResponse(i.Id, i.Number, i.DueDate, i.Amount, i.InvoiceId,
                        i.InvoiceId is { } id ? numbers.GetValueOrDefault(id) : null, stillOpen, stillOpen > 0 && i.DueDate < today));
                }
            }
            installments = installments.OrderBy(i => i.Number).ToList();
            var invoiced = installments.Where(i => i.InvoiceId != null).Sum(i => i.Amount);
            var paidTotal = installments.Where(i => i.InvoiceId != null).Sum(i => i.Amount - i.Open);
            return new SaleContractResponse(c.Id, c.Number, c.UnitId, unit.Number, buildings.GetValueOrDefault(unit.BuildingId) ?? "?", c.BuyerPartnerId,
                partners.GetValueOrDefault(c.BuyerPartnerId) ?? "?", c.Kind, c.ContractDate, c.Price, c.State, c.Notes, invoiced, paidTotal, c.Price - paidTotal,
                installments.Where(i => i.Overdue).Sum(i => i.Open), installments);
        }).ToList();
    }
}
