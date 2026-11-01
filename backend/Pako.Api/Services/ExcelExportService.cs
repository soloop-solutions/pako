using ClosedXML.Excel;

namespace Pako.Api.Services;

// B11: the one shared XLSX writer every report export goes through — no ATK-mandated column
// order is documented anywhere in this repo (checked docs/ODOO_COMPARISON.md,
// docs/COA_V2_IMPLEMENTATION_BRIEF.md, docs/BACKEND_BRIEF.md, the 20_VAT_Codes/PAKO_COA_v2_seed
// CSVs — none specify one), so each export endpoint's column choice mirrors its own response
// DTO's field order, the most defensible default absent a real spec. Confirm against ATK's actual
// required layout before this goes live for filing.
public record ExportSheet(
    string Name, IReadOnlyList<(string Label, object? Value)>? HeaderBlock, IReadOnlyList<string> Headers, IReadOnlyList<IReadOnlyList<object?>> Rows);

public static class ExcelExportService
{
    // Shared by every export action's [Produces] attribute (so NSwag generates a blob-returning
    // client method instead of a bare void) and its File(...) call, so the two can't drift apart.
    public const string XlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public static byte[] BuildWorkbook(string sheetName, IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<object?>> rows) =>
        BuildWorkbook(sheetName, null, headers, rows);

    public static byte[] BuildWorkbook(
        string sheetName, IReadOnlyList<(string Label, object? Value)>? headerBlock, IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<object?>> rows) =>
        BuildWorkbook(new[] { new ExportSheet(sheetName, headerBlock, headers, rows) });

    public static byte[] BuildWorkbook(IReadOnlyList<ExportSheet> sheets)
    {
        using var workbook = new XLWorkbook();
        foreach (var spec in sheets)
        {
            WriteSheet(workbook, spec);
        }

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    private static void WriteSheet(XLWorkbook workbook, ExportSheet spec)
    {
        var sheet = workbook.Worksheets.Add(SanitizeSheetName(spec.Name));
        var headerBlock = spec.HeaderBlock;
        var headers = spec.Headers;
        var rows = spec.Rows;

        var top = 0;
        if (headerBlock is { Count: > 0 })
        {
            foreach (var (label, value) in headerBlock)
            {
                top++;
                sheet.Cell(top, 1).Value = label;
                sheet.Cell(top, 1).Style.Font.Bold = true;
                WriteCell(sheet.Cell(top, 2), value);
            }

            top++;
        }

        for (var col = 0; col < headers.Count; col++)
        {
            var cell = sheet.Cell(top + 1, col + 1);
            cell.Value = headers[col];
            cell.Style.Font.Bold = true;
        }

        for (var row = 0; row < rows.Count; row++)
        {
            var rowValues = rows[row];
            for (var col = 0; col < rowValues.Count; col++)
            {
                WriteCell(sheet.Cell(top + row + 2, col + 1), rowValues[col]);
            }
        }

        sheet.SheetView.FreezeRows(top + 1);
        sheet.Columns(1, Math.Max(headers.Count, 1)).AdjustToContents();
    }

    private static string DateFormat() =>
        System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "sq" ? "dd.mm.yyyy" : "yyyy-mm-dd";

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
                cell.Style.DateFormat.Format = DateFormat();
                break;
            case DateTime dt:
                cell.Value = dt;
                cell.Style.DateFormat.Format = DateFormat();
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
