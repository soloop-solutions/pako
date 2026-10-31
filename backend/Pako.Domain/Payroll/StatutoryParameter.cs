namespace Pako.Domain.Payroll;

// A dated statutory payroll value (minimum wage, pension rate, PIT band, premium…). The country's
// defaults live in code (Pako.Localization.Xk.KosovoStatutoryDefaults) and are read-only; a firm
// may add a row here to apply a new value to all its client companies before a code release —
// e.g. a minimum-wage decision announced mid-year. A firm row wins over a default with the same
// EffectiveFrom.
public class StatutoryParameter
{
    public Guid Id { get; set; }
    public Guid FirmId { get; set; }
    public string Key { get; set; } = string.Empty;
    public DateOnly EffectiveFrom { get; set; }
    public decimal Value { get; set; }
    // Where the value comes from (decision number, gazette reference).
    public string? Source { get; set; }
    public Guid CreatedByUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public static class StatutoryParameterKeys
{
    public const string MinimumWage = "MinimumWage";
    public const string PensionEmployeeRate = "PensionEmployeeRate";
    public const string PensionEmployerRate = "PensionEmployerRate";
    // Annual PIT bands: [0, Band1Upper] at Rate1, (Band1Upper, Band2Upper] at Rate2, above at Rate3.
    public const string PitBand1UpperAnnual = "PitBand1UpperAnnual";
    public const string PitBand2UpperAnnual = "PitBand2UpperAnnual";
    public const string PitRate1 = "PitRate1";
    public const string PitRate2 = "PitRate2";
    public const string PitRate3 = "PitRate3";
    public const string SecondaryEmployerRate = "SecondaryEmployerRate";
    public const string OvertimeMultiplier = "OvertimeMultiplier";
    public const string NightWorkPremium = "NightWorkPremium";
    public const string WeekendWorkPremium = "WeekendWorkPremium";
    public const string HolidayWorkPremium = "HolidayWorkPremium";
    public const string StandardWeeklyHours = "StandardWeeklyHours";

    public static readonly IReadOnlyList<string> All = new[]
    {
        MinimumWage, PensionEmployeeRate, PensionEmployerRate, PitBand1UpperAnnual, PitBand2UpperAnnual,
        PitRate1, PitRate2, PitRate3, SecondaryEmployerRate, OvertimeMultiplier, NightWorkPremium,
        WeekendWorkPremium, HolidayWorkPremium, StandardWeeklyHours
    };

    // Rates are fractions (0.05 = 5%) and must stay below 1; the others are amounts, hours or
    // multipliers.
    public static bool IsRate(string key) => key is PensionEmployeeRate or PensionEmployerRate or PitRate1 or PitRate2
        or PitRate3 or SecondaryEmployerRate or NightWorkPremium or WeekendWorkPremium or HolidayWorkPremium;
}

public record DatedParameterValue(string Key, DateOnly EffectiveFrom, decimal Value, bool IsOverride = false, bool NeedsVerification = false);

// Every statutory value in force on one date. Snapshotted onto a PayrollRun so a later edit never
// changes how an existing run was computed.
public record PayrollParameters(
    DateOnly AsOf,
    decimal MinimumWage,
    decimal PensionEmployeeRate,
    decimal PensionEmployerRate,
    decimal PitBand1UpperAnnual,
    decimal PitBand2UpperAnnual,
    decimal PitRate1,
    decimal PitRate2,
    decimal PitRate3,
    decimal SecondaryEmployerRate,
    decimal OvertimeMultiplier,
    decimal NightWorkPremium,
    decimal WeekendWorkPremium,
    decimal HolidayWorkPremium,
    decimal StandardWeeklyHours)
{
    public PayrollStatutoryRates ToRates() => new(
        new List<PitBracket>
        {
            new(0m, PitBand1UpperAnnual, PitRate1),
            new(PitBand1UpperAnnual, PitBand2UpperAnnual, PitRate2),
            new(PitBand2UpperAnnual, null, PitRate3)
        },
        PensionEmployeeRate,
        PensionEmployerRate,
        SecondaryEmployerRate);

    public decimal DefaultMultiplier(PayrollAdjustmentKind kind) => kind switch
    {
        PayrollAdjustmentKind.Overtime => OvertimeMultiplier,
        PayrollAdjustmentKind.NightWork => NightWorkPremium,
        PayrollAdjustmentKind.WeekendWork => WeekendWorkPremium,
        PayrollAdjustmentKind.HolidayWork => HolidayWorkPremium,
        _ => 1m
    };
}

public static class StatutoryParameterResolver
{
    // For each key, the newest value with EffectiveFrom ≤ date; at equal dates an override wins.
    public static PayrollParameters Resolve(IEnumerable<DatedParameterValue> values, DateOnly date)
    {
        var inForce = values
            .Where(v => v.EffectiveFrom <= date)
            .GroupBy(v => v.Key)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(v => v.EffectiveFrom).ThenByDescending(v => v.IsOverride).First().Value);

        decimal Get(string key) => inForce.TryGetValue(key, out var value)
            ? value
            : throw new InvalidOperationException($"No statutory value for {key} on {date:yyyy-MM-dd}.");

        return new PayrollParameters(
            date,
            Get(StatutoryParameterKeys.MinimumWage),
            Get(StatutoryParameterKeys.PensionEmployeeRate),
            Get(StatutoryParameterKeys.PensionEmployerRate),
            Get(StatutoryParameterKeys.PitBand1UpperAnnual),
            Get(StatutoryParameterKeys.PitBand2UpperAnnual),
            Get(StatutoryParameterKeys.PitRate1),
            Get(StatutoryParameterKeys.PitRate2),
            Get(StatutoryParameterKeys.PitRate3),
            Get(StatutoryParameterKeys.SecondaryEmployerRate),
            Get(StatutoryParameterKeys.OvertimeMultiplier),
            Get(StatutoryParameterKeys.NightWorkPremium),
            Get(StatutoryParameterKeys.WeekendWorkPremium),
            Get(StatutoryParameterKeys.HolidayWorkPremium),
            Get(StatutoryParameterKeys.StandardWeeklyHours));
    }
}
