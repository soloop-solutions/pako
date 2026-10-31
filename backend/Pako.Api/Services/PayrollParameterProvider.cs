using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pako.Domain.Payroll;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Services;

// Resolves the statutory payroll values in force for a company on a date: the Kosovo defaults
// from code plus any override the company's firm has entered.
public class PayrollParameterProvider
{
    private readonly PakoDbContext _db;

    public PayrollParameterProvider(PakoDbContext db) => _db = db;

    public async Task<PayrollParameters> ForCompanyAsync(Guid companyId, DateOnly date)
    {
        var firmId = await _db.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.FirmId).FirstOrDefaultAsync();
        return StatutoryParameterResolver.Resolve(await ValuesAsync(firmId), date);
    }

    public async Task<List<DatedParameterValue>> ValuesAsync(Guid? firmId)
    {
        var values = new List<DatedParameterValue>(KosovoStatutoryDefaults.All);
        if (firmId is { } id)
        {
            values.AddRange(await _db.StatutoryParameters.AsNoTracking()
                .Where(p => p.FirmId == id)
                .Select(p => new DatedParameterValue(p.Key, p.EffectiveFrom, p.Value, true, false))
                .ToListAsync());
        }

        return values;
    }

    public static string Serialize(PayrollParameters parameters) => JsonSerializer.Serialize(parameters);

    public static PayrollParameters? Deserialize(string? snapshot) =>
        string.IsNullOrEmpty(snapshot) ? null : JsonSerializer.Deserialize<PayrollParameters>(snapshot);
}
