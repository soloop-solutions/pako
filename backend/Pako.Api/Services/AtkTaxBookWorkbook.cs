using ClosedXML.Excel;

namespace Pako.Api.Services;

public record AtkBookDocument(
    DateOnly Date, string? Number, string PartnerName, string? Nui, string? VatNumber,
    IReadOnlyDictionary<string, decimal> Boxes);

public static class AtkTaxBookWorkbook
{
    private sealed record SheetSpec(
        (string Cell, string Text)[] Headers,
        string[] Merges,
        (string Column, double Width)[] Widths,
        double[] HeaderRowHeights,
        double? DataRowHeight,
        (string Box, int Column)[] BoxColumns,
        (int Column, string Template)[] Formulas,
        int LastColumn,
        bool IsVat,
        string[] ShadedCells);

    private static readonly SheetSpec SalesVat = new(
        new[]
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
        },
        new[] { "A1:A2", "A3:F3", "B1:C1", "D1:F1", "G1:L1", "M1:R1", "S1:W1", "X1:X2" },
        new[]
        {
            ("A", 5.28515625), ("B", 11.42578125), ("C", 9.140625), ("D", 31.7109375), ("E", 11.28515625),
            ("F", 11.5703125), ("G", 12.7109375), ("I", 14.42578125), ("J", 12.7109375), ("K", 16.5703125),
            ("L", 12.7109375), ("S", 11.28515625), ("T", 12.7109375), ("X", 11.7109375), ("Y", 9.140625)
        },
        new[] { 16.5, 75.0, 12.75 },
        null,
        new[]
        {
            ("9", 7), ("10a", 8), ("10b", 9), ("10c", 10), ("11", 12), ("12", 13), ("16", 14), ("20", 15),
            ("24", 16), ("28", 17), ("14", 19), ("18", 20), ("22", 21), ("26", 22)
        },
        new[]
        {
            (11, "=H{r}+I{r}+J{r}"), (18, "=(M{r}+N{r}+O{r}+P{r}+Q{r})*18%"),
            (23, "=(S{r}+T{r}+U{r}+V{r})*8%"), (24, "=R{r}+W{r}")
        },
        24,
        true,
        new[] { "K2", "R2", "W2", "X1" });

    private static readonly SheetSpec PurchaseVat = new(
        new[]
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
        },
        new[] { "A1:A2", "A3:F3", "AC1:AC2", "B1:C1", "D1:F1", "G1:J1", "K1:S1", "T1:AB1" },
        new[]
        {
            ("A", 4.28515625), ("B", 10.0), ("C", 17.7109375), ("D", 27.7109375), ("E", 13.5703125),
            ("F", 11.42578125), ("G", 13.0), ("K", 11.140625), ("L", 9.0), ("M", 13.7109375), ("N", 11.7109375),
            ("O", 8.140625), ("P", 7.140625), ("Q", 8.7109375), ("R", 9.0), ("S", 12.5703125), ("T", 10.0),
            ("V", 13.28515625), ("AB", 11.7109375), ("AC", 14.140625)
        },
        new[] { 16.5, 76.9, 15.75 },
        null,
        new[]
        {
            ("31", 7), ("32", 8), ("33", 9), ("34", 10), ("35", 11), ("39", 12), ("43", 13), ("47", 14),
            ("53", 15), ("57", 16), ("61", 17), ("65", 18), ("37", 20), ("41", 21), ("45", 22), ("49", 23),
            ("51", 24), ("55", 25), ("59", 26), ("63", 27)
        },
        new[]
        {
            (19, "=(K{r}+L{r}+M{r}+N{r}+O{r}+P{r}+Q{r}+R{r})*18%"),
            (28, "=(T{r}+U{r}+V{r}+W{r}+X{r}+Y{r}+Z{r}+AA{r})*8%"), (29, "=S{r}+AB{r}")
        },
        29,
        true,
        new[] { "S2", "AB2", "AC1" });

    private static readonly SheetSpec SalesNonVat = new(
        new[]
        {
            ("A1", "Nr."), ("B1", "Fatura"), ("D1", "Blerësi"), ("F1", "Shitjet"), ("I1", "Shitjet totale"),
            ("B2", "Data"), ("C2", "Numri i faturës"), ("D2", "Emri i blerësit"),
            ("E2", "NRB (Numri i Regjistrimit të Biznesit)"),
            ("F2", "Shitjet e mallrave/shërbimeve brenda vendit"), ("G2", "Shitja e shërbimeve jashtë vendit"),
            ("H2", "Eksportet"), ("F3", "a"), ("G3", "b"), ("H3", "c"), ("I3", "d=a+b+c")
        },
        new[] { "A1:A3", "B1:C1", "B2:B3", "C2:C3", "D1:E1", "D2:D3", "E2:E3", "F1:H1", "I1:I2" },
        new[] { ("A", 5.0), ("B", 12.0), ("C", 16.0), ("D", 28.0), ("E", 35.0), ("F", 16.0), ("G", 16.0), ("H", 16.0), ("I", 16.0) },
        new[] { 30.0, 45.0, 20.0 },
        18.0,
        new[] { ("a", 6), ("b", 7), ("c", 8) },
        new[] { (9, "=F{r}+G{r}+H{r}") },
        9,
        false,
        Array.Empty<string>());

    private static readonly SheetSpec PurchaseNonVat = new(
        new[]
        {
            ("A1", "Nr."), ("B1", "Fatura"), ("D1", "Shitësi"), ("F1", "Blerje vendore"), ("I1", "Importe"),
            ("L1", "Blerjet totale"),
            ("B2", "Data"), ("C2", "Numri i faturës"), ("D2", "Emri i shitësit"),
            ("E2", "NRB (Numri i Regjistrimit të Biznesit)"), ("F2", "Blerje e mallrave / shërbimeve"),
            ("G2", "Blerje për shpenzime"), ("H2", "Blerje investive"), ("I2", "Importe të mallrave"),
            ("J2", "Importe investive"), ("K2", "Blerje të shërbimeve jashtë vendit"),
            ("F3", "a"), ("G3", "b"), ("H3", "c"), ("I3", "d"), ("J3", "e"), ("K3", "f"), ("L3", "g=a+b+c+d+e+f")
        },
        new[] { "A1:A3", "B1:C1", "B2:B3", "C2:C3", "D1:E1", "D2:D3", "E2:E3", "F1:H1", "I1:K1", "L1:L2" },
        new[]
        {
            ("A", 5.0), ("B", 12.0), ("C", 16.0), ("D", 28.0), ("E", 35.0), ("F", 14.0), ("G", 14.0),
            ("H", 14.0), ("I", 14.0), ("J", 14.0), ("K", 16.0), ("L", 16.0)
        },
        new[] { 30.0, 45.0, 20.0 },
        18.0,
        new[] { ("a", 6), ("b", 7), ("c", 8), ("d", 9), ("e", 10), ("f", 11) },
        new[] { (12, "=F{r}+G{r}+H{r}+I{r}+J{r}+K{r}") },
        12,
        false,
        Array.Empty<string>());

    public static byte[] BuildSales(bool vatRegistered, IReadOnlyList<AtkBookDocument> documents) =>
        Build(vatRegistered ? SalesVat : SalesNonVat, documents);

    public static byte[] BuildPurchases(bool vatRegistered, IReadOnlyList<AtkBookDocument> documents) =>
        Build(vatRegistered ? PurchaseVat : PurchaseNonVat, documents);

    private static byte[] Build(SheetSpec spec, IReadOnlyList<AtkBookDocument> documents)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Sheet1");

        foreach (var (column, width) in spec.Widths)
        {
            sheet.Column(column).Width = width;
        }

        for (var i = 0; i < spec.HeaderRowHeights.Length; i++)
        {
            sheet.Row(i + 1).Height = spec.HeaderRowHeights[i];
        }

        var header = sheet.Range(1, 1, 3, spec.LastColumn);
        header.Style.Font.FontName = spec.IsVat ? "Arial Narrow" : "Calibri";
        header.Style.Font.FontSize = spec.IsVat ? 9.5 : 10;
        header.Style.Font.Bold = !spec.IsVat;
        header.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        header.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        header.Style.Alignment.WrapText = true;
        header.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        header.Style.Border.OutsideBorder = spec.IsVat ? XLBorderStyleValues.Medium : XLBorderStyleValues.Thin;
        header.Style.Fill.BackgroundColor = XLColor.FromHtml("#E7E6E6");

        foreach (var (cell, text) in spec.Headers)
        {
            sheet.Cell(cell).Value = text;
        }

        if (spec.IsVat)
        {
            foreach (var (cell, _) in spec.Headers)
            {
                if (cell.EndsWith('1') && cell != "A1" && !spec.ShadedCells.Contains(cell))
                {
                    sheet.Cell(cell).Style.Font.Bold = true;
                    sheet.Cell(cell).Style.Font.FontSize = 12;
                }
            }
        }

        foreach (var merge in spec.Merges)
        {
            sheet.Range(merge).Merge();
        }

        foreach (var cell in spec.ShadedCells)
        {
            sheet.Cell(cell).Style.Fill.BackgroundColor = XLColor.FromHtml("#EAF0F6");
        }

        var boxColumns = spec.BoxColumns.ToDictionary(b => b.Box, b => b.Column);
        var nil = documents.Count == 0;
        var rows = nil
            ? new List<AtkBookDocument> { new(default, null, string.Empty, "0", null, new Dictionary<string, decimal>()) }
            : documents.ToList();

        for (var i = 0; i < rows.Count; i++)
        {
            var r = i + 4;
            var doc = rows[i];

            if (spec.DataRowHeight is { } height)
            {
                sheet.Row(r).Height = height;
            }

            sheet.Cell(r, 1).Value = i + 1;
            if (!nil)
            {
                sheet.Cell(r, 2).Value = doc.Date.ToString("dd.MM.yyyy");
                sheet.Cell(r, 3).Value = doc.Number ?? string.Empty;
                sheet.Cell(r, 4).Value = doc.PartnerName;
            }

            sheet.Cell(r, 5).Value = doc.Nui ?? string.Empty;
            if (spec.IsVat && doc.VatNumber is not null)
            {
                sheet.Cell(r, 6).Value = doc.VatNumber;
            }

            foreach (var (box, amount) in doc.Boxes)
            {
                if (boxColumns.TryGetValue(box, out var column) && amount != 0m)
                {
                    sheet.Cell(r, column).Value = Math.Round(amount, 2, MidpointRounding.AwayFromZero);
                }
            }

            foreach (var (column, template) in spec.Formulas)
            {
                sheet.Cell(r, column).FormulaA1 = template.Replace("{r}", r.ToString());
            }

            if (!spec.IsVat)
            {
                var dataRow = sheet.Range(r, 1, r, spec.LastColumn);
                dataRow.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
                dataRow.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
                dataRow.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
                sheet.Range(r, 6, r, spec.LastColumn).Style.NumberFormat.Format = "#,##0.00";
            }
        }

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }
}
