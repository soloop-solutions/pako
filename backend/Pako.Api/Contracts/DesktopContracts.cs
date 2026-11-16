namespace Pako.Api.Contracts;

public record DesktopLicenseResponse(
    string Status, int TrialDaysLeft, string MachineCode, string? Customer, DateTimeOffset? ExpiresAt);

public record ActivateLicenseRequest(string LicenseKey);
