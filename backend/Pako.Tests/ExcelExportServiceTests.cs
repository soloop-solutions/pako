using ClosedXML.Excel;
using Pako.Api.Services;

namespace Pako.Tests;

public class ExcelExportServiceTests
{
    [Fact]
    public void BuildWorkbook_WritesHeaderRowAndDataRows()
    {
        var bytes = ExcelExportService.BuildWorkbook(
            "Sheet1",
            new[] { "Code", "Name", "Amount" },
            new List<IReadOnlyList<object?>>
            {
                new object?[] { "1000", "Cash", 123.45m },
                new object?[] { "2000", "Payables", -50m }
            });

        using var workbook = new XLWorkbook(new MemoryStream(bytes));
        var sheet = workbook.Worksheet(1);

        Assert.Equal("Code", sheet.Cell(1, 1).GetString());
        Assert.Equal("Name", sheet.Cell(1, 2).GetString());
        Assert.Equal("Amount", sheet.Cell(1, 3).GetString());
        Assert.True(sheet.Cell(1, 1).Style.Font.Bold);

        Assert.Equal("1000", sheet.Cell(2, 1).GetString());
        Assert.Equal("Cash", sheet.Cell(2, 2).GetString());
        Assert.Equal(123.45m, sheet.Cell(2, 3).GetValue<decimal>());

        Assert.Equal("2000", sheet.Cell(3, 1).GetString());
        Assert.Equal(-50m, sheet.Cell(3, 3).GetValue<decimal>());
    }

    [Fact]
    public void BuildWorkbook_LeavesNullCellsBlank()
    {
        var bytes = ExcelExportService.BuildWorkbook(
            "Sheet1", new[] { "A", "B" }, new List<IReadOnlyList<object?>> { new object?[] { null, "x" } });

        using var workbook = new XLWorkbook(new MemoryStream(bytes));
        var sheet = workbook.Worksheet(1);

        Assert.True(sheet.Cell(2, 1).IsEmpty());
        Assert.Equal("x", sheet.Cell(2, 2).GetString());
    }

    [Fact]
    public void BuildWorkbook_SanitizesSheetNameForExcelRestrictions()
    {
        var bytes = ExcelExportService.BuildWorkbook(
            "A/B:C*D?E[F]G-Named-Extremely-Long-Report-Title-Over-31-Chars",
            new[] { "X" }, new List<IReadOnlyList<object?>>());

        using var workbook = new XLWorkbook(new MemoryStream(bytes));
        var sheet = workbook.Worksheet(1);

        Assert.True(sheet.Name.Length <= 31);
        Assert.DoesNotContain(sheet.Name, "\\/?*[]".Select(c => c.ToString()));
    }

    [Fact]
    public void BuildWorkbook_FormatsDateOnlyCells()
    {
        var bytes = ExcelExportService.BuildWorkbook(
            "Sheet1", new[] { "Date" }, new List<IReadOnlyList<object?>> { new object?[] { new DateOnly(2026, 3, 15) } });

        using var workbook = new XLWorkbook(new MemoryStream(bytes));
        var sheet = workbook.Worksheet(1);

        Assert.Equal(new DateTime(2026, 3, 15), sheet.Cell(2, 1).GetDateTime());
    }
}
