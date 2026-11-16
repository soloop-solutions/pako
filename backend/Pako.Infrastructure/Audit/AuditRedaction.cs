using System.Text.RegularExpressions;

namespace Pako.Infrastructure.Audit;

public static class AuditRedaction
{
    public const string Redacted = "[redacted]";

    private static readonly Regex Sensitive = new(
        "password|passcode|secret|token|apikey|credential|securitystamp|concurrencystamp",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static bool IsSensitive(string fieldName) => Sensitive.IsMatch(fieldName);
}
