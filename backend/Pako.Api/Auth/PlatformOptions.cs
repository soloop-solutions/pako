namespace Pako.Api.Auth;

// docs/PLATFORM_ADMIN.md. "Platform" in appsettings.
public class PlatformOptions
{
    public const string Section = "Platform";

    // Accounts with these emails become platform administrators when they sign in (bootstrap: the
    // first administrator can't be appointed from a panel nobody can open yet).
    public List<string> AdminEmails { get; set; } = new();

    // Off in production: people request an account and an administrator approves it. On only for
    // local development, where the e2e and demo-seed scripts register their own throwaway users.
    public bool AllowSelfRegistration { get; set; }

    public bool IsAdminEmail(string? email) =>
        email is not null && AdminEmails.Any(e => string.Equals(e.Trim(), email.Trim(), StringComparison.OrdinalIgnoreCase));
}
