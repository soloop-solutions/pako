namespace Pako.Domain.Companies;

public enum PaymentMethodKind
{
    Cash,
    Bank
}

// S0.3 (Sprint 0 registers, additive/inert). LedgerAccountId carries no DB FK, same
// no-DB-FK/index-only convention as InvoiceLine.RevenueAccountId/BillLine.ExpenseAccountId.
public class PaymentMethod
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public PaymentMethodKind Kind { get; set; }
    public Guid LedgerAccountId { get; set; }
}
