namespace Pako.Domain.Companies;

// Stored as its number: append only.
public enum PaymentMethodKind
{
    Cash,
    Bank,
    // docs/POS_PLAN.md D8: till tenders. Card posts to an acquirer clearing account (103200) settled
    // by the bank later; voucher and gift card redeem a liability; on-account charges the customer.
    Card,
    Voucher,
    GiftCard,
    OnAccount,
    Other
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
