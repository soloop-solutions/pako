using ClosedXML.Excel;
using Pako.Api.Services;

namespace Pako.Tests;

public class AtkTaxBookLayoutTests
{
    private static XLWorkbook Open(byte[] bytes) => new(new MemoryStream(bytes));

    private static IReadOnlyList<AtkBookDocument> OneDocument(string box, string otherBox) => new[]
    {
        new AtkBookDocument(
            new DateOnly(2026, 2, 1), "INV-1", "Customer Co", "810111111", "330000001",
            new Dictionary<string, decimal> { [box] = 100.126m, [otherBox] = 50m })
    };

    private static void AssertLayout(IXLWorksheet sheet, (string Cell, string Text)[] headers, string[] merges)
    {
        foreach (var (cell, text) in headers)
        {
            Assert.Equal(text, sheet.Cell(cell).GetString());
        }

        Assert.Equal(merges.OrderBy(m => m), sheet.MergedRanges.Select(r => r.RangeAddress.ToStringRelative()).OrderBy(m => m));
    }

    [Fact]
    public void Export_Matches_AtkSalesBookLayout()
    {
        var bytes = AtkTaxBookWorkbook.BuildSales(true, OneDocument("12", "14"));
        using var workbook = Open(bytes);
        var sheet = workbook.Worksheet(1);

        var headers = new[]
        {
            ("A1", "Nr."), ("B1", "Fatura"), ("D1", "Blerësi"), ("G1", "Shitjet e liruara nga TVSH"),
            ("M1", "Shitjet e tatueshme me normën 18%"), ("S1", "Shitjet e tatueshme me normën 8%"),
            ("X1", "Totali i TVSH-së së llogaritur me   18% dhe 8%"),
            ("B2", "Data"), ("C2", "Numri i faturës"), ("D2", "Emri i blerësit"), ("E2", "Numri Fiskal i blerësit"),
            ("F2", "Numri i TVSH-së së blerësit"), ("G2", "Shitjet e liruara pa të drejtë kreditimi"),
            ("H2", "Shitjet e shërbimeve jashtë vendit"),
            ("I2", "Shitjet brenda vendit me ngarkesë të kundërt  të TVSH-së"),
            ("J2", "Shitjet tjera të liruara me të drejtë kreditimi"),
            ("K2", "Totali i shitjeve të liruara me të drejtë kreditimi"), ("L2", "Eksportet"),
            ("M2", "Shitjet e tatueshme "), ("N2", "Nota debitore e lëshuar, nota kreditore e pranuar "),
            ("O2", "Fatura e borxhit të keq e pranuar"), ("P2", "Rregullimet për të rritur TVSH-në "),
            ("Q2", "Blerjet që i nënshtrohen ngarkesës së kundërt"),
            ("R2", "Totali i TVSH-së së llogaritur me normën 18%"), ("S2", "Shitjet e tatueshme"),
            ("T2", "Nota debitore e lëshuar, nota kreditore e pranuar "), ("U2", "Fatura e borxhit të keq e pranuar"),
            ("V2", "Rregullimet për të rritur TVSH-në "), ("W2", "Totali i TVSH-së së llogaritur me normën 8%"),
            ("A3", "Numri i kutisë në Deklaratën e TVSH-së"), ("G3", "[9]"), ("H3", "[10a]"), ("I3", "[10b]"),
            ("J3", "[10c]"), ("K3", "[10] = [10a]+[10b]+[10c]"), ("L3", "[11]"), ("M3", "[12]"), ("N3", "[16]"),
            ("O3", "[20]"), ("P3", "[24]"), ("Q3", "[28]"), ("R3", "[K1]"), ("S3", "[14]"), ("T3", "[18]"),
            ("U3", "[22]"), ("V3", "[26]"), ("W3", "[K2]"), ("X3", "[30]")
        };
        AssertLayout(sheet, headers, new[] { "A1:A2", "A3:F3", "B1:C1", "D1:F1", "G1:L1", "M1:R1", "S1:W1", "X1:X2" });
        Assert.Equal(16.5, sheet.Row(1).Height);
        Assert.Equal(75.0, sheet.Row(2).Height);
        Assert.Equal(12.75, sheet.Row(3).Height);
        Assert.Equal(31.7109375, sheet.Column("D").Width, 3);
        Assert.Equal(100.13m, sheet.Cell("M4").GetValue<decimal>());
        Assert.Equal(50m, sheet.Cell("S4").GetValue<decimal>());
        Assert.True(sheet.Cell("L4").IsEmpty());
        Assert.Equal("01.02.2026", sheet.Cell("B4").GetString());
        Assert.Equal("810111111", sheet.Cell("E4").GetString());
        Assert.Equal("330000001", sheet.Cell("F4").GetString());
        Assert.Equal("H4+I4+J4", sheet.Cell("K4").FormulaA1.TrimStart('='));
        Assert.Equal("(M4+N4+O4+P4+Q4)*18%", sheet.Cell("R4").FormulaA1.TrimStart('='));
        Assert.Equal("(S4+T4+U4+V4)*8%", sheet.Cell("W4").FormulaA1.TrimStart('='));
        Assert.Equal("R4+W4", sheet.Cell("X4").FormulaA1.TrimStart('='));
    }

    [Fact]
    public void Export_Matches_AtkPurchaseBookLayout()
    {
        var bytes = AtkTaxBookWorkbook.BuildPurchases(true, OneDocument("43", "45"));
        using var workbook = Open(bytes);
        var sheet = workbook.Worksheet(1);

        var headers = new[]
        {
            ("A1", "Nr."), ("B1", "Fatura"), ("D1", "Shitësi"),
            ("G1", "Blerjet dhe Importet e liruara dhe me TVSH jo të zbritshme"),
            ("K1", "Blerjet dhe Importet e tatushme me 18%, si dhe rregullimet e zbritjeve"),
            ("T1", "Blerjet dhe Importet e tatushme me 8%, si dhe rregullimet e zbritjeve"),
            ("AC1", "Totali i TVSH-së së zbritshme me 18% dhe 8%"),
            ("B2", "Data"), ("C2", "Numri i faturës"), ("D2", "Emri i shitësit"), ("E2", "Numri Fiskal i shitësit"),
            ("F2", "Numri i TVSH-së së shitësit"), ("G2", "Blerjet dhe importet pa TVSH"),
            ("H2", "Blerjet dhe importet investive pa TVSH"), ("I2", "Blerjet dhe importet me TVSH jo të zbritshme"),
            ("J2", "Blerjet dhe importet investive me TVSH jo të zbritshme"), ("K2", "Importet"),
            ("L2", "Importet investive  "), ("M2", "Blerjet vendore"), ("N2", "Blerjet investive vendore  "),
            ("O2", "Nota debitore e pranuar, nota kreditore e lëshuar "), ("P2", "Fatura e borxhit të keq e lëshuar "),
            ("Q2", "Rregullimet për të ulur TVSH-në për pagesë"),
            ("R2", "E drejta e kreditimit të TVSH-së në lidhje me Ngarkesën e Kundërt"),
            ("S2", "Totali i TVSH-së së  zbritshme me 18%"), ("T2", "Importet "), ("U2", "Importet investive "),
            ("V2", "Blerjet vendore"), ("W2", "Blerjet investive vendore"),
            ("X2", "Blerjet nga fermerët (aplikimi i normës së sheshtë)"),
            ("Y2", "Nota debitore e pranuar, nota kreditore e lëshuar "), ("Z2", "Fatura e borxhit të keq e lëshuar"),
            ("AA2", "Rregullimet për të ulur TVSH-në për pagesë"), ("AB2", "Totali i TVSH-së së  zbritshme me 8%"),
            ("A3", "Numri i kutisë në Deklaratën e TVSH-së"), ("G3", "[31]"), ("H3", "[32]"), ("I3", "[33]"),
            ("J3", "[34]"), ("K3", "[35]"), ("L3", "[39]"), ("M3", "[43]"), ("N3", "[47]"), ("O3", "[53]"),
            ("P3", "[57]"), ("Q3", "[61]"), ("R3", "[65]"), ("S3", "[K1]"), ("T3", "[37]"), ("U3", "[41]"),
            ("V3", "[45]"), ("W3", "[49]"), ("X3", "[51]"), ("Y3", "[55]"), ("Z3", "[59]"), ("AA3", "[63]"),
            ("AB3", "[K2]"), ("AC3", "[67] ")
        };
        AssertLayout(sheet, headers, new[] { "A1:A2", "A3:F3", "AC1:AC2", "B1:C1", "D1:F1", "G1:J1", "K1:S1", "T1:AB1" });
        Assert.Equal(16.5, sheet.Row(1).Height);
        Assert.Equal(76.9, sheet.Row(2).Height);
        Assert.Equal(15.75, sheet.Row(3).Height);
        Assert.Equal(27.7109375, sheet.Column("D").Width, 3);
        Assert.Equal(100.13m, sheet.Cell("M4").GetValue<decimal>());
        Assert.Equal(50m, sheet.Cell("V4").GetValue<decimal>());
        Assert.Equal("01.02.2026", sheet.Cell("B4").GetString());
        Assert.Equal("(K4+L4+M4+N4+O4+P4+Q4+R4)*18%", sheet.Cell("S4").FormulaA1.TrimStart('='));
        Assert.Equal("(T4+U4+V4+W4+X4+Y4+Z4+AA4)*8%", sheet.Cell("AB4").FormulaA1.TrimStart('='));
        Assert.Equal("S4+AB4", sheet.Cell("AC4").FormulaA1.TrimStart('='));
    }

    [Fact]
    public void Export_Matches_NonVatSalesBookLayout()
    {
        var bytes = AtkTaxBookWorkbook.BuildSales(false, OneDocument("a", "c"));
        using var workbook = Open(bytes);
        var sheet = workbook.Worksheet(1);

        var headers = new[]
        {
            ("A1", "Nr."), ("B1", "Fatura"), ("D1", "Blerësi"), ("F1", "Shitjet"), ("I1", "Shitjet totale"),
            ("B2", "Data"), ("C2", "Numri i faturës"), ("D2", "Emri i blerësit"),
            ("E2", "NRB (Numri i Regjistrimit të Biznesit)"),
            ("F2", "Shitjet e mallrave/shërbimeve brenda vendit"), ("G2", "Shitja e shërbimeve jashtë vendit"),
            ("H2", "Eksportet"), ("F3", "a"), ("G3", "b"), ("H3", "c"), ("I3", "d=a+b+c")
        };
        AssertLayout(sheet, headers, new[] { "A1:A3", "B1:C1", "B2:B3", "C2:C3", "D1:E1", "D2:D3", "E2:E3", "F1:H1", "I1:I2" });
        Assert.Equal(30.0, sheet.Row(1).Height);
        Assert.Equal(45.0, sheet.Row(2).Height);
        Assert.Equal(20.0, sheet.Row(3).Height);
        Assert.Equal(100.13m, sheet.Cell("F4").GetValue<decimal>());
        Assert.Equal(50m, sheet.Cell("H4").GetValue<decimal>());
        Assert.Equal("F4+G4+H4", sheet.Cell("I4").FormulaA1.TrimStart('='));
    }

    [Fact]
    public void Export_Matches_NonVatPurchaseBookLayout()
    {
        var bytes = AtkTaxBookWorkbook.BuildPurchases(false, OneDocument("a", "d"));
        using var workbook = Open(bytes);
        var sheet = workbook.Worksheet(1);

        var headers = new[]
        {
            ("A1", "Nr."), ("B1", "Fatura"), ("D1", "Shitësi"), ("F1", "Blerje vendore"), ("I1", "Importe"),
            ("L1", "Blerjet totale"),
            ("B2", "Data"), ("C2", "Numri i faturës"), ("D2", "Emri i shitësit"),
            ("E2", "NRB (Numri i Regjistrimit të Biznesit)"), ("F2", "Blerje e mallrave / shërbimeve"),
            ("G2", "Blerje për shpenzime"), ("H2", "Blerje investive"), ("I2", "Importe të mallrave"),
            ("J2", "Importe investive"), ("K2", "Blerje të shërbimeve jashtë vendit"),
            ("F3", "a"), ("G3", "b"), ("H3", "c"), ("I3", "d"), ("J3", "e"), ("K3", "f"), ("L3", "g=a+b+c+d+e+f")
        };
        AssertLayout(sheet, headers, new[] { "A1:A3", "B1:C1", "B2:B3", "C2:C3", "D1:E1", "D2:D3", "E2:E3", "F1:H1", "I1:K1", "L1:L2" });
        Assert.Equal(30.0, sheet.Row(1).Height);
        Assert.Equal(45.0, sheet.Row(2).Height);
        Assert.Equal(20.0, sheet.Row(3).Height);
        Assert.Equal(100.13m, sheet.Cell("F4").GetValue<decimal>());
        Assert.Equal(50m, sheet.Cell("I4").GetValue<decimal>());
        Assert.Equal("F4+G4+H4+I4+J4+K4", sheet.Cell("L4").FormulaA1.TrimStart('='));
    }

    [Fact]
    public void Export_EmptyBook_WritesNilRowWithZeroIdentifier()
    {
        using var workbook = Open(AtkTaxBookWorkbook.BuildSales(true, Array.Empty<AtkBookDocument>()));
        var sheet = workbook.Worksheet(1);

        Assert.Equal("0", sheet.Cell("E4").GetString());
        Assert.Equal(1, sheet.Cell("A4").GetValue<int>());
    }
}
