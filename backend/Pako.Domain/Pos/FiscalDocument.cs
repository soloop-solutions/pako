namespace Pako.Domain.Pos;

// docs/POS_PLAN.md §12.5 (D4) — one fiscal coupon, immutable once issued. ATK types Sale (1),
// Cancel (2), Return (3); Training coupons are never sent. The signed payloads are kept exactly as
// the till signed them (AI 01/2026 Art. 32, 39; Law 08/L-257 Art. 6(3) retention).
public enum FiscalDocumentType
{
    Sale = 1,
    Cancel = 2,
    Return = 3,
    Training = 9,
}

public enum AtkStatus
{
    // Training: never sent.
    NotSent,
    // Issued and waiting to reach ATK (offline queue).
    Pending,
    Accepted,
    // ATK refused it (4xx): needs attention.
    Rejected,
}

public class FiscalDocument
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid RegisterId { get; set; }
    public Guid OrderId { get; set; }
    public FiscalDocumentType Type { get; set; }
    // ATK CouponId: unique across the whole business (all branches).
    public long CouponId { get; set; }
    // Number of the coupon within the register's business day (printed).
    public int DailyNumber { get; set; }
    // The CouponId of the coupon a cancellation or return refers to.
    public long? ReferenceCouponId { get; set; }
    public string VerificationNo { get; set; } = string.Empty;
    public DateTime IssuedAt { get; set; }
    // Base64 Protobuf PosCoupon and its signature, and the QR string (citizen coupon | signature).
    public string PosCouponDetails { get; set; } = string.Empty;
    public string Signature { get; set; } = string.Empty;
    public string QrCode { get; set; } = string.Empty;
    public AtkStatus AtkStatus { get; set; }
    public ulong? AtkTransactionNo { get; set; }
    public string? AtkError { get; set; }
    public DateTime? SentAt { get; set; }
    public int Attempts { get; set; }
    // AI 01/2026 Art. 44: an offline coupon must reach ATK within 48 hours.
    public DateTime? SendBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
