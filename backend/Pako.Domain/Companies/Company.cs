namespace Pako.Domain.Companies;

// 50_Profiles: which activation profile(s) a company/account belongs to. CORE is always on
// for every company (per that sheet's own text) and is included in every seeded account of
// group CORE, so it's the safe default rather than None.
[Flags]
public enum CompanyProfile
{
    None = 0,
    Core = 1,
    Import = 2,
    Mfg = 4,
    Serv = 8,
    Payroll = 16,
    IfrsPlus = 32
}

public class Company
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid? FirmId { get; set; }
    public DateOnly? AccountingLockDate { get; set; }
    public DateOnly? TaxLockDate { get; set; }
    public int NextInvoiceNumber { get; set; } = 1;
    public int NextCreditNoteNumber { get; set; } = 1;
    public int NextDebitNoteNumber { get; set; } = 1;
    public int NextDownPaymentNumber { get; set; } = 1;

    // Track A (v2 release, docs/V2_PARALLEL_TRACKS.md) — SalesReturn/Proforma need their own
    // series like every other Invoicing.DocumentType, added here as a flagged one-time exception
    // (Company.cs is normally Track B's file) mechanically identical to the four counters above,
    // per explicit authorization rather than silently editing another track's file. No
    // PurchaseReturn counter exists because Bill has never had PAKO-minted numbering at all
    // (VendorReference is free text the vendor supplies) — nothing to add there.
    public int NextSalesReturnNumber { get; set; } = 1;
    public int NextProformaNumber { get; set; } = 1;

    // Plani Kontabel v2.0 (COA_V2_IMPLEMENTATION_BRIEF.md Stage 1, R01 / 50_Profiles).
    public string FunctionalCurrency { get; set; } = "EUR";
    public CompanyProfile EnabledProfiles { get; set; } = CompanyProfile.Core;

    // C2: every company seeded so far is VAT-registered (the 26 VAT/WHT tax definitions are
    // always seeded), so this defaults true for zero behavior change on existing/typical
    // companies — a genuinely-empty "no tax" line is only ever valid once this is false.
    public bool IsVatRegistered { get; set; } = true;

    // B4: off by default. When true, ClientAdmin/FirmAdmin may override a posted document's number
    // via the /override-number endpoint; FirmAccountant may not (adminOnly on that route).
    public bool AllowNumberOverride { get; set; }

    // Kosovo VAT Law Article 45/56 requires invoice numbering to be gapless and strictly
    // monotonic per company. This mints the number and advances the counter together so a
    // failed Invoice.Post (e.g. a lock-date violation) never burns a number.
    public string ReserveNextInvoiceNumber()
    {
        var number = $"INV-{NextInvoiceNumber:D4}";
        NextInvoiceNumber++;
        return number;
    }

    // Kosovo VAT Law Article 47.2.2 requires a credit note to carry its own sequential number,
    // separate from the Article 45/56 invoice series above — a distinct counter, not a shared one.
    public string ReserveNextCreditNoteNumber()
    {
        var number = $"CN-{NextCreditNoteNumber:D4}";
        NextCreditNoteNumber++;
        return number;
    }

    // Kosovo VAT Law Article 47.2.2 requires the same own-sequence treatment for debit notes as
    // for credit notes — a distinct counter from both the invoice and credit-note series.
    public string ReserveNextDebitNoteNumber()
    {
        var number = $"DN-{NextDebitNoteNumber:D4}";
        NextDebitNoteNumber++;
        return number;
    }

    // A down-payment invoice is still a document PAKO issues to a customer, so it gets the same
    // own-sequence legal-numbering treatment as invoices/credit/debit notes, a distinct counter.
    public string ReserveNextDownPaymentNumber()
    {
        var number = $"DP-{NextDownPaymentNumber:D4}";
        NextDownPaymentNumber++;
        return number;
    }

    // A sales return is a legal document PAKO issues to a customer just like a credit/debit note,
    // so it gets the same own-sequence treatment — a distinct counter, not shared with CreditNote.
    public string ReserveNextSalesReturnNumber()
    {
        var number = $"SR-{NextSalesReturnNumber:D4}";
        NextSalesReturnNumber++;
        return number;
    }

    // A proforma is not a fiscal invoice (see Invoice.Post's Proforma rejection), so its series is
    // deliberately separate from — and irrelevant to — Article 45/56's gapless/monotonic
    // requirement, but it still needs its own distinct, predictable sequence for the "PRO-####"
    // label shown to the user before it's ever converted into a real invoice.
    public string ReserveNextProformaNumber()
    {
        var number = $"PRO-{NextProformaNumber:D4}";
        NextProformaNumber++;
        return number;
    }
}
