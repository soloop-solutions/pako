namespace Pako.Domain.Pos;

// docs/POS_PLAN.md P2 (furniture, appliances, fashion): goods put aside (layaway) or ordered in for
// a named customer, paid for in deposits before they're collected. The order holds the agreed
// lines and prices; deposits load its deposit card (a liability), which pays at collection. The
// sale itself — coupon, stock, revenue — happens at collection, like any till sale.
// [VERIFY] Kosovo VAT on advance payments: whether the deposit must be taxed when received.
public enum CustomerOrderKind
{
    Layaway,
    SpecialOrder,
}

public enum CustomerOrderState
{
    Open,
    // The goods are in and waiting for the customer.
    Ready,
    Collected,
    Cancelled,
}

public class CustomerOrder
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Number { get; set; } = string.Empty;
    public CustomerOrderKind Kind { get; set; }
    public CustomerOrderState State { get; set; }
    public Guid CustomerId { get; set; }
    public DateOnly? DueDate { get; set; }
    public string? Notes { get; set; }
    public Guid DepositCardId { get; set; }
    // The till sale that collected it.
    public Guid? CollectedOrderId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<CustomerOrderLine> Lines { get; set; } = new();
}

public class CustomerOrderLine
{
    public Guid Id { get; set; }
    public Guid CustomerOrderId { get; set; }
    public int LineNo { get; set; }
    public Guid ItemId { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    // VAT-inclusive, as agreed with the customer.
    public decimal UnitPrice { get; set; }
}
