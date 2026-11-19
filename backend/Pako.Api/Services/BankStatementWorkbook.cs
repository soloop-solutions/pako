using System.Globalization;
using ClosedXML.Excel;

namespace Pako.Api.Services;

public record BankStatementTemplateInfo(Guid BankAccountId, string AccountName, string? Iban, decimal OpeningBalance);

public record ParsedStatementLine(int Row, DateOnly Date, string Description, string? Partner, string? Reference, decimal AmountIn, decimal AmountOut);

public record ParsedStatement(
    Guid? BankAccountId, DateOnly? PeriodFrom, DateOnly? PeriodTo, decimal? OpeningBalance, decimal? ClosingBalance,
    List<ParsedStatementLine> Lines);

public record WorkbookRowError(int Row, string Message);

// The PAKO bank statement template (docs/BANK_STATEMENTS.md) and its reader. The layout is fixed, so
// the reader works in any language the template was downloaded in:
//   A1 title, H1 marker (hidden column), H2 bank account id
//   B3 bank account, B4 IBAN, B5 period from, B6 period to, B7 opening balance, B8 closing balance
//   row 10 headers: Date | Description | Partner | Reference | Money in | Money out
//   row 11+ one line per bank movement
public static class BankStatementWorkbook
{
    public const string Marker = "PAKO-BANK-STATEMENT-1";
    public const int MaxLines = 2000;

    private const int MarkerColumn = 8;
    private const int HeaderRow = 10;
    private const int FirstLineRow = HeaderRow + 1;

    // Blank rows in a row this many times end the list (users leave gaps; a whole empty page means done).
    private const int BlankRowsThatEnd = 20;

    public static byte[] Build(BankStatementTemplateInfo info, ExportLabels labels)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add(SheetName(labels["BankStmt_Sheet"]));

        sheet.Cell(1, 1).Value = labels["BankStmt_Title"];
        sheet.Cell(1, 1).Style.Font.Bold = true;
        sheet.Cell(1, 1).Style.Font.FontSize = 14;
        sheet.Cell(1, MarkerColumn).Value = Marker;
        sheet.Cell(2, MarkerColumn).Value = info.BankAccountId.ToString();
        sheet.Column(MarkerColumn).Hide();

        Label(3, labels["BankStmt_Account"]);
        sheet.Cell(3, 2).Value = info.AccountName;
        Label(4, labels["BankStmt_Iban"]);
        sheet.Cell(4, 2).Value = info.Iban ?? string.Empty;
        Label(5, labels["BankStmt_PeriodFrom"]);
        Label(6, labels["BankStmt_PeriodTo"]);
        Label(7, labels["BankStmt_Opening"]);
        sheet.Cell(7, 2).Value = info.OpeningBalance;
        Label(8, labels["BankStmt_Closing"]);
        foreach (var row in new[] { 5, 6 })
        {
            sheet.Cell(row, 2).Style.DateFormat.Format = "dd.mm.yyyy";
            Fillable(sheet.Cell(row, 2));
        }

        foreach (var row in new[] { 7, 8 })
        {
            sheet.Cell(row, 2).Style.NumberFormat.Format = "#,##0.00";
            Fillable(sheet.Cell(row, 2));
        }

        var headers = new[]
        {
            labels["BankStmt_Col_Date"], labels["BankStmt_Col_Description"], labels["BankStmt_Col_Partner"],
            labels["BankStmt_Col_Reference"], labels["BankStmt_Col_In"], labels["BankStmt_Col_Out"],
        };
        for (var col = 0; col < headers.Length; col++)
        {
            var cell = sheet.Cell(HeaderRow, col + 1);
            cell.Value = headers[col];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#E2E8F0");
        }

        var body = sheet.Range(FirstLineRow, 1, FirstLineRow + 499, 6);
        body.Style.Fill.BackgroundColor = XLColor.FromHtml("#FFFBEB");
        sheet.Range(FirstLineRow, 1, FirstLineRow + 499, 1).Style.DateFormat.Format = "dd.mm.yyyy";
        sheet.Range(FirstLineRow, 5, FirstLineRow + 499, 6).Style.NumberFormat.Format = "#,##0.00";

        sheet.Column(1).Width = 22;
        sheet.Column(2).Width = 40;
        sheet.Column(3).Width = 30;
        sheet.Column(4).Width = 20;
        sheet.Column(5).Width = 14;
        sheet.Column(6).Width = 14;
        sheet.SheetView.FreezeRows(HeaderRow);

        var help = workbook.Worksheets.Add(SheetName(labels["BankStmt_HelpSheet"]));
        help.Cell(1, 1).Value = labels["BankStmt_HelpTitle"];
        help.Cell(1, 1).Style.Font.Bold = true;
        for (var i = 1; i <= 6; i++)
        {
            help.Cell(i + 2, 1).Value = $"{i}. {labels[$"BankStmt_Help{i}"]}";
        }

        help.Column(1).Width = 120;

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();

        void Label(int row, string text)
        {
            sheet.Cell(row, 1).Value = text;
            sheet.Cell(row, 1).Style.Font.Bold = true;
        }

        static void Fillable(IXLCell cell) => cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#FFFBEB");
    }

    // Reads the template. Returns the statement, or the problems found (row 0 = the file itself).
    // message(key, args) localizes a resx key.
    public static (ParsedStatement? Statement, List<WorkbookRowError> Errors) Read(Stream stream, Func<string, object[], string> message)
    {
        var errors = new List<WorkbookRowError>();
        XLWorkbook workbook;
        try
        {
            workbook = new XLWorkbook(stream);
        }
        catch (Exception)
        {
            errors.Add(new(0, message("BankStmtNotExcel", [])));
            return (null, errors);
        }

        using (workbook)
        {
            var sheet = workbook.Worksheets.FirstOrDefault(s => s.Cell(1, MarkerColumn).GetString().Trim() == Marker);
            if (sheet is null)
            {
                errors.Add(new(0, message("BankStmtNotTemplate", [])));
                return (null, errors);
            }

            Guid? accountId = Guid.TryParse(sheet.Cell(2, MarkerColumn).GetString(), out var id) ? id : null;
            var periodFrom = HeaderDate(5);
            var periodTo = HeaderDate(6);
            var opening = HeaderAmount(7);
            var closing = HeaderAmount(8);
            if (opening is null)
            {
                errors.Add(new(7, message("BankStmtOpeningRequired", [])));
            }

            if (closing is null)
            {
                errors.Add(new(8, message("BankStmtClosingRequired", [])));
            }

            var lines = new List<ParsedStatementLine>();
            var blanks = 0;
            var lastRow = Math.Max(sheet.LastRowUsed()?.RowNumber() ?? 0, FirstLineRow);
            for (var row = FirstLineRow; row <= lastRow && blanks < BlankRowsThatEnd; row++)
            {
                var cells = Enumerable.Range(1, 6).Select(c => sheet.Cell(row, c)).ToArray();
                if (cells.All(c => c.IsEmpty() || c.GetString().Trim().Length == 0))
                {
                    blanks++;
                    continue;
                }

                blanks = 0;
                if (lines.Count >= MaxLines)
                {
                    errors.Add(new(row, message("BankStmtTooManyLines", [MaxLines])));
                    break;
                }

                var rowErrors = errors.Count;
                var date = ReadDate(cells[0]);
                if (date is null)
                {
                    errors.Add(new(row, message("BankStmtBadDate", [])));
                }

                var amountIn = ReadAmount(cells[4], out var badIn);
                var amountOut = ReadAmount(cells[5], out var badOut);
                if (badIn || badOut)
                {
                    errors.Add(new(row, message("BankStmtBadAmount", [])));
                }
                else if (amountIn < 0 || amountOut < 0)
                {
                    errors.Add(new(row, message("BankStmtNegativeAmount", [])));
                }
                else if (amountIn > 0 && amountOut > 0)
                {
                    errors.Add(new(row, message("BankStmtBothAmounts", [])));
                }
                else if (amountIn == 0 && amountOut == 0)
                {
                    errors.Add(new(row, message("BankStmtNoAmount", [])));
                }

                var description = cells[1].GetString().Trim();
                if (date is { } d && periodFrom is { } from && periodTo is { } to && (d < from || d > to))
                {
                    errors.Add(new(row, message("BankStmtDateOutsidePeriod", [])));
                }

                if (errors.Count == rowErrors)
                {
                    lines.Add(new ParsedStatementLine(row, date!.Value,
                        Truncate(description, 500),
                        Optional(cells[2].GetString(), 256),
                        Optional(cells[3].GetString(), 256),
                        Math.Round(amountIn, 2), Math.Round(amountOut, 2)));
                }
            }

            if (lines.Count == 0 && errors.Count == 0)
            {
                errors.Add(new(0, message("BankStmtNoLines", [])));
            }

            if (periodFrom is { } pf && periodTo is { } pt && pf > pt)
            {
                errors.Add(new(5, message("BankStmtBadPeriod", [])));
            }

            if (errors.Count > 0) return (null, errors);

            return (new ParsedStatement(accountId, periodFrom, periodTo, Math.Round(opening!.Value, 2), Math.Round(closing!.Value, 2), lines), errors);

            DateOnly? HeaderDate(int row)
            {
                var cell = sheet.Cell(row, 2);
                if (cell.IsEmpty() || cell.GetString().Trim().Length == 0) return null;
                var value = ReadDate(cell);
                if (value is null) errors.Add(new(row, message("BankStmtBadDate", [])));
                return value;
            }

            decimal? HeaderAmount(int row)
            {
                var cell = sheet.Cell(row, 2);
                if (cell.IsEmpty() || cell.GetString().Trim().Length == 0) return null;
                var value = ReadAmount(cell, out var bad);
                if (bad)
                {
                    errors.Add(new(row, message("BankStmtBadAmount", [])));
                    return 0m;
                }

                return value;
            }
        }
    }

    private static readonly string[] DateFormats =
        ["dd.MM.yyyy", "d.M.yyyy", "dd/MM/yyyy", "d/M/yyyy", "yyyy-MM-dd", "dd-MM-yyyy", "dd.MM.yy", "d.M.yy"];

    public static DateOnly? ReadDate(IXLCell cell)
    {
        if (cell.DataType == XLDataType.DateTime) return DateOnly.FromDateTime(cell.GetDateTime());
        if (cell.DataType == XLDataType.Number)
        {
            var serial = cell.GetDouble();
            return serial is > 0 and < 2958466 ? DateOnly.FromDateTime(DateTime.FromOADate(serial)) : null;
        }

        return ParseDate(cell.GetString());
    }

    public static DateOnly? ParseDate(string text)
    {
        var value = text.Trim().TrimEnd('.');
        return DateOnly.TryParseExact(value, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date : null;
    }

    public static decimal ReadAmount(IXLCell cell, out bool invalid)
    {
        invalid = false;
        if (cell.IsEmpty()) return 0m;
        if (cell.DataType == XLDataType.Number) return (decimal)cell.GetDouble();
        var parsed = ParseAmount(cell.GetString());
        invalid = parsed is null;
        return parsed ?? 0m;
    }

    // "1.234,56", "1,234.56", "1234,56", "1234.56", "1 234,56", "€ 12" are all accepted. With a single
    // separator kind, a comma is the decimal comma (as written in Kosovo) and a dot the decimal dot;
    // a lone separator followed by exactly three digits more than once ("1.234.567") is grouping.
    public static decimal? ParseAmount(string text)
    {
        var value = new string(text.Where(c => !char.IsWhiteSpace(c) && c != '€' && c != ' ').ToArray());
        if (value.EndsWith("EUR", StringComparison.OrdinalIgnoreCase)) value = value[..^3];
        if (value.Length == 0) return 0m;

        var lastComma = value.LastIndexOf(',');
        var lastDot = value.LastIndexOf('.');
        if (lastComma >= 0 && lastDot >= 0)
        {
            var decimalSep = lastComma > lastDot ? ',' : '.';
            var groupSep = decimalSep == ',' ? '.' : ',';
            value = value.Replace(groupSep.ToString(), string.Empty).Replace(decimalSep, '.');
        }
        else if (lastComma >= 0 || lastDot >= 0)
        {
            var sep = lastComma >= 0 ? ',' : '.';
            var parts = value.Split(sep);
            value = parts.Length > 2 && parts.Skip(1).All(p => p.Length == 3)
                ? string.Concat(parts)
                : value.Replace(sep, '.');
        }

        return decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var amount)
            ? amount
            : null;
    }

    private static string? Optional(string value, int max)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : Truncate(trimmed, max);
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];

    private static string SheetName(string name)
    {
        var sanitized = new string(name.Where(c => c is not ('\\' or '/' or '?' or '*' or '[' or ']' or ':')).ToArray());
        return sanitized.Length > 31 ? sanitized[..31] : sanitized;
    }
}
