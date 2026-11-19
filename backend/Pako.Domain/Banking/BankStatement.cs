using System.Security.Cryptography;
using System.Text;

namespace Pako.Domain.Banking;

// A bank statement imported from the PAKO Excel template (docs/BANK_STATEMENTS.md). Draft while the
// user reviews the suggested matches; Confirmed once its matched lines were recorded as payments.
public enum BankStatementState
{
    Draft,
    Confirmed,
}

// Open: not posted (no match yet, or a match chosen but not confirmed). Matched: recorded as a payment
// against the invoice/bill. Ignored: the user decided this line is not a customer or supplier payment
// (a bank fee, a transfer) and it is entered by hand elsewhere.
public enum BankStatementLineState
{
    Open,
    Matched,
    Ignored,
}

[Pako.Domain.Shared.Audited]
public class BankStatement
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }

    // The ledger account the money moved through (AccountSubType.Bank).
    public Guid BankAccountId { get; set; }

    public string FileName { get; set; } = string.Empty;

    // SHA-256 of the uploaded file: the same file can't be imported twice.
    public string FileHash { get; set; } = string.Empty;

    public DateOnly PeriodFrom { get; set; }
    public DateOnly PeriodTo { get; set; }
    public decimal OpeningBalance { get; set; }
    public decimal ClosingBalance { get; set; }
    public BankStatementState State { get; set; } = BankStatementState.Draft;
    public Guid CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ConfirmedAt { get; set; }

    public List<BankStatementLine> Lines { get; set; } = [];

    public decimal TotalIn => Lines.Sum(l => l.AmountIn);
    public decimal TotalOut => Lines.Sum(l => l.AmountOut);

    // Zero when opening + money in − money out = closing: no line is missing or doubled.
    public decimal BalanceDifference => OpeningBalance + TotalIn - TotalOut - ClosingBalance;
}

[Pako.Domain.Shared.AuditedChild(typeof(BankStatement), nameof(StatementId))]
public class BankStatementLine
{
    public Guid Id { get; set; }
    public Guid StatementId { get; set; }

    // The row in the Excel file, so messages can point at it.
    public int RowNumber { get; set; }

    public DateOnly Date { get; set; }
    public string Description { get; set; } = string.Empty;
    public string? PartnerText { get; set; }
    public string? Reference { get; set; }

    // Exactly one of the two is > 0.
    public decimal AmountIn { get; set; }
    public decimal AmountOut { get; set; }

    // Same account + date + amount + reference + occurrence in the file = the same bank movement.
    public string Fingerprint { get; set; } = string.Empty;

    // The same movement was already imported in another statement. Such a line starts Ignored.
    public bool IsDuplicate { get; set; }

    public Guid? PartnerId { get; set; }
    public BankStatementLineState State { get; set; } = BankStatementLineState.Open;

    // The chosen (or suggested) document and the amount to apply to it. Money in pays a customer
    // invoice, money out a supplier bill. MatchAmount can be less than the line amount when the
    // document had less open; the rest of the line is not posted (no other accounts, by design).
    public Guid? InvoiceId { get; set; }
    public Guid? BillId { get; set; }
    public decimal? MatchAmount { get; set; }

    // Set when the line was recorded as a payment.
    public Guid? JournalEntryId { get; set; }
    public Guid? ReconciliationId { get; set; }

    public bool IsIncoming => AmountIn > 0;
    public decimal Amount => AmountIn > 0 ? AmountIn : AmountOut;
    public bool HasMatch => (InvoiceId is not null || BillId is not null) && MatchAmount > 0;

    public void ClearMatch()
    {
        InvoiceId = null;
        BillId = null;
        MatchAmount = null;
    }

    public static string FingerprintOf(Guid bankAccountId, DateOnly date, decimal amountIn, decimal amountOut, string? reference, int occurrence)
    {
        var key = string.Join('|',
            bankAccountId.ToString("N"),
            date.ToString("yyyy-MM-dd"),
            amountIn.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture),
            amountOut.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture),
            (reference ?? string.Empty).Trim().ToUpperInvariant(),
            occurrence.ToString(System.Globalization.CultureInfo.InvariantCulture));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
    }
}
