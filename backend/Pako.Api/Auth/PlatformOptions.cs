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

    // The first administrator, created once on startup while the database has none (see
    // PlatformBootstrap). Development ships a local default; elsewhere set it through environment
    // variables (Platform__BootstrapAdmin__Email / __Password) for the first start only.
    public BootstrapAdminOptions BootstrapAdmin { get; set; } = new();

    public bool IsAdminEmail(string? email) =>
        email is not null && AdminEmails.Any(e => string.Equals(e.Trim(), email.Trim(), StringComparison.OrdinalIgnoreCase));
}

public class BootstrapAdminOptions
{
    public string? Email { get; set; }
    public string? Password { get; set; }
}
