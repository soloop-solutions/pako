using System.Numerics;

namespace Pako.Domain.Hr;

public static class EmployeeValidation
{
    // Kosovo personal number (numri personal): 10 digits.
    public static bool IsValidPersonalNumber(string value) => value.Length == 10 && value.All(char.IsAsciiDigit);

    public static string NormalizeIban(string value) =>
        new string(value.Where(c => !char.IsWhiteSpace(c)).ToArray()).ToUpperInvariant();

    // ISO 13616: country code, check digits, then mod-97 of the rearranged number must be 1.
    public static bool IsValidIban(string normalized)
    {
        if (normalized.Length is < 15 or > 34 || !normalized.All(char.IsAsciiLetterOrDigit) ||
            !char.IsAsciiLetter(normalized[0]) || !char.IsAsciiLetter(normalized[1]) ||
            !char.IsAsciiDigit(normalized[2]) || !char.IsAsciiDigit(normalized[3]))
        {
            return false;
        }

        var rearranged = normalized[4..] + normalized[..4];
        var digits = string.Concat(rearranged.Select(c => char.IsAsciiDigit(c) ? c.ToString() : (c - 'A' + 10).ToString()));
        return BigInteger.Parse(digits) % 97 == 1;
    }
}
