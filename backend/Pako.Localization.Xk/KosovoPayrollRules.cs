namespace Pako.Localization.Xk;

public record KosovoMinimumWage(DateOnly EffectiveFrom, decimal MonthlyGrossEur, SourceConfidence Confidence);

public record KosovoLeaveTypeTemplate(string Code, string NameSq, string NameEn, decimal? DefaultAnnualDays, decimal PayPercent);

public record KosovoPublicHolidayTemplate(DateOnly Date, string NameSq, string NameEn, SourceConfidence Confidence);

// Labour Law 03/L-212 and Law 08/L-142 parameters the payroll and leave modules read. Dated or
// flagged wherever the source is not a primary legal text — confirm with the partner accounting
// firm before go-live (docs/HR_MODULE_PLAN.md §3).
public static class KosovoPayrollRules
{
    // Law 08/L-142: a secondary employer withholds 10% on the whole amount, no 0% band.
    public const decimal SecondaryEmployerFlatRate = 0.10m;
    public const SourceConfidence SecondaryEmployerConfidence = SourceConfidence.NeedsLegalVerification;

    // Monthly hours basis for the hourly rate (40 h × 52 / 12 ≈ 173.33).
    public const decimal StandardWeeklyHours = 40m;

    // Art. 56: overtime paid at 130% of the hourly rate; the others are premiums on top of hours
    // already in the base salary.
    public const decimal OvertimeMultiplier = 1.30m;
    public const decimal NightWorkPremium = 0.20m;
    public const decimal WeekendWorkPremium = 0.50m;
    public const decimal HolidayWorkPremium = 0.50m;
    public const SourceConfidence PremiumsConfidence = SourceConfidence.NeedsLegalVerification;

    // Gov. decisions; the newest row whose EffectiveFrom ≤ the date applies.
    public static readonly IReadOnlyList<KosovoMinimumWage> MinimumWages = new List<KosovoMinimumWage>
    {
        new(new DateOnly(2024, 10, 1), 350m, SourceConfidence.NeedsLegalVerification),
        new(new DateOnly(2026, 1, 1), 425m, SourceConfidence.NeedsLegalVerification),
        new(new DateOnly(2026, 7, 1), 500m, SourceConfidence.NeedsLegalVerification)
    };

    public static decimal? MinimumWageOn(DateOnly date) =>
        MinimumWages.Where(w => w.EffectiveFrom <= date).OrderByDescending(w => w.EffectiveFrom)
            .Select(w => (decimal?)w.MonthlyGrossEur).FirstOrDefault();

    // Seeded per company the first time leave is used; editable afterwards.
    public static readonly IReadOnlyList<KosovoLeaveTypeTemplate> LeaveTypes = new List<KosovoLeaveTypeTemplate>
    {
        new("ANNUAL", "Pushim vjetor", "Annual leave", 20m, 100m),
        new("SICK", "Pushim mjekësor", "Sick leave", 20m, 100m),
        new("MATERNITY", "Pushim i lehonisë", "Maternity leave", null, 70m),
        new("UNPAID", "Pushim pa pagesë", "Unpaid leave", null, 0m),
        new("OTHER", "Pushim tjetër me pagesë", "Other paid leave", null, 100m)
    };

    // Law 03/L-064 on official holidays. Moveable (Easter, Eid) dates are per year and must be
    // checked against the government's annual announcement.
    public static readonly IReadOnlyList<KosovoPublicHolidayTemplate> PublicHolidays = BuildHolidays();

    private static IReadOnlyList<KosovoPublicHolidayTemplate> BuildHolidays()
    {
        var list = new List<KosovoPublicHolidayTemplate>();
        foreach (var year in new[] { 2026, 2027 })
        {
            list.Add(new(new DateOnly(year, 1, 1), "Viti i Ri", "New Year's Day", SourceConfidence.PrimarySource));
            list.Add(new(new DateOnly(year, 1, 2), "Viti i Ri (dita e dytë)", "New Year (second day)", SourceConfidence.PrimarySource));
            list.Add(new(new DateOnly(year, 1, 7), "Krishtlindjet ortodokse", "Orthodox Christmas", SourceConfidence.PrimarySource));
            list.Add(new(new DateOnly(year, 2, 17), "Dita e Pavarësisë", "Independence Day", SourceConfidence.PrimarySource));
            list.Add(new(new DateOnly(year, 4, 9), "Dita e Kushtetutës", "Constitution Day", SourceConfidence.PrimarySource));
            list.Add(new(new DateOnly(year, 5, 1), "Dita Ndërkombëtare e Punës", "Labour Day", SourceConfidence.PrimarySource));
            list.Add(new(new DateOnly(year, 5, 9), "Dita e Evropës", "Europe Day", SourceConfidence.PrimarySource));
            list.Add(new(new DateOnly(year, 12, 25), "Krishtlindjet katolike", "Catholic Christmas", SourceConfidence.PrimarySource));
        }

        list.Add(new(new DateOnly(2026, 3, 20), "Fitër Bajrami", "Eid al-Fitr", SourceConfidence.NeedsLegalVerification));
        list.Add(new(new DateOnly(2026, 4, 6), "Pashkët katolike (e hënë)", "Catholic Easter Monday", SourceConfidence.NeedsLegalVerification));
        list.Add(new(new DateOnly(2026, 4, 13), "Pashkët ortodokse (e hënë)", "Orthodox Easter Monday", SourceConfidence.NeedsLegalVerification));
        list.Add(new(new DateOnly(2026, 5, 27), "Kurban Bajrami", "Eid al-Adha", SourceConfidence.NeedsLegalVerification));
        list.Add(new(new DateOnly(2027, 3, 10), "Fitër Bajrami", "Eid al-Fitr", SourceConfidence.NeedsLegalVerification));
        list.Add(new(new DateOnly(2027, 3, 29), "Pashkët katolike (e hënë)", "Catholic Easter Monday", SourceConfidence.NeedsLegalVerification));
        list.Add(new(new DateOnly(2027, 5, 3), "Pashkët ortodokse (e hënë)", "Orthodox Easter Monday", SourceConfidence.NeedsLegalVerification));
        list.Add(new(new DateOnly(2027, 5, 17), "Kurban Bajrami", "Eid al-Adha", SourceConfidence.NeedsLegalVerification));
        return list.OrderBy(h => h.Date).ToList();
    }
}
