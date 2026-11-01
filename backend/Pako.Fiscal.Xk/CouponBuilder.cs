using Pako.Fiscal.Xk.Atk;

namespace Pako.Fiscal.Xk;

// Builds the PosCoupon and the CitizenCoupon of one fiscal coupon from the same figures, so they can
// never disagree. Units follow ATK's samples: item prices and item totals in €0.0001, coupon totals,
// tax groups and payments in cents [VERIFY item Total units against ATK's technical spec — the
// sample's prose says cents, its numbers use €0.0001; see docs/POS_PLAN.md §16].
//
// VAT per letter is computed from the letter's gross total (net = gross / (1 + rate), rounded half
// away from zero; VAT = gross − net), the same rule as PAKO's TaxComputationService.ComputeFromGross,
// so the coupon and the ledger agree to the cent.
public static class CouponBuilder
{
    public const int MaxVerificationNoLength = 16;

    public static BuiltCoupon Build(FiscalCouponRequest request)
    {
        Validate(request);

        var taxTotals = request.Lines
            .GroupBy(l => l.TaxLetter)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g =>
            {
                var gross = Cents(g.Sum(l => l.LineTotal));
                var net = Math.Round(gross / (1 + TaxLetters.RateOf(g.Key)), 2, MidpointRounding.AwayFromZero);
                return new FiscalTaxTotal(g.Key, net, gross - net, gross);
            })
            .ToList();
        var total = taxTotals.Sum(t => t.Gross);
        var totalTax = taxTotals.Sum(t => t.Tax);
        var totalNoTax = taxTotals.Sum(t => t.Net);

        var paid = request.Payments.Sum(p => Cents(p.Amount));
        if (paid != total)
        {
            throw new FiscalCouponException($"Payments ({paid:0.00}) don't equal the coupon total ({total:0.00}).");
        }

        var time = request.Time.ToUnixTimeSeconds();
        var groups = taxTotals.Select(t => new TaxGroup { TaxRate = t.TaxLetter, TotalForTax = ToCents(t.Net), TotalTax = ToCents(t.Tax) }).ToList();

        var pos = new PosCoupon
        {
            BusinessId = request.Issuer.BusinessId,
            CouponId = request.CouponId,
            BranchId = request.Issuer.BranchId,
            Location = request.Issuer.Location,
            OperatorId = request.OperatorId,
            PosId = request.Issuer.PosId,
            ApplicationId = request.Issuer.ApplicationId,
            VerificationNo = request.VerificationNo,
            Type = (CouponType)request.Type,
            Time = time,
            Total = ToCents(total),
            TotalTax = ToCents(totalTax),
            TotalNoTax = ToCents(totalNoTax),
            ReferenceNo = request.ReferenceNo,
            TotalDiscount = ToCents(request.TotalDiscount),
        };
        pos.Items.AddRange(request.Lines.Select(l => new CouponItem
        {
            Name = l.Name,
            Price = ToTenThousandths(l.UnitPrice),
            Unit = l.Unit,
            Quantity = (float)l.Quantity,
            Total = ToTenThousandths(l.LineTotal),
            TaxRate = l.TaxLetter,
            Type = l.Category,
        }));
        pos.Payments.AddRange(request.Payments.Select(p => new Payment { Type = (PaymentType)p.Type, Amount = ToCents(p.Amount) }));
        pos.TaxGroups.AddRange(groups);

        var citizen = new CitizenCoupon
        {
            BusinessId = pos.BusinessId,
            CouponId = pos.CouponId,
            BranchId = pos.BranchId,
            PosId = pos.PosId,
            VerificationNo = pos.VerificationNo,
            Type = pos.Type,
            Time = pos.Time,
            Total = pos.Total,
            TotalTax = pos.TotalTax,
            TotalNoTax = pos.TotalNoTax,
        };
        citizen.TaxGroups.AddRange(groups.Select(g => g.Clone()));

        return new BuiltCoupon(pos, citizen, taxTotals, total, totalTax, totalNoTax);
    }

    private static void Validate(FiscalCouponRequest r)
    {
        if (r.CouponId == 0) throw new FiscalCouponException("A coupon needs an id unique across the business.");
        if (r.Issuer.BusinessId == 0 || r.Issuer.PosId == 0) throw new FiscalCouponException("The issuer's NUI and POS id are required.");
        if (r.Lines.Count == 0) throw new FiscalCouponException("A coupon needs at least one line.");
        if (r.Payments.Count == 0) throw new FiscalCouponException("A coupon needs at least one payment.");
        if (string.IsNullOrWhiteSpace(r.VerificationNo) || r.VerificationNo.Length > MaxVerificationNoLength)
        {
            throw new FiscalCouponException($"The verification number is required and at most {MaxVerificationNoLength} characters.");
        }
        if (string.IsNullOrWhiteSpace(r.OperatorId)) throw new FiscalCouponException("The operator (cashier) is required on every coupon.");
        // ATK rejects a cancellation or return that doesn't name the original coupon.
        if (r.Type is FiscalCouponType.Cancel or FiscalCouponType.Return && r.ReferenceNo == 0)
        {
            throw new FiscalCouponException("A cancellation or return must reference the original coupon.");
        }
        if (r.Type == FiscalCouponType.Sale && r.ReferenceNo != 0) throw new FiscalCouponException("A sale doesn't reference another coupon.");
        foreach (var line in r.Lines)
        {
            if (string.IsNullOrWhiteSpace(line.Name)) throw new FiscalCouponException("Every line needs a name.");
            if (line.Quantity <= 0 || line.UnitPrice < 0 || line.LineTotal < 0) throw new FiscalCouponException($"Line \"{line.Name}\": quantity must be positive and amounts not negative.");
            TaxLetters.RateOf(line.TaxLetter);
        }
        if (r.Payments.Any(p => p.Amount <= 0)) throw new FiscalCouponException("Payment amounts must be positive.");
    }

    private static decimal Cents(decimal euros) => Math.Round(euros, 2, MidpointRounding.AwayFromZero);

    public static long ToCents(decimal euros) => (long)Math.Round(euros * 100m, 0, MidpointRounding.AwayFromZero);

    public static long ToTenThousandths(decimal euros) => (long)Math.Round(euros * 10_000m, 0, MidpointRounding.AwayFromZero);
}
