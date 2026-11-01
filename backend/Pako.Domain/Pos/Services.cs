namespace Pako.Domain.Pos;

// docs/POS_PLAN.md §6.9 / P4: salons, barbers, clinics, gyms, repair shops. Services are ordinary
// items marked bookable (with a duration); resources are the staff, chairs or rooms that perform
// them, with working hours; an appointment books one resource for one service. Paying happens at
// the till like any sale, naming the appointment.
public enum ResourceKind
{
    Staff,
    Room,
    Equipment,
}

public class ServiceResource
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    public ResourceKind Kind { get; set; }
    // Staff: the member who performs (commission, PIN sign-in).
    public Guid? UserId { get; set; }
    public string? Color { get; set; }
    public bool IsActive { get; set; } = true;
    public List<ResourceHours> Hours { get; set; } = new();
}

// A resource's working hours on one day of the week (Monday = 0); several spans per day allowed.
public class ResourceHours
{
    public Guid Id { get; set; }
    public Guid ResourceId { get; set; }
    public int Day { get; set; }
    public TimeOnly From { get; set; }
    public TimeOnly To { get; set; }
}

// Which resources can perform which service.
public class ServiceResourceLink
{
    public Guid ItemId { get; set; }
    public Guid ResourceId { get; set; }
}

public enum AppointmentState
{
    Booked,
    Confirmed,
    CheckedIn,
    Completed,
    NoShow,
    Cancelled,
}

public enum AppointmentSource
{
    Staff,
    Online,
}

public class Appointment
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Number { get; set; } = string.Empty;
    public Guid ItemId { get; set; }
    public Guid ResourceId { get; set; }
    // UTC.
    public DateTime Start { get; set; }
    public DateTime End { get; set; }
    public AppointmentState State { get; set; }
    public AppointmentSource Source { get; set; }
    public Guid? CustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Notes { get; set; }
    // A deposit taken for it (a deposit card, spent at checkout or kept on a no-show).
    public Guid? DepositCardId { get; set; }
    public Guid? PosOrderId { get; set; }
    public DateTime? ReminderSentAt { get; set; }
    public string? CancelReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// A package of prepaid sessions ("10 massages"): sold once at the till as a liability, each use
// at the till then takes one session at the package's value per session.
// [VERIFY] Kosovo VAT on prepaid single-purpose services: whether VAT is due at sale.
public class CustomerPackage
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Number { get; set; } = string.Empty;
    public Guid ServiceItemId { get; set; }
    public Guid? CustomerId { get; set; }
    public string? HolderName { get; set; }
    public string? Phone { get; set; }
    public int SessionsTotal { get; set; }
    public int SessionsUsed { get; set; }
    // VAT-inclusive value of one session (the package price shared over its sessions).
    public decimal UnitValue { get; set; }
    public DateOnly? ExpiresOn { get; set; }
    public Guid SoldOrderId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum MembershipState
{
    Active,
    Frozen,
    Cancelled,
}

// A gym or club membership: the period a plan item paid for, renewed by selling the plan again.
public class CustomerMembership
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Number { get; set; } = string.Empty;
    public Guid PlanItemId { get; set; }
    public Guid? CustomerId { get; set; }
    public string? HolderName { get; set; }
    public string? Phone { get; set; }
    public DateOnly StartsOn { get; set; }
    public DateOnly EndsOn { get; set; }
    public MembershipState State { get; set; }
    public DateOnly? FrozenFrom { get; set; }
    public int FrozenDays { get; set; }
    public Guid? LastOrderId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// A repair (phone, laptop, car): taken in, diagnosed, estimated, approved by the customer,
// repaired and collected — paid at the till, naming the ticket.
public enum RepairState
{
    Received,
    Diagnosing,
    WaitingApproval,
    Approved,
    InRepair,
    Ready,
    Collected,
    Cancelled,
}

public class RepairTicket
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Number { get; set; } = string.Empty;
    public RepairState State { get; set; }
    public Guid? CustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }
    // What came in: device or vehicle, its serial/IMEI or plate, what is wrong, what was left with it.
    public string Device { get; set; } = string.Empty;
    public string? SerialOrPlate { get; set; }
    public string Problem { get; set; } = string.Empty;
    public string? Accessories { get; set; }
    public Guid? TechnicianUserId { get; set; }
    public string? Notes { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public DateTime? ReadyAt { get; set; }
    public Guid? CollectedOrderId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<RepairTicketLine> Lines { get; set; } = new();
}

// Parts and labour on the estimate (VAT-inclusive).
public class RepairTicketLine
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public int LineNo { get; set; }
    public Guid ItemId { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}
