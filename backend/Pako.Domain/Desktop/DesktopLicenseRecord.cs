namespace Pako.Domain.Desktop;

public class DesktopLicenseRecord
{
    public Guid Id { get; set; }
    public DateTimeOffset TrialStartedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public string? LicenseKey { get; set; }
}
