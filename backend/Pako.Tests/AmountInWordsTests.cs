using System.Globalization;
using Pako.Domain.Documents;

namespace Pako.Tests;

// Client request 2026-11-23: the printed invoice's total in words.
public class AmountInWordsTests
{
    private static readonly CultureInfo Sq = new("sq-AL");
    private static readonly CultureInfo En = new("en-US");

    [Theory]
    [InlineData("0", "zero euro")]
    [InlineData("21", "njëzet e një euro")]
    [InlineData("118.50", "njëqind e tetëmbëdhjetë euro e 50 cent")]
    [InlineData("2345", "dy mijë e treqind e dyzet e pesë euro")]
    [InlineData("1000000", "një milion euro")]
    [InlineData("3200000.07", "tre milionë e dyqind mijë euro e 07 cent")]
    [InlineData("-10", "minus dhjetë euro")]
    public void Albanian(string amount, string expected) =>
        Assert.Equal(expected, AmountInWords.ToWords(decimal.Parse(amount, CultureInfo.InvariantCulture), "EUR", Sq));

    [Theory]
    [InlineData("1234.05", "one thousand two hundred thirty-four euro and 05 cents")]
    [InlineData("90", "ninety euro")]
    public void English(string amount, string expected) =>
        Assert.Equal(expected, AmountInWords.ToWords(decimal.Parse(amount, CultureInfo.InvariantCulture), "EUR", En));

    [Fact]
    public void AnotherCurrency_IsNamedByItsCode() =>
        Assert.Equal("pesë USD", AmountInWords.ToWords(5m, "USD", Sq));
}
