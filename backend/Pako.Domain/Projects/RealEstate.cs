namespace Pako.Domain.Projects;

// docs/ERP_VERTICALS_PLAN.md §2–3 (POS_PLAN P8) — real estate sales and property rental, phase 1.
// A building holds units (apartments, shops, parking, storage); a unit is reserved, sold on a
// contract with an installment plan (or given in compensation for land), or let on a lease whose
// rent is invoiced every month.
public class Building
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid ProjectId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Address { get; set; }
    // The item sales of units are invoiced as (revenue account, VAT code).
    // [VERIFY] Kosovo VAT on the first supply of new residential buildings.
    public Guid SaleItemId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum UnitKind
{
    Apartment,
    Commercial,
    Office,
    Parking,
    Storage,
}

public enum UnitState
{
    Available,
    Reserved,
    Sold,
    // Given to the landowner in exchange for the land (kompensim).
    Compensation,
    Rented,
}

public class PropertyUnit
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid BuildingId { get; set; }
    public string Number { get; set; } = string.Empty;
    public string? Floor { get; set; }
    public UnitKind Kind { get; set; }
    public decimal Area { get; set; }
    // VAT-inclusive asking price.
    public decimal ListPrice { get; set; }
    public UnitState State { get; set; }
}

public enum ReservationState
{
    Active,
    Expired,
    Converted,
    Cancelled,
}

public class UnitReservation
{
    public Guid Id { get; set; }
    public Guid UnitId { get; set; }
    public Guid PartnerId { get; set; }
    public DateOnly Date { get; set; }
    public DateOnly ExpiresOn { get; set; }
    public decimal Deposit { get; set; }
    public ReservationState State { get; set; }
    public string? Notes { get; set; }
}

public enum ContractKind
{
    Sale,
    // The landowner's units, paid for with the land (a barter: both sides invoiced).
    Compensation,
}

public enum ContractState
{
    Active,
    Completed,
    Cancelled,
}

public class UnitSaleContract
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid UnitId { get; set; }
    public Guid BuyerPartnerId { get; set; }
    public string Number { get; set; } = string.Empty;
    public ContractKind Kind { get; set; }
    public DateOnly ContractDate { get; set; }
    // VAT-inclusive.
    public decimal Price { get; set; }
    public ContractState State { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<Installment> Installments { get; set; } = new();
}

public class Installment
{
    public Guid Id { get; set; }
    public Guid ContractId { get; set; }
    public int Number { get; set; }
    public DateOnly DueDate { get; set; }
    public decimal Amount { get; set; }
    public Guid? InvoiceId { get; set; }
}

public enum LeaseState
{
    Draft,
    Active,
    Ended,
}

// A lease: the tenant pays Rent every month from StartDate, invoiced on DueDay; a part month at the
// start or end is charged by the day.
public class Lease
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Number { get; set; } = string.Empty;
    public Guid? UnitId { get; set; }
    // Free text when the property isn't one of the company's own units (sub-letting, a house).
    public string? Property { get; set; }
    public Guid TenantPartnerId { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    // VAT-inclusive per month.
    public decimal Rent { get; set; }
    public Guid RentItemId { get; set; }
    public int DueDay { get; set; } = 1;
    public decimal Deposit { get; set; }
    public DateOnly? DepositReceivedOn { get; set; }
    public DateOnly? DepositReturnedOn { get; set; }
    public LeaseState State { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<LeaseMeter> Meters { get; set; } = new();
}

// A utility meter re-billed to the tenant: consumption × the item's price.
public class LeaseMeter
{
    public Guid Id { get; set; }
    public Guid LeaseId { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid ItemId { get; set; }
    public decimal LastReading { get; set; }
    // Read since the last rent run, not billed yet.
    public decimal? PendingReading { get; set; }
}

// One month of a lease invoiced (never twice).
public class LeaseInvoice
{
    public Guid Id { get; set; }
    public Guid LeaseId { get; set; }
    // The first day of the month.
    public DateOnly Period { get; set; }
    public Guid InvoiceId { get; set; }
}
