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

// docs/ERP_VERTICALS_PLAN.md §3 — property rental, phase 1 (Sales). A lease lets a unit (or any
// property) to a tenant for a monthly rent; the rent run makes one draft invoice per running lease
// and month — a part month charged by the day — with the utility meters read since the last run
// re-billed at their item's price. A month is never invoiced twice.
[ApiController]
[Route("api/companies/{companyId:guid}/rentals")]
[Authorize]
public class RentalsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PriceListService _prices;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public RentalsController(PakoDbContext db, PriceListService prices, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _prices = prices;
        _localizer = localizer;
    }

    private static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    [HttpGet("leases", Name = "ListLeases")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<LeaseResponse>>> Leases(Guid companyId, [FromQuery] LeaseState? state = null, [FromQuery] Guid? tenantId = null)
    {
        var query = _db.Leases.AsNoTracking().Include(l => l.Meters).Where(l => l.CompanyId == companyId);
        if (state is { } s) query = query.Where(l => l.State == s);
        if (tenantId is { } t) query = query.Where(l => l.TenantPartnerId == t);
        return Ok(await ResponsesAsync(companyId, await query.OrderBy(l => l.Number).ToListAsync()));
    }

    [HttpGet("leases/{leaseId:guid}", Name = "GetLease")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<LeaseResponse>> Lease(Guid companyId, Guid leaseId)
    {
        var lease = await _db.Leases.AsNoTracking().Include(l => l.Meters).FirstOrDefaultAsync(l => l.Id == leaseId && l.CompanyId == companyId);
        return lease is null ? NotFound() : Ok((await ResponsesAsync(companyId, new() { lease }))[0]);
    }

    [HttpPost("leases", Name = "CreateLease")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(LeaseResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<LeaseResponse>> CreateLease(Guid companyId, SaveLeaseRequest request)
    {
        var count = await _db.Leases.CountAsync(l => l.CompanyId == companyId);
        var lease = new Lease { Id = Guid.NewGuid(), CompanyId = companyId, Number = $"QR-{count + 1:D4}", State = LeaseState.Draft };
        if (await ApplyAsync(companyId, lease, request) is { } error) return BadRequest(error);
        _db.Leases.Add(lease);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await ResponsesAsync(companyId, new() { lease }))[0]);
    }

    // Terms change while a draft; a running lease only takes its notes, deposit dates and meters.
    [HttpPut("leases/{leaseId:guid}", Name = "UpdateLease")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<LeaseResponse>> UpdateLease(Guid companyId, Guid leaseId, SaveLeaseRequest request)
    {
        var lease = await _db.Leases.Include(l => l.Meters).FirstOrDefaultAsync(l => l.Id == leaseId && l.CompanyId == companyId);
        if (lease is null) return NotFound();
        if (lease.State == LeaseState.Ended) return BadRequest(_localizer["LeaseEnded"].Value);
        if (lease.State == LeaseState.Active && (lease.TenantPartnerId != request.TenantPartnerId || lease.StartDate != request.StartDate || lease.UnitId != request.UnitId
                || lease.Rent != Money(request.Rent) || lease.RentItemId != request.RentItemId))
        {
            return BadRequest(_localizer["LeaseTermsLocked"].Value);
        }
        if (await ApplyAsync(companyId, lease, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await ResponsesAsync(companyId, new() { lease }))[0]);
    }

    private async Task<string?> ApplyAsync(Guid companyId, Lease lease, SaveLeaseRequest r)
    {
        if (r.Rent < 0 || r.DueDay is < 1 or > 28 || r.Deposit < 0 || (r.EndDate is { } end && end < r.StartDate)
            || (r.UnitId is null && string.IsNullOrWhiteSpace(r.Property)))
        {
            return _localizer["LeaseInvalid"].Value;
        }
        if (!await _db.Partners.AnyAsync(p => p.Id == r.TenantPartnerId && p.CompanyId == companyId && p.IsCustomer)) return _localizer["InvalidCustomerPartner"].Value;
        if (!await _db.Items.AnyAsync(i => i.Id == r.RentItemId && i.CompanyId == companyId)) return _localizer["SiteBillingItemInvalid"].Value;
        if (r.UnitId is { } unitId)
        {
            var unit = await _db.PropertyUnits.AsNoTracking().FirstOrDefaultAsync(u => u.Id == unitId && u.CompanyId == companyId);
            if (unit is null) return _localizer["UnitInvalid"].Value;
            if (unit.State is not (UnitState.Available or UnitState.Rented) && lease.UnitId != unitId) return _localizer["UnitNotAvailable"].Value;
            if (await _db.Leases.AnyAsync(l => l.UnitId == unitId && l.Id != lease.Id && l.State == LeaseState.Active)) return _localizer["UnitNotAvailable"].Value;
        }
        var meters = r.Meters ?? new();
        if (meters.Any(m => string.IsNullOrWhiteSpace(m.Name) || m.Name.Trim().Length > 60 || m.LastReading < 0)
            || meters.Select(m => m.Name.Trim()).Distinct().Count() != meters.Count)
        {
            return _localizer["LeaseMeterInvalid"].Value;
        }
        var meterItems = meters.Select(m => m.ItemId).Distinct().ToList();
        if (await _db.Items.CountAsync(i => i.CompanyId == companyId && meterItems.Contains(i.Id)) != meterItems.Count) return _localizer["LeaseMeterInvalid"].Value;

        lease.TenantPartnerId = r.TenantPartnerId;
        lease.UnitId = r.UnitId;
        lease.Property = string.IsNullOrWhiteSpace(r.Property) ? null : r.Property.Trim();
        lease.StartDate = r.StartDate;
        lease.EndDate = r.EndDate;
        lease.Rent = Money(r.Rent);
        lease.RentItemId = r.RentItemId;
        lease.DueDay = r.DueDay;
        lease.Deposit = Money(r.Deposit);
        lease.DepositReceivedOn = r.DepositReceivedOn;
        lease.DepositReturnedOn = r.DepositReturnedOn;
        lease.Notes = string.IsNullOrWhiteSpace(r.Notes) ? null : r.Notes.Trim();
        // Meters are matched by name so their readings carry over.
        var byName = meters.ToDictionary(m => m.Name.Trim());
        foreach (var gone in lease.Meters.Where(m => !byName.ContainsKey(m.Name)).ToList())
        {
            lease.Meters.Remove(gone);
            _db.LeaseMeters.Remove(gone);
        }
        foreach (var (name, m) in byName)
        {
            var existing = lease.Meters.FirstOrDefault(x => x.Name == name);
            if (existing is null)
            {
                existing = new LeaseMeter { Id = Guid.NewGuid(), LeaseId = lease.Id, Name = name, LastReading = m.LastReading };
                lease.Meters.Add(existing);
                if (_db.Entry(lease).State != EntityState.Detached) _db.LeaseMeters.Add(existing);
            }
            existing.ItemId = m.ItemId;
        }
        return null;
    }

    [HttpPost("leases/{leaseId:guid}/activate", Name = "ActivateLease")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<LeaseResponse>> Activate(Guid companyId, Guid leaseId)
    {
        var lease = await _db.Leases.Include(l => l.Meters).FirstOrDefaultAsync(l => l.Id == leaseId && l.CompanyId == companyId);
        if (lease is null) return NotFound();
        if (lease.State != LeaseState.Draft) return BadRequest(_localizer["LeaseNotDraft"].Value);
        if (lease.UnitId is { } unitId)
        {
            var unit = await _db.PropertyUnits.FirstAsync(u => u.Id == unitId);
            if (unit.State != UnitState.Available || await _db.Leases.AnyAsync(l => l.UnitId == unitId && l.State == LeaseState.Active)) return BadRequest(_localizer["UnitNotAvailable"].Value);
            unit.State = UnitState.Rented;
        }
        lease.State = LeaseState.Active;
        await _db.SaveChangesAsync();
        return Ok((await ResponsesAsync(companyId, new() { lease }))[0]);
    }

    // The tenant leaves: the last month is charged to the end date by the next run; the unit is free.
    [HttpPost("leases/{leaseId:guid}/end", Name = "EndLease")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<LeaseResponse>> End(Guid companyId, Guid leaseId, EndLeaseRequest request)
    {
        var lease = await _db.Leases.Include(l => l.Meters).FirstOrDefaultAsync(l => l.Id == leaseId && l.CompanyId == companyId);
        if (lease is null) return NotFound();
        if (lease.State != LeaseState.Active || request.EndDate < lease.StartDate) return BadRequest(_localizer["LeaseInvalid"].Value);
        lease.EndDate = request.EndDate;
        lease.State = LeaseState.Ended;
        if (lease.UnitId is { } unitId)
        {
            var unit = await _db.PropertyUnits.FirstAsync(u => u.Id == unitId);
            if (unit.State == UnitState.Rented) unit.State = UnitState.Available;
        }
        await _db.SaveChangesAsync();
        return Ok((await ResponsesAsync(companyId, new() { lease }))[0]);
    }

    // A meter read for the next rent run.
    [HttpPost("leases/{leaseId:guid}/meters/{meterId:guid}/reading", Name = "ReadLeaseMeter")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<LeaseResponse>> Read(Guid companyId, Guid leaseId, Guid meterId, MeterReadingInput request)
    {
        var lease = await _db.Leases.Include(l => l.Meters).FirstOrDefaultAsync(l => l.Id == leaseId && l.CompanyId == companyId);
        var meter = lease?.Meters.FirstOrDefault(m => m.Id == meterId);
        if (lease is null || meter is null) return NotFound();
        if (request.Reading < meter.LastReading) return BadRequest(string.Format(_localizer["LeaseMeterBelowLast"].Value, meter.LastReading));
        meter.PendingReading = request.Reading;
        await _db.SaveChangesAsync();
        return Ok((await ResponsesAsync(companyId, new() { lease }))[0]);
    }

    // The month's rent run: one draft invoice per lease running in the month and not invoiced for it.
    // Rent is charged by the day for a part month (days of the lease in the month ÷ days in the
    // month); pending meter readings are re-billed and become the meters' last readings. Ended
    // leases are included for their last month.
    [HttpPost("run", Name = "RunRent")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<RentRunResponse>> Run(Guid companyId, RentRunRequest request)
    {
        var period = new DateOnly(request.Month.Year, request.Month.Month, 1);
        var periodEnd = period.AddMonths(1).AddDays(-1);
        var days = periodEnd.Day;
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null) await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        var leases = await _db.Leases.Include(l => l.Meters)
            .Where(l => l.CompanyId == companyId && (l.State == LeaseState.Active || l.State == LeaseState.Ended)).ToListAsync();
        var done = await _db.LeaseInvoices.AsNoTracking().Where(i => i.Period == period && leases.Select(l => l.Id).Contains(i.LeaseId)).Select(i => i.LeaseId).ToListAsync();
        var created = new List<Guid>();
        var notRunning = 0;
        foreach (var lease in leases.OrderBy(l => l.Number))
        {
            var from = lease.StartDate > period ? lease.StartDate : period;
            var to = lease.EndDate is { } end && end < periodEnd ? end : periodEnd;
            if (to < from) { notRunning++; continue; }
            if (done.Contains(lease.Id)) continue;
            var leaseDays = to.DayNumber - from.DayNumber + 1;
            var rentItem = await _db.Items.AsNoTracking().FirstAsync(i => i.Id == lease.RentItemId);
            var label = lease.UnitId is { } u
                ? await _db.PropertyUnits.AsNoTracking().Where(x => x.Id == u).Select(x => _db.Buildings.Where(b => b.Id == x.BuildingId).Select(b => b.Name).First() + " " + x.Number).FirstAsync()
                : lease.Property ?? lease.Number;
            var charges = new List<ProjectBilling.Charge>
            {
                new(rentItem, string.Format(_localizer["LeaseRentLine"].Value, label, period.ToString("MM/yyyy"), leaseDays, days), 1m,
                    leaseDays == days ? lease.Rent : Money(lease.Rent * leaseDays / days)),
            };
            foreach (var meter in lease.Meters.Where(m => m.PendingReading is { } p && p > m.LastReading))
            {
                var item = await _db.Items.AsNoTracking().FirstAsync(i => i.Id == meter.ItemId);
                var price = (await _prices.ResolveAsync(companyId, null, periodEnd, new[] { item.Id }, partnerId: lease.TenantPartnerId)).FirstOrDefault()?.Price ?? 0m;
                var used = meter.PendingReading!.Value - meter.LastReading;
                charges.Add(new(item, string.Format(_localizer["LeaseMeterLine"].Value, meter.Name, meter.LastReading, meter.PendingReading), used, price));
                meter.LastReading = meter.PendingReading.Value;
                meter.PendingReading = null;
            }
            var projectId = lease.UnitId is { } unitId
                ? await _db.PropertyUnits.AsNoTracking().Where(x => x.Id == unitId).Select(x => _db.Buildings.Where(b => b.Id == x.BuildingId).Select(b => (Guid?)b.ProjectId).First()).FirstAsync()
                : null;
            var due = new DateOnly(period.Year, period.Month, Math.Min(lease.DueDay, days));
            var invoice = await ProjectBilling.DraftAsync(_db, companyId, lease.TenantPartnerId, period, due, projectId, charges, lease.Number);
            _db.LeaseInvoices.Add(new LeaseInvoice { Id = Guid.NewGuid(), LeaseId = lease.Id, Period = period, InvoiceId = invoice.Id });
            created.Add(invoice.Id);
        }
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok(new RentRunResponse(period, created, created.Count, done.Count, notRunning));
    }

    private async Task<List<LeaseResponse>> ResponsesAsync(Guid companyId, List<Lease> leases)
    {
        var ids = leases.Select(l => l.Id).ToList();
        var partnerIds = leases.Select(l => l.TenantPartnerId).Distinct().ToList();
        var partners = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        var unitIds = leases.Where(l => l.UnitId != null).Select(l => l.UnitId!.Value).ToList();
        var units = await _db.PropertyUnits.AsNoTracking().Where(u => unitIds.Contains(u.Id))
            .Select(u => new { u.Id, Label = _db.Buildings.Where(b => b.Id == u.BuildingId).Select(b => b.Name).First() + " " + u.Number })
            .ToDictionaryAsync(u => u.Id, u => u.Label);
        var invoices = await _db.LeaseInvoices.AsNoTracking().Where(i => ids.Contains(i.LeaseId)).ToListAsync();
        var open = await ProjectBilling.OpenAsync(_db, companyId, invoices.Select(i => i.InvoiceId).ToList());
        var itemIds = leases.SelectMany(l => l.Meters).Select(m => m.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.Name);
        return leases.Select(l =>
        {
            var own = invoices.Where(i => i.LeaseId == l.Id).ToList();
            return new LeaseResponse(l.Id, l.Number, l.UnitId, l.UnitId is { } u ? units.GetValueOrDefault(u) : null, l.Property, l.TenantPartnerId,
                partners.GetValueOrDefault(l.TenantPartnerId) ?? "?", l.StartDate, l.EndDate, l.Rent, l.RentItemId, l.DueDay, l.Deposit, l.DepositReceivedOn,
                l.DepositReturnedOn, l.State, l.Notes, own.Count == 0 ? null : own.Max(i => i.Period),
                own.Sum(i => open.TryGetValue(i.InvoiceId, out var o) ? o.Open : 0m),
                l.Meters.OrderBy(m => m.Name).Select(m => new LeaseMeterResponse(m.Id, m.Name, m.ItemId, items.GetValueOrDefault(m.ItemId) ?? "?", m.LastReading,
                    m.PendingReading)).ToList());
        }).ToList();
    }
}
