using Pako.Api.Contracts;
using Pako.Domain.Reporting;

namespace Pako.Api.Services;

public static class VatDeclarationLayout
{
    public const string SalesSection = "Sales";
    public const string PurchasesSection = "Purchases";
    public const string CalculationSection = "Calculation";

    private enum Cells { Base, Pair, Vat }

    private static readonly (string Number, string Section, Cells Cells)[] Form =
    {
        ("9", SalesSection, Cells.Base), ("10", SalesSection, Cells.Base), ("11", SalesSection, Cells.Base),
        ("12", SalesSection, Cells.Pair), ("14", SalesSection, Cells.Pair), ("16", SalesSection, Cells.Pair),
        ("18", SalesSection, Cells.Pair), ("20", SalesSection, Cells.Pair), ("22", SalesSection, Cells.Pair),
        ("24", SalesSection, Cells.Pair), ("26", SalesSection, Cells.Pair), ("28", SalesSection, Cells.Pair),
        ("30", SalesSection, Cells.Vat),
        ("31", PurchasesSection, Cells.Base), ("32", PurchasesSection, Cells.Base),
        ("33", PurchasesSection, Cells.Base), ("34", PurchasesSection, Cells.Base),
        ("35", PurchasesSection, Cells.Pair), ("37", PurchasesSection, Cells.Pair), ("39", PurchasesSection, Cells.Pair),
        ("41", PurchasesSection, Cells.Pair), ("43", PurchasesSection, Cells.Pair), ("45", PurchasesSection, Cells.Pair),
        ("47", PurchasesSection, Cells.Pair), ("49", PurchasesSection, Cells.Pair), ("51", PurchasesSection, Cells.Pair),
        ("53", PurchasesSection, Cells.Pair), ("55", PurchasesSection, Cells.Pair), ("57", PurchasesSection, Cells.Pair),
        ("59", PurchasesSection, Cells.Pair), ("61", PurchasesSection, Cells.Pair), ("63", PurchasesSection, Cells.Pair),
        ("65", PurchasesSection, Cells.Pair),
        ("67", PurchasesSection, Cells.Vat),
        ("68", CalculationSection, Cells.Vat), ("69", CalculationSection, Cells.Vat),
        ("70", CalculationSection, Cells.Vat), ("71", CalculationSection, Cells.Vat),
        ("72", CalculationSection, Cells.Vat)
    };

    public static List<VatDeclarationBox> Build(VatDeclarationResult result, Func<string, string> label)
    {
        decimal Net(string box) => result.Boxes.GetValueOrDefault(box)?.Net ?? 0m;
        decimal Vat(string box) => result.Boxes.GetValueOrDefault(box)?.Vat ?? 0m;

        decimal Single(string number) => number switch
        {
            "30" => result.TotalVatCalculated,
            "67" => result.TotalVatDeductible,
            "68" => result.CarriedCredit,
            "69" => result.RemainingCredit,
            "70" => result.RefundRequested,
            "71" => result.CreditForNextPeriod,
            _ => result.VatPayable
        };

        return Form.Select(f => new VatDeclarationBox(
            f.Number, f.Section, label("VatDecl_B" + f.Number),
            f.Cells == Cells.Vat ? null : Net(f.Number),
            f.Cells switch
            {
                Cells.Pair => Vat(f.Number),
                Cells.Vat => Single(f.Number),
                _ => null
            })).ToList();
    }

    public static string? VatBoxNumber(VatDeclarationBox box) =>
        box.Vat is null || box.Base is null ? null : (int.Parse(box.Number) + 1).ToString();
}
