namespace Pako.Domain.Desktop;

public enum LicenseStatus
{
    Trial,
    Licensed,
    ReadOnly
}

public sealed record LicenseState(
    LicenseStatus Status,
    int TrialDaysLeft,
    string MachineCode,
    string? Customer,
    DateTimeOffset? ExpiresAt)
{
    public const int TrialDays = 14;

    public static LicenseState Evaluate(
        DesktopLicenseRecord record,
        string machineCode,
        DateTimeOffset now,
        ReadOnlySpan<byte> publicKey)
    {
        var effectiveNow = now > record.LastSeenAt ? now : record.LastSeenAt;

        if (!string.IsNullOrEmpty(record.LicenseKey))
        {
            var payload = LicenseVerifier.Verify(record.LicenseKey, publicKey);
            if (payload is not null
                && string.Equals(payload.MachineCode, machineCode, StringComparison.Ordinal)
                && (payload.ExpiresAt is null || payload.ExpiresAt > effectiveNow))
            {
                return new LicenseState(LicenseStatus.Licensed, 0, machineCode, payload.Customer, payload.ExpiresAt);
            }
        }

        var trialEnds = record.TrialStartedAt.AddDays(TrialDays);
        if (effectiveNow < trialEnds)
        {
            var daysLeft = (int)Math.Ceiling((trialEnds - effectiveNow).TotalDays);
            return new LicenseState(LicenseStatus.Trial, daysLeft, machineCode, null, null);
        }

        return new LicenseState(LicenseStatus.ReadOnly, 0, machineCode, null, null);
    }
}
