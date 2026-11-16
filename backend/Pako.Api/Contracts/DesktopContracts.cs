namespace Pako.Api.Contracts;

public record DesktopLicenseResponse(
    string Status, int TrialDaysLeft, string MachineCode, string? Customer, DateTimeOffset? ExpiresAt);

public record ActivateLicenseRequest(string LicenseKey);

public record DesktopSetupStatusResponse(bool NeedsSetup);

public record DesktopSetupRequest(string Email, string Password, string FullName);

public record DesktopSetupResponse(string RecoveryCode);

public record RecoverAdminRequest(string Email, string RecoveryCode, string NewPassword);
