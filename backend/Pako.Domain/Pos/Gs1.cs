namespace Pako.Domain.Pos;

// docs/POS_PLAN.md P7: a GS1 DataMatrix (medicine packs, EU FMD style) as a scanner types it — an
// optional "]d2" symbology prefix, application identifiers, variable fields ended by the GS
// character (FNC1). Reads the GTIN (01), expiry (17, YYMMDD; day 00 = end of month), lot (10) and
// serial (21); other identifiers are skipped.
public static class Gs1
{
    public const char GroupSeparator = '\u001d';

    public record Element(string Gtin, string? Lot, DateOnly? Expiry, string? Serial);

    private static readonly Dictionary<string, int> Fixed = new() { ["00"] = 18, ["01"] = 14, ["02"] = 14, ["11"] = 6, ["13"] = 6, ["15"] = 6, ["17"] = 6 };

    public static Element? Parse(string code)
    {
        if (string.IsNullOrEmpty(code)) return null;
        var s = code.StartsWith("]d2", StringComparison.Ordinal) || code.StartsWith("]C1", StringComparison.Ordinal) ? code[3..] : code;
        s = s.TrimStart(GroupSeparator);
        if (!s.StartsWith("01", StringComparison.Ordinal) || s.Length < 16) return null;
        string? gtin = null, lot = null, serial = null;
        DateOnly? expiry = null;
        var i = 0;
        while (i < s.Length)
        {
            if (s[i] == GroupSeparator) { i++; continue; }
            if (i + 2 > s.Length) return null;
            var ai = s.Substring(i, 2);
            i += 2;
            string value;
            if (Fixed.TryGetValue(ai, out var length))
            {
                if (i + length > s.Length) return null;
                value = s.Substring(i, length);
                i += length;
            }
            else if (ai is "10" or "21" or "30" or "37" or "90" or "91" or "92" or "93" or "94" or "95" or "96" or "97" or "98" or "99")
            {
                var end = s.IndexOf(GroupSeparator, i);
                if (end < 0) end = s.Length;
                value = s[i..end];
                i = end;
            }
            else
            {
                // An identifier this reader doesn't know: the rest can't be split safely.
                break;
            }
            switch (ai)
            {
                case "01": gtin = value; break;
                case "10": lot = value; break;
                case "21": serial = value; break;
                case "17": expiry = ParseDate(value); break;
            }
        }
        return gtin is null || !gtin.All(char.IsAsciiDigit) ? null : new Element(gtin, lot, expiry, serial);
    }

    private static DateOnly? ParseDate(string yymmdd)
    {
        if (yymmdd.Length != 6 || !yymmdd.All(char.IsAsciiDigit)) return null;
        var year = 2000 + int.Parse(yymmdd[..2]);
        var month = int.Parse(yymmdd.Substring(2, 2));
        var day = int.Parse(yymmdd.Substring(4, 2));
        if (month is < 1 or > 12) return null;
        if (day == 0) day = DateTime.DaysInMonth(year, month);
        return day <= DateTime.DaysInMonth(year, month) ? new DateOnly(year, month, day) : null;
    }

    // The barcodes a GTIN-14 may be stored as: itself, and the EAN-13/UPC-A without leading zeros.
    public static List<string> Candidates(string gtin)
    {
        var list = new List<string> { gtin };
        var trimmed = gtin;
        while (trimmed.Length > 8 && trimmed[0] == '0')
        {
            trimmed = trimmed[1..];
            if (trimmed.Length is 13 or 12 or 8) list.Add(trimmed);
        }
        return list;
    }
}
