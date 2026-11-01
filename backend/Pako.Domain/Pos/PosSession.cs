namespace Pako.Domain.Pos;

// docs/POS_PLAN.md §12.3 — a till's shift: opened with a float, sells, moves cash, closes with a
// counted amount per tender and posts one journal entry (D6).
public enum PosSessionState
{
    Open,
    Closed,
    Posted,
}

public class PosSession
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid RegisterId { get; set; }
    // Per register, 1, 2, 3 …
    public int Number { get; set; }
    public PosSessionState State { get; set; } = PosSessionState.Open;
    public Guid OpenedByUserId { get; set; }
    public DateTime OpenedAt { get; set; } = DateTime.UtcNow;
    public decimal OpeningFloat { get; set; }
    public Guid? ClosedByUserId { get; set; }
    public DateTime? ClosedAt { get; set; }
    // The day the session's sales are booked on (its opening date, in the company's terms).
    public DateOnly BusinessDate { get; set; }
    public Guid? JournalEntryId { get; set; }
    // Later corrections (offline coupons that arrived after posting) post adjustment entries.
    public string? ZReportJson { get; set; }
    public List<PosCashMovement> CashMovements { get; set; } = new();
    public List<PosSessionTender> Tenders { get; set; } = new();
}

// Lightspeed's taxonomy (docs/POS_PLAN.md §5.1): float top-up, cash to the bank, petty cash in/out,
// supplier paid-outs.
public enum PosCashMovementKind
{
    FloatIn,
    ToBank,
    PettyIn,
    PettyOut,
    PaidOut,
}

public class PosCashMovement
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public PosCashMovementKind Kind { get; set; }
    // Positive; the kind gives the direction.
    public decimal Amount { get; set; }
    public string Reason { get; set; } = string.Empty;
    // The other side of the entry (bank in transit, an expense, a supplier's payable…).
    public Guid CounterpartAccountId { get; set; }
    public Guid? PartnerId { get; set; }
    public Guid CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public PosSession? Session { get; set; }
}

// The close, per payment method: what the till should hold, what was counted, and why they differ.
public class PosSessionTender
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public Guid PaymentMethodId { get; set; }
    public decimal Expected { get; set; }
    public decimal Counted { get; set; }
    public decimal Difference { get; set; }
    public string? DifferenceReason { get; set; }
    public PosSession? Session { get; set; }
}
