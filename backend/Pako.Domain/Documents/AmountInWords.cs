using System.Globalization;

namespace Pako.Domain.Documents;

// Client request 2026-11-23: the printed invoice states its total in words ("Me fjalë"), as Kosovo
// invoices customarily do. Whole currency units are spelled out; cents stay as digits
// ("njëqind e tetëmbëdhjetë euro e 50 cent"). Albanian for "sq", English otherwise.
public static class AmountInWords
{
    public static string ToWords(decimal amount, string currency, CultureInfo culture)
    {
        var albanian = culture.TwoLetterISOLanguageName == "sq";
        var rounded = Math.Round(amount, 2, MidpointRounding.AwayFromZero);
        var negative = rounded < 0;
        var absolute = Math.Abs(rounded);
        var whole = (long)Math.Truncate(absolute);
        var cents = (int)((absolute - whole) * 100m);
        var unit = string.Equals(currency, "EUR", StringComparison.OrdinalIgnoreCase) ? "euro" : currency;

        string text;
        if (albanian)
        {
            text = $"{Sq(whole)} {unit}";
            if (cents > 0) text += $" e {cents:00} cent";
            if (negative) text = "minus " + text;
        }
        else
        {
            text = $"{En(whole)} {unit}";
            if (cents > 0) text += $" and {cents:00} cents";
            if (negative) text = "minus " + text;
        }
        return text;
    }

    // ---- Albanian ----

    private static readonly string[] SqUnits =
    [
        "zero", "një", "dy", "tre", "katër", "pesë", "gjashtë", "shtatë", "tetë", "nëntë",
        "dhjetë", "njëmbëdhjetë", "dymbëdhjetë", "trembëdhjetë", "katërmbëdhjetë", "pesëmbëdhjetë",
        "gjashtëmbëdhjetë", "shtatëmbëdhjetë", "tetëmbëdhjetë", "nëntëmbëdhjetë",
    ];

    private static readonly string[] SqTens =
        ["", "", "njëzet", "tridhjetë", "dyzet", "pesëdhjetë", "gjashtëdhjetë", "shtatëdhjetë", "tetëdhjetë", "nëntëdhjetë"];

    private static string Sq(long n)
    {
        if (n == 0) return SqUnits[0];
        var parts = new List<string>();
        var billions = n / 1_000_000_000;
        var millions = n / 1_000_000 % 1000;
        var thousands = n / 1000 % 1000;
        var rest = n % 1000;
        if (billions > 0) parts.Add(billions == 1 ? "një miliard" : $"{Sq(billions)} miliardë");
        if (millions > 0) parts.Add(millions == 1 ? "një milion" : $"{SqBelow1000(millions)} milionë");
        if (thousands > 0) parts.Add($"{SqBelow1000(thousands)} mijë");
        if (rest > 0) parts.Add(SqBelow1000(rest));
        return string.Join(" e ", parts);
    }

    private static string SqBelow1000(long n)
    {
        var hundreds = n / 100;
        var rest = n % 100;
        var parts = new List<string>();
        if (hundreds > 0) parts.Add(SqUnits[hundreds] + "qind");
        if (rest > 0) parts.Add(rest < 20 ? SqUnits[rest] : rest % 10 == 0 ? SqTens[rest / 10] : $"{SqTens[rest / 10]} e {SqUnits[rest % 10]}");
        return string.Join(" e ", parts);
    }

    // ---- English ----

    private static readonly string[] EnUnits =
    [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
    ];

    private static readonly string[] EnTens =
        ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

    private static string En(long n)
    {
        if (n == 0) return EnUnits[0];
        var parts = new List<string>();
        var billions = n / 1_000_000_000;
        var millions = n / 1_000_000 % 1000;
        var thousands = n / 1000 % 1000;
        var rest = n % 1000;
        if (billions > 0) parts.Add($"{En(billions)} billion");
        if (millions > 0) parts.Add($"{EnBelow1000(millions)} million");
        if (thousands > 0) parts.Add($"{EnBelow1000(thousands)} thousand");
        if (rest > 0) parts.Add(EnBelow1000(rest));
        return string.Join(" ", parts);
    }

    private static string EnBelow1000(long n)
    {
        var hundreds = n / 100;
        var rest = n % 100;
        var parts = new List<string>();
        if (hundreds > 0) parts.Add($"{EnUnits[hundreds]} hundred");
        if (rest > 0) parts.Add(rest < 20 ? EnUnits[rest] : rest % 10 == 0 ? EnTens[rest / 10] : $"{EnTens[rest / 10]}-{EnUnits[rest % 10]}");
        return string.Join(" ", parts);
    }
}
