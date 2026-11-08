namespace Pako.Domain.Inventory;

public enum VehicleType
{
    Car,
    Van,
    Truck,
    Motorcycle,
    Other
}

public enum VehicleStatus
{
    Active,
    InMaintenance,
    OutOfService
}

public class Vehicle
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Plate { get; set; } = string.Empty;
    public string? Make { get; set; }
    public string? Model { get; set; }
    public VehicleType Type { get; set; }
    public VehicleStatus Status { get; set; }
    public Guid? DriverUserId { get; set; }
    public decimal? CapacityKg { get; set; }
    public string? Notes { get; set; }
    public Guid? StockWarehouseId { get; set; }
    public bool IsArchived { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
