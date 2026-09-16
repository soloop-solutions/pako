using ClosedXML.Excel;

namespace Pako.Api.Services;

// B11: the one shared XLSX writer every report export goes through — no ATK-mandated column
// order is documented anywhere in this repo (checked docs/ODOO_COMPARISON.md,
// docs/COA_V2_IMPLEMENTATION_BRIEF.md, docs/BACKEND_BRIEF.md, the 20_VAT_Codes/PAKO_COA_v2_seed
// CSVs — none specify one), so each export endpoint's column choice mirrors its own response
// DTO's field order, the most defensible default absent a real spec. Confirm against ATK's actual
// required layout before this goes live for filing.
public static class ExcelExportService
{
    // Shared by every export action's [Produces] attribute (so NSwag generates a blob-returning
    // client method instead of a bare void) and its File(...) call, so the two can't drift apart.
    public const string XlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public static byte[] BuildWorkbook(string sheetName, IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<object?>> rows)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add(SanitizeSheetName(sheetName));

        for (var col = 0; col < headers.Count; col++)
        {
            var cell = sheet.Cell(1, col + 1);
            cell.Value = headers[col];
            cell.Style.Font.Bold = true;
        }

        for (var row = 0; row < rows.Count; row++)
        {
            var rowValues = rows[row];
            for (var col = 0; col < rowValues.Count; col++)
            {
                WriteCell(sheet.Cell(row + 2, col + 1), rowValues[col]);
            }
        }

        sheet.SheetView.FreezeRows(1);
        sheet.Columns(1, Math.Max(headers.Count, 1)).AdjustToContents();

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    private static void WriteCell(IXLCell cell, object? value)
    {
        switch (value)
        {
            case null:
                break;
            case string s:
                cell.Value = s;
                break;
            case DateOnly d:
                cell.Value = d.ToDateTime(TimeOnly.MinValue);
                cell.Style.DateFormat.Format = "yyyy-mm-dd";
                break;
            case DateTime dt:
                cell.Value = dt;
                cell.Style.DateFormat.Format = "yyyy-mm-dd";
                break;
            case decimal dec:
                cell.Value = dec;
                cell.Style.NumberFormat.Format = "#,##0.00";
                break;
            case int i:
                cell.Value = i;
                break;
            case bool b:
                cell.Value = b;
                break;
            default:
                cell.Value = value.ToString();
                break;
        }
    }

    // Excel worksheet names: max 31 chars, no \ / ? * [ ] : characters.
    private static string SanitizeSheetName(string name)
    {
        var sanitized = new string(name.Where(c => c is not ('\\' or '/' or '?' or '*' or '[' or ']' or ':')).ToArray());
        return sanitized.Length > 31 ? sanitized[..31] : sanitized;
    }
}
