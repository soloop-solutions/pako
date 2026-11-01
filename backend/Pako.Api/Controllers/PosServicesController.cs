using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Auth;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Notifications;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md P4: services — resources and their hours, appointments (Pos: Write books and
// moves them; Approve sets resources up), packages and memberships, repair tickets.
[ApiController]
[Route("api/companies/{companyId:guid}/pos")]
[Authorize]
public class PosServicesController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly AppointmentService _appointments;
    private readonly PriceListService _prices;
    private readonly NotificationOutbox _outbox;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PosServicesController(PakoDbContext db, AppointmentService appointments, PriceListService prices, NotificationOutbox outbox,
        IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _appointments = appointments;
        _prices = prices;
        _outbox = outbox;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // ---- Resources ----

    [HttpGet("resources", Name = "ListPosResources")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<ResourceResponse>>> Resources(Guid companyId, [FromQuery] Guid? storeId = null)
    {
        var query = _db.PosResources.AsNoTracking().Include(r => r.Hours).Where(r => r.CompanyId == companyId);
        if (storeId is { } s) query = query.Where(r => r.StoreId == s);
        var resources = await query.OrderBy(r => r.Name).ToListAsync();
        var ids = resources.Select(r => r.Id).ToList();
        var links = await _db.PosServiceResources.AsNoTracking().Where(l => ids.Contains(l.ResourceId)).ToListAsync();
        return Ok(resources.Select(r => ToResponse(r, links)).ToList());
    }

    [HttpPost("resources", Name = "CreatePosResource")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(ResourceResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ResourceResponse>> CreateResource(Guid companyId, SaveResourceRequest request)
    {
        var resource = new ServiceResource { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyAsync(companyId, resource, request, isNew: true) is { } error) return BadRequest(error);
        _db.PosResources.Add(resource);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(resource, await _db.PosServiceResources.AsNoTracking().Where(l => l.ResourceId == resource.Id).ToListAsync()));
    }

    [HttpPut("resources/{resourceId:guid}", Name = "UpdatePosResource")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<ResourceResponse>> UpdateResource(Guid companyId, Guid resourceId, SaveResourceRequest request)
    {
        var resource = await _db.PosResources.Include(r => r.Hours).FirstOrDefaultAsync(r => r.Id == resourceId && r.CompanyId == companyId);
        if (resource is null) return NotFound();
        if (await ApplyAsync(companyId, resource, request, isNew: false) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok(ToResponse(resource, await _db.PosServiceResources.AsNoTracking().Where(l => l.ResourceId == resource.Id).ToListAsync()));
    }

    private async Task<string?> ApplyAsync(Guid companyId, ServiceResource r, SaveResourceRequest req, bool isNew)
    {
        if (string.IsNullOrWhiteSpace(req.Name) || req.Hours.Any(h => h.Day is < 0 or > 6 || h.To <= h.From)) return _localizer["PosResourceInvalid"].Value;
        if (!await _db.PosStores.AnyAsync(s => s.Id == req.StoreId && s.CompanyId == companyId)) return _localizer["PosStoreNotFound"].Value;
        var serviceIds = req.ServiceItemIds.Distinct().ToList();
        if (await _db.Items.CountAsync(i => i.CompanyId == companyId && serviceIds.Contains(i.Id) && i.IsBookable) != serviceIds.Count) return _localizer["PosServiceNotBookable"].Value;
        (r.StoreId, r.Name, r.Kind, r.UserId, r.Color, r.IsActive) = (req.StoreId, req.Name.Trim(), req.Kind, req.UserId,
            string.IsNullOrWhiteSpace(req.Color) ? null : req.Color.Trim(), req.IsActive);
        _db.PosResourceHours.RemoveRange(r.Hours);
        r.Hours = req.Hours.Select(h => new ResourceHours { Id = Guid.NewGuid(), ResourceId = r.Id, Day = h.Day, From = h.From, To = h.To }).ToList();
        if (!isNew) _db.PosResourceHours.AddRange(r.Hours);
        _db.PosServiceResources.RemoveRange(await _db.PosServiceResources.Where(l => l.ResourceId == r.Id).ToListAsync());
        _db.PosServiceResources.AddRange(serviceIds.Select(id => new ServiceResourceLink { ItemId = id, ResourceId = r.Id }));
        return null;
    }

    private static ResourceResponse ToResponse(ServiceResource r, List<ServiceResourceLink> links) => new(r.Id, r.StoreId, r.Name, r.Kind, r.UserId, r.Color,
        r.IsActive, r.Hours.OrderBy(h => h.Day).ThenBy(h => h.From).Select(h => new ResourceHoursResponse(h.Day, h.From, h.To)).ToList(),
        links.Where(l => l.ResourceId == r.Id).Select(l => l.ItemId).ToList());

    // The store's online booking link: turn it on (or renew it), or off.
    [HttpPost("stores/{storeId:guid}/booking-link", Name = "SetPosBookingLink")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<string?>> BookingLink(Guid companyId, Guid storeId, [FromQuery] bool enabled = true)
    {
        var store = await _db.PosStores.FirstOrDefaultAsync(s => s.Id == storeId && s.CompanyId == companyId);
        if (store is null) return NotFound();
        store.BookingToken = enabled ? AppointmentService.NewToken() : null;
        await _db.SaveChangesAsync();
        return Ok(store.BookingToken);
    }

    // ---- Appointments ----

    [HttpGet("appointments", Name = "ListPosAppointments")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<AppointmentResponse>>> Appointments(Guid companyId, [FromQuery] Guid storeId, [FromQuery] DateTime from,
        [FromQuery] DateTime to, [FromQuery] Guid? resourceId = null)
    {
        if (to <= from || (to - from).TotalDays > 62) return BadRequest(_localizer["PosReportPeriodInvalid"].Value);
        var query = _db.PosAppointments.AsNoTracking().Where(a => a.CompanyId == companyId && a.StoreId == storeId && a.Start < to && a.End > from);
        if (resourceId is { } r) query = query.Where(a => a.ResourceId == r);
        return Ok(await _appointments.ToResponsesAsync(await query.OrderBy(a => a.Start).ToListAsync()));
    }

    [HttpGet("appointments/{appointmentId:guid}", Name = "GetPosAppointment")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<AppointmentResponse>> Appointment(Guid companyId, Guid appointmentId)
    {
        var appointment = await _db.PosAppointments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == appointmentId && a.CompanyId == companyId);
        return appointment is null ? NotFound() : Ok((await _appointments.ToResponsesAsync(new[] { appointment })).Single());
    }

    [HttpGet("appointments/availability", Name = "GetPosAvailability")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<AvailabilityResponse>> Availability(Guid companyId, [FromQuery] Guid storeId, [FromQuery] Guid itemId,
        [FromQuery] DateOnly date, [FromQuery] Guid? resourceId = null)
    {
        try
        {
            return Ok(await _appointments.AvailabilityAsync(companyId, storeId, itemId, date, resourceId));
        }
        catch (PosException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPost("appointments", Name = "CreatePosAppointment")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    [ProducesResponseType(typeof(AppointmentResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<AppointmentResponse>> CreateAppointment(Guid companyId, SaveAppointmentRequest request) =>
        (await BookAsync(companyId, null, request)).AsCreated();

    [HttpPut("appointments/{appointmentId:guid}", Name = "UpdatePosAppointment")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<AppointmentResponse>> UpdateAppointment(Guid companyId, Guid appointmentId, SaveAppointmentRequest request) =>
        await BookAsync(companyId, appointmentId, request);

    private async Task<ActionResult<AppointmentResponse>> BookAsync(Guid companyId, Guid? id, SaveAppointmentRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.CustomerName)) return BadRequest(_localizer["PosAppointmentNameRequired"].Value);
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        }
        Appointment? appointment = null;
        if (id is { } existing)
        {
            appointment = await _db.PosAppointments.FirstOrDefaultAsync(a => a.Id == existing && a.CompanyId == companyId);
            if (appointment is null) return NotFound();
            if (appointment.State is AppointmentState.Completed or AppointmentState.Cancelled or AppointmentState.NoShow) return BadRequest(_localizer["PosAppointmentClosed"].Value);
        }
        if (request.CustomerId is { } c && !await _db.Partners.AnyAsync(p => p.Id == c && p.CompanyId == companyId)) return BadRequest(_localizer["PosCustomerNotFound"].Value);
        try
        {
            var service = await _appointments.ServiceAsync(companyId, request.ItemId);
            await _appointments.CheckSlotAsync(companyId, request.StoreId, service, request.ResourceId, request.Start, id, online: false);
            appointment ??= new Appointment
            {
                Id = Guid.NewGuid(), CompanyId = companyId, Number = await _appointments.NextNumberAsync(companyId), State = AppointmentState.Booked,
                Source = AppointmentSource.Staff,
            };
            var start = DateTime.SpecifyKind(request.Start, DateTimeKind.Utc);
            (appointment.StoreId, appointment.ItemId, appointment.ResourceId, appointment.Start, appointment.End) =
                (request.StoreId, request.ItemId, request.ResourceId, start, start.AddMinutes(service.Duration));
            (appointment.CustomerId, appointment.CustomerName, appointment.Phone, appointment.Email, appointment.Notes) =
                (request.CustomerId, request.CustomerName.Trim(), Blank(request.Phone), Blank(request.Email), Blank(request.Notes));
            if (id is null) _db.PosAppointments.Add(appointment);
            await _db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
        }
        catch (PosException ex)
        {
            return BadRequest(ex.Message);
        }
        var response = (await _appointments.ToResponsesAsync(new[] { appointment })).Single();
        return Ok(response);
    }

    // Confirm, check in, no-show or cancel (completing happens at the till).
    [HttpPost("appointments/{appointmentId:guid}/state", Name = "SetPosAppointmentState")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<AppointmentResponse>> SetAppointmentState(Guid companyId, Guid appointmentId, AppointmentStateRequest request)
    {
        var appointment = await _db.PosAppointments.FirstOrDefaultAsync(a => a.Id == appointmentId && a.CompanyId == companyId);
        if (appointment is null) return NotFound();
        if (appointment.State is AppointmentState.Completed or AppointmentState.Cancelled
            || request.State == AppointmentState.Completed)
        {
            return BadRequest(_localizer["PosAppointmentClosed"].Value);
        }
        if (request.State == AppointmentState.Cancelled && string.IsNullOrWhiteSpace(request.Reason)) return BadRequest(_localizer["PosReasonRequired"].Value);
        appointment.State = request.State;
        if (request.State == AppointmentState.Cancelled) appointment.CancelReason = request.Reason!.Trim();
        await _db.SaveChangesAsync();
        return Ok((await _appointments.ToResponsesAsync(new[] { appointment })).Single());
    }

    // A deposit for the appointment: the deposit card the till loads (and spends at checkout).
    [HttpPost("appointments/{appointmentId:guid}/deposit-card", Name = "GetPosAppointmentDepositCard")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<AppointmentResponse>> DepositCard(Guid companyId, Guid appointmentId)
    {
        var appointment = await _db.PosAppointments.FirstOrDefaultAsync(a => a.Id == appointmentId && a.CompanyId == companyId);
        if (appointment is null) return NotFound();
        if (appointment.DepositCardId is null)
        {
            var card = new GiftCard { Id = Guid.NewGuid(), CompanyId = companyId, Number = appointment.Number, Kind = GiftCardKind.Deposit, PartnerId = appointment.CustomerId };
            _db.GiftCards.Add(card);
            appointment.DepositCardId = card.Id;
            await _db.SaveChangesAsync();
        }
        return Ok((await _appointments.ToResponsesAsync(new[] { appointment })).Single());
    }

    // ---- Packages and memberships ----

    [HttpGet("packages", Name = "ListPosPackages")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<PackageResponse>>> Packages(Guid companyId, [FromQuery] string? search = null)
    {
        var query = _db.PosPackages.AsNoTracking().Where(p => p.CompanyId == companyId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            query = query.Where(p => EF.Functions.ILike(p.Number, term) || EF.Functions.ILike(p.HolderName ?? "", term) || EF.Functions.ILike(p.Phone ?? "", term));
        }
        var packages = await query.OrderByDescending(p => p.CreatedAt).Take(200).ToListAsync();
        var itemIds = packages.Select(p => p.ServiceItemId).Distinct().ToList();
        var names = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.Name);
        return Ok(packages.Select(p => new PackageResponse(p.Id, p.Number, p.ServiceItemId, names.GetValueOrDefault(p.ServiceItemId) ?? "?", p.HolderName, p.Phone,
            p.SessionsTotal, p.SessionsUsed, p.SessionsTotal - p.SessionsUsed, p.UnitValue, p.ExpiresOn, p.IsActive)).ToList());
    }

    [HttpGet("memberships", Name = "ListPosMemberships")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<MembershipResponse>>> Memberships(Guid companyId, [FromQuery] string? search = null)
    {
        var query = _db.PosMemberships.AsNoTracking().Where(m => m.CompanyId == companyId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            query = query.Where(m => EF.Functions.ILike(m.Number, term) || EF.Functions.ILike(m.HolderName ?? "", term) || EF.Functions.ILike(m.Phone ?? "", term));
        }
        return Ok(await MembershipResponsesAsync(await query.OrderByDescending(m => m.CreatedAt).Take(200).ToListAsync()));
    }

    // The reception check: is this membership active today?
    [HttpGet("memberships/{number}", Name = "CheckPosMembership")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<MembershipResponse>> Membership(Guid companyId, string number)
    {
        var membership = await _db.PosMemberships.AsNoTracking().FirstOrDefaultAsync(m => m.CompanyId == companyId && m.Number == number.Trim());
        return membership is null ? NotFound() : Ok((await MembershipResponsesAsync(new() { membership })).Single());
    }

    [HttpPut("memberships/{membershipId:guid}/holder", Name = "SetPosMembershipHolder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<MembershipResponse>> Holder(Guid companyId, Guid membershipId, SaveMembershipHolderRequest request)
    {
        var membership = await _db.PosMemberships.FirstOrDefaultAsync(m => m.Id == membershipId && m.CompanyId == companyId);
        if (membership is null) return NotFound();
        (membership.HolderName, membership.Phone, membership.CustomerId) = (Blank(request.HolderName), Blank(request.Phone), request.CustomerId);
        await _db.SaveChangesAsync();
        return Ok((await MembershipResponsesAsync(new() { membership })).Single());
    }

    // Freezing pushes the end date out by the days frozen.
    [HttpPost("memberships/{membershipId:guid}/freeze", Name = "FreezePosMembership")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<MembershipResponse>> Freeze(Guid companyId, Guid membershipId, FreezeMembershipRequest request)
    {
        var membership = await _db.PosMemberships.FirstOrDefaultAsync(m => m.Id == membershipId && m.CompanyId == companyId);
        if (membership is null) return NotFound();
        if (request.Days is < 1 or > 365 || membership.State == MembershipState.Cancelled) return BadRequest(_localizer["PosAmountInvalid"].Value);
        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        membership.State = MembershipState.Frozen;
        membership.FrozenFrom = today;
        membership.FrozenDays += request.Days;
        membership.EndsOn = membership.EndsOn.AddDays(request.Days);
        await _db.SaveChangesAsync();
        return Ok((await MembershipResponsesAsync(new() { membership })).Single());
    }

    [HttpPost("memberships/{membershipId:guid}/resume", Name = "ResumePosMembership")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<MembershipResponse>> Resume(Guid companyId, Guid membershipId)
    {
        var membership = await _db.PosMemberships.FirstOrDefaultAsync(m => m.Id == membershipId && m.CompanyId == companyId);
        if (membership is null) return NotFound();
        if (membership.State == MembershipState.Frozen) membership.State = MembershipState.Active;
        await _db.SaveChangesAsync();
        return Ok((await MembershipResponsesAsync(new() { membership })).Single());
    }

    private async Task<List<MembershipResponse>> MembershipResponsesAsync(List<CustomerMembership> memberships)
    {
        var itemIds = memberships.Select(m => m.PlanItemId).Distinct().ToList();
        var names = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.Name);
        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        return memberships.Select(m => new MembershipResponse(m.Id, m.Number, m.PlanItemId, names.GetValueOrDefault(m.PlanItemId) ?? "?", m.HolderName, m.Phone,
            m.StartsOn, m.EndsOn, m.State, m.State == MembershipState.Active && m.StartsOn <= today && today <= m.EndsOn, m.FrozenDays)).ToList();
    }

    // ---- Repairs ----

    [HttpGet("repairs", Name = "ListPosRepairs")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PaginatedResponse<RepairTicketResponse>>> Repairs(Guid companyId, [FromQuery] RepairState? state = null,
        [FromQuery] string? search = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.PosRepairTickets.AsNoTracking().Include(t => t.Lines).Where(t => t.CompanyId == companyId);
        if (state is { } s) query = query.Where(t => t.State == s);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            query = query.Where(t => EF.Functions.ILike(t.Number, term) || EF.Functions.ILike(t.CustomerName, term) || EF.Functions.ILike(t.Phone ?? "", term)
                || EF.Functions.ILike(t.SerialOrPlate ?? "", term) || EF.Functions.ILike(t.Device, term));
        }
        var total = await query.CountAsync();
        var tickets = await query.OrderByDescending(t => t.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new PaginatedResponse<RepairTicketResponse>(tickets.Select(ToResponse).ToList(), total, page, pageSize));
    }

    [HttpGet("repairs/{ticketId:guid}", Name = "GetPosRepair")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<RepairTicketResponse>> Repair(Guid companyId, Guid ticketId)
    {
        var ticket = await _db.PosRepairTickets.AsNoTracking().Include(t => t.Lines).FirstOrDefaultAsync(t => t.Id == ticketId && t.CompanyId == companyId);
        return ticket is null ? NotFound() : Ok(ToResponse(ticket));
    }

    [HttpPost("repairs", Name = "CreatePosRepair")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    [ProducesResponseType(typeof(RepairTicketResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<RepairTicketResponse>> CreateRepair(Guid companyId, SaveRepairTicketRequest request)
    {
        var ticket = new RepairTicket
        {
            Id = Guid.NewGuid(), CompanyId = companyId, State = RepairState.Received,
            Number = $"RP-{await _db.PosRepairTickets.CountAsync(t => t.CompanyId == companyId) + 1:D5}",
        };
        if (await ApplyAsync(companyId, ticket, request) is { } error) return BadRequest(error);
        _db.PosRepairTickets.Add(ticket);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(ticket));
    }

    [HttpPut("repairs/{ticketId:guid}", Name = "UpdatePosRepair")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<RepairTicketResponse>> UpdateRepair(Guid companyId, Guid ticketId, SaveRepairTicketRequest request)
    {
        var ticket = await _db.PosRepairTickets.Include(t => t.Lines).FirstOrDefaultAsync(t => t.Id == ticketId && t.CompanyId == companyId);
        if (ticket is null) return NotFound();
        if (ticket.State is RepairState.Collected or RepairState.Cancelled) return BadRequest(_localizer["PosRepairClosed"].Value);
        if (await ApplyAsync(companyId, ticket, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok(ToResponse(ticket));
    }

    // Moves a repair along; the customer hears by email when it waits for their approval and when
    // it is ready (when they left an address).
    [HttpPost("repairs/{ticketId:guid}/state", Name = "SetPosRepairState")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<RepairTicketResponse>> SetRepairState(Guid companyId, Guid ticketId, RepairStateRequest request)
    {
        var ticket = await _db.PosRepairTickets.Include(t => t.Lines).FirstOrDefaultAsync(t => t.Id == ticketId && t.CompanyId == companyId);
        if (ticket is null) return NotFound();
        if (ticket.State is RepairState.Collected or RepairState.Cancelled || request.State == RepairState.Collected)
        {
            return BadRequest(_localizer["PosRepairClosed"].Value);
        }
        ticket.State = request.State;
        if (request.State == RepairState.Approved) ticket.ApprovedAt ??= DateTime.UtcNow;
        if (request.State == RepairState.Ready) ticket.ReadyAt ??= DateTime.UtcNow;
        if (request.State is RepairState.WaitingApproval or RepairState.Ready && !string.IsNullOrWhiteSpace(ticket.Email))
        {
            var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
            var total = ToResponse(ticket).EstimateTotal;
            await _outbox.EnqueueAsync(companyId, NotificationTemplates.RepairStatus, new[] { new NotificationRecipient(ticket.Email!, NotificationOutbox.DefaultCulture) },
                new Dictionary<string, string>
                {
                    ["company"] = company.Name, ["number"] = ticket.Number, ["device"] = ticket.Device, ["estimate"] = total.ToString("N2"),
                    ["status"] = _localizer[$"PosRepairState_{request.State}"].Value,
                });
        }
        await _db.SaveChangesAsync();
        return Ok(ToResponse(ticket));
    }

    private async Task<string?> ApplyAsync(Guid companyId, RepairTicket t, SaveRepairTicketRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.CustomerName) || string.IsNullOrWhiteSpace(r.Device) || string.IsNullOrWhiteSpace(r.Problem)) return _localizer["PosRepairInvalid"].Value;
        var store = await _db.PosStores.AsNoTracking().FirstOrDefaultAsync(s => s.Id == r.StoreId && s.CompanyId == companyId);
        if (store is null) return _localizer["PosStoreNotFound"].Value;
        if (r.CustomerId is { } c && !await _db.Partners.AnyAsync(p => p.Id == c && p.CompanyId == companyId)) return _localizer["PosCustomerNotFound"].Value;
        var lines = r.Lines ?? new();
        if (lines.Any(l => l.Quantity <= 0 || l.UnitPrice is < 0)) return _localizer["CustomerOrderLinesInvalid"].Value;
        var itemIds = lines.Select(l => l.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        if (items.Count != itemIds.Count) return _localizer["PosItemNotFound"].Value;
        var prices = (await _prices.ResolveAsync(companyId, store.WarehouseId, DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)), itemIds, store.PriceListId))
            .ToDictionary(p => p.ItemId, p => p.Price);
        if (lines.Any(l => l.UnitPrice is null && !prices.ContainsKey(l.ItemId))) return _localizer["CustomerOrderPriceMissing"].Value;

        (t.StoreId, t.CustomerId, t.CustomerName, t.Phone, t.Email) = (store.Id, r.CustomerId, r.CustomerName.Trim(), Blank(r.Phone), Blank(r.Email));
        (t.Device, t.SerialOrPlate, t.Problem, t.Accessories, t.TechnicianUserId, t.Notes) =
            (r.Device.Trim(), Blank(r.SerialOrPlate), r.Problem.Trim(), Blank(r.Accessories), r.TechnicianUserId, Blank(r.Notes));
        _db.PosRepairTicketLines.RemoveRange(t.Lines);
        t.Lines = lines.Select((l, i) => new RepairTicketLine
        {
            Id = Guid.NewGuid(), TicketId = t.Id, LineNo = i + 1, ItemId = l.ItemId,
            Description = string.IsNullOrWhiteSpace(l.Description) ? items[l.ItemId].Name : l.Description.Trim(),
            Quantity = l.Quantity, UnitPrice = l.UnitPrice ?? prices[l.ItemId],
        }).ToList();
        if (_db.Entry(t).State != EntityState.Detached) _db.PosRepairTicketLines.AddRange(t.Lines);
        return null;
    }

    private static RepairTicketResponse ToResponse(RepairTicket t)
    {
        var lines = t.Lines.OrderBy(l => l.LineNo)
            .Select(l => new RepairTicketLineResponse(l.Id, l.ItemId, l.Description, l.Quantity, l.UnitPrice, PosPricing.Money(l.Quantity * l.UnitPrice))).ToList();
        return new RepairTicketResponse(t.Id, t.Number, t.StoreId, t.State, t.CustomerId, t.CustomerName, t.Phone, t.Email, t.Device, t.SerialOrPlate, t.Problem,
            t.Accessories, t.TechnicianUserId, t.Notes, lines, lines.Sum(l => l.Amount), t.CreatedAt, t.ApprovedAt, t.ReadyAt, t.CollectedOrderId);
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

// docs/POS_PLAN.md P4: online booking — anonymous, through the store's booking link; bookings land
// on the calendar as Online.
[ApiController]
[Route("api/public/booking/{token}")]
[AllowAnonymous]
[EnableRateLimiting(AuthRateLimit.Policy)]
public class PublicBookingController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly AppointmentService _appointments;
    private readonly PriceListService _prices;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PublicBookingController(PakoDbContext db, AppointmentService appointments, PriceListService prices, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _appointments = appointments;
        _prices = prices;
        _localizer = localizer;
    }

    private async Task<Store?> StoreAsync(string token)
    {
        var store = await _db.PosStores.AsNoTracking().FirstOrDefaultAsync(s => s.BookingToken == token && s.IsActive);
        if (store is null) return null;
        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == store.CompanyId);
        return company.EnabledModules.HasFlag(AppModule.Pos) ? store : null;
    }

    [HttpGet(Name = "GetPublicBooking")]
    public async Task<ActionResult<PublicBookingResponse>> Get(string token)
    {
        if (await StoreAsync(token) is not { } store) return NotFound();
        var resources = await _db.PosResources.AsNoTracking().Where(r => r.StoreId == store.Id && r.IsActive).ToListAsync();
        var resourceIds = resources.Select(r => r.Id).ToList();
        var links = await _db.PosServiceResources.AsNoTracking().Where(l => resourceIds.Contains(l.ResourceId)).ToListAsync();
        var itemIds = links.Select(l => l.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id) && i.IsBookable && i.DurationMinutes != null).OrderBy(i => i.Name).ToListAsync();
        var prices = (await _prices.ResolveAsync(store.CompanyId, store.WarehouseId, DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)), itemIds, store.PriceListId))
            .ToDictionary(p => p.ItemId, p => p.Price);
        return Ok(new PublicBookingResponse(store.Name, store.Address, items.Select(i => new PublicBookingServiceResponse(i.Id, i.Name, i.Description,
            i.DurationMinutes!.Value, prices.TryGetValue(i.Id, out var p) ? p : null,
            resources.Where(r => links.Any(l => l.ItemId == i.Id && l.ResourceId == r.Id)).OrderBy(r => r.Name)
                .Select(r => new PublicBookingResourceResponse(r.Id, r.Name)).ToList())).ToList()));
    }

    [HttpGet("availability", Name = "GetPublicAvailability")]
    public async Task<ActionResult<AvailabilityResponse>> Availability(string token, [FromQuery] Guid itemId, [FromQuery] DateOnly date, [FromQuery] Guid? resourceId = null)
    {
        if (await StoreAsync(token) is not { } store) return NotFound();
        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        if (date < today || date > today.AddDays(90)) return BadRequest(_localizer["PosReportPeriodInvalid"].Value);
        try
        {
            return Ok(await _appointments.AvailabilityAsync(store.CompanyId, store.Id, itemId, date, resourceId));
        }
        catch (PosException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPost(Name = "BookPublicAppointment")]
    public async Task<ActionResult<PublicBookedResponse>> Book(string token, PublicBookRequest request)
    {
        if (await StoreAsync(token) is not { } store) return NotFound();
        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Phone)) return BadRequest(_localizer["PosAppointmentNameRequired"].Value);
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {store.CompanyId} FOR UPDATE");
        }
        try
        {
            var service = await _appointments.ServiceAsync(store.CompanyId, request.ItemId);
            var start = DateTime.SpecifyKind(request.Start, DateTimeKind.Utc);
            // No preference: the first resource free at that time.
            Guid? chosen = request.ResourceId;
            if (chosen is null)
            {
                var free = await _appointments.AvailabilityAsync(store.CompanyId, store.Id, request.ItemId, DateOnly.FromDateTime(PosService.LocalTime(start)), null);
                chosen = free.Resources.FirstOrDefault(r => r.Starts.Contains(start))?.ResourceId ?? throw new PosException(_localizer["PosSlotTaken"].Value);
            }
            await _appointments.CheckSlotAsync(store.CompanyId, store.Id, service, chosen.Value, start, null, online: true);
            var appointment = new Appointment
            {
                Id = Guid.NewGuid(), CompanyId = store.CompanyId, StoreId = store.Id, Number = await _appointments.NextNumberAsync(store.CompanyId),
                ItemId = service.ItemId, ResourceId = chosen.Value, Start = start, End = start.AddMinutes(service.Duration), State = AppointmentState.Booked,
                Source = AppointmentSource.Online, CustomerName = request.Name.Trim()[..Math.Min(request.Name.Trim().Length, 120)],
                Phone = request.Phone.Trim()[..Math.Min(request.Phone.Trim().Length, 40)],
                Email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim()[..Math.Min(request.Email.Trim().Length, 256)],
                Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim()[..Math.Min(request.Notes.Trim().Length, 500)],
            };
            _db.PosAppointments.Add(appointment);
            await _db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            var resourceName = await _db.PosResources.AsNoTracking().Where(r => r.Id == chosen).Select(r => r.Name).FirstAsync();
            return Ok(new PublicBookedResponse(appointment.Number, appointment.Start, appointment.End, resourceName));
        }
        catch (PosException ex)
        {
            return BadRequest(ex.Message);
        }
    }
}
