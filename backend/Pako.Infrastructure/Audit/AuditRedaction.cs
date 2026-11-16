using System.Text.RegularExpressions;

namespace Pako.Infrastructure.Audit;

public static class AuditRedaction
{
    public const string Redacted = "[redacted]";

    private static readonly Regex Sensitive = new(
        "password|passcode|secret|token|apikey|credential|securitystamp|concurrencystamp|personalnumber|personalid|nationalid|idnumber|passport|ssn$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex Pin = new(
        "^(?i:pin)$|^pin(?=[A-Z])|(?<=[a-z0-9])Pin(?=[A-Z]|$)",
        RegexOptions.Compiled);

    public static bool IsSensitive(string fieldName) => Sensitive.IsMatch(fieldName) || Pin.IsMatch(fieldName);
}
