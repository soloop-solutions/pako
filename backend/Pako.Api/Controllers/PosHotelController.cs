using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Hubs;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Invoicing;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md P5: hotel (rooms, bookings, check-in with the guest register, folio, check-out,
// city ledger), event venues (wedding halls) and ticketed events. Pos: Approve sets up rooms,
// venues and events; Write runs the desk.
[ApiController]
[Route("api/companies/{companyId:guid}/pos")]
[Authorize]
public class PosHotelController : ControllerBase
{
    private static readonly HotelBookingState[] Holding = { HotelBookingState.Reserved, HotelBookingState.CheckedIn };

    private readonly PakoDbContext _db;
    private readonly TabService _tabs;
    private readonly PriceListService _prices;
    private readonly PosNotifier _notify;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PosHotelController(PakoDbContext db, TabService tabs, PriceListService prices, PosNotifier notify, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _tabs = tabs;
        _prices = prices;
        _notify = notify;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private static DateOnly Today => DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));

    // ---- Rooms ----

    [HttpGet("room-types", Name = "ListPosRoomTypes")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<RoomTypeResponse>>> RoomTypes(Guid companyId, [FromQuery] Guid? storeId = null)
    {
        var query = _db.PosRoomTypes.AsNoTracking().Where(t => t.CompanyId == companyId);
        if (storeId is { } s) query = query.Where(t => t.StoreId == s);
        var types = await query.OrderBy(t => t.Name).ToListAsync();
        var ids = types.Select(t => t.Id).ToList();
        var rooms = await _db.PosRooms.AsNoTracking().Where(r => ids.Contains(r.RoomTypeId)).OrderBy(r => r.Number).ToListAsync();
        var rateIds = types.Select(t => t.RateItemId).ToList();
        var rates = await _db.Items.AsNoTracking().Where(i => rateIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        return Ok(types.Select(t => new RoomTypeResponse(t.Id, t.StoreId, t.Name, t.Capacity, t.RateItemId, rates.GetValueOrDefault(t.RateItemId)?.DefaultUnitPrice,
            t.IsActive, rooms.Where(r => r.RoomTypeId == t.Id).Select(ToResponse).ToList(), rates.GetValueOrDefault(t.RateItemId)?.Name)).ToList());
    }

    [HttpPost("room-types", Name = "CreatePosRoomType")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(RoomTypeResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<RoomTypeResponse>> CreateRoomType(Guid companyId, SaveRoomTypeRequest request)
    {
        var type = new RoomType { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyAsync(companyId, type, request) is { } error) return BadRequest(error);
        _db.PosRoomTypes.Add(type);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, new RoomTypeResponse(type.Id, type.StoreId, type.Name, type.Capacity, type.RateItemId, null, type.IsActive, new()));
    }

    [HttpPut("room-types/{typeId:guid}", Name = "UpdatePosRoomType")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<IActionResult> UpdateRoomType(Guid companyId, Guid typeId, SaveRoomTypeRequest request)
    {
        var type = await _db.PosRoomTypes.FirstOrDefaultAsync(t => t.Id == typeId && t.CompanyId == companyId);
        if (type is null) return NotFound();
        if (await ApplyAsync(companyId, type, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<string?> ApplyAsync(Guid companyId, RoomType t, SaveRoomTypeRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name) || r.Capacity is < 1 or > 50) return _localizer["PosRoomInvalid"].Value;
        if (!await _db.PosStores.AnyAsync(s => s.Id == r.StoreId && s.CompanyId == companyId)) return _localizer["PosStoreNotFound"].Value;
        if (!await _db.Items.AnyAsync(i => i.Id == r.RateItemId && i.CompanyId == companyId)) return _localizer["PosItemNotFound"].Value;
        (t.StoreId, t.Name, t.Capacity, t.RateItemId, t.IsActive) = (r.StoreId, r.Name.Trim(), r.Capacity, r.RateItemId, r.IsActive);
        return null;
    }

    [HttpPost("rooms", Name = "CreatePosRoom")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(RoomResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<RoomResponse>> CreateRoom(Guid companyId, SaveRoomRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Number)) return BadRequest(_localizer["PosRoomInvalid"].Value);
        if (!await _db.PosRoomTypes.AnyAsync(t => t.Id == request.RoomTypeId && t.CompanyId == companyId)) return BadRequest(_localizer["PosRoomInvalid"].Value);
        var room = new Room { Id = Guid.NewGuid(), RoomTypeId = request.RoomTypeId, Number = request.Number.Trim(), Floor = Blank(request.Floor), IsActive = request.IsActive };
        _db.PosRooms.Add(room);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(room));
    }

    // Renumber, move to another type, or take a room out of use.
    [HttpPut("rooms/{roomId:guid}", Name = "UpdatePosRoom")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<RoomResponse>> UpdateRoom(Guid companyId, Guid roomId, SaveRoomRequest request)
    {
        var room = await _db.PosRooms.FirstOrDefaultAsync(r => r.Id == roomId && _db.PosRoomTypes.Any(t => t.Id == r.RoomTypeId && t.CompanyId == companyId));
        if (room is null) return NotFound();
        if (string.IsNullOrWhiteSpace(request.Number)) return BadRequest(_localizer["PosRoomInvalid"].Value);
        if (!await _db.PosRoomTypes.AnyAsync(t => t.Id == request.RoomTypeId && t.CompanyId == companyId)) return BadRequest(_localizer["PosRoomInvalid"].Value);
        (room.RoomTypeId, room.Number, room.Floor, room.IsActive) = (request.RoomTypeId, request.Number.Trim(), Blank(request.Floor), request.IsActive);
        await _db.SaveChangesAsync();
        return Ok(ToResponse(room));
    }

    // Housekeeping: clean, dirty, out of service.
    [HttpPost("rooms/{roomId:guid}/state", Name = "SetPosRoomState")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<RoomResponse>> RoomState(Guid companyId, Guid roomId, RoomStateRequest request)
    {
        var room = await _db.PosRooms.FirstOrDefaultAsync(r => r.Id == roomId && _db.PosRoomTypes.Any(t => t.Id == r.RoomTypeId && t.CompanyId == companyId));
        if (room is null) return NotFound();
        room.State = request.State;
        await _db.SaveChangesAsync();
        return Ok(ToResponse(room));
    }

    private static RoomResponse ToResponse(Room r) => new(r.Id, r.RoomTypeId, r.Number, r.Floor, r.State, r.IsActive);

    // ---- Bookings ----

    [HttpGet("hotel/calendar", Name = "GetPosHotelCalendar")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<HotelCalendarResponse>> Calendar(Guid companyId, [FromQuery] Guid storeId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (to < from || to.DayNumber - from.DayNumber > 120) return BadRequest(_localizer["PosReportPeriodInvalid"].Value);
        var bookings = await _db.PosHotelBookings.AsNoTracking()
            .Where(b => b.CompanyId == companyId && b.StoreId == storeId && b.Arrival <= to && b.Departure > from && b.State != HotelBookingState.Cancelled)
            .OrderBy(b => b.Arrival).ToListAsync();
        var responses = await ToResponsesAsync(bookings);
        var types = await _db.PosRoomTypes.AsNoTracking().Where(t => t.StoreId == storeId && t.CompanyId == companyId).ToDictionaryAsync(t => t.Id);
        var typeIds = types.Keys.ToList();
        var rooms = await _db.PosRooms.AsNoTracking().Where(r => typeIds.Contains(r.RoomTypeId) && r.IsActive).OrderBy(r => r.Number).ToListAsync();
        return Ok(new HotelCalendarResponse(
            rooms.Select(r => new HotelCalendarRoomResponse(r.Id, r.Number, r.RoomTypeId, types[r.RoomTypeId].Name, r.State,
                responses.Where(b => b.RoomId == r.Id).ToList())).ToList(),
            responses.Where(b => b.RoomId is null).ToList()));
    }

    [HttpGet("hotel/bookings/{bookingId:guid}", Name = "GetPosHotelBooking")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<HotelBookingResponse>> Booking(Guid companyId, Guid bookingId)
    {
        var booking = await _db.PosHotelBookings.AsNoTracking().FirstOrDefaultAsync(b => b.Id == bookingId && b.CompanyId == companyId);
        return booking is null ? NotFound() : Ok((await ToResponsesAsync(new List<HotelBooking> { booking })).Single());
    }

    [HttpPost("hotel/bookings", Name = "CreatePosHotelBooking")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    [ProducesResponseType(typeof(HotelBookingResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<HotelBookingResponse>> CreateBooking(Guid companyId, SaveHotelBookingRequest request) =>
        (await SaveBookingAsync(companyId, null, request)).AsCreated();

    [HttpPut("hotel/bookings/{bookingId:guid}", Name = "UpdatePosHotelBooking")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<HotelBookingResponse>> UpdateBooking(Guid companyId, Guid bookingId, SaveHotelBookingRequest request) =>
        SaveBookingAsync(companyId, bookingId, request);

    private async Task<ActionResult<HotelBookingResponse>> SaveBookingAsync(Guid companyId, Guid? id, SaveHotelBookingRequest r)
    {
        await using var transaction = await LockAsync(companyId);
        HotelBooking? booking = null;
        if (id is { } existing)
        {
            booking = await _db.PosHotelBookings.FirstOrDefaultAsync(b => b.Id == existing && b.CompanyId == companyId);
            if (booking is null) return NotFound();
            if (booking.State is not HotelBookingState.Reserved and not HotelBookingState.CheckedIn) return BadRequest(_localizer["PosBookingClosed"].Value);
        }
        if (string.IsNullOrWhiteSpace(r.GuestName) || r.Departure <= r.Arrival || r.Departure.DayNumber - r.Arrival.DayNumber > 365 || r.Adults < 1 || r.Children < 0)
        {
            return BadRequest(_localizer["PosBookingInvalid"].Value);
        }
        var type = await _db.PosRoomTypes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == r.RoomTypeId && t.CompanyId == companyId && t.StoreId == r.StoreId);
        if (type is null) return BadRequest(_localizer["PosRoomInvalid"].Value);
        if (r.Adults + r.Children > type.Capacity) return BadRequest(_localizer["PosRoomTooSmall"].Value);
        if (r.CompanyPartnerId is { } p && !await _db.Partners.AnyAsync(x => x.Id == p && x.CompanyId == companyId)) return BadRequest(_localizer["PosCustomerNotFound"].Value);
        // Rooms of the type left on every night of the stay.
        var rooms = await _db.PosRooms.AsNoTracking().Where(x => x.RoomTypeId == type.Id && x.IsActive).Select(x => x.Id).ToListAsync();
        var overlapping = await _db.PosHotelBookings.AsNoTracking()
            .Where(b => b.RoomTypeId == type.Id && b.Id != id && Holding.Contains(b.State) && b.Arrival < r.Departure && b.Departure > r.Arrival).ToListAsync();
        for (var night = r.Arrival; night < r.Departure; night = night.AddDays(1))
        {
            var n = night;
            if (overlapping.Count(b => b.Arrival <= n && n < b.Departure) >= rooms.Count) return BadRequest(_localizer["PosNoRoomFree"].Value);
        }
        if (r.RoomId is { } roomId)
        {
            if (!rooms.Contains(roomId)) return BadRequest(_localizer["PosRoomInvalid"].Value);
            if (overlapping.Any(b => b.RoomId == roomId)) return BadRequest(_localizer["PosRoomTaken"].Value);
        }
        var rate = r.NightlyRate ?? await _db.Items.AsNoTracking().Where(i => i.Id == type.RateItemId).Select(i => i.DefaultUnitPrice).FirstOrDefaultAsync()
            ?? throw new InvalidOperationException();
        booking ??= new HotelBooking
        {
            Id = Guid.NewGuid(), CompanyId = companyId, State = HotelBookingState.Reserved,
            Number = $"HB-{await _db.PosHotelBookings.CountAsync(b => b.CompanyId == companyId) + 1:D5}",
        };
        (booking.StoreId, booking.RoomTypeId, booking.RoomId, booking.Arrival, booking.Departure, booking.Adults, booking.Children) =
            (r.StoreId, r.RoomTypeId, r.RoomId, r.Arrival, r.Departure, r.Adults, r.Children);
        (booking.GuestName, booking.Phone, booking.Email, booking.CompanyPartnerId, booking.Channel, booking.NightlyRate, booking.Notes) =
            (r.GuestName.Trim(), Blank(r.Phone), Blank(r.Email), r.CompanyPartnerId, Blank(r.Channel), rate, Blank(r.Notes));
        if (id is null) _db.PosHotelBookings.Add(booking);
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        var response = (await ToResponsesAsync(new List<HotelBooking> { booking })).Single();
        return Ok(response);
    }

    [HttpPut("hotel/bookings/{bookingId:guid}/guests", Name = "SetPosHotelGuests")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<HotelBookingResponse>> Guests(Guid companyId, Guid bookingId, SaveHotelGuestsRequest request)
    {
        var booking = await _db.PosHotelBookings.FirstOrDefaultAsync(b => b.Id == bookingId && b.CompanyId == companyId);
        if (booking is null) return NotFound();
        if (request.Guests.Any(g => string.IsNullOrWhiteSpace(g.FullName))) return BadRequest(_localizer["PosGuestInvalid"].Value);
        _db.PosHotelGuests.RemoveRange(await _db.PosHotelGuests.Where(g => g.BookingId == bookingId).ToListAsync());
        _db.PosHotelGuests.AddRange(request.Guests.Select((g, i) => new HotelGuest
        {
            Id = Guid.NewGuid(), BookingId = bookingId, FullName = g.FullName.Trim(), Nationality = Blank(g.Nationality), DocumentType = Blank(g.DocumentType),
            DocumentNumber = Blank(g.DocumentNumber), BirthDate = g.BirthDate, IsPrimary = i == 0 || g.IsPrimary,
        }));
        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(new List<HotelBooking> { booking })).Single());
    }

    // Check-in: a room, the guests registered, and the folio opened.
    [HttpPost("hotel/bookings/{bookingId:guid}/check-in", Name = "CheckInPosHotelBooking")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<HotelBookingResponse>> CheckIn(Guid companyId, Guid bookingId)
    {
        await using var transaction = await LockAsync(companyId);
        var booking = await _db.PosHotelBookings.FirstOrDefaultAsync(b => b.Id == bookingId && b.CompanyId == companyId);
        if (booking is null) return NotFound();
        if (booking.State != HotelBookingState.Reserved) return BadRequest(_localizer["PosBookingClosed"].Value);
        if (booking.RoomId is null) return BadRequest(_localizer["PosRoomRequired"].Value);
        if (!await _db.PosHotelGuests.AnyAsync(g => g.BookingId == bookingId)) return BadRequest(_localizer["PosGuestInvalid"].Value);
        var room = await _db.PosRooms.AsNoTracking().FirstAsync(r => r.Id == booking.RoomId);
        if (room.State == Domain.Pos.RoomState.OutOfService) return BadRequest(_localizer["PosRoomInvalid"].Value);
        var store = await _db.PosStores.AsNoTracking().FirstAsync(s => s.Id == booking.StoreId);
        var tab = await _tabs.OpenAsync(companyId, store, new OpenTabRequest(store.Id, null, TabKind.Folio, booking.Adults + booking.Children,
            $"{room.Number} · {booking.GuestName}"), CurrentUserId, booking.Number);
        booking.FolioTabId = tab.Id;
        booking.State = HotelBookingState.CheckedIn;
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok((await ToResponsesAsync(new List<HotelBooking> { booking })).Single());
    }

    // The night audit: room nights (and tourist tax per guest) onto the folio, through a date
    // (default today; never past the last night).
    [HttpPost("hotel/bookings/{bookingId:guid}/post-nights", Name = "PostPosHotelNights")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<TabResponse>> PostNights(Guid companyId, Guid bookingId, [FromQuery] DateOnly? through = null)
    {
        await using var transaction = await LockAsync(companyId);
        var booking = await _db.PosHotelBookings.FirstOrDefaultAsync(b => b.Id == bookingId && b.CompanyId == companyId);
        if (booking is null) return NotFound();
        if (booking.State != HotelBookingState.CheckedIn || booking.FolioTabId is null) return BadRequest(_localizer["PosBookingClosed"].Value);
        var tab = await _db.PosTabs.Include(t => t.Lines).FirstAsync(t => t.Id == booking.FolioTabId);
        await PostNightsAsync(booking, tab, through ?? Today);
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok(await _tabs.ToResponseAsync(tab));
    }

    private async Task PostNightsAsync(HotelBooking booking, Tab tab, DateOnly through)
    {
        var last = booking.Departure.AddDays(-1) < through ? booking.Departure.AddDays(-1) : through;
        var first = booking.PostedThrough?.AddDays(1) ?? booking.Arrival;
        if (first > last) return;
        var type = await _db.PosRoomTypes.AsNoTracking().FirstAsync(t => t.Id == booking.RoomTypeId);
        var rateItem = await _db.Items.AsNoTracking().FirstAsync(i => i.Id == type.RateItemId);
        var store = await _db.PosStores.AsNoTracking().FirstAsync(s => s.Id == booking.StoreId);
        var taxItem = store.TouristTaxItemId is { } taxId ? await _db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == taxId) : null;
        var lineNo = tab.Lines.Count == 0 ? 0 : tab.Lines.Max(l => l.LineNo);
        for (var night = first; night <= last; night = night.AddDays(1))
        {
            void Add(Domain.Companies.Item item, decimal quantity, decimal price, string note)
            {
                var line = new TabLine
                {
                    Id = Guid.NewGuid(), TabId = tab.Id, LineNo = ++lineNo, ItemId = item.Id, Description = item.Name, Quantity = quantity, UnitPrice = price,
                    State = TabLineState.Sent, SentAt = DateTime.UtcNow, Note = note,
                };
                tab.Lines.Add(line);
                _db.PosTabLines.Add(line);
            }
            Add(rateItem, 1m, booking.NightlyRate, night.ToString("dd.MM.yyyy"));
            // Tourist tax: per adult guest and night (children don't pay it).
            if (taxItem?.DefaultUnitPrice is { } perGuest) Add(taxItem, booking.Adults, perGuest, night.ToString("dd.MM.yyyy"));
        }
        booking.PostedThrough = last;
        tab.State = TabState.Open;
    }

    // A restaurant or bar tab charged to a checked-in room: its unpaid lines move to the folio.
    [HttpPost("tabs/{tabId:guid}/charge-to-room", Name = "ChargePosTabToRoom")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<TabResponse>> ChargeToRoom(Guid companyId, Guid tabId, [FromQuery] Guid bookingId)
    {
        await using var transaction = await LockAsync(companyId);
        var booking = await _db.PosHotelBookings.FirstOrDefaultAsync(b => b.Id == bookingId && b.CompanyId == companyId);
        if (booking is null || booking.State != HotelBookingState.CheckedIn || booking.FolioTabId is null) return BadRequest(_localizer["PosBookingClosed"].Value);
        var from = await _db.PosTabs.Include(t => t.Lines).FirstOrDefaultAsync(t => t.Id == tabId && t.CompanyId == companyId);
        var folio = await _db.PosTabs.Include(t => t.Lines).FirstAsync(t => t.Id == booking.FolioTabId);
        if (from is null) return NotFound();
        try
        {
            _tabs.MoveLines(from, folio, from.Lines.Where(l => l.ParentLineId == null && l.State is TabLineState.Pending or TabLineState.Sent && l.PaidQuantity == 0)
                .Select(l => l.Id).ToList());
            await _db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
        }
        catch (PosException ex)
        {
            return BadRequest(ex.Message);
        }
        await _notify.TabsChangedAsync(from.StoreId);
        return Ok(await _tabs.ToResponseAsync(folio));
    }

    // City ledger: these folio lines are billed to the company that pays, on a draft invoice the
    // accountant posts; on the folio they count as settled.
    [HttpPost("hotel/bookings/{bookingId:guid}/invoice", Name = "InvoicePosHotelBooking")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<Guid>> Invoice(Guid companyId, Guid bookingId, HotelInvoiceRequest request)
    {
        await using var transaction = await LockAsync(companyId);
        var booking = await _db.PosHotelBookings.FirstOrDefaultAsync(b => b.Id == bookingId && b.CompanyId == companyId);
        if (booking is null) return NotFound();
        if (booking.CompanyPartnerId is not { } partnerId || booking.FolioTabId is null) return BadRequest(_localizer["PosBookingNoCompany"].Value);
        var tab = await _db.PosTabs.Include(t => t.Lines).FirstAsync(t => t.Id == booking.FolioTabId);
        if (booking.State == HotelBookingState.CheckedIn) await PostNightsAsync(booking, tab, booking.Departure.AddDays(-1) < Today ? booking.Departure.AddDays(-1) : Today);
        var lines = tab.Lines.Where(l => request.TabLineIds.Contains(l.Id) && l.State is TabLineState.Pending or TabLineState.Sent && l.PaidQuantity < l.Quantity).ToList();
        if (lines.Count == 0) return BadRequest(_localizer["PosOrderNoLines"].Value);
        var itemIds = lines.Select(l => l.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var defaults = await _db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);
        if (defaults is null) return BadRequest(_localizer["NoAccountDefaults"].Value);
        var partner = await _db.Partners.AsNoTracking().FirstAsync(p => p.Id == partnerId);
        var invoice = new Invoice
        {
            Id = Guid.NewGuid(), CompanyId = companyId, PartnerId = partnerId, IssueDate = Today, DueDate = Today.AddDays(partner.PaymentTermDays ?? 15),
            PriceMode = PriceMode.GrossInclusive, InternalNotes = $"{booking.Number} · {booking.GuestName}",
        };
        invoice.Lines = lines.Select(l => new InvoiceLine
        {
            Id = Guid.NewGuid(), InvoiceId = invoice.Id, ItemId = l.ItemId, Description = $"{l.Description}{(l.Note is { } n ? " · " + n : "")}",
            Quantity = l.Quantity - l.PaidQuantity, UnitPrice = l.UnitPrice, TaxDefinitionId = items[l.ItemId].DefaultTaxDefinitionId,
            RevenueAccountId = items[l.ItemId].DefaultRevenueAccountId ?? defaults.RevenueAccountId,
        }).ToList();
        _db.Invoices.Add(invoice);
        TabService.ApplyPayment(tab, lines.Select(l => (l.Id, l.Quantity - l.PaidQuantity)));
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok(invoice.Id);
    }

    // Check-out: nights posted to the departure, and nothing left to pay on the folio.
    [HttpPost("hotel/bookings/{bookingId:guid}/check-out", Name = "CheckOutPosHotelBooking")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<HotelBookingResponse>> CheckOut(Guid companyId, Guid bookingId)
    {
        await using var transaction = await LockAsync(companyId);
        var booking = await _db.PosHotelBookings.FirstOrDefaultAsync(b => b.Id == bookingId && b.CompanyId == companyId);
        if (booking is null) return NotFound();
        if (booking.State != HotelBookingState.CheckedIn || booking.FolioTabId is null) return BadRequest(_localizer["PosBookingClosed"].Value);
        var tab = await _db.PosTabs.Include(t => t.Lines).FirstAsync(t => t.Id == booking.FolioTabId);
        if ((await _tabs.ToResponseAsync(tab)).Due > 0) return BadRequest(_localizer["PosFolioNotSettled"].Value);
        booking.State = HotelBookingState.CheckedOut;
        tab.State = TabState.Closed;
        tab.ClosedAt ??= DateTime.UtcNow;
        if (booking.RoomId is { } roomId) (await _db.PosRooms.FirstAsync(r => r.Id == roomId)).State = Domain.Pos.RoomState.Dirty;
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok((await ToResponsesAsync(new List<HotelBooking> { booking })).Single());
    }

    // Before check-out, the remaining nights go on the folio so the till can take the stay.
    [HttpPost("hotel/bookings/{bookingId:guid}/prepare-check-out", Name = "PreparePosHotelCheckOut")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<TabResponse>> PrepareCheckOut(Guid companyId, Guid bookingId)
    {
        await using var transaction = await LockAsync(companyId);
        var booking = await _db.PosHotelBookings.FirstOrDefaultAsync(b => b.Id == bookingId && b.CompanyId == companyId);
        if (booking is null) return NotFound();
        if (booking.State != HotelBookingState.CheckedIn || booking.FolioTabId is null) return BadRequest(_localizer["PosBookingClosed"].Value);
        var tab = await _db.PosTabs.Include(t => t.Lines).FirstAsync(t => t.Id == booking.FolioTabId);
        await PostNightsAsync(booking, tab, booking.Departure.AddDays(-1));
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok(await _tabs.ToResponseAsync(tab));
    }

    [HttpPost("hotel/bookings/{bookingId:guid}/cancel", Name = "CancelPosHotelBooking")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<HotelBookingResponse>> CancelBooking(Guid companyId, Guid bookingId, [FromQuery] bool noShow = false)
    {
        var booking = await _db.PosHotelBookings.FirstOrDefaultAsync(b => b.Id == bookingId && b.CompanyId == companyId);
        if (booking is null) return NotFound();
        if (booking.State != HotelBookingState.Reserved) return BadRequest(_localizer["PosBookingClosed"].Value);
        booking.State = noShow ? HotelBookingState.NoShow : HotelBookingState.Cancelled;
        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(new List<HotelBooking> { booking })).Single());
    }

    [HttpPost("hotel/bookings/{bookingId:guid}/deposit-card", Name = "GetPosHotelDepositCard")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<HotelBookingResponse>> HotelDepositCard(Guid companyId, Guid bookingId)
    {
        var booking = await _db.PosHotelBookings.FirstOrDefaultAsync(b => b.Id == bookingId && b.CompanyId == companyId);
        if (booking is null) return NotFound();
        booking.DepositCardId ??= await NewDepositCardAsync(companyId, booking.Number, booking.CompanyPartnerId);
        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(new List<HotelBooking> { booking })).Single());
    }

    // The police register of guests who stayed in a period.
    [HttpGet("hotel/guest-register", Name = "GetPosGuestRegister")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<GuestRegisterRow>>> GuestRegister(Guid companyId, [FromQuery] Guid storeId, [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] bool foreignOnly = false)
    {
        var rows = await (from g in _db.PosHotelGuests.AsNoTracking()
                          join b in _db.PosHotelBookings.AsNoTracking() on g.BookingId equals b.Id
                          join r in _db.PosRooms.AsNoTracking() on b.RoomId equals r.Id
                          where b.CompanyId == companyId && b.StoreId == storeId && b.Arrival <= to && b.Departure >= @from
                              && (b.State == HotelBookingState.CheckedIn || b.State == HotelBookingState.CheckedOut)
                          orderby b.Arrival, b.Number
                          select new GuestRegisterRow(b.Number, r.Number, b.Arrival, b.Departure, g.FullName, g.Nationality, g.DocumentType, g.DocumentNumber, g.BirthDate))
            .ToListAsync();
        return Ok(foreignOnly ? rows.Where(r => r.Nationality is { } n && !n.Trim().Equals("XK", StringComparison.OrdinalIgnoreCase)
            && !n.Trim().StartsWith("Kosov", StringComparison.OrdinalIgnoreCase)).ToList() : rows);
    }

    private async Task<List<HotelBookingResponse>> ToResponsesAsync(List<HotelBooking> bookings)
    {
        var typeIds = bookings.Select(b => b.RoomTypeId).Distinct().ToList();
        var types = await _db.PosRoomTypes.AsNoTracking().Where(t => typeIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name);
        var roomIds = bookings.Where(b => b.RoomId != null).Select(b => b.RoomId!.Value).ToList();
        var rooms = await _db.PosRooms.AsNoTracking().Where(r => roomIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id, r => r.Number);
        var cardIds = bookings.Where(b => b.DepositCardId != null).Select(b => b.DepositCardId!.Value).ToList();
        var cards = await _db.GiftCards.AsNoTracking().Where(c => cardIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id);
        var ids = bookings.Select(b => b.Id).ToList();
        var guests = await _db.PosHotelGuests.AsNoTracking().Where(g => ids.Contains(g.BookingId)).ToListAsync();
        var partnerIds = bookings.Where(b => b.CompanyPartnerId != null).Select(b => b.CompanyPartnerId!.Value).Distinct().ToList();
        var partners = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        return bookings.Select(b =>
        {
            var card = b.DepositCardId is { } c ? cards.GetValueOrDefault(c) : null;
            return new HotelBookingResponse(b.Id, b.Number, b.StoreId, b.RoomTypeId, types.GetValueOrDefault(b.RoomTypeId) ?? "?", b.RoomId,
                b.RoomId is { } r ? rooms.GetValueOrDefault(r) : null, b.Arrival, b.Departure, b.Departure.DayNumber - b.Arrival.DayNumber, b.Adults, b.Children, b.State,
                b.GuestName, b.Phone, b.Email, b.CompanyPartnerId, b.Channel, b.NightlyRate, b.Notes, card?.Number, card?.Balance ?? 0m, b.FolioTabId, b.PostedThrough,
                guests.Where(g => g.BookingId == b.Id).OrderByDescending(g => g.IsPrimary).ThenBy(g => g.FullName)
                    .Select(g => new HotelGuestResponse(g.Id, g.FullName, g.Nationality, g.DocumentType, g.DocumentNumber, g.BirthDate, g.IsPrimary)).ToList(),
                b.CompanyPartnerId is { } p ? partners.GetValueOrDefault(p) : null);
        }).ToList();
    }

    // ---- Venues and events ----

    [HttpGet("venues", Name = "ListPosVenues")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<VenueResponse>>> Venues(Guid companyId) =>
        Ok(await _db.PosVenues.AsNoTracking().Where(v => v.CompanyId == companyId).OrderBy(v => v.Name)
            .Select(v => new VenueResponse(v.Id, v.StoreId, v.Name, v.Capacity, v.IsActive)).ToListAsync());

    [HttpPost("venues", Name = "CreatePosVenue")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(VenueResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<VenueResponse>> CreateVenue(Guid companyId, SaveVenueRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Capacity < 1) return BadRequest(_localizer["PosRoomInvalid"].Value);
        if (!await _db.PosStores.AnyAsync(s => s.Id == request.StoreId && s.CompanyId == companyId)) return BadRequest(_localizer["PosStoreNotFound"].Value);
        var venue = new Venue { Id = Guid.NewGuid(), CompanyId = companyId, StoreId = request.StoreId, Name = request.Name.Trim(), Capacity = request.Capacity, IsActive = request.IsActive };
        _db.PosVenues.Add(venue);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, new VenueResponse(venue.Id, venue.StoreId, venue.Name, venue.Capacity, venue.IsActive));
    }

    [HttpPut("venues/{venueId:guid}", Name = "UpdatePosVenue")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<VenueResponse>> UpdateVenue(Guid companyId, Guid venueId, SaveVenueRequest request)
    {
        var venue = await _db.PosVenues.FirstOrDefaultAsync(v => v.Id == venueId && v.CompanyId == companyId);
        if (venue is null) return NotFound();
        if (string.IsNullOrWhiteSpace(request.Name) || request.Capacity < 1) return BadRequest(_localizer["PosRoomInvalid"].Value);
        if (!await _db.PosStores.AnyAsync(s => s.Id == request.StoreId && s.CompanyId == companyId)) return BadRequest(_localizer["PosStoreNotFound"].Value);
        (venue.StoreId, venue.Name, venue.Capacity, venue.IsActive) = (request.StoreId, request.Name.Trim(), request.Capacity, request.IsActive);
        await _db.SaveChangesAsync();
        return Ok(new VenueResponse(venue.Id, venue.StoreId, venue.Name, venue.Capacity, venue.IsActive));
    }

    [HttpGet("events/{eventId:guid}", Name = "GetPosEventBooking")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<EventBookingResponse>> GetEvent(Guid companyId, Guid eventId)
    {
        var booking = await _db.PosEventBookings.AsNoTracking().FirstOrDefaultAsync(e => e.Id == eventId && e.CompanyId == companyId);
        return booking is null ? NotFound() : Ok((await EventResponsesAsync(new List<EventBooking> { booking })).Single());
    }

    [HttpGet("events", Name = "ListPosEventBookings")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<EventBookingResponse>>> Events(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] Guid? venueId = null)
    {
        var query = _db.PosEventBookings.AsNoTracking().Where(e => e.CompanyId == companyId && e.Date >= from && e.Date <= to);
        if (venueId is { } v) query = query.Where(e => e.VenueId == v);
        return Ok(await EventResponsesAsync(await query.OrderBy(e => e.Date).ToListAsync()));
    }

    [HttpPost("events", Name = "CreatePosEventBooking")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    [ProducesResponseType(typeof(EventBookingResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<EventBookingResponse>> CreateEvent(Guid companyId, SaveEventBookingRequest request) =>
        (await SaveEventAsync(companyId, null, request)).AsCreated();

    [HttpPut("events/{eventId:guid}", Name = "UpdatePosEventBooking")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public Task<ActionResult<EventBookingResponse>> UpdateEvent(Guid companyId, Guid eventId, SaveEventBookingRequest request) => SaveEventAsync(companyId, eventId, request);

    private async Task<ActionResult<EventBookingResponse>> SaveEventAsync(Guid companyId, Guid? id, SaveEventBookingRequest r)
    {
        await using var transaction = await LockAsync(companyId);
        EventBooking? booking = null;
        if (id is { } existing)
        {
            booking = await _db.PosEventBookings.FirstOrDefaultAsync(e => e.Id == existing && e.CompanyId == companyId);
            if (booking is null) return NotFound();
            if (booking.State is EventBookingState.Completed or EventBookingState.Cancelled) return BadRequest(_localizer["PosBookingClosed"].Value);
        }
        if (string.IsNullOrWhiteSpace(r.CustomerName) || r.GuestsEstimated < 1 || (r.From is { } f && r.To is { } t && t <= f)) return BadRequest(_localizer["PosBookingInvalid"].Value);
        var venue = await _db.PosVenues.AsNoTracking().FirstOrDefaultAsync(v => v.Id == r.VenueId && v.CompanyId == companyId && v.StoreId == r.StoreId && v.IsActive);
        if (venue is null) return BadRequest(_localizer["PosRoomInvalid"].Value);
        if (r.GuestsEstimated > venue.Capacity) return BadRequest(_localizer["PosRoomTooSmall"].Value);
        // One event per venue and day.
        if (await _db.PosEventBookings.AnyAsync(e => e.VenueId == r.VenueId && e.Date == r.Date && e.Id != id && e.State != EventBookingState.Cancelled))
        {
            return BadRequest(_localizer["PosVenueTaken"].Value);
        }
        if (r.PackageItemId is { } pkg && !await _db.Items.AnyAsync(i => i.Id == pkg && i.CompanyId == companyId)) return BadRequest(_localizer["PosItemNotFound"].Value);
        booking ??= new EventBooking
        {
            Id = Guid.NewGuid(), CompanyId = companyId, State = EventBookingState.Tentative,
            Number = $"EV-{await _db.PosEventBookings.CountAsync(e => e.CompanyId == companyId) + 1:D5}",
        };
        (booking.StoreId, booking.VenueId, booking.Date, booking.From, booking.To, booking.CustomerId, booking.CustomerName, booking.Phone) =
            (r.StoreId, r.VenueId, r.Date, r.From, r.To, r.CustomerId, r.CustomerName.Trim(), Blank(r.Phone));
        (booking.PackageItemId, booking.PricePerGuest, booking.GuestsEstimated, booking.BanquetNotes, booking.Notes) =
            (r.PackageItemId, r.PricePerGuest, r.GuestsEstimated, Blank(r.BanquetNotes), Blank(r.Notes));
        if (id is null) _db.PosEventBookings.Add(booking);
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        var response = (await EventResponsesAsync(new List<EventBooking> { booking })).Single();
        return Ok(response);
    }

    [HttpPost("events/{eventId:guid}/state", Name = "SetPosEventBookingState")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<EventBookingResponse>> EventState(Guid companyId, Guid eventId, EventBookingStateRequest request)
    {
        var booking = await _db.PosEventBookings.FirstOrDefaultAsync(e => e.Id == eventId && e.CompanyId == companyId);
        if (booking is null) return NotFound();
        if (booking.State is EventBookingState.Completed or EventBookingState.Cancelled) return BadRequest(_localizer["PosBookingClosed"].Value);
        if (request.State == EventBookingState.Completed)
        {
            // Completed once its bill is paid.
            var tab = booking.TabId is { } t ? await _db.PosTabs.Include(x => x.Lines).FirstAsync(x => x.Id == t) : null;
            if (tab is null || (await _tabs.ToResponseAsync(tab)).Due > 0) return BadRequest(_localizer["PosFolioNotSettled"].Value);
        }
        booking.State = request.State;
        await _db.SaveChangesAsync();
        return Ok((await EventResponsesAsync(new List<EventBooking> { booking })).Single());
    }

    [HttpPost("events/{eventId:guid}/deposit-card", Name = "GetPosEventDepositCard")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<EventBookingResponse>> EventDepositCard(Guid companyId, Guid eventId)
    {
        var booking = await _db.PosEventBookings.FirstOrDefaultAsync(e => e.Id == eventId && e.CompanyId == companyId);
        if (booking is null) return NotFound();
        booking.DepositCardId ??= await NewDepositCardAsync(companyId, booking.Number, booking.CustomerId);
        await _db.SaveChangesAsync();
        return Ok((await EventResponsesAsync(new List<EventBooking> { booking })).Single());
    }

    // The final headcount: the bill (a tab) carries the package × guests at the agreed price;
    // extras are added to it like any tab.
    [HttpPost("events/{eventId:guid}/final-guests", Name = "SetPosEventFinalGuests")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<TabResponse>> FinalGuests(Guid companyId, Guid eventId, FinalGuestsRequest request)
    {
        await using var transaction = await LockAsync(companyId);
        var booking = await _db.PosEventBookings.FirstOrDefaultAsync(e => e.Id == eventId && e.CompanyId == companyId);
        if (booking is null) return NotFound();
        if (booking.State is EventBookingState.Completed or EventBookingState.Cancelled) return BadRequest(_localizer["PosBookingClosed"].Value);
        if (request.Guests < 1 || booking.PackageItemId is not { } packageId) return BadRequest(_localizer["PosBookingInvalid"].Value);
        var store = await _db.PosStores.AsNoTracking().FirstAsync(s => s.Id == booking.StoreId);
        Tab tab;
        if (booking.TabId is { } tabId) tab = await _db.PosTabs.Include(t => t.Lines).FirstAsync(t => t.Id == tabId);
        else
        {
            tab = await _tabs.OpenAsync(companyId, store, new OpenTabRequest(store.Id, null, TabKind.Event, request.Guests, $"{booking.Number} · {booking.CustomerName}"),
                CurrentUserId, booking.Number);
            booking.TabId = tab.Id;
        }
        var item = await _db.Items.AsNoTracking().FirstAsync(i => i.Id == packageId);
        var package = tab.Lines.FirstOrDefault(l => l.ItemId == packageId && l.State != TabLineState.Voided);
        if (package is { PaidQuantity: > 0 }) return BadRequest(_localizer["PosTabLinePaid"].Value);
        if (package is null)
        {
            package = new TabLine
            {
                Id = Guid.NewGuid(), TabId = tab.Id, LineNo = (tab.Lines.Count == 0 ? 0 : tab.Lines.Max(l => l.LineNo)) + 1, ItemId = item.Id, Description = item.Name,
                State = TabLineState.Sent, SentAt = DateTime.UtcNow,
            };
            tab.Lines.Add(package);
            _db.PosTabLines.Add(package);
        }
        package.Quantity = request.Guests;
        package.UnitPrice = booking.PricePerGuest ?? item.DefaultUnitPrice ?? 0m;
        booking.GuestsFinal = request.Guests;
        tab.Covers = request.Guests;
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok(await _tabs.ToResponseAsync(tab));
    }

    private async Task<List<EventBookingResponse>> EventResponsesAsync(List<EventBooking> events)
    {
        var venueIds = events.Select(e => e.VenueId).Distinct().ToList();
        var venues = await _db.PosVenues.AsNoTracking().Where(v => venueIds.Contains(v.Id)).ToDictionaryAsync(v => v.Id, v => v.Name);
        var cardIds = events.Where(e => e.DepositCardId != null).Select(e => e.DepositCardId!.Value).ToList();
        var cards = await _db.GiftCards.AsNoTracking().Where(c => cardIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id);
        return events.Select(e =>
        {
            var card = e.DepositCardId is { } c ? cards.GetValueOrDefault(c) : null;
            return new EventBookingResponse(e.Id, e.Number, e.StoreId, e.VenueId, venues.GetValueOrDefault(e.VenueId) ?? "?", e.Date, e.From, e.To, e.State,
                e.CustomerId, e.CustomerName, e.Phone, e.PackageItemId, e.PricePerGuest, e.GuestsEstimated, e.GuestsFinal, e.BanquetNotes, e.Notes,
                card?.Number, card?.Balance ?? 0m, e.TabId);
        }).ToList();
    }

    // ---- Ticketed events ----

    [HttpGet("ticketed-events", Name = "ListPosTicketedEvents")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<List<TicketedEventResponse>>> TicketedEvents(Guid companyId)
    {
        var events = await _db.PosTicketedEvents.AsNoTracking().Include(e => e.TicketTypes).Where(e => e.CompanyId == companyId)
            .OrderByDescending(e => e.StartsAt).ToListAsync();
        return Ok(await TicketedResponsesAsync(events));
    }

    [HttpPost("ticketed-events", Name = "CreatePosTicketedEvent")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(TicketedEventResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<TicketedEventResponse>> CreateTicketedEvent(Guid companyId, SaveTicketedEventRequest request)
    {
        var ev = new TicketedEvent { Id = Guid.NewGuid(), CompanyId = companyId };
        if (await ApplyAsync(companyId, ev, request) is { } error) return BadRequest(error);
        _db.PosTicketedEvents.Add(ev);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await TicketedResponsesAsync(new List<TicketedEvent> { ev })).Single());
    }

    [HttpPut("ticketed-events/{eventId:guid}", Name = "UpdatePosTicketedEvent")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<TicketedEventResponse>> UpdateTicketedEvent(Guid companyId, Guid eventId, SaveTicketedEventRequest request)
    {
        var ev = await _db.PosTicketedEvents.Include(e => e.TicketTypes).FirstOrDefaultAsync(e => e.Id == eventId && e.CompanyId == companyId);
        if (ev is null) return NotFound();
        if (await ApplyAsync(companyId, ev, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await TicketedResponsesAsync(new List<TicketedEvent> { ev })).Single());
    }

    private async Task<string?> ApplyAsync(Guid companyId, TicketedEvent ev, SaveTicketedEventRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name) || r.Capacity < 1 || r.TicketTypes.Count == 0 || r.TicketTypes.Any(t => t.Quota is < 1)) return _localizer["PosEventInvalid"].Value;
        if (!await _db.PosStores.AnyAsync(s => s.Id == r.StoreId && s.CompanyId == companyId)) return _localizer["PosStoreNotFound"].Value;
        var itemIds = r.TicketTypes.Select(t => t.ItemId).Distinct().ToList();
        if (itemIds.Count != r.TicketTypes.Count || await _db.Items.CountAsync(i => i.CompanyId == companyId && itemIds.Contains(i.Id)) != itemIds.Count)
        {
            return _localizer["PosItemNotFound"].Value;
        }
        // A ticket item belongs to one active event at a time, so the till knows which event it sells.
        if (await _db.PosEventTicketTypes.AnyAsync(t => itemIds.Contains(t.ItemId) && t.EventId != ev.Id
                && _db.PosTicketedEvents.Any(e => e.Id == t.EventId && e.IsActive && e.StartsAt > DateTime.UtcNow)))
        {
            return _localizer["PosTicketItemInUse"].Value;
        }
        (ev.StoreId, ev.Name, ev.StartsAt, ev.Capacity, ev.IsActive) = (r.StoreId, r.Name.Trim(), DateTime.SpecifyKind(r.StartsAt, DateTimeKind.Utc), r.Capacity, r.IsActive);
        _db.PosEventTicketTypes.RemoveRange(ev.TicketTypes);
        ev.TicketTypes = r.TicketTypes.Select(t => new EventTicketType { Id = Guid.NewGuid(), EventId = ev.Id, ItemId = t.ItemId, Quota = t.Quota }).ToList();
        if (_db.Entry(ev).State != EntityState.Detached) _db.PosEventTicketTypes.AddRange(ev.TicketTypes);
        return null;
    }

    private async Task<List<TicketedEventResponse>> TicketedResponsesAsync(List<TicketedEvent> events)
    {
        var ids = events.Select(e => e.Id).ToList();
        var tickets = await _db.PosTickets.AsNoTracking().Where(t => ids.Contains(t.EventId) && t.State != TicketState.Cancelled)
            .GroupBy(t => new { t.EventId, t.ItemId, t.State }).Select(g => new { g.Key.EventId, g.Key.ItemId, g.Key.State, Count = g.Count() }).ToListAsync();
        var itemIds = events.SelectMany(e => e.TicketTypes).Select(t => t.ItemId).Distinct().ToList();
        var names = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.Name);
        return events.Select(e => new TicketedEventResponse(e.Id, e.StoreId, e.Name, e.StartsAt, e.Capacity, e.IsActive,
            tickets.Where(t => t.EventId == e.Id).Sum(t => t.Count), tickets.Where(t => t.EventId == e.Id && t.State == TicketState.Used).Sum(t => t.Count),
            e.TicketTypes.Select(t => new EventTicketTypeResponse(t.ItemId, t.Quota, tickets.Where(x => x.EventId == e.Id && x.ItemId == t.ItemId).Sum(x => x.Count),
                names.GetValueOrDefault(t.ItemId))).ToList()))
            .ToList();
    }

    // The door: a ticket's QR code lets one person in, once.
    [HttpPost("ticketed-events/{eventId:guid}/scan", Name = "ScanPosTicket")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<ScanTicketResponse>> Scan(Guid companyId, Guid eventId, ScanTicketRequest request)
    {
        await using var transaction = await LockAsync(companyId);
        var ticket = await _db.PosTickets.FirstOrDefaultAsync(t => t.Code == request.Code.Trim() && t.CompanyId == companyId);
        if (ticket is null || ticket.EventId != eventId || ticket.State == TicketState.Cancelled) return Ok(new ScanTicketResponse("Invalid", null, null));
        var type = await _db.Items.AsNoTracking().Where(i => i.Id == ticket.ItemId).Select(i => i.Name).FirstAsync();
        if (ticket.State == TicketState.Used) return Ok(new ScanTicketResponse("AlreadyUsed", type, ticket.UsedAt));
        ticket.State = TicketState.Used;
        ticket.UsedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok(new ScanTicketResponse("Valid", type, ticket.UsedAt));
    }

    // ---- Helpers ----

    private async Task<Guid> NewDepositCardAsync(Guid companyId, string number, Guid? partnerId)
    {
        var card = new GiftCard { Id = Guid.NewGuid(), CompanyId = companyId, Number = number, Kind = GiftCardKind.Deposit, PartnerId = partnerId };
        _db.GiftCards.Add(card);
        return await Task.FromResult(card.Id);
    }

    private async Task<Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction?> LockAsync(Guid companyId)
    {
        if (!_db.Database.SupportsRowLocking()) return null;
        var transaction = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        return transaction;
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    public static string NewTicketCode() => Convert.ToHexString(RandomNumberGenerator.GetBytes(9)).ToUpperInvariant();
}
