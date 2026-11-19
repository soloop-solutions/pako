using ClosedXML.Excel;
using Pako.Api.Services;
using Pako.Domain.Companies;

namespace Pako.Tests;

public class ExcelNegativeNumberStyleTests
{
    private static string FormatOfFirstAmount(NegativeNumberStyle style)
    {
        ExcelExportService.CurrentNegativeStyle = style;
        try
        {
            var bytes = ExcelExportService.BuildWorkbook("S", new[] { "Amount" }, new[] { (IReadOnlyList<object?>)new object?[] { -100m } });
            using var workbook = new XLWorkbook(new MemoryStream(bytes));
            return workbook.Worksheet(1).Cell(2, 1).Style.NumberFormat.Format;
        }
        finally
        {
            ExcelExportService.CurrentNegativeStyle = NegativeNumberStyle.Parentheses;
        }
    }

    [Fact]
    public void Export_DefaultsToParentheses_NeverParenthesesWithMinus()
    {
        var format = FormatOfFirstAmount(NegativeNumberStyle.Parentheses);
        Assert.Contains("(#,##0.00)", format);
        Assert.DoesNotContain("-", format);
    }

    [Fact]
    public void Export_MinusSignStyle_HasNoParentheses()
    {
        Assert.Equal("#,##0.00", FormatOfFirstAmount(NegativeNumberStyle.MinusSign));
    }
}
