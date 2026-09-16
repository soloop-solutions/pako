namespace Pako.Domain.Companies;

public class Partner
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? TaxNumber { get; set; }
    public bool IsCustomer { get; set; }
    public bool IsVendor { get; set; }

    // S0.3 (Sprint 0 registers, additive/inert): natural-person identifier, distinct from
    // TaxNumber (the business tax number) — Track B5's "with/without-VAT distinction" wiring.
    // B8: now wired into PostingRuleValidator.ValidateVatCounterpartyTaxNumber (R07) — a
    // VAT-registered partner's counterparty identifier is TaxNumber, a non-VAT-registered
    // partner's (a natural person, typically) is FiscalNumber.
    public string? FiscalNumber { get; set; }
    public bool IsVatRegistered { get; set; }

    // B8: per-partner control account override. Null falls back to the company's own
    // ReceivableAccountId/PayableAccountId (CompanyAccountDefaults) — same "override wins,
    // company default otherwise" chain B6 established for Item's default accounts. Not validated
    // to be a Receivable/Payable-subledger account beyond belonging to the company: an accountant
    // may legitimately want a customer's balance on a different but still valid control account
    // (e.g. "Receivables — Related Parties"), and PostingRuleValidator's own R03/R04 checks still
    // apply at post time regardless of which account this resolves to.
    public Guid? ReceivableAccountId { get; set; }
    public Guid? PayableAccountId { get; set; }

    // B8: stored default that Invoice.Create falls back to when the request doesn't specify its
    // own PaymentTermDays — same fallback shape, not a DueDate auto-computation (DueDate stays a
    // required, independently-supplied field; nothing yet derives it from PaymentTermDays, per
    // Invoice.cs's own "feeds Track C6's aging report" comment).
    public int? PaymentTermDays { get; set; }

    // B8: stored, inert data — same "field exists, feature doesn't yet" posture as
    // Item.DefaultInventoryAccountId. No document flow reads or enforces this yet; whether it's a
    // hard block or a soft warning, and at what point in the flow, is a product decision this task
    // doesn't answer.
    public decimal? CreditLimit { get; set; }
}
