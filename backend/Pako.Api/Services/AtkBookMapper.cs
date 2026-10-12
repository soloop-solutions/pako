using System.Text.RegularExpressions;
using Pako.Domain.Companies;
using Pako.Domain.Tax;

namespace Pako.Api.Services;

public record AtkTaxRow(
    Guid DocumentId, string? DocumentNumber, DateOnly IssueDate, Guid PartnerId, string VatCode, decimal Rate,
    decimal NetAmount, TaxDirection? Direction, decimal? DeductiblePercent, bool IsReverseCharge, TaxAtkBook? AtkBook);

public static partial class AtkBookMapper
{
    // Code -> ATK box (net base). Matched top to bottom, first hit wins; no hit leaves the row out.
    // Sales (VAT):      S18 -> 12 | S08 -> 14 | S00 -> 10c | SEXP -> 11 | SEX -> 9 | SRC (reverse charge) -> 10b
    //                   RC18 (a purchase-side code) -> 28 on a sales-book row for the purchase document
    // Purchases (VAT):  B18 -> 43 | B08 -> 45 | INV (18%) -> 47 | INV (8%) -> 49 | B00, BEX, IEX -> 31
    //                   BND, IND (VAT not deductible) -> 33 | I18 -> 35 | I08 -> 37 | RC18 -> 65
    // Left out (no box placed): BV50 (50% deductible), RC00, any 8% code with no 8% box, adjustments,
    // credit/debit notes and bad-debt boxes (16, 18, 20, 22, 24, 26, 53, 55, 57, 59, 61, 63, 51).
    // Non-VAT sales:    SEXP -> c, everything else sold domestically (incl. untaxed documents) -> a
    // Non-VAT purchases: INV -> c, Imp direction -> d, Rc direction -> f, everything else -> a
    private static string? SalesVatBox(AtkTaxRow row)
    {
        if (row.Direction != TaxDirection.Out)
        {
            return null;
        }

        if (row.IsReverseCharge)
        {
            return "10b";
        }

        return row.VatCode switch
        {
            "SEXP" => "11",
            "SEX" => "9",
            "S00" => "10c",
            _ when row.Rate == 0.18m => "12",
            _ when row.Rate == 0.08m => "14",
            _ => null
        };
    }

    private static string? PurchaseVatBox(AtkTaxRow row)
    {
        var deductible = row.DeductiblePercent;
        switch (row.Direction)
        {
            case TaxDirection.Rc:
                return row.Rate == 0.18m && deductible == 100m ? "65" : null;
            case TaxDirection.In when row.Rate == 0m:
            case TaxDirection.Imp when row.Rate == 0m:
                return "31";
            case TaxDirection.In when row.AtkBook == TaxAtkBook.BlerjeInvestime && deductible == 100m:
                return row.Rate == 0.18m ? "47" : row.Rate == 0.08m ? "49" : null;
            case TaxDirection.In when deductible == 0m && row.Rate == 0.18m:
            case TaxDirection.Imp when deductible == 0m && row.Rate == 0.18m:
                return "33";
            case TaxDirection.In when deductible == 100m:
                return row.Rate == 0.18m ? "43" : row.Rate == 0.08m ? "45" : null;
            case TaxDirection.Imp when deductible == 100m:
                return row.Rate == 0.18m ? "35" : row.Rate == 0.08m ? "37" : null;
            default:
                return null;
        }
    }

    private static string? SalesNonVatBox(AtkTaxRow row) =>
        row.Direction is null or TaxDirection.None or TaxDirection.Out
            ? row.VatCode == "SEXP" ? "c" : "a"
            : null;

    private static string? PurchaseNonVatBox(AtkTaxRow row) => row.Direction switch
    {
        TaxDirection.Imp => "d",
        TaxDirection.Rc => "f",
        _ when row.AtkBook == TaxAtkBook.BlerjeInvestime => "c",
        _ => "a"
    };

    public static List<AtkBookDocument> SalesDocuments(
        bool vatRegistered, IEnumerable<AtkTaxRow> salesRows, IEnumerable<AtkTaxRow> purchaseRows,
        IReadOnlyDictionary<Guid, Partner> partners)
    {
        var placed = new List<(AtkTaxRow Row, string Box)>();
        foreach (var row in salesRows)
        {
            var box = vatRegistered ? SalesVatBox(row) : SalesNonVatBox(row);
            if (box is not null)
            {
                placed.Add((row, box));
            }
        }

        if (vatRegistered)
        {
            foreach (var row in purchaseRows.Where(r => r.Direction == TaxDirection.Rc && r.IsReverseCharge && r.Rate == 0.18m))
            {
                placed.Add((row, "28"));
            }
        }

        return Pivot(placed, partners, isSales: true);
    }

    public static List<AtkBookDocument> PurchaseDocuments(
        bool vatRegistered, IEnumerable<AtkTaxRow> purchaseRows, IReadOnlyDictionary<Guid, Partner> partners)
    {
        var placed = new List<(AtkTaxRow Row, string Box)>();
        foreach (var row in purchaseRows)
        {
            var box = vatRegistered ? PurchaseVatBox(row) : PurchaseNonVatBox(row);
            if (box is not null)
            {
                placed.Add((row, box));
            }
        }

        return Pivot(placed, partners, isSales: false);
    }

    private static List<AtkBookDocument> Pivot(
        List<(AtkTaxRow Row, string Box)> placed, IReadOnlyDictionary<Guid, Partner> partners, bool isSales)
    {
        return placed
            .GroupBy(p => p.Row.DocumentId)
            .Select(g =>
            {
                var first = g.First().Row;
                var boxes = g.GroupBy(p => p.Box).ToDictionary(b => b.Key, b => b.Sum(p => p.Row.NetAmount));
                var partner = partners.GetValueOrDefault(first.PartnerId);
                var (validNui, fallbackNui, vatNumber) = PartnerNumbers(partner, isSales);
                var nui = validNui ?? SpecialNumber(g.Select(p => p.Row).ToList(), boxes, isSales) ?? fallbackNui;
                return new AtkBookDocument(
                    first.IssueDate, first.DocumentNumber, partner?.Name ?? string.Empty, nui, vatNumber, boxes);
            })
            .OrderBy(d => d.Date).ThenBy(d => d.Number, StringComparer.Ordinal)
            .ToList();
    }

    private static string? SpecialNumber(List<AtkTaxRow> rows, Dictionary<string, decimal> boxes, bool isSales)
    {
        if (isSales)
        {
            if (boxes.Keys.All(k => k is "11" or "c"))
            {
                return "3";
            }

            return boxes.Keys.All(k => k == "28") ? "6" : null;
        }

        if (rows.Any(r => r.Direction == TaxDirection.Imp))
        {
            return "8";
        }

        return rows.All(r => r.Direction == TaxDirection.Rc) ? "11" : null;
    }

    private static (string? ValidNui, string? FallbackNui, string? VatNumber) PartnerNumbers(Partner? partner, bool isSales)
    {
        if (partner is null)
        {
            return (null, null, null);
        }

        var candidates = new[] { partner.TaxNumber, partner.FiscalNumber }
            .Select(n => n?.Trim())
            .Where(n => !string.IsNullOrEmpty(n))
            .Cast<string>()
            .ToList();

        var vatNumber = candidates.FirstOrDefault(n => VatNumberPattern().IsMatch(n));
        var nuiPattern = isSales ? SalesNuiPattern() : PurchaseNuiPattern();
        var nui = candidates.FirstOrDefault(n => nuiPattern.IsMatch(n));
        return (nui, candidates.FirstOrDefault(n => n != vatNumber), vatNumber);
    }

    [GeneratedRegex(@"^3\d{8}$")]
    private static partial Regex VatNumberPattern();

    [GeneratedRegex(@"^(81\d{7}|6\d{8})$")]
    private static partial Regex SalesNuiPattern();

    [GeneratedRegex(@"^(81\d{7}|6\d{8}|[12]\d{9})$")]
    private static partial Regex PurchaseNuiPattern();
}
