namespace Pako.Domain.Pos;

// docs/POS_PLAN.md P2 (grocery): in-store EAN-13 barcodes starting 20–29, printed by label scales.
// After the two-digit prefix come the item's PLU, a value (weight, price or quantity) and the check
// digit: 2 + ItemDigits + ValueDigits + 1 = 13.
public enum BarcodeRuleKind
{
    Weight,
    Price,
    Quantity,
}

public class BarcodeRule
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Prefix { get; set; } = string.Empty;
    public BarcodeRuleKind Kind { get; set; }
    public int ItemDigits { get; set; } = 5;
    public int ValueDigits { get; set; } = 5;
    // Weight in kg with 3 decimals (grams), price in € with 2, quantity with 0.
    public int ValueDecimals { get; set; } = 3;
    public bool IsActive { get; set; } = true;
}

public static class BarcodeScanner
{
    public record Decoded(BarcodeRule Rule, string Plu, decimal Value);

    // Used when a company has set up no rules: the usual Kosovo/EU scale layouts.
    public static IReadOnlyList<BarcodeRule> Defaults { get; } = new[]
    {
        new BarcodeRule { Prefix = "21", Kind = BarcodeRuleKind.Weight, ItemDigits = 5, ValueDigits = 5, ValueDecimals = 3 },
        new BarcodeRule { Prefix = "22", Kind = BarcodeRuleKind.Price, ItemDigits = 5, ValueDigits = 5, ValueDecimals = 2 },
    };

    public static bool ValidLayout(BarcodeRule rule) =>
        rule.Prefix.Length == 2 && rule.Prefix[0] == '2' && char.IsAsciiDigit(rule.Prefix[1])
        && rule.ItemDigits is >= 1 and <= 6 && rule.ValueDigits >= 1 && rule.ItemDigits + rule.ValueDigits == 10
        && rule.ValueDecimals is >= 0 and <= 3;

    public static bool CheckDigitValid(string ean13)
    {
        if (ean13.Length != 13 || !ean13.All(char.IsAsciiDigit)) return false;
        var sum = 0;
        for (var i = 0; i < 12; i++) sum += (ean13[i] - '0') * (i % 2 == 0 ? 1 : 3);
        return (10 - sum % 10) % 10 == ean13[12] - '0';
    }

    // The rule a code matches and what it carries; null when it isn't an in-store code.
    public static Decoded? Decode(string code, IEnumerable<BarcodeRule> rules)
    {
        if (!CheckDigitValid(code)) return null;
        var rule = rules.FirstOrDefault(r => r.IsActive && ValidLayout(r) && code.StartsWith(r.Prefix, StringComparison.Ordinal));
        if (rule is null) return null;
        // The PLU is matched without its leading zeros (scales pad it).
        var plu = code.Substring(2, rule.ItemDigits).TrimStart('0');
        var digits = long.Parse(code.Substring(2 + rule.ItemDigits, rule.ValueDigits));
        var value = digits / (decimal)Math.Pow(10, rule.ValueDecimals);
        return new Decoded(rule, plu.Length == 0 ? "0" : plu, value);
    }
}
