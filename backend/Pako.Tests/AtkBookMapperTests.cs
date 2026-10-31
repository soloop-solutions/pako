using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Tax;

namespace Pako.Tests;

public class AtkBookMapperTests
{
    private static readonly Guid PartnerId = Guid.NewGuid();

    private static Dictionary<Guid, Partner> Partners(string? taxNumber = "810111111") => new()
    {
        [PartnerId] = new Partner { Id = PartnerId, Name = "P", TaxNumber = taxNumber }
    };

    private static AtkTaxRow Row(
        string code, decimal rate, decimal net, TaxDirection direction, decimal? deductible,
        bool reverseCharge = false, TaxAtkBook book = TaxAtkBook.Blerje, string documentType = "Bill") =>
        new(Guid.NewGuid(), "D-1", new DateOnly(2026, 2, 1), PartnerId, code, rate, net, direction, deductible,
            reverseCharge, book, documentType);

    private static AtkTaxRow VatRow(
        decimal rate, decimal net, decimal vat, TaxDirection direction, decimal? deductible,
        TaxAtkBook book = TaxAtkBook.Blerje) =>
        new(Guid.NewGuid(), "D-1", new DateOnly(2026, 2, 1), PartnerId, "X", rate, net, direction, deductible,
            false, book, "Bill", vat);

    private static Pako.Domain.Reporting.VatBoxAmount Declared(AtkTaxRow row, string box) =>
        AtkBookMapper.DeclarationAmounts(Array.Empty<AtkTaxRow>(), new[] { row }).Single(a => a.Box == box);

    [Fact]
    public void Declaration_Bv50_PutsOnlyDeductibleShareOfVatOnBox43()
    {
        var amounts = AtkBookMapper.DeclarationAmounts(
            Array.Empty<AtkTaxRow>(), new[] { VatRow(0.18m, 1000m, 180m, TaxDirection.In, 50m) });

        var deductible = amounts.Single(a => a.Box == "43");
        Assert.Equal(500m, deductible.Net);
        Assert.Equal(90m, deductible.Vat);
        var nonDeductible = amounts.Single(a => a.Box == "33");
        Assert.Equal(500m, nonDeductible.Net);
        Assert.Equal(0m, nonDeductible.Vat);
    }

    [Fact]
    public void Declaration_Bv50_RoundsDeductibleVatAwayFromZero()
    {
        var amounts = AtkBookMapper.DeclarationAmounts(
            Array.Empty<AtkTaxRow>(), new[] { VatRow(0.18m, 555.61m, 100.01m, TaxDirection.In, 50m) });

        Assert.Equal(277.81m, amounts.Single(a => a.Box == "43").Net);
        Assert.Equal(50.01m, amounts.Single(a => a.Box == "43").Vat);
        Assert.Equal(277.8m, amounts.Single(a => a.Box == "33").Net);
    }

    [Fact]
    public void Declaration_SeventyPercent_PutsSeventyPercentOfVatOnBox43()
    {
        var amounts = AtkBookMapper.DeclarationAmounts(
            Array.Empty<AtkTaxRow>(), new[] { VatRow(0.18m, 1000m, 180m, TaxDirection.In, 70m) });

        Assert.Equal(700m, amounts.Single(a => a.Box == "43").Net);
        Assert.Equal(126m, amounts.Single(a => a.Box == "43").Vat);
        Assert.Equal(300m, amounts.Single(a => a.Box == "33").Net);
    }

    [Fact]
    public void Declaration_FullyDeductible_KeepsFullVat()
    {
        var amount = Declared(VatRow(0.18m, 1000m, 180m, TaxDirection.In, 100m), "43");

        Assert.Equal(1000m, amount.Net);
        Assert.Equal(180m, amount.Vat);
    }

    [Fact]
    public void Declaration_NonDeductible_HasNoDeductibleVat()
    {
        var amounts = AtkBookMapper.DeclarationAmounts(
            Array.Empty<AtkTaxRow>(), new[] { VatRow(0.18m, 1000m, 180m, TaxDirection.In, 0m) });

        var box = Assert.Single(amounts);
        Assert.Equal("33", box.Box);
        Assert.Equal(0m, box.Vat);
    }

    [Fact]
    public void Purchase_Rc18_LandsInBox65_AndGetsSpecialNumber8()
    {
        var book = AtkBookMapper.PurchaseBook(true, new[] { Row("RC18", 0.18m, 100m, TaxDirection.Rc, 100m, true) }, Partners());

        var doc = Assert.Single(book.Documents);
        Assert.Equal(100m, doc.Boxes["65"]);
        Assert.Equal("8", doc.Nui);
        Assert.Empty(book.Unplaced);
    }

    [Fact]
    public void Purchase_Rc00_LandsInBox31()
    {
        var book = AtkBookMapper.PurchaseBook(true, new[] { Row("RC00", 0m, 80m, TaxDirection.Rc, 0m, true) }, Partners());

        Assert.Equal(80m, Assert.Single(book.Documents).Boxes["31"]);
        Assert.Empty(book.Unplaced);
    }

    [Fact]
    public void Declaration_Bv50_PostedDeductibleVatOverridesTheShareComputation()
    {
        var row = VatRow(0.18m, 169.5m, 30.5m, TaxDirection.In, 50m) with { PostedDeductibleVat = 15.26m };

        Assert.Equal(15.26m, Declared(row, "43").Vat);
        Assert.Equal(0m, Declared(row, "33").Vat);
    }

    [Fact]
    public void Declaration_Bv50_WithoutPostedSplitFallsBackToShare()
    {
        var row = VatRow(0.18m, 169.5m, 30.5m, TaxDirection.In, 50m);

        Assert.Equal(15.25m, Declared(row, "43").Vat);
    }

    [Fact]
    public void Declaration_Bv50CreditNote_KeepsNegativePostedAmount()
    {
        var row = VatRow(0.18m, -169.5m, -30.5m, TaxDirection.In, 50m) with { PostedDeductibleVat = -15.24m };

        Assert.Equal(-15.24m, Declared(row, "43").Vat);
    }

    [Fact]
    public void Purchase_Bv50_SplitsNetBetweenBox43AndBox33()
    {
        var book = AtkBookMapper.PurchaseBook(true, new[] { Row("BV50", 0.18m, 101m, TaxDirection.In, 50m) }, Partners());

        var boxes = Assert.Single(book.Documents).Boxes;
        Assert.Equal(50.5m, boxes["43"]);
        Assert.Equal(50.5m, boxes["33"]);
        Assert.Empty(book.Unplaced);
    }

    [Fact]
    public void Purchase_PartiallyDeductible8Percent_SplitsBetweenBox45AndBox33()
    {
        var book = AtkBookMapper.PurchaseBook(true, new[] { Row("X08", 0.08m, 100m, TaxDirection.In, 25m) }, Partners());

        var boxes = Assert.Single(book.Documents).Boxes;
        Assert.Equal(25m, boxes["45"]);
        Assert.Equal(75m, boxes["33"]);
    }

    [Fact]
    public void Sales_DebitNote_LandsInBox16And18_OtherNotesStayInBaseBox()
    {
        var debit18 = Row("S18", 0.18m, 100m, TaxDirection.Out, null, book: TaxAtkBook.Shitje, documentType: "DebitNote");
        var debit08 = Row("S08", 0.08m, 40m, TaxDirection.Out, null, book: TaxAtkBook.Shitje, documentType: "DebitNote");
        var credit = Row("S18", 0.18m, -30m, TaxDirection.Out, null, book: TaxAtkBook.Shitje, documentType: "CreditNote");

        var book = AtkBookMapper.SalesBook(true, new[] { debit18, debit08, credit }, Array.Empty<AtkTaxRow>(), Partners());

        Assert.Equal(100m, book.Documents.Single(d => d.Boxes.ContainsKey("16")).Boxes["16"]);
        Assert.Equal(40m, book.Documents.Single(d => d.Boxes.ContainsKey("18")).Boxes["18"]);
        Assert.Equal(-30m, book.Documents.Single(d => d.Boxes.ContainsKey("12")).Boxes["12"]);
    }

    [Fact]
    public void Purchase_ImportSpecialNumber8_WinsOverPartnerNumber()
    {
        var book = AtkBookMapper.PurchaseBook(true, new[] { Row("I18", 0.18m, 100m, TaxDirection.Imp, 100m, book: TaxAtkBook.BlerjeImport) }, Partners("810111111"));

        Assert.Equal("8", Assert.Single(book.Documents).Nui);
    }

    [Fact]
    public void Sales_ExportOnlySpecialNumber3_WinsOverPartnerNumber_OrdinaryDocumentKeepsPartnerNumber()
    {
        var export = Row("SEXP", 0m, 100m, TaxDirection.Out, null, book: TaxAtkBook.Shitje);
        var ordinary = Row("S18", 0.18m, 100m, TaxDirection.Out, null, book: TaxAtkBook.Shitje);

        Assert.Equal("3", Assert.Single(AtkBookMapper.SalesBook(true, new[] { export }, Array.Empty<AtkTaxRow>(), Partners()).Documents).Nui);
        Assert.Equal("810111111", Assert.Single(AtkBookMapper.SalesBook(true, new[] { ordinary }, Array.Empty<AtkTaxRow>(), Partners()).Documents).Nui);
    }

    [Fact]
    public void Row_WithNoVatCode_IsKeptEmptyAndReportedUnplaced()
    {
        var taxless = new AtkTaxRow(Guid.NewGuid(), "D-2", new DateOnly(2026, 2, 1), PartnerId, string.Empty, 0m, 50m, null, null, false, null);

        var book = AtkBookMapper.SalesBook(true, new[] { taxless }, Array.Empty<AtkTaxRow>(), Partners());

        Assert.Empty(Assert.Single(book.Documents).Boxes);
        Assert.Single(book.Unplaced);
    }

    [Fact]
    public void Workbook_RoundsHalfAwayFromZero()
    {
        var doc = new AtkBookDocument(new DateOnly(2026, 2, 1), "X", "P", "810111111", null,
            new Dictionary<string, decimal> { ["12"] = 0.125m, ["14"] = -0.125m });

        using var workbook = new ClosedXML.Excel.XLWorkbook(new MemoryStream(AtkTaxBookWorkbook.BuildSales(true, new[] { doc })));
        var sheet = workbook.Worksheet(1);

        Assert.Equal(0.13m, sheet.Cell("M4").GetValue<decimal>());
        Assert.Equal(-0.13m, sheet.Cell("S4").GetValue<decimal>());
    }

    [Fact]
    public void Sales_Box28SpecialNumber6_WinsOverPartnerNumber()
    {
        var rc18 = Row("RC18", 0.18m, 100m, TaxDirection.Rc, 100m, true);

        var book = AtkBookMapper.SalesBook(true, Array.Empty<AtkTaxRow>(), new[] { rc18 }, Partners("810111111"));

        var doc = Assert.Single(book.Documents);
        Assert.Equal(100m, doc.Boxes["28"]);
        Assert.Equal("6", doc.Nui);
    }

    [Fact]
    public void Purchase_Rc00InBox31_GetsSpecialNumber8_OverPartnerNumber()
    {
        var book = AtkBookMapper.PurchaseBook(true, new[] { Row("RC00", 0m, 80m, TaxDirection.Rc, 0m, true) }, Partners("810111111"));

        var doc = Assert.Single(book.Documents);
        Assert.Equal(80m, doc.Boxes["31"]);
        Assert.Equal("8", doc.Nui);
    }
}
