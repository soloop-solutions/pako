namespace Pako.Domain.Pos;

// docs/POS_PLAN.md §8.10 / P3: on a shared till each waiter or cashier signs in with a PIN (unique
// within the company, stored hashed), so every order and tab carries who took it.
public class PosPin
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid UserId { get; set; }
    public string PinHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// The Kosovo café habit: each waiter keeps the cash they collect and hands it over at the end of the
// shift. What they hand over against what their orders took in cash; a shortage is owed by the
// waiter (an employee receivable when the waiter is an employee).
public class WaiterSettlement
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public Guid WaiterUserId { get; set; }
    public string WaiterName { get; set; } = string.Empty;
    public decimal Expected { get; set; }
    public decimal Handed { get; set; }
    public decimal Difference { get; set; }
    public string? Reason { get; set; }
    public Guid CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
