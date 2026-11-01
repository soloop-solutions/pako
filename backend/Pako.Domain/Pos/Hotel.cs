namespace Pako.Domain.Pos;

// docs/POS_PLAN.md §6.4–6.5 / P5: hotels and event venues. A guest's folio and an event's bill are
// tabs (TabKind.Folio / Event): room nights, tourist tax, restaurant charges moved from a table
// and banquet extras are its lines, and checking out pays the tab at the till — one fiscal coupon
// for the stay (fiscalised at check-out; [VERIFY] with ATK) — or bills the company that pays.
public class RoomType
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int Capacity { get; set; } = 2;
    // The service item a night is sold as (its price is the rack rate).
    public Guid RateItemId { get; set; }
    public bool IsActive { get; set; } = true;
}

public enum RoomState
{
    Clean,
    Dirty,
    OutOfService,
}

public class Room
{
    public Guid Id { get; set; }
    public Guid RoomTypeId { get; set; }
    public string Number { get; set; } = string.Empty;
    public string? Floor { get; set; }
    public RoomState State { get; set; }
    public bool IsActive { get; set; } = true;
}

public enum HotelBookingState
{
    Reserved,
    CheckedIn,
    CheckedOut,
    Cancelled,
    NoShow,
}

public class HotelBooking
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Number { get; set; } = string.Empty;
    public Guid RoomTypeId { get; set; }
    public Guid? RoomId { get; set; }
    public DateOnly Arrival { get; set; }
    public DateOnly Departure { get; set; }
    public int Adults { get; set; } = 1;
    public int Children { get; set; }
    public HotelBookingState State { get; set; }
    public string GuestName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }
    // A company that pays (city ledger): its share is invoiced to it.
    public Guid? CompanyPartnerId { get; set; }
    // Where it came from (direct, phone, Booking.com …).
    public string? Channel { get; set; }
    // VAT-inclusive price of one night (the rate item's price unless agreed otherwise).
    public decimal NightlyRate { get; set; }
    public string? Notes { get; set; }
    public Guid? DepositCardId { get; set; }
    // The folio (a tab) opened at check-in.
    public Guid? FolioTabId { get; set; }
    // The last night posted to the folio.
    public DateOnly? PostedThrough { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// The guest register (police reporting of foreign guests): everyone who stays, with their document.
public class HotelGuest
{
    public Guid Id { get; set; }
    public Guid BookingId { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string? Nationality { get; set; }
    public string? DocumentType { get; set; }
    public string? DocumentNumber { get; set; }
    public DateOnly? BirthDate { get; set; }
    public bool IsPrimary { get; set; }
}

// ---- Event venues (wedding halls) ----

public class Venue
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int Capacity { get; set; }
    public bool IsActive { get; set; } = true;
}

public enum EventBookingState
{
    Tentative,
    Confirmed,
    Completed,
    Cancelled,
}

public class EventBooking
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public Guid VenueId { get; set; }
    public string Number { get; set; } = string.Empty;
    public DateOnly Date { get; set; }
    public TimeOnly? From { get; set; }
    public TimeOnly? To { get; set; }
    public EventBookingState State { get; set; }
    public Guid? CustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    // The per-guest menu package, its agreed price and the headcount (final once known).
    public Guid? PackageItemId { get; set; }
    public decimal? PricePerGuest { get; set; }
    public int GuestsEstimated { get; set; }
    public int? GuestsFinal { get; set; }
    // The banquet event order: menu, timings, set-up, music — for the kitchen and staff.
    public string? BanquetNotes { get; set; }
    public string? Notes { get; set; }
    public Guid? DepositCardId { get; set; }
    // The event's bill (a tab): the package × guests and the extras (bottles opened …).
    public Guid? TabId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ---- Ticketed events ----

public class TicketedEvent
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime StartsAt { get; set; }
    public int Capacity { get; set; }
    public bool IsActive { get; set; } = true;
    public List<EventTicketType> TicketTypes { get; set; } = new();
}

// A ticket type is an item sold at the till (its price is the ticket's), with an optional quota.
public class EventTicketType
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }
    public Guid ItemId { get; set; }
    public int? Quota { get; set; }
}

public enum TicketState
{
    Valid,
    Used,
    Cancelled,
}

public class Ticket
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EventId { get; set; }
    public Guid ItemId { get; set; }
    // What the QR code on the ticket carries.
    public string Code { get; set; } = string.Empty;
    public Guid OrderId { get; set; }
    public TicketState State { get; set; }
    public DateTime? UsedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
