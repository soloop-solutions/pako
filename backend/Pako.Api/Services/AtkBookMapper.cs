using System.Text.RegularExpressions;
using Pako.Domain.Companies;
using Pako.Domain.Tax;

namespace Pako.Api.Services;

public record AtkUnplaced(string? DocumentNumber, DateOnly Date, string VatCode, decimal NetAmount);

public record AtkBookResult(List<AtkBookDocument> Documents, List<AtkUnplaced> Unplaced);

public record AtkTaxRow(
    Guid DocumentId, string? DocumentNumber, DateOnly IssueDate, Guid PartnerId, string VatCode, decimal Rate,
    decimal NetAmount, TaxDirection? Direction, decimal? DeductiblePercent, bool IsReverseCharge, TaxAtkBook? AtkBook,
    string DocumentType = "");

public static partial class AtkBookMapper
{
    // Code -> ATK box (net base). Explicit guide rules unless marked (inferred).
    // Sales (VAT):      S18 -> 12 | S08 -> 14 | S00 -> 10c (inferred) | SEXP -> 11 | SEX -> 9
    //                   SRC (reverse charge) -> 10b | RC18 on a purchase bill -> 28 on a sales-book row for that bill
    //                   DebitNote documents: 18% -> 16, 8% -> 18 (inferred from the box definitions)
    // Purchases (VAT):  B18 -> 43 | B08 -> 45 | INV 18% -> 47 | INV 8% -> 49 | B00, BEX, IEX -> 31
    //                   BND, IND (VAT not deductible) -> 33 | I18 -> 35 | I08 -> 37 | RC18 -> 65
    //                   RC00 -> 31 (inferred: 0% line, no VAT)
    //                   Partially deductible 18%/8% codes (BV50): net split by DeductiblePercent into the
    //                   deductible box (43/45, 35/37 imports, 47/49 investment) and 33 (34 for investment) (inferred)
    // Credit notes and returns (sales CreditNote/SalesReturn, every purchase credit note/return) get no own
    // box: they follow their VAT code into the ordinary base box with a negative sign (open ATK question).
    // Never filled (no source data): 10a, 16/18 for non-debit-note documents, 20, 22, 24, 26, 32, 39, 41, 51,
    // 53, 55, 57, 59, 61, 63. Special NUI numbers never emitted: 1, 2, 4, 5, 7, 9, 10, 11.
    // Rows with no placement (no VAT-coded line on a VAT book, 8% codes with no 8% box, unknown codes) are
    // kept as rows with empty boxes and reported via X-Atk-Unplaced.
    // Non-VAT sales:    SEXP -> c, everything else sold domestically (incl. untaxed documents) -> a
    // Non-VAT purchases: INV -> c, Imp direction -> d, Rc direction -> f, everything else -> a
    private static List<(string Box, decimal Amount)> SalesVatBoxes(AtkTaxRow row)
    {
        if (row.Direction != TaxDirection.Out)
        {
            return new();
        }

        if (row.IsReverseCharge)
        {
            return One("10b", row.NetAmount);
        }

        if (row.DocumentType == nameof(Pako.Domain.Invoicing.DocumentType.DebitNote) && row.Rate == 0.18m)
        {
            return One("16", row.NetAmount);
        }

        if (row.DocumentType == nameof(Pako.Domain.Invoicing.DocumentType.DebitNote) && row.Rate == 0.08m)
        {
            return One("18", row.NetAmount);
        }

        var box = row.VatCode switch
        {
            "SEXP" => "11",
            "SEX" => "9",
            "S00" => "10c",
            _ when row.Rate == 0.18m => "12",
            _ when row.Rate == 0.08m => "14",
            _ => null
        };
        return box is null ? new() : One(box, row.NetAmount);
    }

    private static List<(string Box, decimal Amount)> PurchaseVatBoxes(AtkTaxRow row)
    {
        var deductible = row.DeductiblePercent;
        var net = row.NetAmount;

        if (row.Direction == TaxDirection.Rc)
        {
            if (row.Rate == 0m)
            {
                return One("31", net);
            }

            return row.Rate == 0.18m && deductible == 100m ? One("65", net) : new();
        }

        if (row.Direction is not (TaxDirection.In or TaxDirection.Imp))
        {
            return new();
        }

        if (row.Rate == 0m)
        {
            return One("31", net);
        }

        if (row.Rate is not (0.18m or 0.08m) || deductible is null or < 0m or > 100m)
        {
            return new();
        }

        var investment = row.AtkBook == TaxAtkBook.BlerjeInvestime;
        var import = row.Direction == TaxDirection.Imp;
        var eighteen = row.Rate == 0.18m;
        var deductibleBox = investment
            ? (import ? null : eighteen ? "47" : "49")
            : import ? (eighteen ? "35" : "37") : (eighteen ? "43" : "45");
        var nonDeductibleBox = investment ? "34" : "33";

        if (deductible == 100m)
        {
            return deductibleBox is null ? new() : One(deductibleBox, net);
        }

        if (deductible == 0m)
        {
            return One(nonDeductibleBox, net);
        }

        if (deductibleBox is null)
        {
            return new();
        }

        var deductiblePart = Math.Round(net * deductible.Value / 100m, 2, MidpointRounding.AwayFromZero);
        return new() { (deductibleBox, deductiblePart), (nonDeductibleBox, net - deductiblePart) };
    }

    private static List<(string Box, decimal Amount)> SalesNonVatBoxes(AtkTaxRow row) =>
        row.Direction is null or TaxDirection.None or TaxDirection.Out
            ? One(row.VatCode == "SEXP" ? "c" : "a", row.NetAmount)
            : new();

    private static List<(string Box, decimal Amount)> PurchaseNonVatBoxes(AtkTaxRow row) => One(row.Direction switch
    {
        TaxDirection.Imp => "d",
        TaxDirection.Rc => "f",
        _ when row.AtkBook == TaxAtkBook.BlerjeInvestime => "c",
        _ => "a"
    }, row.NetAmount);

    private static List<(string Box, decimal Amount)> One(string box, decimal amount) => new() { (box, amount) };

    public static AtkBookResult SalesBook(
        bool vatRegistered, IEnumerable<AtkTaxRow> salesRows, IEnumerable<AtkTaxRow> purchaseRows,
        IReadOnlyDictionary<Guid, Partner> partners)
    {
        var mapped = salesRows
            .Select(row => (Row: row, Boxes: vatRegistered ? SalesVatBoxes(row) : SalesNonVatBoxes(row)))
            .ToList();

        if (vatRegistered)
        {
            mapped.AddRange(purchaseRows
                .Where(r => r.Direction == TaxDirection.Rc && r.IsReverseCharge && r.Rate == 0.18m)
                .Select(row => (Row: row, Boxes: One("28", row.NetAmount))));
        }

        return Pivot(mapped, partners, isSales: true);
    }

    public static AtkBookResult PurchaseBook(
        bool vatRegistered, IEnumerable<AtkTaxRow> purchaseRows, IReadOnlyDictionary<Guid, Partner> partners)
    {
        var mapped = purchaseRows
            .Select(row => (Row: row, Boxes: vatRegistered ? PurchaseVatBoxes(row) : PurchaseNonVatBoxes(row)))
            .ToList();

        return Pivot(mapped, partners, isSales: false);
    }

    private static AtkBookResult Pivot(
        List<(AtkTaxRow Row, List<(string Box, decimal Amount)> Boxes)> mapped,
        IReadOnlyDictionary<Guid, Partner> partners, bool isSales)
    {
        var unplaced = mapped
            .Where(m => m.Boxes.Count == 0)
            .Select(m => new AtkUnplaced(m.Row.DocumentNumber, m.Row.IssueDate, m.Row.VatCode, m.Row.NetAmount))
            .ToList();

        var documents = mapped
            .GroupBy(m => m.Row.DocumentId)
            .Select(g =>
            {
                var first = g.First().Row;
                var boxes = g.SelectMany(m => m.Boxes)
                    .GroupBy(b => b.Box)
                    .ToDictionary(b => b.Key, b => b.Sum(x => x.Amount));
                var partner = partners.GetValueOrDefault(first.PartnerId);
                var (validNui, fallbackNui, vatNumber) = PartnerNumbers(partner, isSales);
                var rows = g.Select(m => m.Row).ToList();
                var nui = OverridingNumber(rows, boxes, isSales) ?? validNui ?? fallbackNui;
                return new AtkBookDocument(
                    first.IssueDate, first.DocumentNumber, partner?.Name ?? string.Empty, nui, vatNumber, boxes);
            })
            .OrderBy(d => d.Date).ThenBy(d => d.Number, StringComparer.Ordinal)
            .ToList();

        return new AtkBookResult(documents, unplaced);
    }

    private static string? OverridingNumber(List<AtkTaxRow> rows, Dictionary<string, decimal> boxes, bool isSales)
    {
        if (isSales)
        {
            if (boxes.Count == 0)
            {
                return null;
            }

            return boxes.Keys.All(k => k is "11" or "c") ? "3" : boxes.Keys.All(k => k == "28") ? "6" : null;
        }

        return rows.Any(r => r.Direction is TaxDirection.Imp or TaxDirection.Rc) || boxes.ContainsKey("65") ? "8" : null;
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
