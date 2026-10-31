using ClosedXML.Excel;
using Pako.Api.Contracts;

namespace Pako.Api.Services;

public static class VatDeclarationWorkbook
{
    private const string AmountFormat = "#,##0.00";

    public static byte[] Build(
        string sheetName, ExportLabels labels, VatDeclarationResponse response, string? contactName, string? contactNumber)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add(sheetName.Length > 31 ? sheetName[..31] : sheetName);

        var row = 1;
        sheet.Cell(row, 1).Value = labels["VatDecl_Title"];
        sheet.Range(row, 1, row, 5).Merge().Style.Font.Bold = true;
        row += 2;

        sheet.Cell(row, 1).Value = "[1]";
        sheet.Cell(row, 2).Value = labels["VatDecl_Period"];
        sheet.Cell(row, 3).Value = response.Month;
        sheet.Cell(row, 4).Value = response.Year;
        row++;

        void Field(string number, string labelKey, string? value)
        {
            sheet.Cell(row, 1).Value = number;
            sheet.Cell(row, 2).Value = labels[labelKey];
            sheet.Cell(row, 3).Value = value ?? string.Empty;
            row++;
        }

        Field("[3]", "VatDecl_FiscalNumber", response.FiscalNumber);
        Field("[4]", "VatDecl_TaxpayerName", response.TaxpayerName);
        Field("[5]", "VatDecl_Address", response.Address);
        Field("[6]", "VatDecl_ContactName", contactName);
        Field("[7]", "VatDecl_ContactNumber", contactNumber);
        var noTransactions = response.Boxes.All(b => (b.Base ?? 0m) == 0m && (b.Vat ?? 0m) == 0m);
        Field("[8]", "VatDecl_NoTransactions", noTransactions ? "X" : null);
        row++;

        var headerRow = row;
        sheet.Cell(row, 1).Value = labels["VatDecl_Box"];
        sheet.Cell(row, 2).Value = labels["VatDecl_Description"];
        sheet.Cell(row, 3).Value = labels["VatDecl_Base"];
        sheet.Cell(row, 4).Value = labels["VatDecl_Box"];
        sheet.Cell(row, 5).Value = labels["VatDecl_Vat"];
        sheet.Range(row, 1, row, 5).Style.Font.Bold = true;
        row++;

        string? currentSection = null;
        foreach (var box in response.Boxes)
        {
            if (box.Section != currentSection)
            {
                currentSection = box.Section;
                sheet.Cell(row, 1).Value = labels["VatDecl_Section_" + box.Section];
                sheet.Range(row, 1, row, 5).Style.Font.Bold = true;
                row++;
            }

            sheet.Cell(row, 1).Value = "[" + box.Number + "]";
            sheet.Cell(row, 2).Value = box.Label;
            if (box.Base is { } baseAmount)
            {
                sheet.Cell(row, 3).Value = baseAmount;
                sheet.Cell(row, 3).Style.NumberFormat.Format = AmountFormat;
            }

            if (VatDeclarationLayout.VatBoxNumber(box) is { } vatNumber)
            {
                sheet.Cell(row, 4).Value = "[" + vatNumber + "]";
            }

            if (box.Vat is { } vatAmount)
            {
                sheet.Cell(row, 5).Value = vatAmount;
                sheet.Cell(row, 5).Style.NumberFormat.Format = AmountFormat;
            }

            row++;
        }

        sheet.Column(1).Width = 12;
        sheet.Column(2).Width = 70;
        sheet.Column(3).Width = 18;
        sheet.Column(4).Width = 12;
        sheet.Column(5).Width = 18;
        sheet.SheetView.FreezeRows(headerRow);

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }
}
