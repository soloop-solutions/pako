using ClosedXML.Excel;
using Pako.Domain.Tax;
using Pako.Localization.Xk;

namespace Pako.Api.Services;

public static class WithholdingTaxExportService
{
    public const int CountryListFirstRow = 4;
    public const int CountryListColumn = 21;

    public static readonly IReadOnlyList<string> Headers = new[]
    {
        "Nr. Rend",
        "NUI/ \nNumri Fiskal/ Numri personal",
        "Emri i biznesit/ \nEmri dhe Mbiemri i personit",
        "Interesi bruto i paguar",
        "Të drejtat pronësore të paguara",
        "Fitoret bruto në lotari të paguara",
        "Tatimi Mbajtur në Burim(TMB)",
        "Qiraja bruto e paguar \n(pa TVSH)",
        "Pagesa bruto për personin jo-rezident (zbavitës)",
        "Pagesa bruto për personin jo-rezident për shërbime",
        "TMB për personat jo-rezident ",
        "Pagesat bruto për personat fizik jo-afarist (kategori të veçanta)",
        "Hapësira e objektit të marr me qira në metra katror (m2) [plotësohet nese kutia 8>0]",
        "Vlera bruto e qirasë mujore (pa TVSH)\n[plotësohet nëse kutia 8>0]",
        "Shteti me të cilin keni transaksione"
    };

    public const string StandardWithholdingNumbering = "7=(4+5+6)*10% ose % sipas METD";
    public const string NonResidentWithholdingNumbering = "11=(9+10)*5% ose % sipas METD";

    private const int FirstDataRow = 3;

    public static byte[] BuildWorkbook(IReadOnlyList<WithholdingTaxEntry> entries, decimal standardRate, decimal nonResidentRate)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Sheet1");

        WriteHeader(sheet);
        WriteNumbering(sheet);
        WriteCountryList(sheet);

        for (var i = 0; i < entries.Count; i++)
        {
            WriteEntry(sheet, FirstDataRow + i, i + 1, entries[i], standardRate, nonResidentRate);
        }

        var lastCountryRow = CountryListFirstRow + AtkCountries.Names.Count - 1;
        var lastDataRow = Math.Max(FirstDataRow, FirstDataRow + entries.Count - 1);
        sheet.Range(FirstDataRow, 15, lastDataRow, 15).CreateDataValidation().List(
            sheet.Range(CountryListFirstRow, CountryListColumn, lastCountryRow, CountryListColumn), true);

        sheet.Column(1).Width = 9.109375;
        sheet.Columns(2, 14).Width = 14.6640625;
        sheet.Column(15).Width = 21.77734375;
        sheet.Column(CountryListColumn).Width = 9;

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    private static void WriteHeader(IXLWorksheet sheet)
    {
        sheet.Row(1).Height = 63;
        for (var col = 0; col < Headers.Count; col++)
        {
            var cell = sheet.Cell(1, col + 1);
            cell.Value = Headers[col];
            cell.Style.Font.FontName = "Segoe UI";
            cell.Style.Font.FontSize = 9;
            ApplyBox(cell, wrap: true);
        }
    }

    private static void WriteNumbering(IXLWorksheet sheet)
    {
        sheet.Row(2).Height = 20.4;
        for (var col = 1; col <= 15; col++)
        {
            var cell = sheet.Cell(2, col);
            switch (col)
            {
                case 7:
                    cell.Value = StandardWithholdingNumbering;
                    break;
                case 11:
                    cell.Value = NonResidentWithholdingNumbering;
                    break;
                default:
                    cell.Value = col;
                    break;
            }

            cell.Style.Font.FontName = "Calibri Light";
            cell.Style.Font.FontSize = 8;
            cell.Style.Fill.PatternType = XLFillPatternValues.Solid;
            cell.Style.Fill.BackgroundColor = XLColor.FromTheme(XLThemeColor.Background1, -0.0499893185216834);
            ApplyBox(cell, wrap: col == 7 || col == 11);
        }
    }

    private static void ApplyBox(IXLCell cell, bool wrap)
    {
        cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        cell.Style.Alignment.WrapText = wrap;
        cell.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
    }

    private static void WriteCountryList(IXLWorksheet sheet)
    {
        for (var i = 0; i < AtkCountries.Names.Count; i++)
        {
            var cell = sheet.Cell(CountryListFirstRow + i, CountryListColumn);
            cell.Value = AtkCountries.Names[i];
            cell.Style.Font.FontName = "Calibri Light";
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.NumberFormat.Format = "General\\,";
        }
    }

    private static void WriteEntry(
        IXLWorksheet sheet, int row, int sequence, WithholdingTaxEntry entry, decimal standardRate, decimal nonResidentRate)
    {
        sheet.Cell(row, 1).Value = sequence;
        WritePersonalNumber(sheet.Cell(row, 2), entry.PersonalNumber);

        var name = sheet.Cell(row, 3);
        name.Value = entry.Name;
        name.Style.Font.FontName = "Arial";
        name.Style.Font.FontSize = 10;
        name.Style.Font.FontColor = XLColor.FromHtml("#333333");
        name.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        name.Style.Alignment.WrapText = true;

        WriteAmount(sheet.Cell(row, 4), entry.GrossInterest);
        WriteAmount(sheet.Cell(row, 5), entry.PropertyRights);
        WriteAmount(sheet.Cell(row, 6), entry.LotteryWinnings);
        WriteAmount(sheet.Cell(row, 7), entry.WithheldTax(standardRate));
        WriteAmount(sheet.Cell(row, 8), entry.GrossRent);
        WriteAmount(sheet.Cell(row, 9), entry.NonResidentEntertainer);
        WriteAmount(sheet.Cell(row, 10), entry.NonResidentServices);
        WriteAmount(sheet.Cell(row, 11), entry.NonResidentWithheldTax(nonResidentRate));
        WriteAmount(sheet.Cell(row, 12), entry.NonEntrepreneur);
        if (entry.GrossRent > 0)
        {
            WriteAmount(sheet.Cell(row, 13), entry.RentalAreaM2 ?? 0m);
            WriteAmount(sheet.Cell(row, 14), entry.MonthlyGrossRent ?? 0m);
        }

        sheet.Cell(row, 15).Value = entry.Country;
    }

    private static void WritePersonalNumber(IXLCell cell, string personalNumber)
    {
        var trimmed = personalNumber.Trim();
        if (trimmed.Length is > 0 and <= 15 && trimmed[0] != '0' && trimmed.All(char.IsAsciiDigit))
        {
            cell.Value = long.Parse(trimmed);
        }
        else
        {
            cell.Value = trimmed;
        }
    }

    private static void WriteAmount(IXLCell cell, decimal amount)
    {
        if (amount != 0m) cell.Value = amount;
    }
}
