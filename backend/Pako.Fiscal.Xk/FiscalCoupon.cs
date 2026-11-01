using Pako.Fiscal.Xk.Atk;

namespace Pako.Fiscal.Xk;

// docs/POS_PLAN.md §2.4 and §12.5 — what PAKO hands to the fiscal layer for one coupon. Amounts are
// euros as decimals here; CouponBuilder turns them into ATK's integer units. Prices are VAT-inclusive
// (what the shelf and the coupon show).
public enum FiscalCouponType
{
    Sale = 1,
    Cancel = 2,
    Return = 3,
}

// ATK's payment types (models.proto PaymentType).
public enum FiscalPaymentType
{
    Cash = 1,
    CreditCard = 2,
    Voucher = 3,
    Cheque = 4,
    CryptoCurrency = 5,
    Other = 6,
}

// Who issues the coupon: the business (NUI), its branch and point of sale, and PAKO's certified
// application id (AI 01/2026 Art. 34–35).
public record FiscalIssuer(ulong BusinessId, ulong BranchId, ulong PosId, ulong ApplicationId, string Location);

public record FiscalCouponLine(
    string Name,
    string Unit,
    decimal Quantity,
    // VAT-inclusive price per unit, before the line discount.
    decimal UnitPrice,
    // VAT-inclusive amount of the line after its discount (what the customer pays for it).
    decimal LineTotal,
    // ATK tax letter: A exempt, C 0 %, D 8 %, E 18 % (see TaxLetters).
    string TaxLetter,
    // ATK "Type": the article's category code.
    string Category = "TT");

public record FiscalCouponPayment(FiscalPaymentType Type, decimal Amount);

public record FiscalCouponRequest(
    FiscalIssuer Issuer,
    ulong CouponId,
    FiscalCouponType Type,
    DateTimeOffset Time,
    string OperatorId,
    string VerificationNo,
    IReadOnlyList<FiscalCouponLine> Lines,
    IReadOnlyList<FiscalCouponPayment> Payments,
    // The original CouponId for a cancellation or return; 0 for a sale.
    ulong ReferenceNo = 0,
    decimal TotalDiscount = 0m);

// The two payloads that together are one fiscal coupon. ATK marks a coupon FAILED VERIFICATION when
// their totals disagree, so they are always built together by CouponBuilder.
public record BuiltCoupon(PosCoupon Pos, CitizenCoupon Citizen, IReadOnlyList<FiscalTaxTotal> TaxTotals,
    decimal Total, decimal TotalTax, decimal TotalNoTax);

// Totals per tax letter, in euros: net, VAT and gross.
public record FiscalTaxTotal(string TaxLetter, decimal Net, decimal Tax, decimal Gross);

public class FiscalCouponException(string message) : Exception(message);
