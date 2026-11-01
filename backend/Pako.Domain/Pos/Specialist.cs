namespace Pako.Domain.Pos;

// docs/POS_PLAN.md §6.8 / P7 — specialist retail: pharmacies, fuel stations, auto parts, online
// channels. Each pack adds a few records next to the shared till; the sale itself is always an
// ordinary POS order.

// ---- Pharmacy ----

// Who pays part of a prescription: the health insurance fund, an insurer, an employer. Its share is
// charged to its partner's receivable (an on-account tender) and claimed from it later.
public class ThirdPartyPayer
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid PartnerId { get; set; }
    // Share of the price it covers when the prescription doesn't say (0–100).
    public decimal CoveragePercent { get; set; }
    public bool IsActive { get; set; } = true;
}

public enum PrescriptionState
{
    Open,
    PartlyDispensed,
    Dispensed,
    Cancelled,
}

// A prescription (recetë) presented at the counter. Prescription-only items are sold against one of
// its lines; what is dispensed is counted on the line, so a repeat can't take more than prescribed.
// [VERIFY] Kosovo e-prescription (e-Recetë) integration: once the Ministry of Health's service is
// open to pharmacies, the number is checked there instead of typed.
public class Prescription
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    // The number written on the prescription.
    public string Number { get; set; } = string.Empty;
    public DateOnly IssuedOn { get; set; }
    public DateOnly? ValidUntil { get; set; }
    public string Prescriber { get; set; } = string.Empty;
    public string? PrescriberLicence { get; set; }
    public string PatientName { get; set; } = string.Empty;
    public string? PatientPersonalNumber { get; set; }
    public Guid? PayerId { get; set; }
    // The payer's share of each line (0–100).
    public decimal CoveragePercent { get; set; }
    public PrescriptionState State { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<PrescriptionLine> Lines { get; set; } = new();
}

public class PrescriptionLine
{
    public Guid Id { get; set; }
    public Guid PrescriptionId { get; set; }
    public Guid ItemId { get; set; }
    public decimal Quantity { get; set; }
    public decimal Dispensed { get; set; }
    public string? Dosage { get; set; }
}

// ---- Fuel station ----

public class FuelTank
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    // The fuel grade it holds (a stock-tracked item sold in litres).
    public Guid ItemId { get; set; }
    public decimal Capacity { get; set; }
    public bool IsActive { get; set; } = true;
}

// A nozzle on a pump, drawing from one tank. Its totaliser (meter) is read at every shift close.
public class FuelNozzle
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public int Pump { get; set; }
    public int Number { get; set; }
    public Guid TankId { get; set; }
    public bool IsActive { get; set; } = true;
}

// A shift's opening and closing totaliser readings on one nozzle: closing − opening is the litres
// pumped, compared with the litres sold at the till.
public class MeterReading
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid NozzleId { get; set; }
    public DateOnly Date { get; set; }
    // The till session (shift) it belongs to, when read at a session close.
    public Guid? SessionId { get; set; }
    public decimal Opening { get; set; }
    public decimal Closing { get; set; }
    public Guid UserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// A dip of a tank: litres measured (and water at the bottom).
public class TankDip
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid TankId { get; set; }
    public DateTime MeasuredAt { get; set; }
    public decimal Volume { get; set; }
    public decimal Water { get; set; }
    public Guid UserId { get; set; }
}

// A fleet card: a company's vehicle fuels on account; the fill is charged to the company.
public class FleetCard
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Number { get; set; } = string.Empty;
    public Guid PartnerId { get; set; }
    public string? VehiclePlate { get; set; }
    public string? DriverName { get; set; }
    // The most one fill may charge (null = no limit).
    public decimal? LimitPerFill { get; set; }
    // Fuel only: lines that aren't a tank's grade can't be charged to the card.
    public bool FuelOnly { get; set; } = true;
    public bool IsActive { get; set; } = true;
}

// ---- Auto parts ----

// Another maker's number for the same part (OEM, aftermarket); searched with spaces, dots and dashes
// removed.
public class ItemCrossReference
{
    public Guid Id { get; set; }
    public Guid ItemId { get; set; }
    public string Brand { get; set; } = string.Empty;
    public string Number { get; set; } = string.Empty;
    public string Normalized { get; set; } = string.Empty;
}

// A vehicle the part fits.
public class ItemFitment
{
    public Guid Id { get; set; }
    public Guid ItemId { get; set; }
    public string Make { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public int? YearFrom { get; set; }
    public int? YearTo { get; set; }
    public string? Engine { get; set; }
}

// ---- Online channels ----

public enum SalesChannelKind
{
    Webshop,
    Marketplace,
    SocialMedia,
}

// A webshop or marketplace selling a store's stock: it reads the catalogue and sends orders through a
// secret token. Orders are fiscalised at the store's till when collected or dispatched.
public class SalesChannel
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    public SalesChannelKind Kind { get; set; }
    public string Token { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum ChannelOrderState
{
    New,
    Accepted,
    // Picked and waiting at the counter (pickup) or for the courier (delivery).
    Ready,
    // Fiscalised and handed to the courier.
    Dispatched,
    // Collected at the counter, or delivered by the courier.
    Completed,
    // The courier brought it back.
    Returned,
    Cancelled,
}

public enum ChannelFulfilment
{
    Pickup,
    Delivery,
}

public enum ChannelPayment
{
    // Paid online (card); the money comes from the payment provider.
    Prepaid,
    // Paid to the courier (pagesë në dorëzim); the courier remits it later.
    CashOnDelivery,
    // Paid at the counter on collection.
    AtPickup,
}

public class ChannelOrder
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid ChannelId { get; set; }
    public Guid StoreId { get; set; }
    public string Number { get; set; } = string.Empty;
    // The webshop's own order number (unique per channel, so a resent order isn't taken twice).
    public string ExternalRef { get; set; } = string.Empty;
    public ChannelOrderState State { get; set; }
    public ChannelFulfilment Fulfilment { get; set; }
    public ChannelPayment Payment { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? Notes { get; set; }
    // VAT-inclusive, as charged by the webshop (lines plus shipping).
    public decimal Total { get; set; }
    public decimal ShippingFee { get; set; }
    // Delivery: the courier (a partner) and its tracking number.
    public Guid? CourierPartnerId { get; set; }
    public string? TrackingNumber { get; set; }
    // The till sale that fiscalised it.
    public Guid? PosOrderId { get; set; }
    // Cash on delivery: when and under which statement the courier paid it over.
    public DateOnly? RemittedOn { get; set; }
    public string? RemittanceRef { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<ChannelOrderLine> Lines { get; set; } = new();
}

public class ChannelOrderLine
{
    public Guid Id { get; set; }
    public Guid ChannelOrderId { get; set; }
    public int LineNo { get; set; }
    public Guid ItemId { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}
