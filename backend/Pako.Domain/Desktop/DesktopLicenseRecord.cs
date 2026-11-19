namespace Pako.Domain.Desktop;

public class DesktopLicenseRecord
{
    public Guid Id { get; set; }
    public DateTimeOffset TrialStartedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public string? LicenseKey { get; set; }

    public static DesktopLicenseRecord Start(DateTimeOffset now) =>
        new() { Id = Guid.NewGuid(), TrialStartedAt = now, LastSeenAt = now };

    public bool Touch(DateTimeOffset now)
    {
        if (now <= LastSeenAt) return false;
        LastSeenAt = now;
        return true;
    }
}
