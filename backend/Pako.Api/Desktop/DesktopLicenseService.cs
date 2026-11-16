using Microsoft.EntityFrameworkCore;
using Pako.Domain.Desktop;
using Pako.Infrastructure;

namespace Pako.Api.Desktop;

public sealed record LicensePublicKeyHolder(byte[] Value);

public sealed class DesktopLicenseService(
    PakoDbContext db,
    IMachineIdProvider machineId,
    LicensePublicKeyHolder publicKey,
    TimeProvider clock)
{
    public async Task<LicenseState> EvaluateAsync(CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var record = await GetOrCreateAsync(now, ct);
        var state = LicenseState.Evaluate(record, MachineCode.Compute(machineId.GetMachineGuid()), now, publicKey.Value);
        record.Touch(now);
        await db.SaveChangesAsync(ct);
        return state;
    }

    public async Task<LicenseState?> ActivateAsync(string licenseKey, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var record = await GetOrCreateAsync(now, ct);
        var previous = record.LicenseKey;
        record.LicenseKey = licenseKey.Trim();
        var state = LicenseState.Evaluate(record, MachineCode.Compute(machineId.GetMachineGuid()), now, publicKey.Value);
        if (state.Status != LicenseStatus.Licensed)
        {
            record.LicenseKey = previous;
            record.Touch(now);
            await db.SaveChangesAsync(ct);
            return null;
        }
        record.Touch(now);
        await db.SaveChangesAsync(ct);
        return state;
    }

    private async Task<DesktopLicenseRecord> GetOrCreateAsync(DateTimeOffset now, CancellationToken ct)
    {
        var record = await db.DesktopLicenseRecords
            .OrderBy(r => r.TrialStartedAt).ThenBy(r => r.Id)
            .FirstOrDefaultAsync(ct);
        if (record is not null) return record;
        record = DesktopLicenseRecord.Start(now);
        db.DesktopLicenseRecords.Add(record);
        return record;
    }
}
